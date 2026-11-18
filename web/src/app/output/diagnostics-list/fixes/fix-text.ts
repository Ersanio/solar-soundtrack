/** What every family of fixes shares: building a {@link Fix}, finding tokens near a span, and taking a line out. */

import type { Span } from '@amk/core/types';
import type { Token, TokenIndex } from '@amk/tokens';
import { type Edit, insertAt, spliceOut, spliceRange } from '@amk/tokens/edits';
import type { Fix } from './fixes';

/** The button text of a diagnostic's one fix. */
export const FIX_LABEL = $localize`:@@output.fix.label:output.fix.label`;

/**
 * A fix from the edits that make it, sorted, with the `null`s the builders return for "nothing to
 * change" dropped. Throws on two edits that overlap, which `applyAll` cannot refuse.
 */
export function makeFix(
  against: string,
  summary: string,
  edits: readonly (Edit | null)[],
  id = 'fix',
  label = FIX_LABEL,
): Fix {
  const sorted = edits
    .filter((edit) => edit !== null)
    .sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].span.start < sorted[i - 1].span.end) {
      throw new Error(`overlapping fix edits at ${sorted[i].span.start}`);
    }
  }

  return { id, label, summary, edits: sorted, against };
}

export function textOf(text: string, token: Token | Span): string {
  return text.slice(token.start, token.end);
}

/** The last token of `kind` that ends at or before `offset`. */
export function tokenBefore(index: TokenIndex, offset: number, kind: Token['kind']): Token | null {
  let found: Token | null = null;
  for (const token of index.tokens) {
    if (token.start >= offset) {
      break;
    }

    if (token.kind === kind && token.end <= offset) {
      found = token;
    }
  }

  return found;
}

/** The token that starts at `offset`, if any. */
export function tokenAt(index: TokenIndex, offset: number): Token | null {
  return index.tokens.find((token) => token.start === offset) ?? null;
}

/** The tokens after `token` on its own line, in order. */
export function restOfLine(index: TokenIndex, token: Token): Token[] {
  return index.tokens.filter((other) => other.start >= token.end && other.line === token.line);
}

/** Every directive token whose text is `word`, exactly as AddmusicK compares it. */
export function directives(index: TokenIndex, text: string, word: string): Token[] {
  return index.tokens.filter((token) => token.kind === 'directive' && textOf(text, token) === word);
}

/** Where the line holding `offset` starts. */
export function lineStart(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1;
}

/** Where the line holding `offset` ends, before its line break. */
export function lineEnd(text: string, offset: number): number {
  const next = text.indexOf('\n', offset);
  const end = next < 0 ? text.length : next;
  return end > 0 && text[end - 1] === '\r' ? end - 1 : end;
}

/**
 * The range taken out, and its whole line with it where nothing else stands on that line — a
 * directive written on a line of its own leaves no blank line behind.
 */
export function removeLine(text: string, span: Span): Edit | null {
  const start = lineStart(text, span.start);
  const end = lineEnd(text, span.end);
  if (text.slice(start, span.start).trim() !== '') {
    return spliceOut(text, span);
  }

  // First on a line that goes on: the space after it goes with it instead of the one before.
  if (text.slice(span.end, end).trim() !== '') {
    let after = span.end;
    while (text[after] === ' ' || text[after] === '\t') {
      after++;
    }

    return spliceRange(text, { ...span, end: after }, '');
  }

  const breakAfter = text.indexOf('\n', span.end);
  if (breakAfter >= 0) {
    return spliceRange(text, { ...span, start, end: breakAfter + 1 }, '');
  }

  // The last line: take the line break in front of it instead.
  const before = start > 0 ? (text[start - 2] === '\r' ? start - 2 : start - 1) : start;
  return spliceRange(text, { ...span, start: before, end: text.length }, '');
}

/** A line of text inserted at the start of the line holding `offset`. */
export function insertLineBefore(text: string, offset: number, line: string): Edit | null {
  return insertAt(lineStart(text, offset), `${line}${eolOf(text)}`);
}

/** The document's own line ending. */
export function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** The first real `#0`-`#7` marker, which `channelDefined` latches on (Music.cpp:1015). */
export function firstChannelMarker(index: TokenIndex, text: string): Token | null {
  return (
    index.tokens.find(
      (token) => token.kind === 'channel' && /^#[0-7]$/.test(textOf(text, token).trim()),
    ) ?? null
  );
}

/**
 * The `{` and `}` of the block a directive opens, or `null` where it has none closed.
 *
 * `#samples`, `#instruments` and `#spc` blocks hold no braces of their own, so the first `}`
 * after the `{` closes it.
 */
export function blockAfter(
  index: TokenIndex,
  text: string,
  directive: Token,
): { open: Token; close: Token } | null {
  const after = index.tokens.filter((token) => token.start >= directive.end);
  const open = after[0];
  if (open?.kind !== 'operator' || textOf(text, open) !== '{') {
    return null;
  }

  const close = after.find((token) => token.kind === 'operator' && textOf(text, token) === '}');
  return close === undefined ? null : { open, close };
}

/** A quoted string's contents as written, escapes and all, without its quotes. */
export function quoted(text: string, token: Token): string {
  return text.slice(token.start + 1, token.end - 1);
}

/** The indentation the line holding `offset` starts with. */
export function indentOf(text: string, offset: number): string {
  const start = lineStart(text, offset);
  return /^[ \t]*/.exec(text.slice(start))?.[0] ?? '';
}
