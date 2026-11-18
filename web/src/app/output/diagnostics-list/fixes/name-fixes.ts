/**
 * Fixes to a name AddmusicK could not find: a sample, a sample group or an `#spc` field whose
 * only fault is letter case, or a sample missing its extension. AddmusicK matches all three
 * exactly, so each is offered only where exactly one name fits.
 */

import type { Token } from '@amk/tokens';
import { spliceRange } from '@amk/tokens/edits';
import type { CompiledSong, Fix, FixRequest } from './fixes';
import { makeFix, quoted, textOf, tokenBefore } from './fix-text';

/** The fields `parseSpcInfo` knows (`parser.ts:1402`). */
const SPC_FIELDS = ['#title', '#game', '#author', '#comment', '#length'];

/** The last token of `kind` before `offset` with nothing but whitespace after it. */
function justBefore(song: CompiledSong, offset: number, kind: Token['kind']): Token | null {
  const token = tokenBefore(song.index, offset, kind);
  return token !== null && song.text.slice(token.end, offset).trim() === '' ? token : null;
}

/** The one name in `names` that `wanted` would be with its case changed, or `null`. */
function onlyCaseOf(wanted: string, names: readonly string[]): string | null {
  const matches = names.filter(
    (name) => name !== wanted && name.toLowerCase() === wanted.toLowerCase(),
  );
  return matches.length === 1 ? matches[0] : null;
}

function rename(song: CompiledSong, at: Token, from: string, to: string): Fix[] {
  return [
    makeFix(song.text, $localize`:@@output.fix.rename:output.fix.rename ${from}:from: ${to}:to:`, [
      spliceRange(song.text, at, to),
    ]),
  ];
}

/** AMK0058, AMK0107: the quoted sample name the parser had just read. */
function sampleName({ diagnostic, context }: FixRequest): Fix[] {
  const song = context.compiled;
  const token = song && justBefore(song, diagnostic.span.start, 'string');
  if (!song || !token) {
    return [];
  }

  const name = quoted(song.text, token);
  let found: string | null;
  if (diagnostic.code === 'AMK0107') {
    const exact = context.sampleNames.filter(
      (each) => each === `${name}.brr` || each === `${name}.bnk`,
    );
    found = exact.length === 1 ? exact[0] : null;
  } else {
    found = onlyCaseOf(name, context.sampleNames);
  }

  return found === null ? [] : rename(song, token, `"${name}"`, `"${found}"`);
}

/** AMK0059: the `#group` the parser had just read (`parser.ts:1377`). */
function groupName({ diagnostic, context }: FixRequest): Fix[] {
  const song = context.compiled;
  const token = song && justBefore(song, diagnostic.span.start, 'directive');
  if (!song || !token) {
    return [];
  }

  const written = textOf(song.text, token);
  const found = onlyCaseOf(written.slice(1), Object.keys(context.sampleGroups));
  return found === null ? [] : rename(song, token, written, `#${found}`);
}

/** AMK0065: the `#field` in front of the value the parser had just read. */
function spcField({ diagnostic, context }: FixRequest): Fix[] {
  const song = context.compiled;
  const token = song && tokenBefore(song.index, diagnostic.span.start, 'directive');
  if (!song || !token) {
    return [];
  }

  const written = textOf(song.text, token);
  const found = onlyCaseOf(written, SPC_FIELDS);
  return found === null ? [] : rename(song, token, written, found);
}

export const nameFixes = {
  codes: new Set(['AMK0058', 'AMK0059', 'AMK0065', 'AMK0107']),
  fixes(request: FixRequest): readonly Fix[] {
    switch (request.diagnostic.code) {
      case 'AMK0059':
        return groupName(request);
      case 'AMK0065':
        return spcField(request);
      default:
        return sampleName(request);
    }
  },
};
