/**
 * The palette entry a command already in a song was written as.
 *
 * The catalogue answers "what can I add"; this answers the same question
 * backwards, for the piano roll's bars and the note inspector's strip. It is the
 * same table read the other way rather than a second one, so a glyph on a bar
 * and the button that writes that command cannot drift apart, and a byte with no
 * entry is a `palettetest` failure rather than a blank space on a bar.
 *
 * Four forks, none of them decided here for the first time: `$ED` is one opcode
 * and two envelopes, told apart by its first argument exactly as
 * `command-inspector.ts` tells them apart; `t`, `v` and `w` become their fade
 * entries on a second argument in the dialects that read one, which is `isFade`,
 * the same test `gather` makes to name them; `#am4` reads two bytes as other
 * commands entirely; and thirteen bytes have no button at all because a letter or
 * bracket writes them, which `LetterEntry.writes` states and `palettetest` proves.
 */

import { type Command, isFade, vcmdName } from '@amk/tokens';
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
 * The entry for a byte the dialect reads as another command entirely.
 *
 * `#am4`'s `$E5` with a high first byte is a sample load, and AddmusicK emits
 * `$F3` for it (`parser.ts:parseHexCommand`), so the sample button's glyph is
 * the honest one. `$ED $80`-`$83` has no single command to point at — it is four
 * — and the inspector drops those to its generic readout too, so the envelope
 * glyph stands and only the name is corrected below.
 */
function forkEntry(command: Command): (typeof ENTRIES)[number] | undefined {
  if (
    command.vcmd === 0xe5 &&
    command.target.program === 1 &&
    (command.args[0]?.value ?? 0) >= 0x80
  ) {
    return byVcmd.get(0xf3);
  }

  return undefined;
}

/**
 * How a command should be drawn and named, or `null` for one with no entry.
 *
 * `null` is reachable only for a spelling the catalogue does not offer at all —
 * `<` and `>` never reach the command model, `^` folds into its note, `]` is
 * half of what the loop button writes rather than a button of its own, and `*`
 * replays a body nothing can point at — so a caller may treat it as "nothing to
 * draw" rather than as an error. Every caller is fed a `commandScope`-filtered
 * list, and all of those are `structure` or nothing at all, so none of them
 * ever asks.
 */
export function glyphOf(command: Command): ResolvedEntry | null {
  let entry: (typeof ENTRIES)[number] | undefined;

  if (command.vcmd !== undefined) {
    // A byte with no button of its own is one a letter or bracket writes, and
    // that spelling's glyph is the right one: a `$E7` read back out of a song is
    // a `v`, whichever way it was typed.
    entry =
      forkEntry(command) ??
      (command.vcmd === 0xed
        ? envelopeEntry(command)
        : (byVcmd.get(command.vcmd) ?? byWrites.get(command.vcmd)));
  } else {
    const letter = command.kind.toLowerCase();
    // `t18,144` is `$E3` and `t144` is `$E2` — two commands, two glyphs, one
    // letter, and only where the dialect looks for the comma. `gather` splits
    // their names on the same test.
    entry =
      (isFade(letter, command.args.length, command.target)
        ? bySyntax.get(`${letter},`)
        : undefined) ?? byLetter.get(letter);
  }

  if (entry === undefined) {
    return null;
  }

  const resolved = resolveEntry(entry, command.target, READING);
  return command.vcmd === undefined || entry.kind !== 'hex'
    ? resolved
    : { ...resolved, label: readingOf(command, entry.args) ?? resolved.label };
}

/**
 * The name the written bytes earn, where it differs from the one the entry's own
 * defaults would earn.
 *
 * `resolveEntry` names a button from the arguments it would *insert*, and under
 * `#am4` those are chosen to stay clear of the forks (`catalog.ts`) — so a
 * `$ED $81` read back out of a song comes out named for the plain envelope. The
 * comparison is what keeps this to the forks: `$EF` and `$F1` are both "echo
 * parameters" to `vcmdName` whatever their arguments, and their entries' own
 * labels are what tell them apart.
 */
function readingOf(command: Command, defaults: readonly number[]): string | undefined {
  const vcmd = command.vcmd;
  if (vcmd === undefined) {
    return undefined;
  }

  const written = vcmdName(vcmd, command.args, command.target);
  const assumed = vcmdName(
    vcmd,
    defaults.map((value) => ({ value })),
    command.target,
  );
  return written === assumed ? undefined : written.charAt(0).toUpperCase() + written.slice(1);
}
