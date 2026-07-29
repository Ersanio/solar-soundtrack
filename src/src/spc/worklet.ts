/**
 * The SPC700 renderer, running on the audio thread.
 *
 * Bundled to `public/player/spc-worklet.js` by `npm run build:worklet`, because
 * `audioWorklet.addModule` needs a real URL and the Angular builder does not
 * treat worklets as entry points. Nothing in the app imports this module.
 *
 * Rendering here rather than on the page is the point of the exercise: the
 * editor recompiles MML on the main thread while a song is playing, and any
 * main-thread renderer drops out every time it does.
 */

import { SPC_CHANNELS, SPC_SAMPLE_RATE, type SpcCore, instantiate } from "./wasm-host";
import { SPC_PROCESSOR, type FromWorklet, type SpcProcessorOptions, type ToWorklet } from "./protocol";

// AudioWorkletGlobalScope is not in lib.dom, which only describes the page side.
declare const sampleRate: number;
declare abstract class AudioWorkletProcessor {
	readonly port: MessagePort;
	constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(
	name: string,
	constructor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

/** Emulator frames per refill. ~32 ms, so the call overhead disappears. */
const SOURCE_BLOCK = 1024;

/** How often to tell the page where playback has got to. */
const POSITION_INTERVAL = 0.1;

const FULL_SCALE = 32768;

class SpcProcessor extends AudioWorkletProcessor {
	private core: SpcCore | null = null;
	private spc: Uint8Array | null = null;

	private playing = false;
	private paused = false;
	private looping = false;

	private lengthSeconds = 0;
	private fadeSeconds = 0;

	/** Output frames emitted since the song started, and so the clock. */
	private frames = 0;
	private postedAt = -1;

	/** Resampler: 32 kHz source, `sampleRate` sink, linear between two frames. */
	private readonly step = SPC_SAMPLE_RATE / sampleRate;
	private phase = 0;
	private primed = false;
	private prevL = 0;
	private prevR = 0;
	private nextL = 0;
	private nextR = 0;

	private readonly block = new Int16Array(SOURCE_BLOCK * SPC_CHANNELS);
	private blockPos = SOURCE_BLOCK;
	private pullL = 0;
	private pullR = 0;

	constructor(options: AudioWorkletNodeOptions) {
		super(options);
		this.port.onmessage = (event: MessageEvent<ToWorklet>) => this.receive(event.data);

		try {
			const { module } = options.processorOptions as SpcProcessorOptions;
			this.core = instantiate(module);
		} catch (error) {
			this.fail(error);
		}
	}

	private send(message: FromWorklet): void {
		this.port.postMessage(message);
	}

	private fail(error: unknown): void {
		this.playing = false;
		this.send({ type: "error", message: error instanceof Error ? error.message : String(error) });
	}

	private receive(message: ToWorklet): void {
		try {
			switch (message.type) {
				case "load":
					this.spc = message.spc;
					this.lengthSeconds = message.lengthSeconds;
					this.fadeSeconds = message.fadeSeconds;
					this.seek(message.atSeconds);
					this.playing = true;
					break;
				case "seek":
					this.seek(message.seconds);
					break;
				case "paused":
					this.paused = message.paused;
					break;
				case "loop":
					this.looping = message.loop;
					break;
				case "stop":
					this.playing = false;
					this.spc = null;
					this.frames = 0;
					this.postedAt = -1;
					break;
			}
		} catch (error) {
			this.fail(error);
		}
	}

	/**
	 * Restarts the song and fast-forwards. `_skipSPC` takes whole seconds, so the
	 * remainder is emulated and thrown away.
	 *
	 * This re-emulates from the beginning every time, which is how the format
	 * works — there is no snapshot to jump to. Seeking far into a long song
	 * therefore blocks the audio thread for a moment.
	 */
	private seek(seconds: number): void {
		const { core, spc } = this;
		if (!core || !spc) return;

		const target = Math.max(0, seconds);
		core.loadSpc(spc);

		const whole = Math.floor(target);
		if (whole > 0) core.skip(whole);

		const remainder = Math.round((target - whole) * SPC_SAMPLE_RATE);
		if (remainder > 0) core.renderView(remainder);

		this.frames = Math.round(target * sampleRate);
		this.postedAt = -1;
		this.primed = false;
		this.blockPos = SOURCE_BLOCK;
		this.phase = 0;
	}

	/** Reads one emulator frame, rendering another block when the last runs out. */
	private pull(): void {
		if (this.blockPos >= SOURCE_BLOCK) {
			this.block.set(this.core!.renderView(SOURCE_BLOCK));
			this.blockPos = 0;
		}
		const at = this.blockPos * SPC_CHANNELS;
		this.pullL = this.block[at];
		this.pullR = this.block[at + 1];
		this.blockPos++;
	}

	/** 1 up to the ID666 length, then a linear ramp across the fade. */
	private gainAt(position: number): number {
		if (this.looping || this.lengthSeconds <= 0 || position <= this.lengthSeconds) return 1;
		if (this.fadeSeconds <= 0) return 0;
		return Math.max(0, 1 - (position - this.lengthSeconds) / this.fadeSeconds);
	}

	process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		const output = outputs[0];
		if (!output?.length) return true;

		const left = output[0];
		const right = output[1] ?? output[0];
		const frames = left.length;

		if (!this.core || !this.spc || !this.playing || this.paused) {
			left.fill(0);
			if (right !== left) right.fill(0);
			return true;
		}

		try {
			const position = this.frames / sampleRate;

			if (this.lengthSeconds > 0) {
				if (this.looping && position >= this.lengthSeconds) {
					this.seek(0);
				} else if (!this.looping && position >= this.lengthSeconds + this.fadeSeconds) {
					this.playing = false;
					left.fill(0);
					if (right !== left) right.fill(0);
					this.send({ type: "ended" });
					return true;
				}
			}

			if (!this.primed) {
				this.pull();
				this.prevL = this.pullL;
				this.prevR = this.pullR;
				this.pull();
				this.nextL = this.pullL;
				this.nextR = this.pullR;
				this.phase = 0;
				this.primed = true;
			}

			for (let i = 0; i < frames; i++) {
				const gain = this.gainAt((this.frames + i) / sampleRate) / FULL_SCALE;
				left[i] = (this.prevL + (this.nextL - this.prevL) * this.phase) * gain;
				right[i] = (this.prevR + (this.nextR - this.prevR) * this.phase) * gain;

				this.phase += this.step;
				while (this.phase >= 1) {
					this.phase -= 1;
					this.prevL = this.nextL;
					this.prevR = this.nextR;
					this.pull();
					this.nextL = this.pullL;
					this.nextR = this.pullR;
				}
			}

			this.frames += frames;

			const now = this.frames / sampleRate;
			if (this.postedAt < 0 || now - this.postedAt >= POSITION_INTERVAL) {
				this.postedAt = now;
				this.send({ type: "position", seconds: now });
			}
		} catch (error) {
			left.fill(0);
			if (right !== left) right.fill(0);
			this.fail(error);
		}

		return true;
	}
}

registerProcessor(SPC_PROCESSOR, SpcProcessor);
