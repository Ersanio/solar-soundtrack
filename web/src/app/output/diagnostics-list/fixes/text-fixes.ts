/** Fixes that change spelling and nothing else: a stray character deleted, upper-case note letters lowered. */

import { spliceOut, spliceRange } from '@amk/tokens/edits';
import type { Fix, FixRequest } from './fixes';
import { makeFix, textOf, tokenAt } from './fix-text';

/** AMK0100: the character `scan` warns about and steps over (`parser.ts:464`). */
function strayCharacter({ diagnostic, context }: FixRequest): Fix[] {
  const song = context.compiled;
  const { span } = diagnostic;
  const token = song && tokenAt(song.index, span.start);
  // A character that arrived through a replacement collapses onto the macro's name, which is
  // not an `unknown` token of one character.
  if (!song || token?.kind !== 'unknown' || token.end !== span.end || span.end - span.start !== 1) {
    return [];
  }

  const character = textOf(song.text, span);
  return [
    makeFix(
      song.text,
      $localize`:@@output.fix.delete-character:output.fix.delete-character ${character}:character:`,
      [spliceOut(song.text, span)],
    ),
  ];
}

/**
 * AMK0216: every note and rest letter written in upper case, lowered. `parseNote` lowers it
 * itself (`parser.ts:2695`), so the bytes are the same; AddmusicK 1.0.8 and lower did not.
 */
function upperCaseNotes({ context }: FixRequest): Fix[] {
  const song = context.compiled;
  if (song === null) {
    return [];
  }

  const edits = song.index.commands.flatMap((command) => {
    if (command.noteLength === undefined || command.replacement !== undefined) {
      return [];
    }

    const letter = { ...command.span, end: command.span.start + 1 };
    const written = textOf(song.text, letter);
    return /^[A-GR]$/.test(written) ? [spliceRange(song.text, letter, written.toLowerCase())] : [];
  });

  const summary =
    edits.length === 1
      ? $localize`:@@output.fix.lower-case-notes.one:output.fix.lower-case-notes.one`
      : $localize`:@@output.fix.lower-case-notes.other:output.fix.lower-case-notes.other ${edits.length}:count:`;
  return [makeFix(song.text, summary, edits)];
}

export const textFixes = {
  codes: new Set(['AMK0100', 'AMK0216']),
  fixes(request: FixRequest): readonly Fix[] {
    return request.diagnostic.code === 'AMK0100'
      ? strayCharacter(request)
      : upperCaseNotes(request);
  },
};
