import { StreamLanguage } from '@codemirror/language';
import { type Tag, tags } from '@lezer/highlight';

import { TOKEN_TAGS, copyState, type ScanState, startState, step } from '@amk/tokens';

/**
 * `TOKEN_TAGS` holds `@lezer/highlight` tag *names*, so that `compiler/` never
 * depends on CodeMirror; this is the one place they are resolved to `Tag`
 * values. `tokentest` asserts every name really is a tag, so the cast is a
 * checked one.
 */
const tokenTable = Object.fromEntries(
  [...new Set(Object.values(TOKEN_TAGS))].map((name) => [
    name,
    tags[name as keyof typeof tags] as Tag,
  ]),
);

/**
 * The MML scanner in `@compiler/tokens`, adapted to CodeMirror.
 *
 * `step` was shaped for exactly this contract — a line-oriented stepper with a
 * small copyable state — so the adapter only translates between the stream and
 * `(line, at)`. `tokenize` in the same module is the other wrapper over the
 * same stepper, and `tokentest`'s restartability assertion is what guarantees
 * the two can never colour a document differently.
 *
 * No `blankLine` and no `indent`: the scanner carries nothing a blank line
 * would reset (adding one would diverge from `tokenize`), and MML has no
 * indentation grammar.
 */
export const mmlLanguage = StreamLanguage.define<ScanState>({
  name: 'amk-mml',
  startState,
  copyState,
  token(stream, state) {
    const { kind, end } = step(stream.string, stream.pos, state);
    // step contractually advances; the max() is the same belt tokenize() wears.
    stream.pos = Math.max(end, stream.pos + 1);
    return kind ? TOKEN_TAGS[kind] : null;
  },
  languageData: { commentTokens: { line: ';' } },
  tokenTable,
});
