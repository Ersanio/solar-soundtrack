/**
 * Which instruments the roll draws as percussion, and where a note goes as a
 * result. Pure — no Angular, no storage — so `charttest` covers it.
 *
 * This is a *preference*, and deliberately not derived. The obvious derivation
 * is to look at the sample an instrument resolves to and ask whether the
 * driver's own drums play it; that fails in the likeliest direction, because
 * replacing a percussion sample with **another** percussion sample makes it say
 * no. Nothing in the data answers "is this sample a drum" — length, envelope and
 * loop flag all fail on pizzicato and marimba — so the porter is asked instead.
 */

import { FIRST_PERCUSSION_INSTRUMENT, PERCUSSION_SLOTS } from '@amk/spc/instruments';
import type { WalkNote } from '@amk/spc/song-walk';

/** A `$DA` operand is one byte, so nothing outside this can name an instrument. */
const MAX_INSTRUMENT = 0xff;

/**
 * The instruments the roll treats as drums until told otherwise.
 *
 * `@21`-`@29` are the driver's own percussion table, so they are here for the
 * reason the table exists. `@10` is the one addition, and it is provable from the
 * image: its melodic entry is srcn `$0B` at tuning `$08`, byte for byte what
 * `@27` and `@28` carry in the percussion table.
 *
 * A song that repoints its `#samples` makes `@10` wrong too and nothing here can
 * detect it, which is the whole reason any of this is editable — `@21`-`@29`
 * included.
 */
export const DEFAULT_PERCUSSION: readonly number[] = [
  10,
  ...Array.from({ length: PERCUSSION_SLOTS }, (_, slot) => FIRST_PERCUSSION_INSTRUMENT + slot),
];

/**
 * A stored percussion set, or `null` when there is no usable opinion in it.
 *
 * `null` and `[]` are different answers, the same way `sampleList: null` is not
 * `[]`: `null` means nothing was stored and the default stands, while `[]` means
 * the porter turned everything off. Reading an empty list as "no opinion" would
 * make that setting silently undo itself on reload.
 */
export function parsePercussion(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const instruments = value.filter(
    (entry): entry is number => Number.isInteger(entry) && entry >= 0 && entry <= MAX_INSTRUMENT,
  );

  return [...new Set(instruments)].sort((a, b) => a - b);
}

/** What decides where a note is drawn. One object per change, never per note. */
export interface PlaceContext {
  /** Instrument numbers the porter calls percussion. */
  percussion: ReadonlySet<number>;
  /** Instruments whose `#instruments` entry has `NOISE_FLAG` set. */
  noisy: ReadonlySet<number>;
  /** The driver's own note byte for each of `@21`-`@29`. */
  drumNotes: ReadonlyMap<number, number>;
}

/** Which band of rows a note belongs to. */
export type Place = 'drum' | 'noise' | 'key' | 'none';

/**
 * The precedence, stated once so the lanes and the fitted range cannot disagree
 * about the same note — they used to be two implementations of this.
 *
 * The porter's set comes first: if they have called a noise instrument
 * percussion, that is what they meant.
 */
export function placeOf(note: WalkNote, context: PlaceContext): Place {
  const instrument = note.state.instrument;
  if (instrument !== null && context.percussion.has(instrument)) {
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
 * `null` only when the driver has not loaded and so has no table to ask, which
 * cannot happen while a song is compiled — compilation is blocked until it has.
 */
export function keyOf(note: WalkNote, context: PlaceContext): number | null {
  if (note.key !== null) {
    return note.key;
  }

  // `& 0x7f` rather than `- 0x80`, matching `keyName` and `units.ts`'s `noteName`.
  const sounds =
    note.state.instrument === null ? undefined : context.drumNotes.get(note.state.instrument);
  return sounds === undefined ? null : sounds & 0x7f;
}

/** What a set of drums makes of a song: the rows it needs, and the range left over. */
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
        // A drum on a lane must not widen the keyboard: `@10` sits at o4 f+ once
        // its default transposition applies, and letting a hi-hat stretch the
        // range adds octaves of empty rows. Only what lands on a key counts.
        const key = keyOf(note, context) ?? 0;
        lowestKey = lowestKey === null ? key : Math.min(lowestKey, key);
        highestKey = highestKey === null ? key : Math.max(highestKey, key);

        break;
      }

      case 'none':
        // A note with no row at all: a drum the porter removed while the driver
        // has no table to give it a pitch from. It is not drawn, so it claims
        // no range either.
        break;
    }
  }

  return { usedDrums: [...drums].sort((a, b) => a - b), usesNoise, lowestKey, highestKey };
}
