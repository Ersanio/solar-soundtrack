/**
 * Which byte to play for a pitch the porter has not written yet.
 *
 * The compiler bakes transposition into the note byte: `h` is added and the
 * instrument's own tuning is subtracted, both at compile time
 * (`parser.ts:2737-2741`). So `@2 o5 g` emits `o5 d`, and the five semitones are
 * cancelled by the sample's tuning to sound as the `g` that was written. The
 * piano roll's rows are the written pitch, which means a row is not the byte that
 * sounds it, and auditioning the row's own byte would put the note somewhere the
 * bars drawn on that very row are not.
 *
 * There is no per-tick table of the offset anywhere, and nothing short of running
 * the compiler's own state machine would build one. But every note already
 * carries the answer: `NoteAddress` holds both the byte emitted and the pitch
 * written, and the difference is exactly the transposition that was in force
 * where it stands. So the nearest note before the tick is asked.
 *
 * Exact except across an `@` or an `h` with no note between it and the tick —
 * where there is no note under the new instrument to read a new offset from
 * either, so the alternative is not a better answer but a guess at one.
 */

import type { NoteAddress } from '@amk/core/types';
import type { WalkNote } from '@amk/spc/song-walk';

/**
 * The transposition in force on a channel at a tick, in semitones, to be added
 * to a written pitch. 0 when the channel has played nothing yet.
 *
 * `notes` is `SongTimeline.notes`, which is sorted by tick, so the walk stops at
 * the first note past the one asked about.
 */
export function transposeAt(
  notes: readonly WalkNote[],
  written: ReadonlyMap<number, NoteAddress>,
  channel: number,
  tick: number,
): number {
  let offset = 0;

  for (const note of notes) {
    if (note.tick > tick) {
      break;
    }

    // Drums emit `$D0`-`$D8` whatever pitch was written, so they carry no offset
    // to borrow; `key` is null for exactly those.
    if (note.channel !== channel || note.key === null) {
      continue;
    }

    const entry = written.get(note.address);
    if (entry) {
      offset = entry.note - entry.written;
    }
  }

  return offset;
}
