import { CHANNELS } from '../../../state/transport-view';
import { clamp } from '../../../util/math';
import { readStored, writeStored } from '../../../util/storage';
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
  /** The channel the roll is editing, or null for none. One at a time. */
  editChannel: number | null;
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
  editChannel?: unknown;
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
    allOctaves: false,
    beatsPerBar: 4,
    beatUnit: 4,
    percussion: [...DEFAULT_PERCUSSION],
    percussionOpen: false,
    editChannel: null,
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

  if (isChannel(stored.editChannel)) {
    settings.editChannel = stored.editChannel;
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

/** Whether a number off a `<select>` is one of the note values a beat can be. */
export function isBeatUnit(value: number): boolean {
  return BEAT_UNITS.includes(value as (typeof BEAT_UNITS)[number]);
}
