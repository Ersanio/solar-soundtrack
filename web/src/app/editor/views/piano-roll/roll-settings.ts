import { TICKS_PER_WHOLE } from '@amk/core/hardcoded-tables';
import { CHANNELS } from '../../../state/transport-view';
import { clamp } from '../../../util/math';
import { readStored, writeStored } from '../../../util/storage';
import { EDIT_MODES, type EditMode } from './roll-edit';
import { LANE_HEIGHT, LANE_HEIGHT_MAX } from './roll-metrics';
import { DEFAULT_PERCUSSION, parsePercussion } from './percussion';

/**
 * The roll's preferences, and the reading of them back out of storage.
 *
 * Free functions rather than anything Angular, so the component holds one
 * `signal<Settings>` and nothing else about how a setting is stored or stepped.
 */

const STORAGE_KEY = 'solar-soundtrack.pianoroll';

const ZOOMS = [0.5, 1, 2, 4, 8] as const;
const ROW_HEIGHTS = [6, 9, 13, 18, 26, 36] as const;

/**
 * Note values a beat can be — a time signature's lower number.
 *
 * These seven and no others because the lower number *is* an MML note value, and
 * because each divides a whole note exactly: a beat of `192 / 5` would put every
 * line 38.4 ticks apart, on nothing a note could ever be written at.
 */
export const BEAT_UNITS = [1, 2, 4, 8, 16, 32, 64] as const;

/** Beats a bar may hold. Zero is the grid switched off. */
export const MAX_BEATS = 32;

/**
 * How long a note the roll will draw or snap to, in ticks.
 *
 * Sixteen whole notes, which is far past anything musical and well short of the
 * point where a stored value could be nonsense. A stretch is not held to it —
 * a note may be as long as the porter likes — only the stored settings are.
 */
const MAX_NOTE_TICKS = TICKS_PER_WHOLE * 16;

/**
 * What the toolbar's Snap control offers, coarsest first.
 *
 * `bar` and `beat` are named rather than fixed because they come off the grid
 * the porter set: at 6/8 a beat is an `l8` and a bar is six of them. The rest
 * are fractions of the beat, and `0` is the snap switched off, which `Alt`
 * reaches for the length of one gesture without changing the setting.
 */
export const SNAPS = ['bar', 'beat', 'half', 'quarter', 'eighth', 'sixteenth', 'off'] as const;
export type SnapName = (typeof SNAPS)[number];

/** The Snap setting in ticks, from the grid the porter chose. */
export function snapTicks(name: SnapName, beatsPerBar: number, beatUnit: number): number {
  const beat = TICKS_PER_WHOLE / beatUnit;
  switch (name) {
    case 'bar':
      return beat * Math.max(1, beatsPerBar);
    case 'beat':
      return beat;
    case 'half':
      return Math.max(1, Math.floor(beat / 2));
    case 'quarter':
      return Math.max(1, Math.floor(beat / 4));
    case 'eighth':
      return Math.max(1, Math.floor(beat / 8));
    case 'sixteenth':
      return Math.max(1, Math.floor(beat / 16));
    case 'off':
      return 0;
  }
}

export interface Settings {
  zoom: number;
  rowHeight: number;
  follow: boolean;
  /** Slide the music under a fixed playhead, rather than turning a page under it. */
  scrollNotes: boolean;
  allOctaves: boolean;
  /** Beats in a bar of the grid — a time signature's upper number. Zero draws none. */
  beatsPerBar: number;
  /** The note value that gets the beat: its lower number, one of {@link BEAT_UNITS}. */
  beatUnit: number;
  /** Instruments drawn on percussion lanes, ascending. */
  percussion: readonly number[];
  percussionOpen: boolean;
  /** How tall the command lane under the roll is drawn, in CSS pixels, between its own floor and ceiling. */
  laneHeight: number;
  /** The channel the roll is editing, or null for none. One at a time. */
  editChannel: number | null;
  /**
   * What a drawn or dragged note snaps to — see {@link SNAPS}.
   *
   * Its own setting rather than the grid's beat, because the two answer
   * different questions: the grid is the bar lines the porter wants to *see*,
   * and at 4/4 that is a whole quarter note — far too coarse to draw sixteenths
   * against. {@link SNAPS} is what the toolbar offers, and the two named ones
   * are read off the grid so they still follow it.
   */
  snap: SnapName;
  /**
   * What a gesture does when it would make two notes sound at once.
   *
   * The roll's answer rather than the gesture's: a stretch and a drag both carve
   * in `overwrite`, both push in `insert` and both refuse in `strict`, so the
   * outcome does not depend on which part of a bar the press landed on. It
   * reaches the roll only — the inspector's own length slider writes one
   * argument and knows nothing about its neighbours.
   */
  editMode: EditMode;
  /**
   * The length a drawn note takes, in ticks — the last one drawn or resized.
   *
   * Seeded at an eighth note. A roll that always drew `l8` would need every
   * note resized after it was drawn, which is a gesture per note for no reason.
   */
  lastLength: number;
}

/** Every field `unknown`, because none of it is ours until it is checked. */
interface StoredSettings {
  zoom?: unknown;
  rowHeight?: unknown;
  follow?: unknown;
  scrollNotes?: unknown;
  allOctaves?: unknown;
  beatsPerBar?: unknown;
  beatUnit?: unknown;
  percussion?: unknown;
  percussionOpen?: unknown;
  laneHeight?: unknown;
  editChannel?: unknown;
  snap?: unknown;
  editMode?: unknown;
  lastLength?: unknown;
}

/** A tick count a drawn note could have. */
function isTicks(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_NOTE_TICKS
  );
}

/** A whole number of beats a bar could hold, zero — no grid — included. */
function isBeatCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_BEATS;
}

/** One of the eight music channels. Null — editing nothing — is the default, not a stored value. */
function isChannel(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < CHANNELS;
}

/**
 * The stored settings, field by field.
 *
 * Field by field and not a spread: a spread takes whatever is in storage on
 * trust, so a hand-edited `zoom: "big"` multiplies every mark's x into `NaN` and
 * blanks the roll, and `percussion: "yes"` would be handed to `new Set` as a
 * string of characters. The enumerated numbers are checked against their own
 * tables rather than by type, which is what makes them safe rather than merely
 * numeric.
 */
export function readSettings(): Settings {
  const settings: Settings = {
    zoom: 2,
    rowHeight: 9,
    follow: true,
    scrollNotes: false,
    allOctaves: true,
    beatsPerBar: 4,
    // A line per sixteenth with a heavier one every quarter note, which is the
    // grid FL Studio opens on and the one a snap of `beat` then lands on.
    beatUnit: 16,
    percussion: [...DEFAULT_PERCUSSION],
    percussionOpen: false,
    laneHeight: LANE_HEIGHT,
    editChannel: null,
    snap: 'beat',
    // The first mode in the table, which is what makes that table's order the
    // one place the default, the fallback and the `<select>`'s order are set.
    editMode: EDIT_MODES[0],
    lastLength: TICKS_PER_WHOLE / 8,
  };

  let stored: StoredSettings | null;
  try {
    const raw = readStored(STORAGE_KEY);
    stored = raw ? (JSON.parse(raw) as StoredSettings) : null;
  } catch {
    stored = null; // Not ours, or not JSON; the defaults are fine.
  }

  if (!stored) {
    return settings;
  }

  if (ZOOMS.includes(stored.zoom as (typeof ZOOMS)[number])) {
    settings.zoom = stored.zoom as number;
  }

  if (ROW_HEIGHTS.includes(stored.rowHeight as (typeof ROW_HEIGHTS)[number])) {
    settings.rowHeight = stored.rowHeight as number;
  }

  if (typeof stored.follow === 'boolean') {
    settings.follow = stored.follow;
  }

  if (typeof stored.scrollNotes === 'boolean') {
    settings.scrollNotes = stored.scrollNotes;
  }

  if (typeof stored.allOctaves === 'boolean') {
    settings.allOctaves = stored.allOctaves;
  }

  if (isBeatCount(stored.beatsPerBar)) {
    settings.beatsPerBar = stored.beatsPerBar;
  }

  if (BEAT_UNITS.includes(stored.beatUnit as (typeof BEAT_UNITS)[number])) {
    settings.beatUnit = stored.beatUnit as number;
  }

  if (typeof stored.percussionOpen === 'boolean') {
    settings.percussionOpen = stored.percussionOpen;
  }

  // Clamped rather than rejected: it comes off a drag, so any height between the
  // two ends is one the porter could have set, and one outside them is a window
  // that has since been resized rather than a value that means nothing.
  if (typeof stored.laneHeight === 'number' && Number.isFinite(stored.laneHeight)) {
    settings.laneHeight = clampLaneHeight(stored.laneHeight);
  }

  if (isChannel(stored.editChannel)) {
    settings.editChannel = stored.editChannel;
  }

  if (SNAPS.includes(stored.snap as SnapName)) {
    settings.snap = stored.snap as SnapName;
  }

  if (EDIT_MODES.includes(stored.editMode as EditMode)) {
    settings.editMode = stored.editMode as EditMode;
  }

  if (isTicks(stored.lastLength)) {
    settings.lastLength = stored.lastLength;
  }

  const percussion = parsePercussion(stored.percussion);
  if (percussion) {
    settings.percussion = percussion;
  }

  return settings;
}

export function writeSettings(settings: Settings): void {
  writeStored(STORAGE_KEY, JSON.stringify(settings));
}

/** One step along {@link ZOOMS}, held at either end. */
export function stepZoom(zoom: number, direction: number): number {
  const at = ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]);
  return ZOOMS[clamp((at < 0 ? 2 : at) + direction, 0, ZOOMS.length - 1)];
}

/**
 * One step along {@link ROW_HEIGHTS}, or `undefined` at either end.
 *
 * Up steps from the height on screen, so a press always shows; down steps the
 * floor itself, so a press never raises it. That is why it takes both: `shown`
 * is what the rows were stretched to, `floor` is what the setting asks for.
 */
export function stepRowHeight(shown: number, floor: number, direction: number): number | undefined {
  return direction > 0
    ? ROW_HEIGHTS.find((h) => h > shown)
    : ROW_HEIGHTS.filter((h) => h < floor).at(-1);
}

/** A beats-per-bar typed into the toolbar's field, held inside the grid's range. */
export function clampBeats(beats: number): number {
  return clamp(beats, 0, MAX_BEATS);
}

/**
 * A lane height off the seam above it, held between five rows and ten.
 *
 * Rounded, because a drag is in fractional pixels and the height goes into a
 * `viewBox` the glyphs are laid out against: one user unit is one CSS pixel
 * there, and a fractional one would put every row's rule on a half pixel.
 */
export function clampLaneHeight(height: number): number {
  return Math.round(clamp(height, LANE_HEIGHT, LANE_HEIGHT_MAX));
}

/** Whether a number off a `<select>` is one of the note values a beat can be. */
export function isBeatUnit(value: number): boolean {
  return BEAT_UNITS.includes(value as (typeof BEAT_UNITS)[number]);
}
