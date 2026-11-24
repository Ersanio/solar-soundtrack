/**
 * A tracker module's samples made ready for BRR: resampled to fit ARAM, their loops moved onto block
 * boundaries, and the tuning an AddmusicK instrument needs to play each at the module's pitch.
 *
 * A BRR loop starts on a 16-frame block and runs to the sample's end, so a looped sample is
 * resampled with its loop rounded to whole blocks (a loop too short for one laid end to end until it
 * fills one), the factor nudged to make that exact, and silence put in front so the loop starts on
 * a block; anything after the loop is never heard and is dropped. The resampler is a windowed sinc whose cutoff follows the factor, and it reads the
 * loop round past its end, so the seam is filtered as the loop sounds.
 */

import { DSP_PITCH_LIMIT, SEMITONE, setPitchWide } from "@amk/spc/pitch";
import type { TrackerSample } from "./model";

const BLOCK = 16;
/** Zero crossings either side of the sinc's centre. */
const LOBES = 8;
/** The DSP plays a pitch register of `$1000` at 32 kHz, one frame a sample. */
const UNITY_REGISTER = 0x1000;
const DSP_HZ = 32_000;
/** The highest key a letter can be written at, o6 a (`$C5`), counted from o1 c. */
export const HIGHEST_KEY = 69;

/** A sample planned at a factor: its PCM, and the loop on a block. */
export interface PlannedSample {
	pcm: Int16Array;
	/** The frame the loop starts at, a multiple of 16, or `null` for a one-shot. */
	loopStart: number | null;
	/** The factor the sample was resampled by, which the loop's rounding may have moved off the one asked for. */
	factor: number;
}

/**
 * How many times the loop is laid end to end, so that at `factor` it fills a block. Widening a short
 * loop by raising the factor would raise it for the whole sample: a 1-frame loop holding a sample's
 * last value would make the sample sixteen times longer.
 */
function loopRepeats(sample: TrackerSample, factor: number): number {
	return Math.max(1, Math.ceil(BLOCK / (sample.loopLength * factor)));
}

/** The loop's length after resampling, its repeats laid end to end: whole blocks, at least one. */
function loopFrames(sample: TrackerSample, factor: number): number {
	const repeated = loopRepeats(sample, factor) * sample.loopLength;
	return Math.max(BLOCK, Math.round((repeated * factor) / BLOCK) * BLOCK);
}

/** What resampling `sample` by `factor` makes, without doing it: frames, whether it loops, and the factor it ends up at. */
export function plannedFrames(
	sample: TrackerSample,
	factor: number,
): { frames: number; loops: boolean; factor: number } {
	if (sample.pcm.length === 0) {
		return { frames: 0, loops: false, factor };
	}

	if (sample.loopLength === 0) {
		return { frames: Math.max(1, Math.ceil(sample.pcm.length * factor)), loops: false, factor };
	}

	const loop = loopFrames(sample, factor);
	const exact = loop / (loopRepeats(sample, factor) * sample.loopLength);
	return { frames: Math.ceil((sample.loopStart * exact) / BLOCK) * BLOCK + loop, loops: true, factor: exact };
}

function blackman(x: number): number {
	return 0.42 + 0.5 * Math.cos(Math.PI * x) + 0.08 * Math.cos(2 * Math.PI * x);
}

/** `sample` resampled by `factor` (above 0, at most 1 bar a short loop's rounding), with its loop on a block. */
export function planSample(sample: TrackerSample, factor: number): PlannedSample {
	const plan = plannedFrames(sample, factor);
	const k = plan.factor;
	const source = sample.pcm;
	const loopEnd = sample.loopStart + sample.loopLength;
	const at = (i: number): number => {
		if (i < 0) {
			return 0;
		}

		if (sample.loopLength > 0 && i >= loopEnd) {
			return source[sample.loopStart + ((i - sample.loopStart) % sample.loopLength)];
		}

		return i < source.length ? source[i] : 0;
	};

	// Output frame j reads source position (j - offset) / k: the loop's first frame lands on a block.
	const loopOut = plan.loops ? plan.frames - loopFrames(sample, factor) : 0;
	const offset = plan.loops ? loopOut - sample.loopStart * k : 0;
	if (k === 1 && Number.isInteger(offset)) {
		// Nothing to resample: the frames as they are, behind the silence that puts the loop on a block.
		return {
			pcm: Int16Array.from({ length: plan.frames }, (_, j) => at(j - offset)),
			loopStart: plan.loops ? loopOut : null,
			factor: k,
		};
	}

	const cutoff = Math.min(1, k) * 0.95;
	const half = Math.ceil(LOBES / cutoff);
	const pcm = new Int16Array(plan.frames);
	for (let j = 0; j < plan.frames; j++) {
		const u = (j - offset) / k;
		const centre = Math.floor(u);
		let sum = 0;
		let weight = 0;
		for (let i = centre - half + 1; i <= centre + half; i++) {
			const x = u - i;
			const w = Math.abs(x) >= half ? 0 : blackman(x / half);
			const s = x === 0 ? 1 : Math.sin(Math.PI * cutoff * x) / (Math.PI * cutoff * x);
			sum += at(i) * s * w;
			weight += s * w;
		}

		const value = Math.round(sum / (weight || 1));
		pcm[j] = value > 32767 ? 32767 : value < -32768 ? -32768 : value;
	}

	return { pcm, loopStart: plan.loops ? loopOut : null, factor: k };
}

/** The lowest factor {@link fitFactor} offers: a sample that does not fit at this does not fit. */
export const LOWEST_FACTOR = 0.05;

/**
 * The largest factor at most 1 that every one of `samples` can share and still fit `room` bytes,
 * each measured by `bytes` (the encoder's size for so many frames); {@link LOWEST_FACTOR} where
 * none does. A loop's rounding makes the size step rather than slide, so it is bisected.
 */
export function fitFactor(
	samples: readonly TrackerSample[],
	room: number,
	bytes: (frames: number, loops: boolean) => number,
): number {
	const size = (factor: number): number =>
		samples.reduce((sum, sample) => {
			const plan = plannedFrames(sample, factor);
			return sum + (plan.frames > 0 ? bytes(plan.frames, plan.loops) : 0);
		}, 0);
	if (size(1) <= room) {
		return 1;
	}

	let low = LOWEST_FACTOR;
	let high = 1;
	for (let i = 0; i < 24; i++) {
		const mid = (low + high) / 2;
		if (size(mid) <= room) {
			low = mid;
		} else {
			high = mid;
		}
	}

	return low;
}

/** How far a channel's `$EE` may raise its notes, in cents: the 64 256ths of a semitone the writer tries. */
export const FINE_TUNE_CENTS = 25;

/** An instrument's tuning bytes and the key the sample's reference note is written at under them. */
export interface Tuning {
	multiplier: number;
	sub: number;
	/** The key, from o1 c, that plays the sample at its base rate. */
	baseKey: number;
}

/** The register value the reference note needs from a sample of `baseHz` resampled by `factor`. */
export function baseRegister(factor: number, baseHz: number): number {
	return (baseHz * factor * UNITY_REGISTER) / DSP_HZ;
}

/**
 * The tuning that plays the sample at the module's pitch, with its reference note on a `c`, chosen by what the driver
 * would actually play. `SetPitch` shifts its table value right before it multiplies, so a low key
 * keeps fewer bits, while a high one leaves a small multiplier coarse (`main.asm:484-554`); so every
 * octave for the reference note and the four multipliers nearest each is tried against every key the song plays on
 * the sample (`low`..`high` semitones from the reference note), and the one whose worst note is nearest is kept. A
 * channel's `$EE` raises every note it plays by up to {@link FINE_TUNE_CENTS}, in far finer steps than
 * a small multiplier takes, so each choice is judged after the upward shift that serves it best: a
 * multiplier a little flat is as good as exact once the channel's fine tune lifts it. A choice that
 * leaves notes outside o1 c to o6 a, or past the DSP's fourteen bits, loses to one that does not.
 */
export function tuningFor(factor: number, baseHz: number, low: number, high: number): Tuning {
	const wanted = baseRegister(factor, baseHz);
	let best: (Tuning & { outside: number; error: number }) | null = null;
	for (let baseKey = 0; baseKey <= HIGHEST_KEY; baseKey += 12) {
		const ideal = (wanted / setPitchWide(baseKey * SEMITONE, 1, 0)) * 256;
		for (const total of [Math.floor(ideal) - 1, Math.floor(ideal), Math.ceil(ideal), Math.ceil(ideal) + 1]) {
			if (total < 1 || total >= 256 * 256) {
				continue;
			}

			const multiplier = total >> 8;
			const sub = total & 0xff;
			let outside = 0;
			let flattest = Infinity;
			let sharpest = -Infinity;
			for (let semis = low; semis <= high; semis++) {
				const key = baseKey + semis;
				const register = key >= 0 && key <= HIGHEST_KEY ? setPitchWide(key * SEMITONE, multiplier, sub) : 0;
				if (register === 0 || register >= DSP_PITCH_LIMIT) {
					outside++;
					continue;
				}

				const cents = 1200 * Math.log2(register / (wanted * 2 ** (semis / 12)));
				flattest = Math.min(flattest, cents);
				sharpest = Math.max(sharpest, cents);
			}

			// The worst note once the shift that centres the spread is applied, as far as `$EE` reaches.
			const shift = Math.min(FINE_TUNE_CENTS, Math.max(0, -(flattest + sharpest) / 2));
			const error = sharpest === -Infinity ? 0 : Math.max(Math.abs(flattest + shift), Math.abs(sharpest + shift));

			if (best === null || outside < best.outside || (outside === best.outside && error < best.error)) {
				best = { multiplier, sub, baseKey, outside, error };
			}
		}
	}

	return best
		? { multiplier: best.multiplier, sub: best.sub, baseKey: best.baseKey }
		: { multiplier: 1, sub: 0, baseKey: 36 };
}

/** Whether a key, from o1 c, plays true under the tuning: its register below the DSP's fourteen bits. */
export function playsTrue(tuning: Tuning, key: number): boolean {
	return setPitchWide(key * SEMITONE, tuning.multiplier, tuning.sub) < DSP_PITCH_LIMIT;
}
