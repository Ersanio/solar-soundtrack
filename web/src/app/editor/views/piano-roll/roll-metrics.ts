/**
 * The roll's drawing constants, shared by the parent and its children.
 *
 * Here rather than in `piano-roll.ts` because the pieces that draw with them are
 * separate components now: the key column's width is the scrub bar's left edge
 * as well as the keyboard's, and a second copy of that number is how the two
 * would come apart. The camera's own fractions are not here — nothing but the
 * camera reads them.
 */

/** Width of the key column. Wide enough for a drum's longest label, `@29 o4 c+`. */
export const KEY_WIDTH = 76;

/** Gap between a note and its row's edges, so two rows never merge into a block. */
export const ROW_GAP = 1;

/** The surface gap between two bars that meet, per the mark spec. */
export const NOTE_GAP = 2;

/** Height of the scrub bar: room for a pitch contour, little enough to stay chrome. */
export const SCRUB_HEIGHT = 36;

/** Inset, so the top and bottom rows are not swallowed by the border. */
export const SCRUB_PAD = 3;

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
