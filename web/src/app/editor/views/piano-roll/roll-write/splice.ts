/** The edit primitives every writer here shares: splicing a unit, removing a span or an item with its comments, and refusing. */

import type { Span } from '@amk/core/types';
import { type Edit, spliceOut, spliceRange } from '@amk/tokens/edits';
import type { EditRefusal } from '../roll-edit';
import { COMMENT, type StripItem } from '../roll-strip';
import { eol } from './spelling';

export function refuse(reason: string): EditRefusal {
  return { refused: reason };
}

/**
 * `text`, with the comments the span it replaces holds put back after it.
 *
 * The parser never sees a comment (`roll-strip.ts:COMMENT`), so a rest it folded
 * across a `;` line has the comment inside its span. Each goes back with its own
 * line end, which is where it stood.
 */
function keepingComments(source: string, span: Span, text: string): string {
  const comments = source.slice(span.start, span.end).match(COMMENT);
  if (comments === null) {
    return text;
  }

  const line = eol(source);
  return `${text}${comments.map((comment) => ` ${comment}${line}`).join('')}`;
}

/** A unit's text replaced, keeping its comments. */
export function spliceUnit(source: string, span: Span, text: string): Edit | null {
  return spliceRange(source, span, keepingComments(source, span, text));
}

/** A span and the whitespace in front of it taken out, keeping its comments. */
export function removeSpan(source: string, span: Span): Edit[] {
  const edit = spliceOut(source, span);
  return edit ? [{ ...edit, text: keepingComments(source, span, edit.text) }] : [];
}

/** The unit and the whitespace in front of it, so a deletion leaves no double space. */
export function removeItem(source: string, item: StripItem): Edit[] {
  return removeSpan(source, item.unitSpan);
}
