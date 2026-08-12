export interface StackInput {
  /** The value driving the segment's share of the bar. */
  value: number;
}

export interface StackPlacement {
  /** Left edge in px, from the start of the bar. */
  x: number;
  /** Visible width in px, gap already excluded. */
  width: number;
}

export interface StackOptions {
  /** Total px available, including the gaps between segments. */
  width: number;
  /** Surface gap between adjacent fills. */
  gap: number;
  /**
   * Smallest visible width for a segment whose value is above zero.
   *
   * A stacked bar spanning the whole 64 KiB of ARAM makes small-but-real regions
   * round away to nothing — a 700-byte song is a hair over 1% of the bar and
   * disappears at typical widths. A floor keeps every present region visible.
   *
   * The floor necessarily overstates the smallest segments, so the pixels it
   * grants are taken back from the segments that can spare them rather than
   * added to the total. The table beside the bar carries exact byte counts, so
   * the distortion is bounded and never the only thing a reader has.
   */
  minWidth: number;
}

/**
 * Lays out one stacked proportion bar.
 *
 * Pure, so the arithmetic can be tested without a DOM: the only interesting
 * behaviour here is what happens at the extremes (a segment worth a fraction of
 * a pixel, a bar too narrow to satisfy every floor), and that is exactly what
 * is awkward to check by eye in a browser.
 */
export function stackSegments(
  segments: readonly StackInput[],
  { width, gap, minWidth }: StackOptions,
): StackPlacement[] {
  const count = segments.length;
  if (count === 0) {
    return [];
  }

  const available = width - gap * (count - 1);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (available <= 0 || total <= 0) {
    return [];
  }

  // Each segment's share of what the gaps leave: a linear map of [0, total]
  // onto [0, available]. The guard above is what makes the division safe.
  let widths = segments.map((segment) => (segment.value / total) * available);

  // Too narrow to honour the floor at all: split evenly rather than emit
  // negative widths. Only reachable on a bar of a couple of dozen pixels.
  if (available < minWidth * count) {
    widths = segments.map(() => available / count);
  } else {
    // Raise everything under the floor, then reclaim those pixels from the
    // segments with room above it, in proportion to how much room each has.
    const deficit = widths.reduce((sum, w) => sum + Math.max(minWidth - w, 0), 0);
    const surplus = widths.map((w) => Math.max(w - minWidth, 0));
    const totalSurplus = surplus.reduce((sum, s) => sum + s, 0);

    if (deficit > 0 && totalSurplus > 0) {
      const take = Math.min(deficit / totalSurplus, 1);
      widths = widths.map((w, index) => (w < minWidth ? minWidth : w - surplus[index] * take));
    }
  }

  let offset = 0;
  return widths.map((segmentWidth) => {
    const placement = { x: offset, width: segmentWidth };
    offset += segmentWidth + gap;
    return placement;
  });
}
