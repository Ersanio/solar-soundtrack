/**
 * A fix's edits as the rows of a diff: whole lines removed and added, lines changed inside, a
 * little unchanged text around each change, and the rest folded away.
 *
 * The edits are the exact change, so no general diff runs over the song: only the lines they
 * touch are compared, and every line outside them is the same line on both sides.
 */

import type { Edit } from '@amk/tokens/edits';

/** Unchanged lines kept either side of a change. */
export const CONTEXT_LINES = 2;

/** Lines compared character by character past this many cells; beyond it, by common ends. */
const INLINE_LIMIT = 40_000;

/** One stretch of a changed line. */
export interface DiffPart {
  readonly text: string;
  readonly kind: 'same' | 'removed' | 'added';
}

/** One row, its line numbers counted from 1 on the side or sides it is on. */
export type DiffRow =
  | { readonly kind: 'context'; readonly old: number; readonly new: number; readonly text: string }
  | { readonly kind: 'removed'; readonly old: number; readonly text: string }
  | { readonly kind: 'added'; readonly new: number; readonly text: string }
  | {
      readonly kind: 'changed';
      readonly old: number;
      readonly new: number;
      readonly parts: readonly DiffPart[];
    }
  | { readonly kind: 'skipped'; readonly count: number };

/** The text with the edits applied. They are sorted and do not overlap. */
export function applied(source: string, edits: readonly Edit[]): string {
  let out = '';
  let at = 0;
  for (const edit of edits) {
    out += source.slice(at, edit.span.start) + edit.text;
    at = edit.span.end;
  }

  return out + source.slice(at);
}

/**
 * Lines without their line breaks, a `\r` before one included. A text ending in a line break has
 * no empty line after it, as an editor numbers it.
 */
function linesOf(text: string): string[] {
  const lines = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines;
}

/** The 0-based line holding `offset`. */
function lineAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      starts.push(i + 1);
    }
  }

  return starts;
}

/** A run of old lines and the new lines that replace it. */
interface Hunk {
  oldFrom: number;
  oldTo: number;
  newFrom: number;
  newTo: number;
}

/** The lines each edit touches, on both sides, merged where they meet. */
function hunksOf(source: string, after: string, edits: readonly Edit[]): Hunk[] {
  const oldStarts = lineStarts(source);
  const newStarts = lineStarts(after);
  const hunks: Hunk[] = [];
  let shift = 0;
  for (const edit of edits) {
    const newStart = edit.span.start + shift;
    const hunk = {
      oldFrom: lineAt(oldStarts, edit.span.start),
      oldTo: lineAt(oldStarts, edit.span.end),
      newFrom: lineAt(newStarts, newStart),
      newTo: lineAt(newStarts, newStart + edit.text.length),
    };
    shift += edit.text.length - (edit.span.end - edit.span.start);

    const last = hunks[hunks.length - 1];
    if (last !== undefined && hunk.oldFrom <= last.oldTo) {
      last.oldTo = Math.max(last.oldTo, hunk.oldTo);
      last.newTo = Math.max(last.newTo, hunk.newTo);
    } else {
      hunks.push(hunk);
    }
  }

  return hunks;
}

/** The longest common subsequence of two lists, as index pairs in order. */
function common<T>(a: readonly T[], b: readonly T[]): [number, number][] {
  const lengths = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] =
        a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  return pairs;
}

/** Appends a part, joining it to the one before where they are the same kind. */
function push(parts: DiffPart[], text: string, kind: DiffPart['kind']): void {
  if (text === '') {
    return;
  }

  const last = parts[parts.length - 1];
  if (last?.kind === kind) {
    parts[parts.length - 1] = { text: last.text + text, kind };
  } else {
    parts.push({ text, kind });
  }
}

/** One line changed into another, as what stayed, what went and what came. */
export function inlineParts(before: string, after: string): DiffPart[] {
  const parts: DiffPart[] = [];
  if (before.length * after.length > INLINE_LIMIT) {
    let head = 0;
    while (head < before.length && head < after.length && before[head] === after[head]) {
      head++;
    }

    let tail = 0;
    while (
      tail < before.length - head &&
      tail < after.length - head &&
      before[before.length - 1 - tail] === after[after.length - 1 - tail]
    ) {
      tail++;
    }

    push(parts, before.slice(0, head), 'same');
    push(parts, before.slice(head, before.length - tail), 'removed');
    push(parts, after.slice(head, after.length - tail), 'added');
    push(parts, before.slice(before.length - tail), 'same');
    return parts;
  }

  const a = [...before];
  const b = [...after];
  let i = 0;
  let j = 0;
  for (const [ai, bj] of common(a, b)) {
    push(parts, a.slice(i, ai).join(''), 'removed');
    push(parts, b.slice(j, bj).join(''), 'added');
    push(parts, a[ai], 'same');
    i = ai + 1;
    j = bj + 1;
  }

  push(parts, a.slice(i).join(''), 'removed');
  push(parts, b.slice(j).join(''), 'added');
  return parts;
}

/** A hunk's rows: equal lines as context, and the unequal ones between as removed, added or changed. */
function hunkRows(oldLines: readonly string[], newLines: readonly string[], hunk: Hunk): DiffRow[] {
  const before = oldLines.slice(hunk.oldFrom, hunk.oldTo + 1);
  const after = newLines.slice(hunk.newFrom, hunk.newTo + 1);
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;

  const between = (toI: number, toJ: number) => {
    // Lines removed and added side by side are one line changed, as far as they pair up.
    while (i < toI && j < toJ) {
      rows.push({
        kind: 'changed',
        old: hunk.oldFrom + i + 1,
        new: hunk.newFrom + j + 1,
        parts: inlineParts(before[i], after[j]),
      });
      i++;
      j++;
    }

    for (; i < toI; i++) {
      rows.push({ kind: 'removed', old: hunk.oldFrom + i + 1, text: before[i] });
    }

    for (; j < toJ; j++) {
      rows.push({ kind: 'added', new: hunk.newFrom + j + 1, text: after[j] });
    }
  };

  // A hunk too long to compare line against line is lined up in order instead.
  const pairs =
    before.length * after.length > INLINE_LIMIT
      ? before.flatMap((line, k): [number, number][] => (line === after[k] ? [[k, k]] : []))
      : common(before, after);
  for (const [bi, aj] of pairs) {
    between(bi, aj);
    rows.push({
      kind: 'context',
      old: hunk.oldFrom + bi + 1,
      new: hunk.newFrom + aj + 1,
      text: before[bi],
    });
    i = bi + 1;
    j = aj + 1;
  }

  between(before.length, after.length);
  return rows;
}

/** The rows of `edits` applied to `source`, with {@link CONTEXT_LINES} around each change. */
export function diffRows(source: string, edits: readonly Edit[]): DiffRow[] {
  const after = applied(source, edits);
  const oldLines = linesOf(source);
  const newLines = linesOf(after);
  const hunks = hunksOf(source, after, edits);

  const rows: DiffRow[] = [];
  let oldAt = 0;
  // Old and new line numbers outside a hunk differ by however many lines the hunks before it added.
  let offset = 0;
  for (const [index, hunk] of hunks.entries()) {
    const from = Math.max(oldAt, hunk.oldFrom - CONTEXT_LINES);
    if (from > oldAt) {
      rows.push({ kind: 'skipped', count: from - oldAt });
    }

    for (let line = from; line < hunk.oldFrom; line++) {
      rows.push({ kind: 'context', old: line + 1, new: line + offset + 1, text: oldLines[line] });
    }

    rows.push(...hunkRows(oldLines, newLines, hunk));
    offset = hunk.newTo - hunk.oldTo;
    oldAt = hunk.oldTo + 1;

    const next = hunks[index + 1];
    const until = Math.min(
      oldLines.length,
      hunk.oldTo + 1 + CONTEXT_LINES,
      next?.oldFrom ?? Infinity,
    );
    for (let line = oldAt; line < until; line++) {
      rows.push({ kind: 'context', old: line + 1, new: line + offset + 1, text: oldLines[line] });
    }

    oldAt = until;
  }

  if (oldAt < oldLines.length) {
    rows.push({ kind: 'skipped', count: oldLines.length - oldAt });
  }

  return rows;
}
