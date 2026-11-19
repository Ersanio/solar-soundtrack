/**
 * Loudness as ITU-R BS.1770-4 measures it — K-weighting, 400 ms momentary blocks, the gated
 * integrated figure — at whatever rate the samples arrive at.
 *
 * The K filter's two stages are given in the recommendation as coefficients for 48 kHz only; these
 * are the analogue prototypes behind those coefficients (shelf at 1681.97 Hz, +4.0 dB, Q 0.7072;
 * high pass at 38.135 Hz, Q 0.5003) put through the bilinear transform at the rate asked for, as
 * libebur128 does, so they reproduce the published 48 kHz coefficients and hold at the DSP's 32 kHz.
 */

/** A full-scale sine on one channel reads this; on both, 3 dB more. */
export const LUFS_OFFSET = -0.691;

/** Below this a block is silence and counts for nothing (BS.1770-4 §5.1, the absolute gate). */
const ABSOLUTE_GATE = -70;
/** And this far under the ungated mean, a block is a quiet passage (the relative gate). */
const RELATIVE_GATE = -10;

class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    private readonly b0: number,
    private readonly b1: number,
    private readonly b2: number,
    private readonly a1: number,
    private readonly a2: number,
  ) {}

  run(x: number): number {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Stage 1 of the K filter, the head's high shelf, at `rate`. */
function shelf(rate: number): Biquad {
  const f0 = 1681.974450955533;
  const gain = 3.999843853973347;
  const q = 0.7071752369554196;
  const k = Math.tan((Math.PI * f0) / rate);
  const vh = 10 ** (gain / 20);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / q + k * k;
  return new Biquad(
    (vh + (vb * k) / q + k * k) / a0,
    (2 * (k * k - vh)) / a0,
    (vh - (vb * k) / q + k * k) / a0,
    (2 * (k * k - 1)) / a0,
    (1 - k / q + k * k) / a0,
  );
}

/** Stage 2, the RLB high pass, at `rate`. */
function highPass(rate: number): Biquad {
  const f0 = 38.13547087602444;
  const q = 0.5003270373238773;
  const k = Math.tan((Math.PI * f0) / rate);
  const a0 = 1 + k / q + k * k;
  return new Biquad(1, -2, 1, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0);
}

/** Mean-square power as LUFS, `-Infinity` for none. */
export function lufs(power: number): number {
  return power > 0 ? LUFS_OFFSET + 10 * Math.log10(power) : -Infinity;
}

/**
 * Takes stereo frames scaled to ±1 and reports momentary loudness as it goes, and the integrated
 * loudness of everything it was given at the end.
 */
export class LoudnessMeter {
  private readonly left: readonly Biquad[];
  private readonly right: readonly Biquad[];
  /** Frames in one 100 ms step: a momentary block is four of them, overlapping by three. */
  private readonly stepFrames: number;
  private stepSum = 0;
  private stepFill = 0;
  private readonly steps = [0, 0, 0, 0];
  private stepsSeen = 0;
  /** Every momentary block's power, for the gated integration. */
  private readonly blocks: number[] = [];

  constructor(rate: number) {
    this.left = [shelf(rate), highPass(rate)];
    this.right = [shelf(rate), highPass(rate)];
    this.stepFrames = Math.round(rate / 10);
  }

  push(l: number, r: number): void {
    const kl = this.left[1].run(this.left[0].run(l));
    const kr = this.right[1].run(this.right[0].run(r));
    this.stepSum += kl * kl + kr * kr;
    if (++this.stepFill < this.stepFrames) {
      return;
    }

    this.steps[this.stepsSeen % 4] = this.stepSum / this.stepFrames;
    this.stepsSeen++;
    this.stepSum = 0;
    this.stepFill = 0;
    if (this.stepsSeen >= 4) {
      this.blocks.push(this.blockPower());
    }
  }

  /** The last 400 ms, or as much of it as there has been. */
  momentary(): number {
    return lufs(this.blockPower());
  }

  private blockPower(): number {
    const seen = Math.min(4, this.stepsSeen);
    if (seen === 0) {
      return 0;
    }

    let sum = 0;
    for (let n = 0; n < seen; n++) {
      sum += this.steps[n];
    }

    return sum / seen;
  }

  /** The gated mean over every block (BS.1770-4 §5.1), `-Infinity` when every block is gated out. */
  integrated(): number {
    const loud = this.blocks.filter((power) => lufs(power) > ABSOLUTE_GATE);
    if (loud.length === 0) {
      return -Infinity;
    }

    const mean = loud.reduce((sum, power) => sum + power, 0) / loud.length;
    const gate = lufs(mean) + RELATIVE_GATE;
    const kept = loud.filter((power) => lufs(power) > gate);
    return lufs(kept.reduce((sum, power) => sum + power, 0) / kept.length);
  }
}
