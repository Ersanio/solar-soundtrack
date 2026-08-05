import type { Command, Token } from '@compiler/tokens';

/**
 * The tempo in force where a command sits, as it was *written*, or `null` when
 * the song has not set one yet.
 *
 * The same positional walk as {@link velocityTableAt} and `feedbackBefore`, with
 * two differences. There is no channel filter — tempo is song-global, and a `t`
 * on channel 0 governs a fade on channel 5. And it has to match three spellings:
 * `$E2`'s only argument, `$E3`'s *second* (its first is the fade duration), and
 * the letter `t`, whose comma form puts the duration first in exactly the same
 * way.
 *
 * Deliberately not seeded from the driver's power-on `$51 = $36` (`main.asm:177`).
 * That is a *stored* tempo, and `tickSeconds` adds the handler's stale carry back
 * on — so seeding with it would report a song that has set no tempo as one tick
 * faster than it really is. Returning `null` lets the readout say ticks and stop,
 * which is the honest answer to "how long is this in seconds" when nothing has
 * said how long a tick is.
 */
export function tempoBefore(command: Command, commands: readonly Command[]): number | null {
  let found: number | null = null;

  for (const other of commands) {
    if (other.span.start >= command.span.start) {
      break;
    }

    if (other.vcmd === 0xe2) {
      found = other.args[0]?.value ?? found;
    } else if (other.vcmd === 0xe3) {
      // `$E3 <duration> <tempo>` — the target is what stands afterwards.
      found = other.args[1]?.value ?? found;
    } else if (other.kind.toLowerCase() === 't' && other.args.length > 0) {
      // `t144` and `t30,80`: the tempo is last either way (`parser.ts:1740-1760`).
      found = other.args[other.args.length - 1].value;
    }
  }

  return found;
}

/**
 * Which velocity table is live where a command was written.
 *
 * `q`'s low nibble is an index, and the table it indexes is a property of the
 * *song*: `#amk 2` moved the default from SMW's to N-SPC's (`parser.ts:415`),
 * and `#option smwvtable` / `nspcvtable` switch it mid-file
 * (`parser.ts:926-953`). Without this the panel would put a number on the
 * velocity that is simply the wrong number for half the songs in the wild.
 *
 * Positional, and in `app/` for the same reason `feedbackBefore` and
 * `firOverriddenBefore` are: the scanner does not track `#option` — it has no
 * argument history, which is what keeps `copyState` O(1) — and the compiler
 * applies the file's markers rather than reading them where they sit. So this is
 * an approximation the compiler deliberately does not make, kept out of
 * `compiler/` so it cannot be mistaken for one it does.
 *
 * The scanner does tokenise the directive's argument word (`ScanState.
 * directiveWord`), which is what makes a text scan possible at all.
 */
export function velocityTableAt(command: Command, tokens: Token[], text: string): 'smw' | 'nspc' {
  // parser.ts:415 — the default the dialect sets, before any #option.
  let smw = command.target.program !== 0 || command.target.amkVersion < 2;

  for (const token of tokens) {
    if (token.start >= command.span.start) {
      break;
    }

    if (token.kind !== 'directive') {
      continue;
    }

    // `matchWord` is case-insensitive (`parser.ts:845`), and `#option` and its
    // keyword are two tokens, so the word is read from the one after.
    if (text.slice(token.start, token.end).toLowerCase() !== '#option') {
      continue;
    }

    const rest = text.slice(token.end).trimStart().toLowerCase();
    if (rest.startsWith('smwvtable')) {
      smw = true;
    } else if (rest.startsWith('nspcvtable')) {
      smw = false;
    }
  }

  return smw ? 'smw' : 'nspc';
}
