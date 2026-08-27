import { clamp } from '../../../util/math';

/**
 * What fits inside a note's bar, and where.
 *
 * A bar cannot grow, so everything it would say has to be measured against the
 * width it has: the name has priority and the glyphs drop from the end, because
 * a bar that says `C6` and nothing else is still saying something. Pure
 * arithmetic over `(width, height, name, glyphCount)` — it never learns what a
 * glyph *is*, which is why the caller orders them before handing them over.
 */

/** A bar has room for its name below this, and for nothing at all under it. */
const MIN_CONTENT_HEIGHT = 11;
/** Monospace advance as a fraction of the font size, for `font-mono` at any size. */
const ADVANCE = 0.6;
/** Between the bar's edge and its text, and between two glyphs. */
const CONTENT_PAD = 3;
/** More than this on one bar is a wall of icons rather than a reading of it. */
const MAX_GLYPHS = 5;

/** Where a bar's name goes, in the same user units as the mark. */
export interface BarName {
  x: number;
  y: number;
  size: number;
}

/** Where one glyph goes. Square, so one number does for width and height. */
export interface BarGlyph {
  x: number;
  y: number;
  size: number;
}

export interface BarContent {
  name: BarName | null;
  /** As many as fit, in the order they were given. */
  glyphs: readonly BarGlyph[];
  /** Where the "and more" mark goes, when some were left off. Null when they all fit. */
  more: BarGlyph | null;
}

/**
 * What fits inside one bar: its name on the left, its glyphs on the right.
 *
 * Measured rather than assumed, because a bar is a 32nd note at one zoom and a
 * whole note at another, and rows stretch to fill the pane. Both scale with the
 * bar's height and fill it, so a tall row is easier to read and not merely
 * emptier. The name goes first and the glyphs are dropped from the end — a bar
 * that says `C6` and nothing else is still telling you something, where glyphs
 * with no note beside them are a row of icons floating over the music.
 *
 * A bar that cannot show them all says so, in the rightmost slot: a truncated
 * list and a complete one look the same otherwise, and the difference is what
 * decides whether the hover is worth asking. The inspector lists all of them
 * for the note under the caret, and a hover names them.
 */
export function fitBarContent(
  width: number,
  height: number,
  name: string,
  glyphs: number,
): BarContent {
  const empty: BarContent = { name: null, glyphs: [], more: null };
  if (height < MIN_CONTENT_HEIGHT || width <= 0) {
    return empty;
  }

  const size = Math.max(7, height - 4);
  const nameWidth = name.length * size * ADVANCE;
  // The name is the floor, not the first of several things competing for room:
  // a bar with no room for it has none for a glyph either, and letting the
  // glyphs take the space the name gave up means a bar that grows an icon as it
  // shrinks. Nothing at all is the honest picture, and the hover still answers.
  if (nameWidth + CONTENT_PAD * 2 > width) {
    return empty;
  }

  const placed: BarName = { x: CONTENT_PAD, y: height / 2, size };
  const left = CONTENT_PAD + nameWidth + CONTENT_PAD;

  // Right-aligned and filled leftwards, so a bar that grows a glyph grows it on
  // the side away from the name. The boxes come back in the order they were
  // asked for, left to right, which is what lets the caller read the ones it did
  // not get back as the tail of its own list.
  const box = height - 2;
  const slot = (n: number): BarGlyph => ({
    x: width - CONTENT_PAD - (n + 1) * box - n * CONTENT_PAD,
    y: (height - box) / 2,
    size: box,
  });

  const room = clamp(Math.floor((width - left) / (box + CONTENT_PAD)), 0, MAX_GLYPHS);
  // The mark takes a slot of its own, and takes it from the glyphs — a bar with
  // room for one of four says "there are commands here" better than it says
  // which one came first, so the last glyph gives way to it even when that
  // leaves the mark standing alone. `MAX_GLYPHS` counts as no room: a list cut
  // to keep the bar readable is still a list cut.
  const short = glyphs > room;
  const count = short ? Math.max(0, room - 1) : glyphs;
  const laid: BarGlyph[] = [];
  for (let n = 0; n < count; n++) {
    laid.push(slot(short ? n + 1 : n));
  }

  return { name: placed, glyphs: laid.reverse(), more: short && room > 0 ? slot(0) : null };
}
