/**
 * SPC700 playback.
 *
 * Owns an AudioContext, a GainNode for volume, and an AudioWorkletNode running
 * `worklet.ts`, which holds the emulator. The wasm is compiled here and posted
 * across because an AudioWorkletGlobalScope cannot fetch. Playback state lives on
 * the audio thread, so position arrives as events rather than being polled off the
 * context clock — which stays accurate across pause and seek.
 */

import { SPC_PROCESSOR, type FromWorklet, type SpcProcessorOptions, type ToWorklet } from "./protocol";
import type { DriverState } from "./driver-state";

export class PlayerError extends Error {}

export type PlayerState = "idle" | "playing" | "paused";

/**
 * What a caller knows about a song that its ID666 header does not say.
 *
 * The shape is given in music ticks, not seconds, because that is what the
 * player follows: it counts the driver's own ticks out of the emulator rather
 * than timing the song against a clock. Ticks are exact on both sides; the
 * seconds they take are not predictable, since a busy song makes the driver drop
 * ticks (`main.asm`, `MainLoop`).
 */
export interface SongTiming {
	/** Ticks in the intro, played once. 0 for a song with no intro. */
	introTicks?: number;
	/** Ticks in the main loop. 0 when the compiler could not work it out, which
	 * leaves the song playing until it is stopped. */
	loopTicks?: number;
	/** Seconds of fade after the end. Omitted, the ID666 fade is used. */
	fadeSeconds?: number;
	/**
	 * Whether the song data loops on its own. Defaults to true, which is the
	 * normal case; set it false so loop mode restarts the song by hand.
	 */
	songLoops?: boolean;
}

/**
 * ID666 stores this as ASCII digits in the file header, so a song carries its
 * own fade. Reading it here keeps `play()` down to the bytes and works for any
 * `.spc`, not only the ones `buildSpc` produces.
 */
const ID666_FADE = 0xac; // 5 digits, milliseconds

/** The player allows a little headroom above unity, as the old backend did. */
const MAX_VOLUME = 5;

function readDigits(spc: Uint8Array, offset: number, length: number): number {
	if (spc.length < offset + length) {
		return 0;
	}

	let text = "";
	for (let index = 0; index < length; index++) {
		const code = spc[offset + index];
		if (code < 0x30 || code > 0x39) {
			break;
		} // NUL- or space-padded

		text += String.fromCharCode(code);
	}

	const value = Number.parseInt(text, 10);
	return Number.isFinite(value) ? value : 0;
}

export class SpcPlayer {
	private context: AudioContext | null = null;
	private node: AudioWorkletNode | null = null;
	private gain: GainNode | null = null;

	private state: PlayerState = "idle";
	private position = 0;
	private songTicks = 0;
	private volume = 1;
	private looping = false;
	private muteMask = 0;
	/**
	 * Counts loads and seeks, so a position that was already in flight when the
	 * playhead moved can be told from one that reflects the move.
	 */
	private epoch = 0;

	/**
	 * Where the song has got to, pushed from the audio thread roughly ten times a
	 * second.
	 *
	 * In music ticks, and within one pass: a looping song reports the same range
	 * over and over. Ticks rather than seconds because they are counted off the
	 * driver, so they stay in step with what is being heard however long it plays
	 * — which seconds derived from a predicted tempo do not.
	 */
	onPosition: ((songTicks: number) => void) | null = null;
	/**
	 * What the driver is doing, alongside every position update: where each voice
	 * is reading its music data, and the tempo in force. For views that follow the
	 * song rather than just time it.
	 */
	onDriverState: ((state: DriverState) => void) | null = null;
	/** The song reached the end of its length and fade, and is not looping. */
	onEnded: (() => void) | null = null;
	/** The emulator or the audio graph failed; playback has stopped. */
	onError: ((error: PlayerError) => void) | null = null;

	constructor(private readonly baseUrl = "player") {}

	get status(): PlayerState {
		return this.state;
	}

	get isReady(): boolean {
		return this.node !== null;
	}

	/**
	 * Must be called from a user gesture: creating and resuming an AudioContext
	 * is blocked by autoplay policy otherwise.
	 */
	async init(): Promise<void> {
		if (this.node) {
			return;
		}

		if (typeof WebAssembly === "undefined") {
			throw new PlayerError("This browser has no WebAssembly support.");
		}

		if (typeof AudioContext === "undefined") {
			throw new PlayerError("This browser has no Web Audio support.");
		}

		const context = new AudioContext();
		try {
			const [module] = await Promise.all([this.compile(), this.addModule(context)]);

			const node = new AudioWorkletNode(context, SPC_PROCESSOR, {
				numberOfInputs: 0,
				numberOfOutputs: 1,
				outputChannelCount: [2],
				processorOptions: { module } satisfies SpcProcessorOptions,
			});
			node.port.onmessage = (event: MessageEvent<FromWorklet>) => this.receive(event.data);
			node.onprocessorerror = () => {
				this.state = "idle";
				this.onError?.(new PlayerError("The SPC renderer stopped unexpectedly."));
			};

			const gain = context.createGain();
			gain.gain.value = this.volume;
			node.connect(gain).connect(context.destination);

			this.context = context;
			this.node = node;
			this.gain = gain;
		} catch (error) {
			void context.close();
			throw error instanceof PlayerError ? error : new PlayerError(String(error));
		}

		// Autoplay policy leaves a fresh context suspended until a gesture.
		await context.resume();
		this.post({ type: "loop", loop: this.looping });
		this.post({ type: "mute", mask: this.muteMask });
	}

	private async compile(): Promise<WebAssembly.Module> {
		const url = `${this.baseUrl}/spc.wasm`;
		const response = await fetch(url);
		if (!response.ok) {
			throw new PlayerError(
				`Could not load ${url} (HTTP ${response.status}). The emulator lives in packages/spc/assets/player/.`,
			);
		}

		return await WebAssembly.compile(await response.arrayBuffer());
	}

	private async addModule(context: AudioContext): Promise<void> {
		const url = `${this.baseUrl}/spc-worklet.js`;
		try {
			await context.audioWorklet.addModule(url);
		} catch {
			throw new PlayerError(`Could not load ${url}. Run \`npm run build:worklet\` to generate it.`);
		}
	}

	/**
	 * Loads an SPC and plays it, optionally fast-forwarded to `atSeconds`.
	 *
	 * `timing` says what the header cannot. The ID666 length counts the main loop
	 * twice and the fade beside it is sized for a listening app, so a host that
	 * knows the song's real shape states it here in ticks and gets a playhead that
	 * follows the driver. Left out, the song plays on with the file's own fade.
	 */
	play(spc: Uint8Array, atSeconds = 0, timing: SongTiming = {}): void {
		this.require();
		this.position = Math.max(0, atSeconds);
		this.songTicks = 0;
		this.epoch++;
		this.post({
			type: "load",
			spc,
			atSeconds: this.position,
			epoch: this.epoch,
			introTicks: timing.introTicks ?? 0,
			loopTicks: timing.loopTicks ?? 0,
			fadeSeconds: timing.fadeSeconds ?? readDigits(spc, ID666_FADE, 5) / 1000,
			songLoops: timing.songLoops ?? true,
		});
		this.post({ type: "paused", paused: false });
		this.state = "playing";
	}

	stop(): void {
		if (!this.node) {
			return;
		}

		this.post({ type: "stop" });
		this.state = "idle";
		this.position = 0;
		this.songTicks = 0;
	}

	pause(): void {
		if (!this.node || this.state !== "playing") {
			return;
		}

		this.post({ type: "paused", paused: true });
		this.state = "paused";
	}

	resume(): void {
		if (!this.node || this.state !== "paused") {
			return;
		}

		this.post({ type: "paused", paused: false });
		this.state = "playing";
	}

	/**
	 * Jumps to `seconds`. The emulator has no snapshot to jump to, so this
	 * replays the song silently up to that point — seeking a long way into a
	 * long song takes a moment.
	 */
	seek(seconds: number): void {
		if (!this.node || this.state === "idle") {
			return;
		}

		this.position = Math.max(0, seconds);
		this.epoch++;
		this.post({ type: "seek", seconds: this.position, epoch: this.epoch });
	}

	setLoop(loop: boolean): void {
		this.looping = loop;
		if (this.node) {
			this.post({ type: "loop", loop });
		}
	}

	/**
	 * Silences voices, as a bitmask, bit 0 being channel #0.
	 *
	 * Takes effect within a few milliseconds and survives loads and seeks: the
	 * song data is not involved, so nothing has to be rebuilt and playback does
	 * not break stride.
	 */
	setMute(mask: number): void {
		this.muteMask = mask;
		if (this.node) {
			this.post({ type: "mute", mask });
		}
	}

	/** The playhead folded into one pass, in music ticks. */
	getSongTicks(): number {
		return this.songTicks;
	}

	/** 0 to 5. */
	setVolume(volume: number): void {
		this.volume = Math.min(Math.max(volume, 0), MAX_VOLUME);
		if (this.gain && this.context) {
			this.gain.gain.setValueAtTime(this.volume, this.context.currentTime);
		}
	}

	/** Tears down the audio graph. */
	async dispose(): Promise<void> {
		const context = this.context;
		this.node?.port.close();
		this.node = null;
		this.gain = null;
		this.context = null;
		this.state = "idle";
		if (context) {
			await context.close();
		}
	}

	private receive(message: FromWorklet): void {
		switch (message.type) {
			case "position":
				// Posted before the seek that overtook it: it describes a playhead
				// that no longer exists, and reporting it would drag the transport
				// back to where the song was until the next update landed.
				if (message.epoch !== this.epoch) {
					return;
				}

				this.position = message.seconds;
				this.songTicks = message.songTicks;
				this.onPosition?.(message.songTicks);
				this.onDriverState?.(message.driver);
				break;
			case "ended":
				this.state = "idle";
				this.onEnded?.();
				break;
			case "error":
				this.state = "idle";
				this.onError?.(new PlayerError(message.message));
				break;
		}
	}

	private post(message: ToWorklet): void {
		this.node?.port.postMessage(message);
	}

	private require(): AudioWorkletNode {
		if (!this.node) {
			throw new PlayerError("The player has not been initialised yet.");
		}

		return this.node;
	}
}
