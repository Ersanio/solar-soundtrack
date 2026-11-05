/** Rewriting one surviving note in place — pitch, length, octave and drum — which is usually nothing at all. */

import { octaveFor, spellDuration, spellOctave } from '@amk/core/mml-text';
import type { Span } from '@amk/core/types';
import type { Edit } from '@amk/tokens/edits';
import {
  type EditContext,
  type EditRefusal,
  type PlacedNote,
  REFUSE_INSIDE,
  REFUSE_RAMP,
  REFUSE_SPELL,
} from '../roll-edit';
import { noteText, writtenLength } from './spelling';
import { refuse, spliceUnit } from './splice';
import type { Region } from './regions';
import { drumOctaves, exitOctaveFor } from './octaves';

/** A survivor's splices, and the octave its text leaves standing once they land. */
interface Rewrite {
  edits: Edit[];
  leaves: number | null;
}

export function isRewrite(outcome: Rewrite | EditRefusal): outcome is Rewrite {
  return (outcome as EditRefusal).refused === undefined;
}

/** What one surviving note needs written, which is usually nothing at all. */
export function rewriteNote(
  context: EditContext,
  index: number,
  note: PlacedNote,
  survivors: ReadonlyMap<number, PlacedNote>,
  regions: readonly Region[],
  running: number | null,
): Rewrite | EditRefusal {
  const { source, strip, targetAMKVersion } = context;
  const { octaves } = strip;
  const item = strip.items[index];
  const samePitch =
    note.written === item.written && note.drum === (item.drum?.args[0]?.value ?? null);
  const sameLength = note.ticks === item.ticks;
  if (samePitch && sameLength) {
    return { edits: [], leaves: octaves.carry(running, item.unitSpan.start, item.unitSpan.end) };
  }

  const exit = exitOctaveFor(context, index, survivors, regions);
  // Empty for a pitched note, which spells its own octaves through `noteText`.
  const around = note.drum === null ? { lead: '', exit: '' } : drumOctaves(item);
  if (around === null) {
    return refuse(REFUSE_SPELL);
  }

  // An `o` the porter wrote at this note is theirs, and a note that keeps its
  // octave keeps saying so — a channel's opening `o4` is not redundancy to tidy.
  const stated = item.hasLeadingOctave && octaveFor(note.written) === item.octave;
  const standing = stated ? null : running;

  const last = item.segments[item.segments.length - 1];
  /**
   * What the rewritten unit leaves: a pitched note its own octave moved on by
   * whatever is written between its segments, which stays; a drum the unit's own
   * octaves, which {@link drumOctaves} restates.
   */
  const own =
    note.drum === null
      ? octaves.carry(octaveFor(note.written), item.segments[0].span.end, last.span.start)
      : octaves.carry(running, item.unitSpan.start, item.unitSpan.end);
  const leaves = note.drum === null && exit !== null ? exit : own;

  // One segment is one token, so the whole unit is rewritten together.
  if (item.segments.length === 1) {
    const length = sameLength ? writtenLength(source, item) : null;
    const text = noteText(note, length, exit, targetAMKVersion, standing);
    if (text === null) {
      return refuse(REFUSE_SPELL);
    }

    const edit = spliceUnit(source, item.unitSpan, `${around.lead}${text}${around.exit}`);
    return { edits: edit ? [edit] : [], leaves };
  }

  // The command inside the note stands a number of ticks into it, and only the
  // last continuation is rewritten, so a change that moves the note's **start**
  // carries the command along with it: the note keeps the ticks it kept, and the
  // ramp written inside them fires later than it was written to. Which ticks the
  // porter meant to keep is not something the gesture says, so it is refused.
  if (note.startTick !== item.startTick) {
    return refuse(REFUSE_INSIDE);
  }

  // More than one segment means a command sits inside the note — a mid-note
  // volume ramp is the usual one. Only the head and the last continuation are
  // rewritten, so the command keeps its place; a length below what the earlier
  // segments already hold has nowhere to go.
  const earlier = item.segments.slice(0, -1).reduce((sum, segment) => sum + segment.ticks, 0);
  const remaining = note.ticks - earlier;
  if (remaining < 1) {
    return refuse(REFUSE_RAMP);
  }

  const edits: Edit[] = [];
  const headSpan: Span = { ...item.unitSpan, end: item.segments[0].span.end };
  const headText = noteText(note, writtenLength(source, item), null, targetAMKVersion, standing);
  if (headText === null) {
    return refuse(REFUSE_SPELL);
  }

  const headEdit = spliceUnit(source, headSpan, `${around.lead}${headText}`);
  if (headEdit) {
    edits.push(headEdit);
  }

  const length = spellDuration(remaining, targetAMKVersion);
  if (length === null) {
    return refuse(REFUSE_SPELL);
  }

  // Against what the head and the text inside the note leave, not the head alone:
  // a `<` written before the `^` is still there.
  const spelled = exit === null || note.drum !== null || exit === own ? '' : spellOctave(exit);
  if (spelled === null) {
    return refuse(REFUSE_SPELL);
  }

  const tailEdit = spliceUnit(
    source,
    { start: last.span.start, end: item.unitSpan.end, line: last.span.line },
    `^${length}${spelled === '' ? '' : ` ${spelled}`}${around.exit}`,
  );
  if (tailEdit) {
    edits.push(tailEdit);
  }

  return { edits, leaves };
}
