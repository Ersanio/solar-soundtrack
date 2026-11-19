/** The fix to an arpeggio whose count disagrees with its notes: the count written as the notes there are. */

import { hex2 } from '@amk/core/hex';
import { arpeggioCountMismatches } from '@amk/tokens/arpeggio-count';
import { argEditable, argumentText, spliceArg } from '@amk/tokens/edits';
import type { Fix, FixRequest } from './fixes';
import { makeFix } from './fix-text';

/** SST0518: the count byte, and nothing else, rewritten where one count fits what is written. */
function arpeggioCount(request: FixRequest): Fix[] {
  const song = request.context.live;
  const { span } = request.diagnostic;
  const mismatch = arpeggioCountMismatches(song.index, song.text).find(
    (each) => each.span.start === span.start && each.span.end === span.end,
  );
  if (mismatch?.fitting == null || !argEditable(mismatch.command, 0)) {
    return [];
  }

  const { command, count, fitting } = mismatch;
  const from = `$${hex2(count)}`;
  const to = `$${hex2(fitting)}`;
  return [
    makeFix(
      song.text,
      $localize`:@@output.fix.arpeggio-count:output.fix.arpeggio-count ${from}:from: ${to}:to:`,
      [spliceArg(song.text, command, 0, argumentText(command, fitting))],
    ),
  ];
}

export const arpeggioFixes = {
  codes: new Set(['SST0518']),
  fixes: arpeggioCount,
};
