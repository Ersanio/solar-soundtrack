/**
 * What the live oscilloscopes and the vectorscope compute from a capture: where to start drawing
 * so a waveform holds still, a voice as it is heard, and how alike the two sides of the mix are.
 */

/**
 * The level a scope's box is full at: -6 dBFS, which one ordinary voice stays inside.
 * One scale for every box, so channels compare; a voice louder than it is held at the edge.
 */
export const SCOPE_FULL_SCALE = 0.5;

/**
 * The frame a scope of `span` frames starts at: the last rising zero crossing that leaves a whole
 * span after it, so a steady tone is drawn from the same point of its cycle every time. `stride`
 * and `offset` pick one voice out of interleaved data. Where nothing crosses, the newest span.
 */
export function triggerFrame(
  samples: ArrayLike<number>,
  frames: number,
  span: number,
  stride = 1,
  offset = 0,
): number {
  const last = frames - span;
  if (last <= 0) {
    return 0;
  }

  for (let frame = last; frame > 0; frame--) {
    const before = samples[(frame - 1) * stride + offset];
    const at = samples[frame * stride + offset];
    if (before < 0 && at >= 0) {
      return frame;
    }
  }

  return last;
}

/**
 * A voice's `VxOUTX` byte scaled to what the mix hears of it, -1 to 1: the DSP multiplies the
 * voice by its volume over 128 on each side, then the whole mix by the main volume over 128. The
 * two sides are averaged by magnitude, since a surround voice is negated on one side only.
 */
export function heardGain(volumes: ArrayLike<number>, voice: number): number {
  const left = Math.abs(volumes[voice * 2]);
  const right = Math.abs(volumes[voice * 2 + 1]);
  const main = (Math.abs(volumes[16] ?? 127) + Math.abs(volumes[17] ?? 127)) / 2;
  return (((left + right) / 2) * main) / (128 * 128 * 128);
}

/**
 * How alike the two sides of interleaved stereo are: 1 the same, 0 unrelated, -1 one the negation
 * of the other, which is what a surround volume makes and what cancels when the mix is heard in mono.
 * `null` for silence, which has no correlation to report.
 */
export function correlation(mix: ArrayLike<number>, from: number, to: number): number | null {
  let lr = 0;
  let ll = 0;
  let rr = 0;
  for (let frame = from; frame < to; frame++) {
    const l = mix[frame * 2];
    const r = mix[frame * 2 + 1];
    lr += l * r;
    ll += l * l;
    rr += r * r;
  }

  const norm = Math.sqrt(ll * rr);
  return norm > 0 ? lr / norm : null;
}

/** How quickly the correlation meter follows its readings, in seconds: a 32 ms window jumps about. */
export const CORRELATION_SMOOTHING = 0.3;
/** How long the meter's low mark holds the lowest reading before it lets go, in seconds. */
export const CORRELATION_HOLD = 2;

/** The correlation meter between frames: where the bar stands, and its low mark. */
export interface CorrelationMeter {
  value: number;
  low: number;
  /** How long the low mark has stood. */
  heldFor: number;
}

/**
 * One frame of the correlation meter: the bar eased toward `reading` with
 * {@link CORRELATION_SMOOTHING}, and the low mark held at the lowest it has been for
 * {@link CORRELATION_HOLD}, since a dip below 0 is the moment worth seeing. A `null` meter starts
 * on `reading`; a `null` reading, silence, leaves the meter where it stands.
 */
export function stepCorrelation(
  meter: CorrelationMeter | null,
  reading: number | null,
  elapsed: number,
): CorrelationMeter | null {
  if (reading === null) {
    return meter;
  }

  if (!meter) {
    return { value: reading, low: reading, heldFor: 0 };
  }

  const ease = elapsed > 0 ? 1 - Math.exp(-elapsed / CORRELATION_SMOOTHING) : 0;
  const value = meter.value + (reading - meter.value) * ease;
  const heldFor = meter.heldFor + Math.max(0, elapsed);
  return value <= meter.low || heldFor >= CORRELATION_HOLD
    ? { value, low: value, heldFor: 0 }
    : { value, low: meter.low, heldFor };
}
