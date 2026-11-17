/**
 * Which instruments the roll draws on drum lanes, and where a note goes as a
 * result. Pure — no Angular, no storage — so `charttest` covers it.
 *
 * A lane is one of `@21`-`@29`, the driver's own percussion table: a drum's byte
 * comes from that table and not from the letter it was written at, so its row is
 * the instrument. It is also the range `roll-strip.ts` knows a drum by, so a bar
 * is drawn on the row a press finds it on. Every other instrument's pitch is
 * heard, `@10` and a sampled kick included, so it goes on the keyboard. Nothing
 * is guessed from the sample: no property of one says "drum", and asking whether
 * the driver's own drums play it says no once one drum sample is swapped for
 * another.
 */

import { FIRST_PERCUSSION_INSTRUMENT, PERCUSSION_SLOTS } from '@amk/spc/instruments';
import type { WalkNote } from '@amk/spc/song-walk';

/** Whether an instrument is one of the driver's nine drums, which get a lane each. */
export function isDrum(instrument: number | null): boolean {
  return (
    instrument !== null &&
    instrument >= FIRST_PERCUSSION_INSTRUMENT &&
    instrument < FIRST_PERCUSSION_INSTRUMENT + PERCUSSION_SLOTS
  );
}

/** What decides where a note is drawn. One object per change, never per note. */
export interface PlaceContext {
  /** Instruments whose `#instruments` entry has `NOISE_FLAG` set. */
  noisy: ReadonlySet<number>;
  /**
   * The pitch each note was written at, by the ARAM address of its note map
   * entry — `NoteAddress.written`. Only the compiler knows it: the byte the walk
   * reads has `h` and the instrument's transposition already folded in.
   */
  written: ReadonlyMap<number, number>;
}

/** Which band of rows a note belongs to. */
export type Place = 'drum' | 'noise' | 'key' | 'none';

/**
 * The precedence, stated once so the lanes and the fitted range cannot disagree
 * about the same note.
 *
 * A drum first: its lane is its instrument, whatever else is in force, a noise
 * command included.
 */
export function placeOf(note: WalkNote, context: PlaceContext): Place {
  const instrument = note.state.instrument;
  if (isDrum(instrument)) {
    return 'drum';
  }

  if (note.state.noise !== null || (instrument !== null && context.noisy.has(instrument))) {
    return 'noise';
  }

  return keyOf(note, context) === null ? 'none' : 'key';
}

/**
 * The key a note draws on, for anything `placeOf` puts on the keyboard.
 *
 * A pitched note draws at the pitch it was **written** at, and that is a
 * musician's answer rather than a byte's: `@2 o5 g` is a g to whoever wrote it,
 * and the five semitones the compiler takes off exist to cancel the sample's
 * tuning, so a row on the byte would be neither what was written nor what
 * sounds. It is also the only row an edit could map back to the text from.
 * What the note plays as is the tooltip's to say. A note the map does not know
 * — a `$8x` typed as raw hex — keeps the byte, since there is nothing else.
 *
 * `null` for a percussion byte, which has no key: the driver's nine are on their
 * lanes, and the `$D9` only a malformed blob plays has no row at all.
 */
export function keyOf(note: WalkNote, context: PlaceContext): number | null {
  if (note.key === null) {
    return null;
  }

  const written = context.written.get(note.address);
  return written === undefined ? note.key : written - 0x80;
}

/** What a song's notes make of the roll: the rows it needs, and the range left over. */
export interface RollShape {
  /** Ascending instrument numbers, one lane each. */
  usedDrums: readonly number[];
  usesNoise: boolean;
  /** The pitched range to fit the keyboard to, drums and noise excluded. */
  lowestKey: number | null;
  highestKey: number | null;
}

export function rollShape(notes: readonly WalkNote[], context: PlaceContext): RollShape {
  const drums = new Set<number>();
  let usesNoise = false;
  let lowestKey: number | null = null;
  let highestKey: number | null = null;

  for (const note of notes) {
    switch (placeOf(note, context)) {
      case 'drum':
        drums.add(note.state.instrument ?? 0);
        break;
      case 'noise':
        usesNoise = true;
        break;
      case 'key': {
        // Only what lands on a key widens the keyboard. A drum on its lane is
        // left out, since letting a hi-hat stretch the range adds octaves of
        // empty rows.
        const key = keyOf(note, context) ?? 0;
        lowestKey = lowestKey === null ? key : Math.min(lowestKey, key);
        highestKey = highestKey === null ? key : Math.max(highestKey, key);

        break;
      }

      case 'none':
        // A note with no row at all — a percussion byte past the driver's nine,
        // which the walk reports. It is not drawn, so it claims no range either.
        break;
    }
  }

  return { usedDrums: [...drums].sort((a, b) => a - b), usesNoise, lowestKey, highestKey };
}
