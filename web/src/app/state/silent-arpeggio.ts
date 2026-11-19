/**
 * `SST0516` — a note under an arpeggio that never takes a step, and so is never keyed on.
 *
 * Under an arpeggio a note sounds only at its steps (`@amk/spc/arpeggio`), and the driver holds the
 * steps on a frame's last `!WaitTime` ticks before a key-off, so a note no longer than that plays
 * nothing. The walk reports it only where it can vouch for every tick of the hold; a remote body
 * that runs an `$FB` is not followed.
 */

import { SST } from '@amk/core/messages/sst';
import type { Diagnostic, NoteAddress } from '@amk/core/types';
import type { SongTimeline } from '@amk/spc/song-walk';

/** One finding per note written, on the note, however many times it plays silent. */
export function silentArpeggioNotes(
  timeline: SongTimeline,
  noteMap: readonly NoteAddress[],
): Diagnostic[] {
  const notes = new Map(noteMap.map((entry) => [entry.address, entry]));
  const seen = new Set<number>();
  const found: Diagnostic[] = [];
  for (const note of timeline.notes) {
    const mapped = notes.get(note.address);
    if (
      note.arpeggioSteps?.length !== 0 ||
      note.state.remotePitch ||
      mapped === undefined ||
      seen.has(mapped.span.start)
    ) {
      continue;
    }

    seen.add(mapped.span.start);
    found.push({
      severity: 'severe',
      code: 'SST0516',
      message: SST['0516'](note.state.waitTime),
      span: mapped.span,
    });
  }

  return found;
}
