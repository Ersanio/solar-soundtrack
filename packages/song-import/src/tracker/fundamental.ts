/**
 * A sample's fundamental, so a library sample standing in for a module's can be tuned to sound the
 * module's notes: YIN's cumulative mean normalised difference over a window of the sample, a loop
 * laid end to end or a one-shot from its attack.
 */

/** The DSP's own rate: a sample at pitch register `$1000` plays a frame a sample at 32 kHz. */
const DSP_HZ = 32_000;
/** Frames the difference is taken over at most. */
const WINDOW = 4096;
const LOWEST_HZ = 30;
const HIGHEST_HZ = 4000;
/** The first dip under this is the period (YIN's absolute threshold). */
const THRESHOLD = 0.15;
/** A best dip above this is no pitch: a drum or noise. */
const UNPITCHED = 0.3;

/** The frames the period is looked for in: the loop laid end to end, or a one-shot from its loudest early frame. */
function windowOf(pcm: Int16Array, loopStart: number | null): Float64Array {
	if (loopStart !== null && loopStart < pcm.length) {
		const loop = pcm.subarray(loopStart);
		return Float64Array.from({ length: WINDOW }, (_, i) => loop[i % loop.length]);
	}

	let peak = 0;
	for (let i = 1; i < Math.floor(pcm.length / 4); i++) {
		if (Math.abs(pcm[i]) > Math.abs(pcm[peak])) {
			peak = i;
		}
	}

	return Float64Array.from(pcm.subarray(peak, peak + WINDOW));
}

/**
 * The frequency `pcm` sounds at when played at `rate` frames a second, or `null` where it has no clear
 * pitch. A loop made of whole periods has its period read off the loop's length, which is exact.
 */
export function fundamentalHz(pcm: Int16Array, loopStart: number | null, rate: number): number | null {
	const x = windowOf(pcm, loopStart);
	const minLag = Math.max(2, Math.floor(rate / HIGHEST_HZ));
	const maxLag = Math.min(Math.ceil(rate / LOWEST_HZ), Math.floor(x.length / 2) - 1);
	if (maxLag <= minLag || x.every((v) => v === 0)) {
		return null;
	}

	const width = x.length - maxLag - 1;
	const d = new Float64Array(maxLag + 2);
	for (let lag = 1; lag <= maxLag + 1; lag++) {
		let sum = 0;
		for (let j = 0; j < width; j++) {
			const diff = x[j] - x[j + lag];
			sum += diff * diff;
		}

		d[lag] = sum;
	}

	// Normalised by the running mean, so the dip at the period stands out from those at short lags.
	const cmnd = new Float64Array(maxLag + 2).fill(1);
	let running = 0;
	for (let lag = 1; lag <= maxLag + 1; lag++) {
		running += d[lag];
		cmnd[lag] = running === 0 ? 1 : (d[lag] * lag) / running;
	}

	let best = -1;
	for (let lag = minLag; lag <= maxLag; lag++) {
		if (cmnd[lag] < THRESHOLD) {
			while (lag + 1 <= maxLag && cmnd[lag + 1] < cmnd[lag]) {
				lag++;
			}

			best = lag;
			break;
		}
	}

	if (best < 0) {
		for (let lag = minLag; lag <= maxLag; lag++) {
			if (best < 0 || cmnd[lag] < cmnd[best]) {
				best = lag;
			}
		}
	}

	if (cmnd[best] > UNPITCHED) {
		return null;
	}

	const [a, b, c] = [cmnd[best - 1], cmnd[best], cmnd[best + 1]];
	const bend = a - 2 * b + c;
	let period = best + (bend > 0 ? (a - c) / (2 * bend) : 0);
	if (loopStart !== null && loopStart < pcm.length) {
		const loop = pcm.length - loopStart;
		const exact = loop / Math.max(1, Math.round(loop / period));
		if (Math.abs(exact - period) < period * 0.01) {
			period = exact;
		}
	}

	return rate / period;
}

/**
 * The factor that tunes a library sample to stand in for a module sample of `baseHz`: the rate it
 * must play at on the module's reference note, over `baseHz`. With both pitches heard the library
 * sample sounds the module sample's (`moduleHz` heard at `baseHz`, `libraryHz` at the DSP's 32 kHz);
 * otherwise it plays at 32 kHz on the reference note. Either way raised by `semitones`.
 */
export function libraryFactor(
	baseHz: number,
	moduleHz: number | null,
	libraryHz: number | null,
	semitones: number,
): { factor: number; pitched: boolean } {
	const pitched = moduleHz !== null && libraryHz !== null;
	const rate = pitched ? (DSP_HZ * moduleHz) / libraryHz : DSP_HZ;
	return { factor: (rate / baseHz) * 2 ** (semitones / 12), pitched };
}
