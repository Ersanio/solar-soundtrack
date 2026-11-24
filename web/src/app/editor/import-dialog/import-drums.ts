/** The Import dialog's drum map: the porter's sound for each GM drum key, kept in storage across imports. */

import { FIRST_CUSTOM_INSTRUMENT, FIRST_PERCUSSION_INSTRUMENT } from '@amk/core/hardcoded-tables';
import type { DrumSound } from '@amk/import/midi';
import { GM_DRUMS } from '@amk/import/midi/gm';
import { STOCK_NAMES } from '../../output/command-inspector/instrument-inspector/instrument-choices';
import { readStored, writeStored } from '../../util/storage';

export type DrumMap = ReadonlyMap<number, DrumSound>;

const DRUM_MAP_KEY = 'solar-soundtrack.import-drums';
/** The keys a pitched sound may be set to: `o1 c` to `o6 a`, what the writer can spell. */
export const LOWEST_PITCH = 24;
export const HIGHEST_PITCH = 93;
/** Where a sound moved onto a pitched instrument starts when the stock one has no pitch. */
const MIDDLE_C = 60;

/** Whether an instrument is a stock drum, which plays its own pitch. */
export function isStockDrum(instrument: number): boolean {
  return instrument >= FIRST_PERCUSSION_INSTRUMENT && instrument < FIRST_CUSTOM_INSTRUMENT;
}

/** The sound a key plays: the porter's, or the stock one. */
export function soundOf(map: DrumMap, key: number): DrumSound {
  return map.get(key) ?? GM_DRUMS.get(key) ?? { instrument: FIRST_PERCUSSION_INSTRUMENT };
}

/** Whether `sound` is what the key plays with no map at all. */
export function isStock(key: number, sound: DrumSound): boolean {
  const stock = GM_DRUMS.get(key);
  return stock?.instrument === sound.instrument && stock.key === sound.key;
}

function withSound(map: DrumMap, key: number, sound: DrumSound): DrumMap {
  const next = new Map(map);
  if (isStock(key, sound)) {
    next.delete(key);
  } else {
    next.set(key, sound);
  }

  return next;
}

/** The map with `key` on `instrument`, a pitched one keeping the pitch the key had. */
export function withInstrument(map: DrumMap, key: number, instrument: number): DrumMap {
  if (isStockDrum(instrument)) {
    return withSound(map, key, { instrument });
  }

  const pitch = soundOf(map, key).key ?? GM_DRUMS.get(key)?.key ?? MIDDLE_C;
  return withSound(map, key, { instrument, key: pitch });
}

/** The map with `key`'s pitched sound at `pitch`; a stock drum has no pitch to set. */
export function withPitch(map: DrumMap, key: number, pitch: number): DrumMap {
  const { instrument } = soundOf(map, key);
  return isStockDrum(instrument) ? map : withSound(map, key, { instrument, key: pitch });
}

/** A stored entry as the key and sound it names, or `null` where it does not hold up. */
function entryOf(entry: unknown): [number, DrumSound] | null {
  if (!Array.isArray(entry)) {
    return null;
  }

  const [key, instrument, pitch] = entry as unknown[];
  if (typeof key !== 'number' || !GM_DRUMS.has(key)) {
    return null;
  }

  if (typeof instrument !== 'number' || !STOCK_NAMES.has(instrument)) {
    return null;
  }

  if (isStockDrum(instrument)) {
    return pitch === undefined ? [key, { instrument }] : null;
  }

  const pitched =
    typeof pitch === 'number' &&
    Number.isInteger(pitch) &&
    pitch >= LOWEST_PITCH &&
    pitch <= HIGHEST_PITCH;
  return pitched ? [key, { instrument, key: pitch }] : null;
}

/** The stored map, each entry `[key, instrument, pitch?]`; an entry that does not hold up is left out. */
export function readDrumMap(): DrumMap {
  const map = new Map<number, DrumSound>();
  let entries: unknown;
  try {
    entries = JSON.parse(readStored(DRUM_MAP_KEY) ?? '[]');
  } catch {
    return map;
  }

  if (!Array.isArray(entries)) {
    return map;
  }

  for (const entry of entries) {
    const read = entryOf(entry);
    if (read && !isStock(...read)) {
      map.set(...read);
    }
  }

  return map;
}

export function writeDrumMap(map: DrumMap): void {
  writeStored(
    DRUM_MAP_KEY,
    JSON.stringify(
      [...map].map(([key, sound]) =>
        sound.key === undefined ? [key, sound.instrument] : [key, sound.instrument, sound.key],
      ),
    ),
  );
}
