/**
 * A whole song rendered to PCM and wrapped as a `.wav`: the intro, the loop twice and a fade, as
 * the ID666 tag `export.ts` writes describes it.
 *
 * The length is counted in the driver's own ticks off the running emulator, as `analyseSong` and
 * the transport count them, rather than priced from a tempo: the driver drops ticks on a busy
 * song, and a formula over `t` would end the file early on exactly those. Nothing is muted — the
 * `.wav` is the song, as the `.spc` is.
 */

import {
	MAX_SEEK_SECONDS,
	POLL_BLOCK_FRAMES,
	SEEK_STALL_BLOCKS,
	createTickPhase,
	sawTick,
	seedTickPhase,
	tickVoice,
} from "./driver-state";
import { SPC_CHANNELS, SPC_SAMPLE_RATE, type SpcCore } from "./wasm-host";

/** Times round the loop before the fade, as the ID666 length counts it. */
export const RENDER_LOOP_COUNT = 2;

/** The fade over the end of a looping song, matching the `.spc`'s 10000 ms tag. */
export const RENDER_FADE_SECONDS = 10;

/** How long a song that does not loop has to be silent after its pass to count as over. */
export const RENDER_TAIL_SILENCE_SECONDS = 0.5;

/** And the longest it is let ring out, for a release or an echo that never quite stops. */
export const RENDER_TAIL_MAX_SECONDS = 10;

/** A frame no louder than this, on both sides, counts as silent in the tail. */
const SILENT_SAMPLE = 2;

/** How often, in emulated frames, to report progress. */
const PROGRESS_FRAMES = SPC_SAMPLE_RATE / 4;

export interface RenderLength {
	/** The song loops: false for one that ends after its pass (`doesntLoop`). */
	loops: boolean;
	introTicks: number;
	loopTicks: number;
}

/** Interleaved stereo frames, growing as they are written. */
class PcmBuffer {
	private data = new Int16Array(SPC_SAMPLE_RATE * SPC_CHANNELS * 60);
	length = 0;

	push(block: Int16Array): void {
		if (this.length + block.length > this.data.length) {
			const grown = new Int16Array(Math.max(this.data.length * 2, this.length + block.length));
			grown.set(this.data.subarray(0, this.length));
			this.data = grown;
		}

		this.data.set(block, this.length);
		this.length += block.length;
	}

	get frames(): number {
		return this.length / SPC_CHANNELS;
	}

	/** The frames written, scaled from `from` to the end by a ramp from 1 down to 0. */
	finish(fadeFrom: number | null): Int16Array {
		const out = this.data.slice(0, this.length);
		if (fadeFrom !== null) {
			const span = Math.max(1, this.frames - fadeFrom);
			for (let frame = fadeFrom; frame < this.frames; frame++) {
				const gain = 1 - (frame - fadeFrom + 1) / span;
				for (let channel = 0; channel < SPC_CHANNELS; channel++) {
					const at = frame * SPC_CHANNELS + channel;
					out[at] = Math.round(out[at] * gain);
				}
			}
		}

		return out;
	}
}

/**
 * Plays `spc` from its start to the end of {@link RENDER_LOOP_COUNT} loops and then fades it over
 * {@link RENDER_FADE_SECONDS}; a song that does not loop plays its one pass and rings out until
 * silent. A song whose ticks stop moving ends where they stopped, and none runs past
 * {@link MAX_SEEK_SECONDS}. `progress` is told how far it is, 0 to 1, a few times a second.
 */
export function renderSong(
	core: SpcCore,
	spc: Uint8Array,
	length: RenderLength,
	progress: (fraction: number) => void = () => {},
): Int16Array {
	const target = Math.max(
		1,
		length.introTicks + (length.loops ? RENDER_LOOP_COUNT : 1) * Math.max(0, length.loopTicks),
	);
	const cap = MAX_SEEK_SECONDS * SPC_SAMPLE_RATE;
	const pcm = new PcmBuffer();

	core.loadSpc(spc);

	const tick = createTickPhase();
	let latched = false;
	let ticks = 0;
	let stalledBlocks = 0;
	let reported = 0;
	while (ticks < target && stalledBlocks < SEEK_STALL_BLOCKS && pcm.frames < cap) {
		pcm.push(core.renderView(POLL_BLOCK_FRAMES));

		const aram = core.aram();
		if (!latched) {
			tickVoice(aram);
			seedTickPhase(tick, aram);
			latched = true;
		} else {
			const stepped = sawTick(tick, aram);
			ticks += stepped;
			stalledBlocks = stepped ? 0 : stalledBlocks + 1;
		}

		if (pcm.frames - reported >= PROGRESS_FRAMES) {
			reported = pcm.frames;
			progress(Math.min(1, ticks / target));
		}
	}

	if (length.loops) {
		const fadeFrom = pcm.frames;
		const fadeEnd = Math.min(cap, fadeFrom + RENDER_FADE_SECONDS * SPC_SAMPLE_RATE);
		while (pcm.frames < fadeEnd) {
			pcm.push(core.renderView(Math.min(POLL_BLOCK_FRAMES, fadeEnd - pcm.frames)));
		}

		progress(1);
		return pcm.finish(fadeFrom);
	}

	const tailEnd = Math.min(cap, pcm.frames + RENDER_TAIL_MAX_SECONDS * SPC_SAMPLE_RATE);
	const quietNeeded = RENDER_TAIL_SILENCE_SECONDS * SPC_SAMPLE_RATE;
	let quiet = 0;
	while (pcm.frames < tailEnd && quiet < quietNeeded) {
		const block = core.renderView(Math.min(POLL_BLOCK_FRAMES, tailEnd - pcm.frames));
		pcm.push(block);
		for (let frame = 0; frame < block.length / SPC_CHANNELS; frame++) {
			const loud =
				Math.abs(block[frame * SPC_CHANNELS]) > SILENT_SAMPLE ||
				Math.abs(block[frame * SPC_CHANNELS + 1]) > SILENT_SAMPLE;
			quiet = loud ? 0 : quiet + 1;
		}
	}

	progress(1);
	return pcm.finish(null);
}

/** 16-bit PCM in a RIFF/WAVE container: a 44-byte header and the samples, little-endian. */
export function encodeWav(pcm: Int16Array, sampleRate = SPC_SAMPLE_RATE, channels = SPC_CHANNELS): Uint8Array {
	const dataBytes = pcm.length * 2;
	const bytes = new Uint8Array(44 + dataBytes);
	const view = new DataView(bytes.buffer);
	const text = (at: number, value: string): void => {
		for (let index = 0; index < value.length; index++) {
			bytes[at + index] = value.charCodeAt(index);
		}
	};

	text(0, "RIFF");
	view.setUint32(4, 36 + dataBytes, true);
	text(8, "WAVE");
	text(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, channels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * channels * 2, true);
	view.setUint16(32, channels * 2, true);
	view.setUint16(34, 16, true);
	text(36, "data");
	view.setUint32(40, dataBytes, true);
	for (let index = 0; index < pcm.length; index++) {
		view.setInt16(44 + index * 2, pcm[index], true);
	}

	return bytes;
}
