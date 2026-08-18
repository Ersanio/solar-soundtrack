/**
 * The palette entry a command already in a song was written as.
 *
 * The catalogue answers "what can I add"; this answers the same question
 * backwards, for the piano roll's bars and the note inspector's strip. It is the
 * same table read the other way rather than a second one, so a glyph on a bar
 * and the button that writes that command cannot drift apart, and a byte with no
 * entry is a `palettetest` failure rather than a blank space on a bar.
 *
 * Three forks, none of them decided here for the first time: `$ED` is one opcode
 * and two envelopes, told apart by its first argument exactly as
 * `command-inspector.ts` tells them apart; `t`, `v` and `w` become their fade
 * entries on a second argument, which is the same test `gather` makes to name
 * them; and thirteen bytes have no button at all because a letter or bracket
 * writes them, which `LetterEntry.writes` states and `palettetest` proves.
 */

import type { Command } from '@amk/tokens';
import { ENTRIES, type ResolvedEntry, resolveEntry } from './catalog';

/** The one place in a song a resolved entry is never being *inserted*. */
const READING = { beforeChannels: false };

const byVcmd = new Map<number, (typeof ENTRIES)[number]>();
const byWrites = new Map<number, (typeof ENTRIES)[number]>();
const byLetter = new Map<string, (typeof ENTRIES)[number]>();
const bySyntax = new Map<string, (typeof ENTRIES)[number]>();

for (const entry of ENTRIES) {
  if (entry.kind === 'hex') {
    // `$ED` is the one byte two entries write, and it is handled on its own.
    if (!byVcmd.has(entry.vcmd)) {
      byVcmd.set(entry.vcmd, entry);
    }
  } else {
    if (entry.writes !== undefined) {
      byWrites.set(entry.writes, entry);
    }

    if (entry.kind === 'letter') {
      byLetter.set(entry.id, entry);
    } else {
      bySyntax.set(entry.id, entry);
    }
  }
}

const ADSR = ENTRIES.find((entry) => entry.kind === 'hex' && entry.id === 'adsr');
const GAIN = ENTRIES.find((entry) => entry.kind === 'hex' && entry.id === 'gain');

/** `$ED $80` and up drives the level directly; below it is the four-stage envelope. */
function envelopeEntry(command: Command): (typeof ENTRIES)[number] | undefined {
  return (command.args[0]?.value ?? 0) >= 0x80 ? GAIN : ADSR;
}

/**
 * How a command should be drawn and named, or `null` for one with no entry.
 *
 * `null` is reachable only for a spelling the catalogue does not offer at all —
 * `<` and `>` never reach the command model, and `^` folds into its note — so a
 * caller may treat it as "nothing to draw" rather than as an error.
 */
export function glyphOf(command: Command): ResolvedEntry | null {
  let entry: (typeof ENTRIES)[number] | undefined;

  if (command.vcmd !== undefined) {
    // A byte with no button of its own is one a letter or bracket writes, and
    // that spelling's glyph is the right one: a `$E7` read back out of a song is
    // a `v`, whichever way it was typed.
    entry =
      command.vcmd === 0xed
        ? envelopeEntry(command)
        : (byVcmd.get(command.vcmd) ?? byWrites.get(command.vcmd));
  } else {
    const letter = command.kind.toLowerCase();
    // `t18,144` is `$E3` and `t144` is `$E2` — two commands, two glyphs, one
    // letter. `gather` splits their names on the same count.
    entry =
      (command.args.length >= 2 ? bySyntax.get(`${letter},`) : undefined) ?? byLetter.get(letter);
  }

  return entry === undefined ? null : resolveEntry(entry, command.target, READING);
}
