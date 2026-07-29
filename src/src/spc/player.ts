/**
 * SPC700 playback.
 *
 * Owns an AudioContext, a GainNode for volume, and an AudioWorkletNode running
 * `worklet.ts`, which holds the emulator. Everything below the Web Audio graph
 * is ours; the only vendored piece left is `public/player/spc.wasm` itself.
 *
 * The wasm is compiled here and posted to the worklet because an
 * AudioWorkletGlobalScope cannot fetch. Playback state lives on the audio
 * thread, so position arrives as events rather than being polled off the
 * context clock — which stays accurate across pause and seek.
 */

import { SPC_PROCESSOR, type FromWorklet, type SpcProcessorOptions, type ToWorklet } from "./protocol";

export class PlayerError extends Error {}

export type PlayerState = "idle" | "playing" | "paused";

/**
 * ID666 stores both of these as ASCII digits in the file header, so a song
 * carries its own length and fade. Reading them here keeps `play()` down to the
 * bytes and works for any `.spc`, not only the ones `buildSpc` produces.
 */
const ID666_LENGTH = 0xa9; // 3 digits, seconds
const ID666_FADE = 0xac; // 5 digits, milliseconds

/** The player allows a little headroom above unity, as the old backend did. */
const MAX_VOLUME = 5;

function readDigits(spc: Uint8Array, offset: number, length: number): number {
	if (spc.length < offset + length) return 0;
	let text = "";
	for (let index = 0; index < length; index++) {
		const code = spc[offset + index];
		if (code < 0x30 || code > 0x39) break; // NUL- or space-padded
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
	private volume = 1;
	private looping = false;

	/** Seconds elapsed, pushed from the audio thread roughly ten times a second. */
	onPosition: ((seconds: number) => void) | null = null;
	/** The song reached the end of its ID666 length and fade, and is not looping. */
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
		if (this.node) return;
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
	}

	private async compile(): Promise<WebAssembly.Module> {
		const url = `${this.baseUrl}/spc.wasm`;
		const response = await fetch(url);
		if (!response.ok) {
			throw new PlayerError(`Could not load ${url} (HTTP ${response.status}). The emulator lives in public/player/.`);
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

	/** Loads an SPC and plays it, optionally fast-forwarded to `atSeconds`. */
	play(spc: Uint8Array, atSeconds = 0): void {
		this.require();
		this.position = Math.max(0, atSeconds);
		this.post({
			type: "load",
			spc,
			atSeconds: this.position,
			lengthSeconds: readDigits(spc, ID666_LENGTH, 3),
			fadeSeconds: readDigits(spc, ID666_FADE, 5) / 1000,
		});
		this.post({ type: "paused", paused: false });
		this.state = "playing";
	}

	stop(): void {
		if (!this.node) return;
		this.post({ type: "stop" });
		this.state = "idle";
		this.position = 0;
	}

	pause(): void {
		if (!this.node || this.state !== "playing") return;
		this.post({ type: "paused", paused: true });
		this.state = "paused";
	}

	resume(): void {
		if (!this.node || this.state !== "paused") return;
		this.post({ type: "paused", paused: false });
		this.state = "playing";
	}

	/**
	 * Jumps to `seconds`. The emulator has no snapshot to jump to, so this
	 * replays the song silently up to that point — seeking a long way into a
	 * long song takes a moment.
	 */
	seek(seconds: number): void {
		if (!this.node || this.state === "idle") return;
		this.position = Math.max(0, seconds);
		this.post({ type: "seek", seconds: this.position });
	}

	setLoop(loop: boolean): void {
		this.looping = loop;
		if (this.node) this.post({ type: "loop", loop });
	}

	/** Seconds elapsed, or 0 when nothing is loaded. */
	getTime(): number {
		return this.position;
	}

	/** 0 to 1.5. */
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
		if (context) await context.close();
	}

	private receive(message: FromWorklet): void {
		switch (message.type) {
			case "position":
				this.position = message.seconds;
				this.onPosition?.(message.seconds);
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
		if (!this.node) throw new PlayerError("The player has not been initialised yet.");
		return this.node;
	}
}
