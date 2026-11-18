/**
 * The fixes the Problems list offers: for a diagnostic with one mechanical answer, the edits that
 * make it.
 *
 * A fix is computed from the diagnostic and the text it was raised on, never from the message,
 * which is display text. Most diagnostic spans are where the parser happened to be standing, so
 * each fix finds what it rewrites in the scan and takes the span as a hint. Every edit carries
 * `expect`, and the list is sorted and non-overlapping, as `EditorRequests.applyAll` requires.
 */

import type { CompileResult, Diagnostic } from '@amk/core/types';
import type { SongTimeline } from '@amk/spc/song-walk';
import type { TokenIndex } from '@amk/tokens';
import type { Edit } from '@amk/tokens/edits';
import { directiveFixes } from './directive-fixes';
import { hazardFixes } from './hazard-fixes';
import { lengthFixes } from './length-fixes';
import { nameFixes } from './name-fixes';
import { repeatFixes } from './repeat-fixes';
import { sampleFixes } from './sample-fixes';
import { textFixes } from './text-fixes';

/** One way to answer a diagnostic. */
export interface Fix {
  /** Stable within one diagnostic: `'fix'`, or `'pad'` and `'trim'` where there are two. */
  readonly id: string;
  /** The button's text. */
  readonly label: string;
  /** What the fix does, in one sentence, for the dialog. */
  readonly summary: string;
  /** Sorted by offset, non-overlapping, each with its `expect`. */
  readonly edits: readonly Edit[];
  /** The text the edits were built against, which the document has to still be. */
  readonly against: string;
}

/** A text and its one scan. */
export interface ScannedText {
  readonly text: string;
  readonly index: TokenIndex;
}

/** The compile a diagnostic came from, and the text and scan its spans index. */
export interface CompiledSong extends ScannedText {
  readonly result: CompileResult;
  readonly timeline: SongTimeline | null;
}

export interface FixContext {
  /** The document as it stands, which the scan's own diagnostics index. */
  readonly live: ScannedText;
  /** The last compile, whose diagnostics index its text; `null` before there is one. */
  readonly compiled: CompiledSong | null;
  /** The sample library's file names. */
  readonly sampleNames: readonly string[];
  /** The library's sample groups, by name. */
  readonly sampleGroups: Readonly<Record<string, readonly string[]>>;
}

/** What one family of fixes is handed. */
export interface FixRequest {
  readonly diagnostic: Diagnostic;
  readonly context: FixContext;
}

/** One family: the codes it answers and how. */
interface FixFamily {
  readonly codes: ReadonlySet<string>;
  readonly fixes: (request: FixRequest) => readonly Fix[];
}

const FAMILIES: readonly FixFamily[] = [
  directiveFixes,
  textFixes,
  nameFixes,
  sampleFixes,
  hazardFixes,
  lengthFixes,
  repeatFixes,
];

/** Every fix there is for `diagnostic`, or none. */
export function fixesFor(diagnostic: Diagnostic, context: FixContext): readonly Fix[] {
  const family = FAMILIES.find((each) => each.codes.has(diagnostic.code));
  if (family === undefined) {
    return [];
  }

  return family.fixes({ diagnostic, context }).filter((fix) => fix.edits.length > 0);
}

/** Every code some family answers. */
export const FIXABLE_CODES: ReadonlySet<string> = new Set(
  FAMILIES.flatMap((family) => [...family.codes]),
);
