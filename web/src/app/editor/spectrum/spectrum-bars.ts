/**
 * The bars a spectrum meter draws from its band levels: all 28 at full size, or fourteen for the
 * top bar, each the louder of a pair, so a narrow peak still shows in the small one.
 */
export function spectrumBars(bands: Float32Array, compact: boolean): Float32Array {
  if (!compact) {
    return bands;
  }

  const out = new Float32Array(Math.ceil(bands.length / 2));
  for (let n = 0; n < out.length; n++) {
    out[n] = Math.max(bands[n * 2], bands[n * 2 + 1] ?? bands[n * 2]);
  }

  return out;
}
