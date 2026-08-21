/**
 * Where the piano roll puts things, and when. Pure arithmetic, no Angular —
 * `charttest` covers it, because neither an off-by-one in a windowed scroller
 * nor a playhead that jerks ten times a second is visible in a screenshot, and
 * both are obvious in a number.
 */

import { TICKS_PER_WHOLE } from '@amk/core/hardcoded-tables';
import { KEY_COUNT } from '@amk/spc/song-walk';
import { NOTE_NAMES } from '@amk/tokens/commands/units';
import { clamp } from '../../../util/math';
import { KEY_WIDTH } from './roll-metrics';

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

const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

/**
 * `$80` is o1 c, so key 0 is o1 c and key 69 is o6 a. A key below 0 is a
 * written pitch in o0 — `o0` is legal MML and `h12` brings it back into the
 * driver's range — so the octave floors and the semitone wraps.
 */
export function keyName(key: number): string {
  return `o${Math.floor(key / OCTAVE) + 1} ${NOTE_NAMES[semitone(key)]}`;
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
  return `${NOTE_NAMES[semitone(key)].toUpperCase()}${Math.floor(key / OCTAVE) + 1}`;
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
 * A line every `beatTicks`, heavier on the first beat of a bar. MML carries no
 * time signature, so the porter supplies one and the bars are the ones they
 * named.
 *
 * Beats are counted **from tick 0** and the bar is the count's remainder, rather
 * than a `tick % barTicks` on the tick itself. The window a caller asks about is
 * snapped to a whole note ({@link tickWindow}) and a bar need not divide one —
 * 7/8 is 168 ticks — so the two only ever line up by coincidence. Counting from
 * the song's start makes a strong line the first beat of a bar by construction,
 * whichever window it turns up in.
 */
export function gridLines(
  from: number,
  to: number,
  beatTicks: number,
  beatsPerBar: number,
): { tick: number; strong: boolean }[] {
  const lines: { tick: number; strong: boolean }[] = [];
  if (beatTicks <= 0 || beatsPerBar <= 0) {
    return lines; // An unmeasured beat, or a grid the porter has switched off.
  }

  for (let beat = Math.max(0, Math.floor(from / beatTicks)); beat * beatTicks <= to; beat++) {
    lines.push({ tick: beat * beatTicks, strong: beat % beatsPerBar === 0 });
  }

  return lines;
}

/** How fast the display closes a gap with the driver, in gaps per second. */
const CATCH_UP = 6;
/** A target this much music *ahead* is not drift; it is a seek. */
const SNAP_SECONDS = 1;
/**
 * A target this much music *behind* is not drift either; it is a loop wrap or a
 * seek backwards.
 *
 * A bound of its own, and much the smaller of the two, because the display only
 * ever trails: the ease settles `rate / CATCH_UP` — a sixth of a second of music
 * — behind the anchor and never overshoots it, so anything ahead of that is the
 * anchor having moved back. Sizing the backwards case off {@link SNAP_SECONDS}
 * instead cannot see a wrap at all on a short loop, since the anchor is folded
 * into one pass and the whole jump a wrap can make is one trip round it: `aaaa`
 * at `t54` is 96 ticks against a second's 107.
 */
const SNAP_BACK_SECONDS = 0.25;
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
  // The two directions get their own bounds because they are not the same
  // question: forwards is a seek and can be told from drift by its size alone,
  // where backwards is measured against a lead the display is never supposed to
  // have — see {@link SNAP_BACK_SECONDS}.
  if (
    elapsed <= 0 ||
    elapsed > MAX_FRAME ||
    rate <= 0 ||
    target - shown > rate * SNAP_SECONDS ||
    shown - target > rate * SNAP_BACK_SECONDS
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

  // Right-aligned and filled leftwards, so the last command to take effect sits
  // furthest from the name rather than the list shuffling as it grows.
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

/**
 * Where a tick sits across the roll, in px from its left edge.
 *
 * Deliberately unclamped. It is what draws the playhead, and a parked roll's
 * playhead is wherever the song has got to rather than wherever the view is
 * looking — so a song that has run past the pane gives an x off the end, and the
 * clip in `piano-roll.html` is what hides it. Holding it inside the pane instead
 * would draw a line at the edge saying the song was there.
 */
export function xAtTick(tick: number, viewTick: number, pxPerTick: number): number {
  return KEY_WIDTH + (tick - viewTick) * pxPerTick;
}

/**
 * The tick under a pointer, which is the camera run backwards.
 *
 * `offsetX` is measured from the roll's own left edge, key column included, so
 * a caller hands over `event.clientX - box.left` and nothing else. The inverse
 * of {@link xAtTick} and of the `translate` in `piano-roll.ts`, and the sibling
 * of {@link scrubTick}, which is the same question asked of the scrub bar.
 */
export function tickAtX(offsetX: number, viewTick: number, pxPerTick: number): number {
  return pxPerTick > 0 ? viewTick + (offsetX - KEY_WIDTH) / pxPerTick : viewTick;
}

/** Which row a pointer is over, or -1 past either end of the stack. */
export function rowAtY(offsetY: number, rowHeight: number, rows: number): number {
  if (rowHeight <= 0) {
    return -1;
  }

  const row = Math.floor(offsetY / rowHeight);
  return row >= 0 && row < rows ? row : -1;
}

/**
 * Every duration a note can be written as one length token, in ticks.
 *
 * `1`, `2`, `4`… and their dotted forms — exactly the set `spellLength` can
 * spell without falling back to `=N` — which is what a stretch snaps to. A
 * start snaps to the grid and a length snaps to this, because a note in MML is
 * a duration rather than a region and the porter thinks in note values.
 */
export const NOTE_LENGTHS: readonly number[] = (() => {
  const ticks = new Set<number>();
  for (let divisor = 1; divisor <= TICKS_PER_WHOLE; divisor++) {
    if (TICKS_PER_WHOLE % divisor !== 0) {
      continue;
    }

    const base = TICKS_PER_WHOLE / divisor;
    const half = Math.floor(base / 2);
    ticks.add(base);
    ticks.add(base + half);
    ticks.add(base + half + Math.floor(half / 2));
  }

  // A dotted whole note is past what one token holds, and `spellLength` says so
  // by answering `null` — so the rungs stop where the spelling does.
  return [...ticks].filter((each) => each <= TICKS_PER_WHOLE).sort((a, b) => a - b);
})();

/** The nearest length a note can be written as, at or above one tick. */
export function snapDuration(ticks: number): number {
  if (ticks <= NOTE_LENGTHS[0]) {
    return NOTE_LENGTHS[0];
  }

  // Past a whole note the ladder repeats: a tie is whole notes and a remainder,
  // so the same rungs are what a longer note lands on.
  const whole = Math.max(0, Math.floor((ticks - 1) / TICKS_PER_WHOLE)) * TICKS_PER_WHOLE;
  const left = ticks - whole;
  let nearest = NOTE_LENGTHS[0];
  for (const rung of NOTE_LENGTHS) {
    if (Math.abs(rung - left) < Math.abs(nearest - left)) {
      nearest = rung;
    }
  }

  return whole + nearest;
}

/** A tick snapped to the grid the porter chose. `0` snaps to nothing. */
export function snapTick(tick: number, snap: number): number {
  return snap > 0 ? Math.round(tick / snap) * snap : Math.round(tick);
}
