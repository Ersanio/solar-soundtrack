/**
 * The roll's drawing constants, shared by the parent and its children.
 *
 * Here rather than in `piano-roll.ts` because the pieces that draw with them are
 * separate components now: the key column's width is where both bars over the
 * roll start as well as the keyboard's, and a second copy of that number is how
 * they would come apart. The camera's own fractions are not here — nothing but
 * the camera reads them.
 */

/** Width of the key column. Wide enough for a drum's longest label, `@29 o4 c+`. */
export const KEY_WIDTH = 76;

/** Gap between a note and its row's edges, so two rows never merge into a block. */
export const ROW_GAP = 1;

/** The surface gap between two bars that meet, per the mark spec. */
export const NOTE_GAP = 2;

/**
 * The box a note occupies on its row, less the gaps that keep bars apart.
 *
 * One definition, because the roll's bars, the overview's minimap and a
 * gesture's preview all draw the same rectangle and a bar drawn a pixel taller
 * in one of them reads as a different kind of thing. The `x` is the caller's:
 * the three disagree about which tick a bar starts on, which is the only thing
 * they should disagree about.
 */
export function barRect(
  row: number,
  rowHeight: number,
  ticks: number,
  zoom: number,
): { y: number; w: number; h: number } {
  return {
    y: row * rowHeight + ROW_GAP,
    w: Math.max(1, ticks * zoom - NOTE_GAP),
    h: Math.max(1, rowHeight - ROW_GAP * 2),
  };
}

/**
 * The box a loop's pass occupies, given the rows its notes span.
 *
 * Padded outward past the bars rather than fitted to them, so the outline reads
 * as something the notes stand inside. One definition for `barRect`'s reason:
 * the box is built from the compiled song and moved again while a gesture is
 * held, and a rectangle two pixels shorter in one of those is a box that jumps
 * the moment a pointer goes down.
 */
export function loopBox(low: number, high: number, rowHeight: number): { y: number; h: number } {
  return { y: low * rowHeight - 2, h: (high - low + 1) * rowHeight + 4 };
}

/** Height of the overview bar: room for a pitch contour, little enough to stay chrome. */
export const OVERVIEW_HEIGHT = 36;

/** Inset, so the top and bottom rows are not swallowed by the border. */
export const OVERVIEW_PAD = 3;

/** Height of the scrub bar: a row of bar numbers over a row of beat ticks. */
export const SCRUB_HEIGHT = 20;

/**
 * The loop label's own text size, in the corner of a selected loop's box.
 *
 * Fixed, where a bar's name is measured against the row it sits in: it names a
 * construct, which is neither a note nor a row. The roll's `<svg>` is 1:1 with
 * CSS pixels and `scroll()` is a translate, so this is the same size at every
 * zoom and at every row height.
 */
export const LOOP_LABEL_SIZE = 9;

/** Between a loop label's plate and the corner of the box it sits in. */
export const LOOP_LABEL_INSET = 3;

/** A command glyph in the lane. The bar's own are measured against the row it sits in. */
export const LANE_GLYPH = 12;

/** Around a glyph: the gap between two stacked, and between two columns that meet. */
export const LANE_PAD = 2;

/** One row of the command lane. */
export const LANE_ROW = LANE_GLYPH + LANE_PAD;

/**
 * Five glyphs: the height the lane opens at, and the shortest the seam above it
 * will let it be. Deeper columns are scrolled to, not shown.
 */
export const LANE_HEIGHT = LANE_ROW * 5;

/** The tallest that seam will let it be, at ten glyphs. */
export const LANE_HEIGHT_MAX = LANE_ROW * 10;

/** How tall the playhead's marker is. Its tip is on the bar's bottom edge. */
export const MARKER_HEIGHT = 10;

/** Half the marker's width, so its two top corners are `x` either side of the tip. */
export const MARKER_REACH = 6;

/**
 * Tailwind v4 scans source text, so a class name has to be a complete literal —
 * `fill-ch-${n}` generates no CSS at all and every note renders unpainted.
 */
export const CHANNEL_FILL: readonly string[] = [
  'fill-ch-0',
  'fill-ch-1',
  'fill-ch-2',
  'fill-ch-3',
  'fill-ch-4',
  'fill-ch-5',
  'fill-ch-6',
  'fill-ch-7',
];

/**
 * The same eight as `color`, and spelled out for the same reason.
 *
 * A palette glyph draws its own paths with `fill="currentColor"` and
 * `stroke="currentColor"` (`command-icon.html`), so an inherited `fill` is
 * overridden on every filled shape and the strokes are never reached at all.
 * `color` is the one property that tints one.
 */
export const CHANNEL_TEXT: readonly string[] = [
  'text-ch-0',
  'text-ch-1',
  'text-ch-2',
  'text-ch-3',
  'text-ch-4',
  'text-ch-5',
  'text-ch-6',
  'text-ch-7',
];

/** The same eight, as outlines, and spelled out for the same reason. */
export const CHANNEL_STROKE: readonly string[] = [
  'stroke-ch-0',
  'stroke-ch-1',
  'stroke-ch-2',
  'stroke-ch-3',
  'stroke-ch-4',
  'stroke-ch-5',
  'stroke-ch-6',
  'stroke-ch-7',
];

/**
 * How far a silenced channel is dimmed, in both pictures.
 *
 * One number, so a mute reads the same on the roll as on the overview bar.
 * Dimmed rather than hidden: a muted part is still part of the song.
 */
export const MUTED_OPACITY = 0.12;

/**
 * The same idea in the command lane, and a much higher number.
 *
 * A bar is a filled rectangle tens of pixels wide, so a twelfth of its colour is
 * still a shape the eye finds; a lane glyph is line art twelve pixels square,
 * and at that value its strokes are all but gone. What is left dimmed there is
 * also the part of a silenced channel that is still *heard* — its `t`, its `w`
 * and its echo writes, everything else having been dropped — so it has to be
 * legible rather than merely present. Soloing one channel is where that bites:
 * seven channels' worth of song settings are dimmed at once, and they are the
 * only record on screen of what is still running.
 */
export const LANE_MUTED_OPACITY = 0.45;
