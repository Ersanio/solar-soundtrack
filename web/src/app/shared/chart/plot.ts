/**
 * The fixed drawing space the command inspector's graphs share.
 *
 * They are drawn at a fixed size and stretched to their container, so stroke
 * widths and offsets are in viewBox units rather than pixels. Stating the space
 * once means a graph declares only where it differs — the FIR plot is taller,
 * and that is the whole of what makes it different.
 */
export interface Plot {
  readonly w: number;
  readonly h: number;
  /** The `viewBox` attribute, ready to bind. */
  readonly box: string;
}

export function plot(w: number, h: number): Plot {
  return { w, h, box: `0 0 ${w} ${h}` };
}

/** What an inspector graph draws in unless it says otherwise. */
export const PLOT = plot(320, 120);
