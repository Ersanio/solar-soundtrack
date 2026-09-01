/**
 * The eight music channels' colours, as Tailwind class names.
 *
 * Tailwind v4 scans source text, so a class name has to be a complete literal —
 * `fill-ch-${n}` generates no CSS at all and every note renders unpainted. That
 * is why each property the app paints a channel with gets its own spelled-out
 * eight rather than one array and a prefix.
 *
 * One home for all of them, because they are drawn by things that are not each
 * other's: the roll's marks and the minimap's bars are SVG, the roll's channel
 * picker and the channel mixer are HTML, and a chip that disagreed with a bar
 * about which blue channel 0 is would be worse than no colour at all. The
 * `--color-ch-*` set in `styles.css` is the one definition underneath them all.
 */

/** Filled SVG shapes: the roll's note bars and the overview's minimap. */
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
 * The same eight as `color`.
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

/** The same eight as outlines. */
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

/** The same eight as HTML backgrounds: the mixer's plates, the roll's chips. */
export const CHANNEL_BG: readonly string[] = [
  'bg-ch-0',
  'bg-ch-1',
  'bg-ch-2',
  'bg-ch-3',
  'bg-ch-4',
  'bg-ch-5',
  'bg-ch-6',
  'bg-ch-7',
];

/**
 * A channel the mask silences, on the mixer's plate and the roll's chip alike:
 * struck through and dimmed, so plate and digit lose their colour together.
 */
export const CHANNEL_QUIET = 'line-through opacity-40';

/** The same eight behind a whole mixer strip, faint enough to read M and S over. */
export const CHANNEL_WASH: readonly string[] = [
  'bg-ch-0/15',
  'bg-ch-1/15',
  'bg-ch-2/15',
  'bg-ch-3/15',
  'bg-ch-4/15',
  'bg-ch-5/15',
  'bg-ch-6/15',
  'bg-ch-7/15',
];
