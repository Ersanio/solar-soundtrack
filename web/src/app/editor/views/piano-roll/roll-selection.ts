import { plannedOrdinals, type FramePlan } from './roll-edit';
import type { Strip } from './roll-strip';

/**
 * Carrying the roll's selection across an edit.
 *
 * A selection is a set of indices into a `Strip`, and a strip is rebuilt from
 * scratch on every compile — so an index means something for exactly as long as
 * the strip it indexes into stands. What survives is a note's **frame** and its
 * place among that frame's notes: `planEdits` writes the survivors and the born
 * notes in the plan's own tick order, which within one frame is text order too,
 * so the plan is the authority on where each note it was given ends up.
 *
 * Nothing else in the strip is: an index moves the moment an item is added or
 * removed, a tick moves for every note after a length change (`emitNote` writes
 * the duration into the note itself), an address moves for every byte written
 * before it, and a source offset cannot be mapped at all for a note carried past
 * a neighbour, which `crossings` lifts out of the text and writes back on the
 * far side.
 */

/** A selected note in terms a rewrite of the channel leaves alone. */
export interface NoteAnchor {
  /** Index into `Strip.frames` — the root, or the body the note is written in. */
  frame: number;
  /** Its place among that frame's notes. */
  ordinal: number;
  /** The byte the letter and octave name. Meaningless, and unread, for a drum. */
  written: number;
  /** The `21`-`29` of the drum this note is, or `null` where it is pitched. */
  drum: number | null;
}

/**
 * The selected notes as the plans leave them.
 *
 * Every note the selection named and a plan still carries, not only the ones the
 * gesture moved: a stretch pushes its neighbours and a carve cuts one shorter,
 * and a selected note either of those reached is still the note the porter has
 * hold of. A note no plan carries is one that has gone.
 */
export function anchorsFor(
  strip: Strip,
  parts: readonly FramePlan[],
  chosen: ReadonlySet<number>,
): readonly NoteAnchor[] {
  const anchors: NoteAnchor[] = [];
  for (const part of parts) {
    const frame = strip.frames.indexOf(part.frame);
    if (frame < 0) {
      continue;
    }

    for (const [from, ordinal] of plannedOrdinals(part.plan)) {
      const note = part.plan.notes[ordinal];
      if (chosen.has(from)) {
        anchors.push({ frame, ordinal, written: note.written, drum: note.drum });
      }
    }
  }

  return anchors;
}

/**
 * The anchored notes as indices into the strip that has arrived.
 *
 * The ordinal is counted to rather than searched for, and the note found there
 * has to be the note that was expected: an anchor that does not confirm is
 * dropped, so a commit that moved more than its plan said takes an outline off
 * rather than putting it on a note nobody picked.
 */
export function notesAtAnchors(strip: Strip, anchors: readonly NoteAnchor[]): ReadonlySet<number> {
  const found = new Set<number>();
  for (const anchor of anchors) {
    const frame = strip.frames[anchor.frame];
    if (!frame) {
      continue;
    }

    let nth = 0;
    for (let index = frame.from; index < frame.to; index++) {
      const item = strip.items[index];
      if (item.kind !== 'note') {
        continue;
      }

      if (nth === anchor.ordinal) {
        if (isNote(item.written, item.drum?.args[0]?.value ?? null, anchor)) {
          found.add(index);
        }

        break;
      }

      nth++;
    }
  }

  return found;
}

/**
 * A drum is confirmed by its instrument alone: its letter says nothing, and
 * `pitchOfRow` hands a drawn one the row's own `c` whatever the text carries, so
 * a pitch compared there would turn every percussion anchor away. The `@` is
 * read as `placedNotes` reads it, so the two sides of the test are one number.
 */
function isNote(written: number, drum: number | null, anchor: NoteAnchor): boolean {
  return anchor.drum === null ? drum === null && written === anchor.written : drum === anchor.drum;
}
