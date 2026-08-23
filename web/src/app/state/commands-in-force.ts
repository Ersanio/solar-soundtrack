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
 * The scanned command a walked note was written as, or `null` off the map.
 *
 * Its own factory because both lookups below need it, and each of them is built
 * once per compile: the note map and the scan are what it closes over.
 */
function writtenAt(sources: InForceSources): (address: number) => Command | null {
  const { index, notes } = sources;
  return (address) => {
    const span = notes.get(address)?.span;
    return span === undefined ? null : commandStartingAt(index.commands, span.start);
  };
}

/**
 * The half of the answer that emits no bytes: `q`, `h` and `@21`-`@29`.
 *
 * Split out because it is the half a *tick* can be given honestly. These fold
 * into a note's own frame, so the note they are folded into is where they take
 * effect — where a command that emits bytes runs at the tick the driver reads
 * it, which is a fact only the walk's own record holds.
 *
 * Cached on the two things it is derived from, both of which a run of notes
 * under unchanged state shares.
 */
export function foldedInForceOf(sources: InForceSources): (note: WalkNote) => readonly Command[] {
  const parseTime = parseTimeInForce(sources.index, sources.text);
  const written = writtenAt(sources);
  const cache = new Map<Command | null, Map<number, readonly Command[]>>();

  return (note: WalkNote) => {
    const own = written(note.address);
    let byDrum = cache.get(own);
    if (byDrum === undefined) {
      byDrum = new Map();
      cache.set(own, byDrum);
    }

    const drumKey = note.drumFrom ?? -1;
    const found = byDrum.get(drumKey);
    if (found !== undefined) {
      return found;
    }

    // The drum comes from the note that loaded it, which is this one for a drum
    // note; anything else folded into *that* note is not folded into this one.
    const folded = own === null ? [] : (parseTime.get(own) ?? []);
    const loader = note.drumFrom === null ? null : written(note.drumFrom);
    const drum =
      loader === null ? [] : (parseTime.get(loader) ?? []).filter(isPercussionInstrument);
    const acting = [...folded.filter((command) => !isPercussionInstrument(command)), ...drum];
    byDrum.set(drumKey, acting);
    return acting;
  };
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
  const { index, commands: byAddress } = sources;
  const commands = index.commands;
  const folded = foldedInForceOf(sources);
  const written = writtenAt(sources);
  const cache = new Map<
    readonly (number | null)[],
    Map<Command | null, Map<number, readonly Command[]>>
  >();

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
    // under, where the rest reached it from wherever the driver had been.
    const acting = [...folded(note), ...walked(note.origins)];
    byDrum.set(drumKey, acting);
    return acting;
  };
}

/**
 * Of the commands acting on a note, the ones it puts in force rather than
 * inherits — where `before` is what was acting on the note before it on its
 * channel, and nothing at all for the first note of a pass.
 *
 * By the identity of the commands and never of the arrays holding them.
 * `recordOrigin` calls `invalidateAll` on every song-wide write
 * (`song-walk.ts:713`), so a `t`, a `$E4` or an echo byte hands all eight
 * channels a fresh `origins` array with the same addresses in it, and an array
 * compared against the one before would report every channel's next note as
 * setting everything it plays under. `index.commands` holds one object per
 * written command, which is stable across the whole scan.
 *
 * A `[ ]` body re-running a command that changes nothing is not a definition:
 * `origins` names a command by the address the driver read it from and
 * `recordOrigin` skips a write to the address already in the slot, so
 * `[ v200 c8 ]2` is answered on the first pass alone. `[ v200 c8 v100 d8 ]2`
 * answers all four, each list differing from the one before it.
 *
 * A statement about the one pass the walk produces, as everything else read off
 * a `WalkNote` is.
 */
export function definedAt(
  acting: readonly Command[],
  before: readonly Command[],
): ReadonlySet<Command> {
  if (before.length === 0) {
    return new Set(acting);
  }

  const held = new Set(before);
  return new Set(acting.filter((command) => !held.has(command)));
}

/**
 * The note the driver played before this one on its channel, for a caller with
 * a note and no place in the list to read a neighbour from.
 *
 * A channel plays one note at a time, so its ticks strictly increase, and the
 * notes a pass never reaches are dropped from the tail — what is left of a
 * channel is a contiguous prefix of its walk order, and the last of them below
 * this tick is the one before it.
 */
export function notePreceding(notes: readonly WalkNote[], note: WalkNote): WalkNote | null {
  let before: WalkNote | null = null;
  for (const each of notes) {
    if (each.tick >= note.tick) {
      break; // sorted by tick
    }

    if (each.channel === note.channel) {
      before = each;
    }
  }

  return before;
}
