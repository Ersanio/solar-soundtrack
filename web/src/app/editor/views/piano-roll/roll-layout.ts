/**
 * Where the piano roll puts things, and when. Pure arithmetic, no Angular —
 * `charttest` covers it, because neither an off-by-one in a windowed scroller
 * nor a playhead that jerks ten times a second is visible in a screenshot, and
 * both are obvious in a number.
 */

import { KEY_COUNT } from '@amk/spc/song-walk';
import { clamp } from '../../../util/math';

/** Semitones per octave, and where `$80` sits: o1 c. */
const OCTAVE = 12;

/** A row of the roll: one semitone, one drum, or the noise lane. */
export interface Lane {
  /** Distance from the top of the stack, in rows. */
  row: number;
  kind: 'key' | 'drum' | 'noise';
  /**
   * The key number for a key — o1 c is 0, and a written pitch below it is
   * negative — the `@n` for a drum, -1 for noise.
   *
   * Read by `charttest` and by nothing in the roll, which goes the other way
   * round — `rowOfKey` and `rowOfDrum` take it a number and hand back a row.
   * It stays because the checks that a fitted range covers the notes played,
   * and that the drums count down to the keyboard, are about this number.
   */
  index: number;
  /** `o4 c+` for a key, `@23 o3 a` for a drum. */
  label: string;
  /** Whether a key is one of the five black ones. */
  black: boolean;
  /** The first row of an octave, which gets the heavier rule. */
  octaveStart: boolean;
}

export interface LaneStack {
  lanes: readonly Lane[];
  /** Row of every pitched key drawn, keyed by key number. */
  rowOfKey: ReadonlyMap<number, number>;
  /**
   * Row of each drum, keyed by its instrument number.
   *
   * Keyed by instrument and not by note byte, because that is what places a
   * note: everything played while a drum is loaded is that drum being hit,
   * whatever pitch it was written at.
   */
  rowOfDrum: ReadonlyMap<number, number>;
  /** Row of the noise lane, or -1 when the song makes none. */
  noiseRow: number;
}

const NAMES = ['c', 'c+', 'd', 'd+', 'e', 'f', 'f+', 'g', 'g+', 'a', 'a+', 'b'];
const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

/**
 * `$80` is o1 c, so key 0 is o1 c and key 69 is o6 a. A key below 0 is a
 * written pitch in o0 — `o0` is legal MML and `h12` brings it back into the
 * driver's range — so the octave floors and the semitone wraps.
 */
export function keyName(key: number): string {
  return `o${Math.floor(key / OCTAVE) + 1} ${NAMES[semitone(key)]}`;
}

/**
 * The same key, short enough to sit inside a bar: `C6`, `C+6`.
 *
 * {@link keyName}'s `o6 c` is right down the key column and in a tooltip, and
 * four characters too wide for a bar at any sensible zoom. Both are built from
 * the same {@link semitone} and the same floor, so they can only ever name the
 * same key — `charttest` holds them to it.
 */
export function noteLabel(key: number): string {
  return `${NAMES[semitone(key)].toUpperCase()}${Math.floor(key / OCTAVE) + 1}`;
}

export function keyIsBlack(key: number): boolean {
  return BLACK[semitone(key)];
}

/** 0-11 for any key, negative ones included. */
function semitone(key: number): number {
  return ((key % OCTAVE) + OCTAVE) % OCTAVE;
}

/**
 * The rows to draw, top to bottom.
 *
 * Drums and the noise lane sit above the keyboard and appear **only when the
 * song plays them** — nine empty drum rows on a song with no percussion is nine
 * rows of nothing, and the roll is already fighting for height.
 *
 * The pitched range is likewise the range the song uses, rounded out to whole
 * octaves so the keyboard still reads as a keyboard: a range starting on `g+`
 * would put a black key at the top edge with no white key under it. `all` draws
 * the full o1-o6 regardless, for when the fitted range is the thing you want to
 * check — it widens the pitch range only, and never conjures an unused drum.
 *
 * Keys are written pitches, and a written pitch is not held to the driver's
 * o1 c-o6 a: `h12 o0 c` is a legal note whose row is o0 c. Either range simply
 * grows to take it in.
 */
export interface LaneRequest {
  /** The pitched range the song actually plays, or `null` when it plays none. */
  lowestKey?: number | null;
  highestKey?: number | null;
  /** Instrument numbers of whatever the view calls percussion. See `percussion.ts`. */
  usedDrums?: readonly number[];
  usesNoise?: boolean;
  /** Draw the full o1-o6 rather than fitting the range. Pitched keys only. */
  all?: boolean;
  /**
   * The note byte a drum sounds at, keyed by instrument number, from the
   * driver's own percussion table. A drum's pitch is a property of that table
   * and appears nowhere in the MML, so the lane states it rather than leaving
   * it to be guessed. Absent for the melodic slots, which have no such entry.
   */
  drumNotes?: ReadonlyMap<number, number>;
}

export function laneStack(request: LaneRequest = {}): LaneStack {
  const {
    lowestKey = null,
    highestKey = null,
    usedDrums = [],
    usesNoise = false,
    all = false,
    drumNotes = new Map<number, number>(),
  } = request;

  const lanes: Lane[] = [];
  const rowOfKey = new Map<number, number>();
  const rowOfDrum = new Map<number, number>();
  let noiseRow = -1;

  if (usesNoise) {
    noiseRow = lanes.length;
    lanes.push({
      row: noiseRow,
      kind: 'noise',
      index: -1,
      label: 'noise',
      black: false,
      octaveStart: false,
    });
  }

  // Highest instrument number at the top, so the column counts down — @29 to
  // @21, then @10, then straight on into the keyboard. Only the drums actually
  // played get a row: `all` widens the *pitch* range and nothing else, because
  // a drum lane with no drums in it is a row of nothing and the roll is already
  // short of height.
  for (const instrument of [...usedDrums].sort((a, b) => b - a)) {
    const sounds = drumNotes.get(instrument);
    rowOfDrum.set(instrument, lanes.length);
    lanes.push({
      row: lanes.length,
      kind: 'drum',
      index: instrument,
      label: sounds === undefined ? `@${instrument}` : `@${instrument} ${keyName(sounds & 0x7f)}`,
      black: false,
      octaveStart: false,
    });
  }

  // The driver's o1-o6 when asked for all of it or given nothing to fit to;
  // otherwise the octaves the song writes in — and those either way, since a
  // note off the driver's keyboard still needs a row.
  let low = 0;
  let high = KEY_COUNT - 1;
  if (lowestKey !== null && highestKey !== null) {
    const fittedLow = Math.floor(lowestKey / OCTAVE) * OCTAVE;
    // Whole octaves, except that the driver's top one stops at o6 a — `$C6`
    // and `$C7` are the tie and the rest — unless something is written above.
    const octaveTop = Math.floor(highestKey / OCTAVE) * OCTAVE + OCTAVE - 1;
    const fittedHigh = highestKey < KEY_COUNT ? Math.min(KEY_COUNT - 1, octaveTop) : octaveTop;
    low = all ? Math.min(low, fittedLow) : fittedLow;
    high = all ? Math.max(high, fittedHigh) : fittedHigh;
  }

  for (let key = high; key >= low; key--) {
    rowOfKey.set(key, lanes.length);
    lanes.push({
      row: lanes.length,
      kind: 'key',
      index: key,
      label: keyName(key),
      black: keyIsBlack(key),
      octaveStart: semitone(key) === 0,
    });
  }

  return { lanes, rowOfKey, rowOfDrum, noiseRow };
}

/**
 * The span of ticks to build marks for, snapped outward to a whole note either
 * side of what is on screen.
 *
 * Snapping is the point. The mark list is a `computed`, and rebuilding it every
 * frame would put the whole song's worth of DOM churn behind a scroll; snapped
 * to 192 ticks with a screen of margin, it rebuilds a couple of times per
 * screen and the transform does the rest.
 */
export function tickWindow(
  centreTick: number,
  widthPx: number,
  pxPerTick: number,
  leadFraction: number,
): { from: number; to: number } {
  const onScreen = pxPerTick > 0 ? widthPx / pxPerTick : 0;
  const before = onScreen * leadFraction + onScreen;
  const after = onScreen * (1 - leadFraction) + onScreen;
  const snap = 192;
  return {
    from: Math.max(0, Math.floor((centreTick - before) / snap) * snap),
    to: Math.ceil((centreTick + after) / snap) * snap,
  };
}

/**
 * The tick at the left edge of a paged roll.
 *
 * A page turns when the playhead reaches `turnAt` across the pane, and moves by
 * `step` of a pane, so the playhead lands at `turnAt - step` with the music it
 * has just played still behind it.
 *
 * **Every page opens on that same lead-in**, so `origin` is the tick that sits
 * on it: the grid runs both ways from there in whole `stride`s. A song that has
 * not been scrolled anchors on 0, and page zero therefore starts `turnAt - step`
 * of a pane *before* tick 0 rather than on it — the song is drawn with the margin
 * it will keep for the rest of its length. Start it flush against the key column
 * instead and the first bar has nowhere to sit, while the margin every later page
 * has appears out of nowhere at the first turn.
 *
 * **The anchor is what a scroll moves.** Measured from the song's own start
 * always, a seek would drop the playhead wherever its place in that fixed grid
 * happened to fall, so the notes would jump the moment the wheel went quiet.
 * Anchoring on the view the scroll left behind means the roll carries on from
 * what is on screen, and turns a page a full pane later.
 *
 * A closed form rather than a counter: given the anchor, the page is a function
 * of the tick, so a loop wrap or a resize lands on the right page with nothing
 * to reset and no way for the view to disagree with the playhead. It needs
 * `step` below `turnAt` to stay one — a longer step would drop the playhead past
 * the very turn it just made, and would leave no lead-in to open on.
 */
export function pageStart(
  tick: number,
  screenTicks: number,
  turnAt: number,
  step: number,
  origin = 0,
): number {
  const stride = screenTicks * step;
  if (!(stride > 0)) {
    return 0; // An unmeasured pane, or no zoom to divide by.
  }

  // With the lead-in taken out, a turn is simply every `stride` of music from
  // the anchor, so the count of turns is what the distance to it divides into.
  // Negative behind the anchor, which is a loop wrap and needs a page just the
  // same — clamping there would strand the playhead off the left of the pane.
  const leadIn = screenTicks * (turnAt - step);
  return origin - leadIn + Math.floor((tick - origin) / stride) * stride;
}

/**
 * Where a tick sits across the scrub bar, in px from the roll's left edge.
 *
 * The bar holds the **whole song and nothing else**: tick 0 on its left edge and
 * the last tick on its right, at every zoom and every pane width. The roll's own
 * horizontal scale has no bearing on it, which is the point — the roll shows a
 * pane of music and this shows the song it is a pane of.
 */
export function scrubOffset(tick: number, ticks: number, width: number): number {
  if (!(ticks > 0) || !(width > 0)) {
    return 0; // Nothing compiled, or an unmeasured pane. Not a NaN across every bar.
  }

  return clamp(tick / ticks, 0, 1) * width;
}

/**
 * The tick under a point on the scrub bar, the exact inverse of
 * {@link scrubOffset}.
 *
 * Exact because a drag rides on it: the tick a scrub commits to has to be the
 * one under the pointer, not one near it. Off either end is the song's own end,
 * since a drag that runs past the bar is still asking for the last tick.
 */
export function scrubTick(offset: number, ticks: number, width: number): number {
  if (!(ticks > 0) || !(width > 0)) {
    return 0;
  }

  return clamp(offset / width, 0, 1) * ticks;
}

/**
 * Where the grid lines fall inside a window.
 *
 * Every 48 ticks — a quarter note — with a heavier line every 192. Called a
 * grid and not bars on purpose: MML has no time signature, so anything claiming
 * to be a bar line would be an invention of this view's.
 */
export function gridLines(
  from: number,
  to: number,
  step: number,
): { tick: number; strong: boolean }[] {
  const lines: { tick: number; strong: boolean }[] = [];
  if (step <= 0) {
    return lines;
  }

  for (let tick = Math.max(0, Math.floor(from / step) * step); tick <= to; tick += step) {
    lines.push({ tick, strong: tick % 192 === 0 });
  }

  return lines;
}

/** How fast the display closes a gap with the driver, in gaps per second. */
const CATCH_UP = 6;
/** A gap bigger than this much music is not drift; it is a wrap or a seek. */
const SNAP_SECONDS = 1;
/** A frame gap this long means the loop was stopped, not that time passed. */
const MAX_FRAME = 0.25;

export interface ClockStep {
  /** Where the display has got to. */
  shown: number;
  /** Where the driver says the song is, already carried to this instant. */
  target: number;
  /** Ticks per second in force. */
  rate: number;
  /** Seconds since the previous frame. */
  elapsed: number;
  /** Ticks in one pass, or 0 when the song is unknown. */
  pass: number;
}

/**
 * One frame of the playhead's own clock.
 *
 * The display carries its position across frames rather than deriving it from
 * the newest anchor, and that is the whole point. Anchors land ten times a
 * second and each arrives already slightly stale — mostly the time the message
 * spent getting here — so the gap between the display and the anchor stays
 * roughly *constant*. Re-deriving the position every frame would reproduce that
 * gap ten times a second as a lurch; running at the driver's own rate and easing
 * the gap shut turns a periodic jolt into a constant offset nobody can see.
 *
 * This is why interpolating over tempo does not break "ticks, not seconds": the
 * driver's own count steers it on every anchor, so the formula sets the velocity
 * between readings and never the position.
 */
export function advanceTick(step: ClockStep): number {
  const { shown, target, rate, elapsed, pass } = step;
  const hold = (tick: number) => (pass > 0 ? clamp(tick, 0, pass) : Math.max(0, tick));

  // A loop wrap, a seek, or the clock starting again after a pause. None of
  // those is drift, and easing across one would crawl the length of the song.
  if (
    elapsed <= 0 ||
    elapsed > MAX_FRAME ||
    rate <= 0 ||
    Math.abs(target - shown) > rate * SNAP_SECONDS
  ) {
    return hold(target);
  }

  return hold(shown + rate * elapsed + (target - shown) * Math.min(1, CATCH_UP * elapsed));
}

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
  /** As many as fit, in the order they were given. The rest are simply not drawn. */
  glyphs: readonly BarGlyph[];
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
 * Anything that does not fit is not drawn and not marked either: the inspector
 * lists all of them for the note under the caret, and a hover names them.
 */
export function fitBarContent(
  width: number,
  height: number,
  name: string,
  glyphs: number,
): BarContent {
  const empty: BarContent = { name: null, glyphs: [] };
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

  // Right-aligned and filled leftwards, so the last command to take effect sits
  // furthest from the name rather than the list shuffling as it grows.
  const box = height - 2;
  const room = Math.floor((width - left - CONTENT_PAD + CONTENT_PAD) / (box + CONTENT_PAD));
  const count = clamp(Math.min(room, glyphs), 0, MAX_GLYPHS);
  const laid: BarGlyph[] = [];
  for (let n = 0; n < count; n++) {
    laid.push({
      x: width - CONTENT_PAD - (n + 1) * box - n * CONTENT_PAD,
      y: (height - box) / 2,
      size: box,
    });
  }

  return { name: placed, glyphs: laid.reverse() };
}
