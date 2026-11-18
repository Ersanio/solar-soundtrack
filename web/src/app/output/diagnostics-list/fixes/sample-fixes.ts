/**
 * Fixes to the `#samples` list: a sample the song uses added to it, and `#default` put first
 * where a stock instrument reaches past the list's end.
 */

import type { Edit } from '@amk/tokens/edits';
import { insertAt } from '@amk/tokens/edits';
import type { Token } from '@amk/tokens';
import type { CompiledSong, Fix, FixRequest } from './fixes';
import {
  blockAfter,
  directives,
  eolOf,
  firstChannelMarker,
  indentOf,
  lineEnd,
  lineStart,
  makeFix,
  quoted,
  textOf,
  tokenBefore,
} from './fix-text';

/** The group every stock instrument's sample is in, and so the one the list has to open with. */
const DEFAULT_GROUP = '#default';

/** The song's one `#samples` block, or `null` where it has none or more than one. */
function samplesBlock(song: CompiledSong): { directive: Token; open: Token; close: Token } | null {
  const found = directives(song.index, song.text, '#samples');
  const block = found.length === 1 ? blockAfter(song.index, song.text, found[0]) : null;
  return block && { directive: found[0], ...block };
}

/** The indentation of an entry inside the block, or a tab where it has none on a line of its own. */
function entryIndent(song: CompiledSong, open: Token, close: Token): string {
  const entry = song.index.tokens.find(
    (token) =>
      token.start > open.end &&
      token.end <= close.start &&
      song.text.slice(lineStart(song.text, token.start), token.start).trim() === '',
  );
  return entry === undefined ? '\t' : indentOf(song.text, entry.start);
}

/** `entry` written as the block's last entry, on a line of its own where the `}` is on one. */
function appendEntry(song: CompiledSong, open: Token, close: Token, entry: string): Edit | null {
  const start = lineStart(song.text, close.start);
  if (song.text.slice(start, close.start).trim() === '') {
    return insertAt(start, `${entryIndent(song, open, close)}${entry}${eolOf(song.text)}`);
  }

  return insertAt(close.start, `${entry} `);
}

/** `entry` written as the block's first entry, on a line of its own where the `{` ends one. */
function prependEntry(song: CompiledSong, open: Token, close: Token, entry: string): Edit | null {
  const end = lineEnd(song.text, open.end);
  if (song.text.slice(open.end, end).trim() === '') {
    const next = song.text.indexOf('\n', open.end) + 1;
    return insertAt(next, `${entryIndent(song, open, close)}${entry}${eolOf(song.text)}`);
  }

  return insertAt(open.end, ` ${entry}`);
}

/**
 * AMK0089, AMK0132: the sample the parser had just read, added to `#samples`. AMK0132's span
 * covers the sample load's `(` and its string (`parser.ts:2115`), AMK0089's stands just after it.
 */
function missingSample({ diagnostic, context }: FixRequest): Fix[] {
  const song = context.compiled;
  const token = song && tokenBefore(song.index, diagnostic.span.end, 'string');
  if (!song || !token || song.text.slice(token.end, diagnostic.span.start).trim() !== '') {
    return [];
  }

  const name = quoted(song.text, token);
  if (!context.sampleNames.includes(name)) {
    return [];
  }

  const entry = `"${name}"`;
  const summary = $localize`:@@output.fix.add-sample:output.fix.add-sample ${entry}:sample:`;
  const block = samplesBlock(song);
  if (block !== null) {
    // A list written after the use cannot be what the use reads.
    return block.close.start < token.start
      ? [makeFix(song.text, summary, [appendEntry(song, block.open, block.close, entry)])]
      : [];
  }

  if (directives(song.index, song.text, '#samples').length > 0) {
    return [];
  }

  // A new list goes above whatever reads it first: the `#instruments` block or the music.
  const readers = [
    directives(song.index, song.text, '#instruments')[0],
    firstChannelMarker(song.index, song.text),
  ].filter((each) => each !== undefined && each !== null);
  const at = Math.min(token.start, ...readers.map((each) => each.start));
  const line = eolOf(song.text);
  const list = ['#samples', '{', `\t${DEFAULT_GROUP}`, `\t${entry}`, '}', ''].join(line);
  return [makeFix(song.text, summary, [insertAt(lineStart(song.text, at), list)])];
}

/** AMK0109: `#default` first in the list, so `@0`-`@29` find their samples where they expect. */
function missingDefault({ context }: FixRequest): Fix[] {
  const song = context.compiled;
  const block = song && samplesBlock(song);
  if (!song || !block) {
    return [];
  }

  const listed = song.index.tokens.some(
    (token) =>
      token.start > block.open.end &&
      token.end <= block.close.start &&
      textOf(song.text, token) === DEFAULT_GROUP,
  );
  if (listed) {
    return [];
  }

  return [
    makeFix(song.text, $localize`:@@output.fix.add-default:output.fix.add-default`, [
      prependEntry(song, block.open, block.close, DEFAULT_GROUP),
    ]),
  ];
}

export const sampleFixes = {
  codes: new Set(['AMK0089', 'AMK0109', 'AMK0132']),
  fixes(request: FixRequest): readonly Fix[] {
    return request.diagnostic.code === 'AMK0109' ? missingDefault(request) : missingSample(request);
  },
};
