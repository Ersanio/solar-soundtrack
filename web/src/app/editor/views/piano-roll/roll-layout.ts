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
  /** 0-69 for a key, the `@n` for a drum, -1 for noise. */
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
  /** Row of every pitched key, indexed by key number. -1 when out of range. */
  rowOfKey: readonly number[];
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

/** `$80` is o1 c, so key 0 is o1 c and key 69 is o6 a. */
export function keyName(key: number): string {
  return `o${Math.floor(key / OCTAVE) + 1} ${NAMES[key % OCTAVE]}`;
}

export function keyIsBlack(key: number): boolean {
  return BLACK[key % OCTAVE];
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
  const rowOfKey = new Array<number>(KEY_COUNT).fill(-1);
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

  let low = 0;
  let high = KEY_COUNT - 1;
  if (!all && lowestKey !== null && highestKey !== null) {
    low = Math.floor(lowestKey / OCTAVE) * OCTAVE;
    high = Math.min(KEY_COUNT - 1, Math.floor(highestKey / OCTAVE) * OCTAVE + OCTAVE - 1);
  }

  for (let key = high; key >= low; key--) {
    rowOfKey[key] = lanes.length;
    lanes.push({
      row: lanes.length,
      kind: 'key',
      index: key,
      label: keyName(key),
      black: keyIsBlack(key),
      octaveStart: key % OCTAVE === 0,
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
 * roughly *constant*. Re-deriving the position every frame therefore reproduced
 * that same gap ten times a second, and closing it in one frame made the
 * playhead lurch: measured on a `t48` song, one frame in ten ran at 2.4x speed
 * or stalled outright, spaced exactly 100 ms apart. Running at the driver's own
 * rate and easing the gap shut turns a periodic jolt into a constant offset
 * nobody can see.
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
