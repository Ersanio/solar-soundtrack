/**
 * The SPC700 renderer, running on the audio thread.
 *
 * Bundled to `assets/player/spc-worklet.js` by this package's `npm run build`,
 * because `audioWorklet.addModule` needs a real URL. Nothing imports this module.
 *
 * Rendering here rather than on the page is the point: the editor recompiles MML
 * on the main thread while a song is playing, and any main-thread renderer drops
 * out every time it does.
 */

import { SPC_CHANNELS, SPC_SAMPLE_RATE, type SpcCore, instantiate } from "./wasm-host";
import {
	type MuteBackup,
	TICK_POLL_HZ,
	applyChannelMutes,
	createMuteBackup,
	readDriverState,
	readNoteDuration,
	resetMuteBackup,
	sawTick,
	tickVoice,
} from "./driver-state";
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

/**
 * Emulator frames per refill, which is also how often the driver's note
 * duration counter gets read.
 *
 * 1 ms, so `$70` is sampled at {@link TICK_POLL_HZ} — twice the driver's main
 * loop rate, which is what makes the tick count exact. Measured against the
 * vendored core, 32 frames rather than 1024 costs about 4% more emulator time
 * and still runs 355x faster than realtime on an eight-channel song — a cheap
 * price for a playhead that cannot drift.
 */
const SOURCE_BLOCK = SPC_SAMPLE_RATE / TICK_POLL_HZ;

/** How often to tell the page where playback has got to. */
const POSITION_INTERVAL = 0.1;

/**
 * How long a seek will emulate without the tick count moving before it gives up.
 *
 * A target the song never reaches — one past the end of a song that does not
 * loop, or any target at all in a song with no note data to tick on — would
 * otherwise render until a wall-clock ceiling, which on the audio thread is a
 * freeze rather than a slow seek. Two seconds is four times the 0.512 s a tick
 * takes at the slowest tempo the driver can hold, so no real song can look
 * stalled while it is merely slow.
 */
const SEEK_STALL_BLOCKS = 2 * TICK_POLL_HZ;

/**
 * And an outright ceiling, for a song that ticks forever without reaching the
 * target. `999` seconds is what the SPC format allows.
 */
const MAX_SEEK_SECONDS = 999;

const FULL_SCALE = 32768;

class SpcProcessor extends AudioWorkletProcessor {
	private readonly core: SpcCore | null = null;
	private spc: Uint8Array | null = null;

	private playing = false;
	private paused = false;
	private looping = false;

	private fadeSeconds = 0;
	private songLoops = false;

	/** Voices the mixer has silenced, and the volumes taken off them. */
	private muteMask = 0;
	private readonly MuteBackup: MuteBackup = createMuteBackup();

	/** One pass through the song, in ticks: the intro plus one trip round. */
	private introTicks = 0;
	private loopTicks = 0;

	/**
	 * Music ticks played since the song started, counted off the driver rather
	 * than predicted. This is the clock the playhead runs on.
	 */
	private ticks = 0;
	/** The voice ticks are counted off, and its counter as of the last poll. */
	private voice = -1;
	private duration = 0;

	/**
	 * Where the song stops, in ticks. Normally one pass, but loop mode moves it:
	 * a song several passes in cannot stop at a point already gone by.
	 */
	private endsAtTicks = 0;
	/** When the fade began, in output seconds. -1 until the end is reached. */
	private fadeFrom = -1;

	/** Output frames emitted since the song started, and so the wall clock. */
	private frames = 0;
	private postedAt = -1;
	/** Stamped on every position, so the page can discard ones a seek overtook. */
	private epoch = 0;

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
					this.fadeSeconds = message.fadeSeconds;
					this.songLoops = message.songLoops;
					this.introTicks = message.introTicks;
					this.loopTicks = message.loopTicks;
					this.epoch = message.epoch;
					this.seek(message.atTicks);
					this.playing = true;
					break;
				case "seek":
					this.epoch = message.epoch;
					this.seek(message.ticks);
					break;
				case "paused":
					this.paused = message.paused;
					break;
				case "loop":
					this.looping = message.loop;
					// Switching looping off mid-song has to decide where "the end" now
					// is; switching it on makes the question moot.
					if (!this.looping) {
						this.rebaseEnd();
					}

					break;
				case "mute":
					this.muteMask = message.mask;
					break;
				case "stop":
					this.playing = false;
					this.spc = null;
					this.frames = 0;
					this.postedAt = -1;
					resetMuteBackup(this.MuteBackup);
					break;
			}
		} catch (error) {
			this.fail(error);
		}
	}

	/**
	 * Restarts the song and fast-forwards to `songTicks`.
	 *
	 * The fast-forward is emulated a millisecond at a time rather than through
	 * `_skipSPC`, because the tick count has to be carried across it: skipping
	 * would leave the emulator somewhere in the song with no idea how many ticks
	 * had gone by, and every reading after that would inherit the error. The
	 * format gives no snapshot to jump to either way, so seeking far into a long
	 * song blocks the audio thread for a moment.
	 *
	 * Stopping on the tick count rather than on a sample count is what makes a
	 * seek land where it was asked to. A host can only guess how many seconds of
	 * audio a tick is worth — the driver drops ticks when it is busy, so the
	 * guess runs progressively early the further in you seek — whereas the ticks
	 * counted here are the driver's own. `SOURCE_BLOCK` is a millisecond, which
	 * is under a tick at any tempo, so the overshoot is smaller than the unit.
	 */
	private seek(songTicks: number): void {
		const { core, spc } = this;
		if (!core || !spc) {
			return;
		}

		const target = Math.max(0, songTicks);
		core.loadSpc(spc);

		this.ticks = 0;
		this.voice = -1;
		this.duration = 0;
		// The reload puts the pristine image back, so `$5E` and every track
		// volume are the song's own again. A volume saved from the position just
		// left would be restored into a song that has moved on.
		resetMuteBackup(this.MuteBackup);

		let rendered = 0;
		let stalledFor = 0;
		const cap = MAX_SEEK_SECONDS * SPC_SAMPLE_RATE;
		while (this.ticks < target && rendered < cap && stalledFor < SEEK_STALL_BLOCKS) {
			const before = this.ticks;
			core.renderView(SOURCE_BLOCK);
			rendered += SOURCE_BLOCK;
			this.afterBlock();
			stalledFor = this.ticks > before ? 0 : stalledFor + 1;
		}

		// What was actually rendered, not what was asked for. This is the wall
		// clock the end-of-song fade runs on, and the request is in ticks, so the
		// two are not the same number.
		this.frames = Math.round((rendered / SPC_SAMPLE_RATE) * sampleRate);
		this.endsAtTicks = this.durationTicks();
		this.fadeFrom = -1;
		this.postedAt = -1;
		this.primed = false;
		this.blockPos = SOURCE_BLOCK;
		this.phase = 0;
	}

	/** One pass: the intro, played once, plus one trip round the loop. */
	private durationTicks(): number {
		return this.introTicks + this.loopTicks;
	}

	/**
	 * Everything that happens in APU RAM between emulated blocks.
	 *
	 * Two things, sharing the one look at it: the driver's note duration counter
	 * is folded into the running count, and the mixer's mute mask is pressed back
	 * onto the driver. Running at the block rate is what keeps tick sampling
	 * above the driver's iteration rate, and it is also what makes the mute
	 * stick — see {@link applyChannelMutes}.
	 */
	private afterBlock(): void {
		if (!this.core) {
			return;
		}

		const aram = this.core.aram();
		applyChannelMutes(aram, this.muteMask, this.MuteBackup);

		// The song has not keyed on yet at load; latch the voice once it has.
		if (this.voice < 0) {
			this.voice = tickVoice(aram);
			this.duration = readNoteDuration(aram, this.voice);
			return;
		}

		const now = readNoteDuration(aram, this.voice);
		this.ticks += sawTick(this.duration, now);
		this.duration = now;
	}

	/**
	 * Carries the end forward to the next time the loop comes round.
	 *
	 * Leaving loop mode after several passes would otherwise end the song at a
	 * point long gone, cutting it off the instant the box is unticked. Stopping
	 * where the loop next closes finishes the phrase instead.
	 */
	private rebaseEnd(): void {
		const duration = this.durationTicks();
		if (this.loopTicks <= 0 || this.ticks <= duration) {
			this.endsAtTicks = duration;
			return;
		}

		const passes = Math.ceil((this.ticks - duration) / this.loopTicks);
		this.endsAtTicks = duration + passes * this.loopTicks;
	}

	/**
	 * The playhead as the song sees it: within one pass, however many passes the
	 * emulator has actually rendered.
	 *
	 * A looping song wraps to the start of its main loop rather than to zero,
	 * because the intro is played once and never returned to. The fade at the end
	 * pins rather than wrapping — it is the tail of the song, not the start again.
	 */
	private songTicks(): number {
		const duration = this.durationTicks();
		if (duration <= 0 || this.ticks <= duration) {
			return this.ticks;
		}

		if (!this.looping && this.ticks >= this.endsAtTicks) {
			return duration;
		}

		if (this.loopTicks <= 0) {
			return duration;
		}

		return this.introTicks + ((this.ticks - this.introTicks) % this.loopTicks);
	}

	/** Reads one emulator frame, rendering another block when the last runs out. */
	private pull(): void {
		if (this.blockPos >= SOURCE_BLOCK) {
			this.block.set(this.core!.renderView(SOURCE_BLOCK));
			this.blockPos = 0;
			this.afterBlock();
		}

		const at = this.blockPos * SPC_CHANNELS;
		this.pullL = this.block[at];
		this.pullR = this.block[at + 1];
		this.blockPos++;
	}

	/**
	 * 1 up to the end of the song, then a linear ramp across the fade.
	 *
	 * The end is a tick count and the fade is a duration, so the moment the two
	 * meet is latched in `fadeFrom` — the ramp has to run on the wall clock or a
	 * song whose tempo drops during the tail would fade at the wrong speed.
	 */
	private gainAt(position: number): number {
		if (this.looping || this.fadeFrom < 0) {
			return 1;
		}

		if (this.fadeSeconds <= 0) {
			return 0;
		}

		return Math.max(0, 1 - (position - this.fadeFrom) / this.fadeSeconds);
	}

	process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		const output = outputs[0];
		if (!output?.length) {
			return true;
		}

		const left = output[0];
		const right = output[1] ?? output[0];
		const frames = left.length;

		if (!this.core || !this.spc || !this.playing || this.paused) {
			left.fill(0);
			if (right !== left) {
				right.fill(0);
			}

			return true;
		}

		try {
			const position = this.frames / sampleRate;

			if (this.durationTicks() > 0) {
				if (this.looping) {
					// N-SPC channel data ends by jumping back to the loop point, so the
					// emulator repeats the song by itself and restarting it here would
					// only replay the intro and cost a re-emulation. A song with no loop
					// point is the exception: nothing brings it round, so it is restarted
					// by hand rather than left running into silence.
					if (!this.songLoops && this.ticks >= this.durationTicks()) {
						this.seek(0);
					}
				} else {
					// The end is a tick count, so it is reached exactly; the fade that
					// follows it is wall time, latched here so it runs at a steady rate.
					if (this.fadeFrom < 0 && this.ticks >= this.endsAtTicks) {
						this.fadeFrom = position;
					}

					if (this.fadeFrom >= 0 && position >= this.fadeFrom + this.fadeSeconds) {
						this.playing = false;
						left.fill(0);
						if (right !== left) {
							right.fill(0);
						}

						this.send({ type: "ended" });
						return true;
					}
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
			const due =
				this.postedAt < 0 ? this.ticks > 0 || now >= POSITION_INTERVAL : now - this.postedAt >= POSITION_INTERVAL;
			if (due) {
				this.postedAt = now;
				this.send({
					type: "position",
					seconds: now,
					ticks: this.ticks,
					songTicks: this.songTicks(),
					driver: readDriverState(this.core.aram()),
					epoch: this.epoch,
				});
			}
		} catch (error) {
			left.fill(0);
			if (right !== left) {
				right.fill(0);
			}

			this.fail(error);
		}

		return true;
	}
}

registerProcessor(SPC_PROCESSOR, SpcProcessor);
