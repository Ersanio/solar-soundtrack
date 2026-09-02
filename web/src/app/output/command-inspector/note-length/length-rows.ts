import { TICKS_PER_WHOLE } from '@amk/core/hardcoded-tables';
import { NOTE_DENOMINATORS } from '@amk/tokens/commands/letter-params';
import { noteLengthName } from '@amk/tokens/commands/units';
import { type Edit, insertAt, spliceRange } from '@amk/tokens/edits';
import { type Command, type NoteLengthSegment, noteLengthTicks } from '@amk/tokens';
import { replacementLockedBecause } from '../commands/context';

/**
 * A note's lengths as controls, and the splice each one writes back.
 *
 * A note is the one command whose parameters are not its arguments. `c` under a
 * standing `l8` writes no digits at all and is still 24 ticks long; `c^8` writes
 * one number for two segments, so an argument-indexed row would label the tie's
 * `8` as the head's length; `c0` writes a number `getNoteLength` throws away.
 * `NoteLengthSegment` is what the eleven spellings have in common, so it is the
 * subject here — one row per segment, and one write path that picks its splice
 * by what the segment actually wrote.
 *
 * The number is the **denominator**, the `n` of `1/n`, which is what `l`'s own
 * slider is and what the digits on a note are. Dots are never touched: they
 * compose rather than add (`Music.cpp:2950`), so `l8 c.` is 24 + 12 and the
 * digits that keep it there are `8`, not the 36 the segment plays for.
 */

/** One length segment, drawn. */
export interface NoteLengthRow {
  /** For `@for`'s `track`; the segment's index. */
  key: number;
  /** `Length` for the head, `Tied to` for each `^` after it. */
  label: string;
  /** The denominator the slider edits, or the tick count where there is none. */
  value: number;
  /** What the segment plays for now, dots and any `{ }` folded in. */
  ticks: number;
  /** False while the segment is reading the standing `l` rather than digits of its own. */
  written: boolean;
  editable: boolean;
  /** Why it is not editable, when it is not. */
  lockedBecause: string | null;
  /** Slider stops, `null` for a row that is not a denominator at all. */
  stops: readonly number[] | null;
}

/** Said under a row whose digits are not in the document. */
export const READS_THE_DEFAULT =
  'This note takes its length from the standing `l`. Moving the slider writes the length onto the note itself.';

/** The reading beside the track — `1/4 · a quarter note · 48 ticks`. */
export function noteLengthLabel(segment: NoteLengthSegment, denominator: number): string {
  const ticks = noteLengthTicks(segment, denominator);
  return [`1/${denominator}`, noteLengthName(ticks), `${ticks} tick${ticks === 1 ? '' : 's'}`]
    .filter((part) => part !== null)
    .join(' · ');
}

/**
 * Why a segment cannot be written, or `null`.
 *
 * A macro's tokens share one collapsed span, so there is no text of the
 * author's to write over — the same interlock `argEditable` makes, in the
 * wording `context.ts` states once. A segment with no denominator has no
 * number this control could write: an `=NN` is a tick count, and an implicit
 * one under a dotted or exact `l` is a length nothing spells `1/n`.
 */
function lockedBecause(segment: NoteLengthSegment): string | null {
  if (segment.replacement !== undefined) {
    return replacementLockedBecause(segment.replacement);
  }

  if (segment.denominator === null) {
    return segment.exact
      ? 'written as an exact tick count, which is not a note value'
      : 'the standing `l` is not a length that can be written as `1/n`';
  }

  return null;
}

/** Every length segment of a note, rest or tie, in the order they are written. */
export function noteLengthRows(command: Command): readonly NoteLengthRow[] {
  return (command.noteLength ?? []).map((segment, index) => {
    const locked = lockedBecause(segment);
    return {
      key: index,
      label: index === 0 ? 'Length' : 'Tied to',
      value: segment.denominator ?? segment.ticks,
      ticks: segment.ticks,
      written: !segment.implicit,
      editable: locked === null,
      lockedBecause: locked,
      stops: segment.denominator === null ? null : NOTE_DENOMINATORS,
    };
  });
}

/**
 * The splice one row writes, or `null` where there is nothing to do.
 *
 * The one place the spellings are told apart: an insertion where the segment
 * wrote no digits, a rewrite of the digits alone where it did. Both land inside
 * the note's own text, so a note's length never moves anything beside it — and
 * digits are never taken back out, so a slider let go on the `l`'s own value
 * writes `c8` rather than restoring a bare `c`.
 */
export function noteLengthEdit(
  source: string,
  command: Command,
  index: number,
  denominator: number,
): Edit | null {
  const segment = command.noteLength?.[index];
  if (!segment || lockedBecause(segment) !== null) {
    return null;
  }

  if (denominator < 1 || denominator > TICKS_PER_WHOLE) {
    return null;
  }

  const text = String(denominator);
  const { digits } = segment;
  return digits.start === digits.end
    ? insertAt(digits.start, text, digits.line)
    : spliceRange(source, digits, text);
}
