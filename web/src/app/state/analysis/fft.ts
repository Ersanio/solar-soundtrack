/**
 * A radix-2 FFT over a Hann window, for the spectrogram: one size, its tables built once, and the
 * power of each bin out.
 *
 * Calibrated as `spectrum-bands.ts`'s `HANN` says, so its output goes straight into `bandLevels`
 * with a scale of `(size / 2)²`.
 */
export class PowerSpectrum {
  readonly bins: number;
  private readonly window: Float64Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly reversed: Uint32Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;

  constructor(readonly size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`an FFT size must be a power of two, not ${size}`);
    }

    this.bins = size / 2;
    this.window = Float64Array.from(
      { length: size },
      (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / size),
    );
    this.cos = Float64Array.from({ length: size / 2 }, (_, k) =>
      Math.cos((2 * Math.PI * k) / size),
    );
    this.sin = Float64Array.from(
      { length: size / 2 },
      (_, k) => -Math.sin((2 * Math.PI * k) / size),
    );

    const bits = Math.log2(size);
    this.reversed = Uint32Array.from({ length: size }, (_, n) => {
      let r = 0;
      for (let b = 0; b < bits; b++) {
        r = (r << 1) | ((n >> b) & 1);
      }

      return r;
    });

    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
  }

  /** `|X[k]|²` for `k` below the Nyquist bin, of `input[at .. at + size)` windowed. */
  power(input: ArrayLike<number>, at: number, out: Float32Array): Float32Array {
    const { size, re, im, reversed, window } = this;
    for (let n = 0; n < size; n++) {
      re[reversed[n]] = input[at + n] * window[n];
      im[reversed[n]] = 0;
    }

    for (let half = 1; half < size; half *= 2) {
      const stride = size / (half * 2);
      for (let start = 0; start < size; start += half * 2) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * stride];
          const wi = this.sin[k * stride];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }

    for (let k = 0; k < this.bins; k++) {
      out[k] = re[k] * re[k] + im[k] * im[k];
    }

    return out;
  }
}
