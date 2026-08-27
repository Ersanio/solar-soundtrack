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

/** Height of the overview bar: room for a pitch contour, little enough to stay chrome. */
export const OVERVIEW_HEIGHT = 36;

/** Inset, so the top and bottom rows are not swallowed by the border. */
export const OVERVIEW_PAD = 3;

/** Height of the scrub bar: a row of bar numbers over a row of beat ticks. */
export const SCRUB_HEIGHT = 20;

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
