import type { CommandAddress, NoteAddress } from '@amk/core/types';
import type { WalkNote } from '@amk/spc/song-walk';
import { type Command, type TokenIndex, commandStartingAt } from '@amk/tokens';
import {
  commandScope,
  isPercussionInstrument,
  parseTimeInForce,
} from '@amk/tokens/commands/in-force';

/** What the join reads: the scan of `text`, and the compiler's two maps for the bytes it walked. */
export interface InForceSources {
  index: TokenIndex;
  text: string;
  /** `CompileResult.commandMap` by address, which is how the walk names a command. */
  commands: ReadonlyMap<number, CommandAddress>;
  /** `CompileResult.noteMap` by address, which is how the walk names a note. */
  notes: ReadonlyMap<number, NoteAddress>;
}

/**
 * The commands acting on a walked note, exactly — a lookup rather than a map.
 *
 * Three answers joined, each exact in its own half:
 *
 *   - `WalkNote.origins` names every command that emitted a VCMD, by the address
 *     the driver read it from, which is the only way to be right where one run of
 *     bytes plays more than once: `v255 (1)[ c ]2 v200 (1)5` sounds one written
 *     `c` under two volumes, and the answer is a fact about the pass rather than
 *     about the text.
 *   - `parseTimeInForce` names the `q` and `h` folded into the note's own bytes,
 *     which emit nothing to address; the source is exactly what the compiler
 *     resolved them from.
 *   - The drum a note sounds on is both at once. `@21`-`@29` emit nothing, the
 *     drum byte itself loads the sample, and it stays loaded through the `]` of
 *     the loop it was written in, a `*` or `(1)n` that replays it, and a call
 *     from another channel — so `WalkNote.drumFrom` names the note whose drum
 *     byte did the loading, and the source, asked about *that* note, names the
 *     `@`. Asked about the note itself it would say which `@` was folded into
 *     it, which after `@21 c d` is none for `d` while `d` plays on the drum.
 *
 * Filtered to commands that act on a note at all: the song's own settings reach
 * every channel alike and where a note sits is what a roll already draws, so
 * neither is something acting on *this* note.
 *
 * A lookup and not a map because the timeline can hold two hundred thousand
 * notes and only the ones on screen are ever asked about. Answers are cached on
 * the three things they are derived from, and the first two are shared across a
 * run of notes under unchanged state, so a long song resolves a handful of lists.
 */
export function commandsInForceOf(sources: InForceSources): (note: WalkNote) => readonly Command[] {
  const { index, text, commands: byAddress, notes } = sources;
  const commands = index.commands;
  const parseTime = parseTimeInForce(index, text);
  const cache = new Map<
    readonly (number | null)[],
    Map<Command | null, Map<number, readonly Command[]>>
  >();

  /** The scanned command a walked note was written as, or `null` off the map. */
  const written = (address: number): Command | null => {
    const span = notes.get(address)?.span;
    return span === undefined ? null : commandStartingAt(commands, span.start);
  };

  const walked = (origins: readonly (number | null)[]): Command[] => {
    const acting: Command[] = [];
    for (const at of origins) {
      const span = at === null ? undefined : byAddress.get(at)?.span;
      const command = span === undefined ? null : commandStartingAt(commands, span.start);
      if (command !== null && commandScope(command) === 'note-state') {
        acting.push(command);
      }
    }

    return acting;
  };

  return (note: WalkNote) => {
    let byWritten = cache.get(note.origins);
    if (byWritten === undefined) {
      byWritten = new Map();
      cache.set(note.origins, byWritten);
    }

    const own = written(note.address);
    let byDrum = byWritten.get(own);
    if (byDrum === undefined) {
      byDrum = new Map();
      byWritten.set(own, byDrum);
    }

    const drumKey = note.drumFrom ?? -1;
    const found = byDrum.get(drumKey);
    if (found !== undefined) {
      return found;
    }

    // The parse-time ones first: they are what the note itself was written
    // under, where the rest reached it from wherever the driver had been. The
    // drum comes from the note that loaded it, which is this one for a drum note.
    const folded = own === null ? [] : (parseTime.get(own) ?? []);
    const loader = note.drumFrom === null ? null : written(note.drumFrom);
    const drum =
      loader === null ? [] : (parseTime.get(loader) ?? []).filter(isPercussionInstrument);
    const acting = [
      ...folded.filter((command) => !isPercussionInstrument(command)),
      ...drum,
      ...walked(note.origins),
    ];
    byDrum.set(drumKey, acting);
    return acting;
  };
}
