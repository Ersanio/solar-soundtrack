/**
 * The frequency axis every spectrum in the Song Inspector shares: one fixed range for every song,
 * so two songs can be read against each other.
 *
 * The top is 16 kHz because that is all there is: the DSP mixes at 32 kHz, so nothing it makes lies
 * above half of that. The bottom is the lowest ISO third-octave band, 31.5 Hz. The level runs from
 * {@link FLOOR_DB} to {@link CEIL_DB} dBFS, where 0 is a full-scale sine.
 */

export const FLOOR_DB = -72;
export const CEIL_DB = 0;

export interface Band {
  /** The nominal centre, for a label. */
  centre: number;
  low: number;
  high: number;
}

/**
 * The 28 ISO third-octave bands from 31.5 Hz to 16 kHz: exact base-two centres a third of an
 * octave apart, named by their preferred numbers.
 */
const NOMINAL = [
  31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000,
  2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000,
];

export const THIRD_OCTAVES: readonly Band[] = NOMINAL.map((centre, n) => {
  const exact = 1000 * 2 ** ((n - 15) / 3);
  return { centre, low: exact / 2 ** (1 / 6), high: exact * 2 ** (1 / 6) };
});

/** The bottom and top of the axis, in Hz: the edges of the outermost third-octave bands. */
export const LOW_HZ = THIRD_OCTAVES[0].low;
export const HIGH_HZ = THIRD_OCTAVES[THIRD_OCTAVES.length - 1].high;

/** Rows of a spectrogram: twelve to the octave over the same range. */
export function logRows(perOctave: number): Band[] {
  const octaves = Math.log2(HIGH_HZ / LOW_HZ);
  const count = Math.round(octaves * perOctave);
  return Array.from({ length: count }, (_, n) => {
    const low = LOW_HZ * 2 ** (n / perOctave);
    const high = LOW_HZ * 2 ** ((n + 1) / perOctave);
    return { centre: Math.sqrt(low * high), low, high };
  });
}

/**
 * A window's two calibrations: the amplitude of its peak bin for a unit sine, and how many bins of
 * power a sine spreads over (its noise-equivalent bandwidth).
 */
export interface WindowGain {
  coherent: number;
  bandwidth: number;
}

/** Hann, as `fft.ts` applies it. */
export const HANN: WindowGain = { coherent: 0.5, bandwidth: 1.5 };

/** Blackman with α = 0.16, as `AnalyserNode` applies it (Web Audio §1.8.4). */
export const BLACKMAN: WindowGain = { coherent: 0.42, bandwidth: 1.727 };

/**
 * Each band's level in dB, `FLOOR_DB` at the least, from a power spectrum.
 *
 * `power[k]` is `|X[k]|²` for a transform whose peak bin is `coherent × A × N / 2` for a sine of
 * amplitude `A`; `scale` is `(N / 2)²`. A band that holds whole bins sums them and divides by the
 * window's bandwidth, so a full-scale sine reads 0 dB in its band — or reads its loudest bin, where
 * that is more: a low band a bin or two wide holds only part of a sine the window spreads over
 * several. A band narrower than a bin reads the spectrum at its centre, interpolated, so the low
 * bands of a short window are not left empty.
 */
export function bandLevels(
  power: ArrayLike<number>,
  binHz: number,
  bands: readonly Band[],
  window: WindowGain,
  scale: number,
  out: Float32Array = new Float32Array(bands.length),
): Float32Array {
  const norm = 1 / (scale * window.coherent * window.coherent);
  const bins = power.length;
  for (let b = 0; b < bands.length; b++) {
    const { low, high, centre } = bands[b];
    const from = Math.ceil(low / binHz);
    const to = Math.min(bins - 1, Math.floor(high / binHz));
    let level: number;
    if (to >= from) {
      let sum = 0;
      let loudest = 0;
      for (let k = from; k <= to; k++) {
        sum += power[k];
        loudest = Math.max(loudest, power[k]);
      }

      level = Math.max(sum / window.bandwidth, loudest) * norm;
    } else {
      const at = centre / binHz;
      const k = Math.min(bins - 2, Math.floor(at));
      const t = at - k;
      level = (power[k] * (1 - t) + power[k + 1] * t) * norm;
    }

    out[b] = Math.max(FLOOR_DB, level > 0 ? 10 * Math.log10(level) : FLOOR_DB);
  }

  return out;
}

/**
 * `AnalyserNode.getFloatFrequencyData`'s decibels as the power `bandLevels` reads: the node
 * reports `20 log10 |X[k]|` of a transform already divided by its size, so a unit sine's peak is
 * `coherent / 2` and the scale to pass `bandLevels` alongside this is `1 / 4`.
 */
export function analyserPower(decibels: Float32Array, out: Float32Array): Float32Array {
  for (let k = 0; k < decibels.length; k++) {
    const db = decibels[k];
    out[k] = Number.isFinite(db) ? 10 ** (db / 10) : 0;
  }

  return out;
}

/** Where `db` sits between the floor and the ceiling, 0 to 1. */
export function levelFraction(db: number): number {
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / (CEIL_DB - FLOOR_DB)));
}
