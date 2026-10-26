import type { NoteAddress } from '@amk/core/types';
import type { BendAnchor } from '@amk/tokens/command-hazards';

/** Where a `$DD` slides from: the byte of the note it rides on, or why there is none to draw from. */
export type SlideStart =
  /** `$80`-`$C5`, as the compiler emitted it. */
  | { kind: 'note'; byte: number }
  /** `$C7`: the slide runs on a keyed-off voice. */
  | { kind: 'rest' }
  /** `$D0`-`$D8`, which sounds at its percussion entry's pitch (`Commands.asm:219-220`), not the byte's. */
  | { kind: 'drum' }
  /** No note precedes the `$DD` on its channel. */
  | { kind: 'nothing' }
  /** No compile speaks for that note yet. */
  | { kind: 'unknown' };

/** The compile the answer is read off: the text it ran on and its note map. */
export interface CompiledNotes {
  text: string;
  notes: readonly NoteAddress[];
}

/**
 * The note a `$DD` slides from, by the byte the compiler emitted for the note `bendAnchor` names.
 *
 * Emitted rather than written, because the target is a byte the driver reads as it stands: `h`,
 * the instrument's transposition and the percussion remap are already in the note's byte, and the
 * driver adds `$43` to both (`main.asm:440`, `:3281`), so `target - byte` is the interval.
 *
 * One limit, stated rather than modelled: `$FA $02` and the arpeggio delta are added to the note
 * (`main.asm:442-444`) and reach the target only under hot-patch bit 3 (`main.asm:3282-3286`,
 * `Commands.asm:877`), which nothing here tracks.
 *
 * A note's byte is decided by the text in front of it, so a compile that agrees with `source` up to
 * the end of the note still names it — a commit to the `$DD`'s own operands keeps the answer
 * through the recompile it causes.
 */
export function slideStart(
  anchor: BendAnchor,
  compiled: CompiledNotes | null,
  source: string,
): SlideStart {
  if (anchor.kind === 'nothing') {
    return { kind: 'nothing' };
  }

  const { start, end } = anchor.note;
  if (!compiled?.text.startsWith(source.slice(0, end))) {
    return { kind: 'unknown' };
  }

  // A tie is an entry of its own starting at `^`, so a tied note matches on its head alone.
  const bytes = new Set(
    compiled.notes.filter((entry) => entry.span.start === start).map((entry) => entry.note),
  );
  if (bytes.size !== 1) {
    return { kind: 'unknown' };
  }

  const [byte] = bytes;
  if (byte >= 0x80 && byte < 0xc6) {
    return { kind: 'note', byte };
  }

  if (byte === 0xc7) {
    return { kind: 'rest' };
  }

  return byte >= 0xd0 && byte <= 0xd8 ? { kind: 'drum' } : { kind: 'unknown' };
}
