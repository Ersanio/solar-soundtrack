import type { Command, Token } from '@compiler/tokens';

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
