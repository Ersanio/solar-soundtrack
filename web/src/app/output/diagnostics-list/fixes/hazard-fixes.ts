/**
 * Fixes to the bytes that compile clean and break the song: a runaway echo's feedback lowered, a
 * dead `$F7` deleted, and a `$DD` moved back against the note it was written to ride on.
 */

import { VCMD } from '@amk/core/hardcoded-tables';
import { hex2 } from '@amk/core/hex';
import { FIR_TAPS, type FirTaps, echoStability, signedByte } from '@amk/spc/fir';
import type { Command } from '@amk/tokens';
import { bendAnchor } from '@amk/tokens/command-hazards';
import { builtInTaps, echoDelayBefore } from '@amk/tokens/echo-hazards';
import {
  argEditable,
  argumentText,
  commandRewritable,
  insertAt,
  spliceArg,
  spliceOut,
} from '@amk/tokens/edits';
import type { Fix, FixRequest, ScannedText } from './fixes';
import { makeFix } from './fix-text';

/**
 * What may stand between a note and the `$DD` moved in front of it. Each emits a byte of its own
 * or none, and none of them is structure, a note, or parse state the `$DD`'s own note target reads.
 */
const MOVABLE_ACROSS = new Set([
  'comment',
  'hex',
  'hexArg',
  'number',
  'hexNumber',
  'volume',
  'globalVolume',
  'pan',
  'tempo',
  'quantize',
  'instrument',
  'transpose',
  'vibrato',
  'noise',
]);

/** The scanned command the diagnostic's span is exactly. */
function commandOf(song: ScannedText, request: FixRequest): Command | null {
  const { span } = request.diagnostic;
  return (
    song.index.commands.find(
      (command) => command.span.start === span.start && command.span.end === span.end,
    ) ?? null
  );
}

/** SST0506: the `$F7` and its arguments, which run nothing but a jump to `$0000`. */
function deadCommand(request: FixRequest): Fix[] {
  const song = request.context.live;
  const command = commandOf(song, request);
  if (command?.vcmd !== VCMD.WriteByte || !commandRewritable(command)) {
    return [];
  }

  return [
    makeFix(song.text, $localize`:@@output.fix.remove-f7:output.fix.remove-f7`, [
      spliceOut(song.text, command.span),
    ]),
  ];
}

/** SST0507 (blocked): the `$DD`, its note target with it, moved to directly after the note. */
function strandedBend(request: FixRequest): Fix[] {
  const song = request.context.live;
  const command = commandOf(song, request);
  if (command?.vcmd !== VCMD.PitchBend || !commandRewritable(command)) {
    return [];
  }

  const anchor = bendAnchor(command, song.index);
  if (anchor.kind !== 'blocked' || command.noteTarget?.replacement !== undefined) {
    return [];
  }

  const between = song.index.tokens.filter(
    (token) => token.start >= anchor.note.end && token.end <= command.span.start,
  );
  if (!between.every((token) => MOVABLE_ACROSS.has(token.kind))) {
    return [];
  }

  const moved = { ...command.span, end: command.noteTarget?.span.end ?? command.span.end };
  return [
    makeFix(song.text, $localize`:@@output.fix.move-bend:output.fix.move-bend`, [
      insertAt(anchor.note.end, ` ${song.text.slice(moved.start, moved.end)}`),
      spliceOut(song.text, moved),
    ]),
  ];
}

/**
 * The feedback nearest `feedback` on its own side of zero, and below it, that fades through
 * `taps`; 0 always does.
 */
function fadingFeedback(taps: FirTaps, feedback: number): number {
  const signed = signedByte(feedback);
  for (let size = Math.abs(signed) - 1; size > 0; size--) {
    const byte = signed < 0 ? (256 - size) & 0xff : size;
    if (!echoStability(taps, byte).runaway) {
      return byte;
    }
  }

  return 0;
}

/** SST0500, SST0501: the governing `$F1`'s feedback lowered until this filter fades. */
function runawayEcho(request: FixRequest): Fix[] {
  const song = request.context.live;
  const command = commandOf(song, request);
  if (command === null) {
    return [];
  }

  let delay: Command | null;
  let taps: FirTaps | null;
  if (command.vcmd === VCMD.EchoDelay && command.args.length >= 3) {
    delay = command;
    taps = builtInTaps(command.args[2].value);
  } else if (command.vcmd === VCMD.Fir && command.args.length >= FIR_TAPS) {
    delay = echoDelayBefore(command, song.index.commands);
    taps = command.args.slice(0, FIR_TAPS).map((arg) => signedByte(arg.value));
  } else {
    return [];
  }

  if (delay === null || taps === null || !argEditable(delay, 1)) {
    return [];
  }

  const feedback = delay.args[1].value;
  const lowered = fadingFeedback(taps, feedback);
  const from = `$${hex2(feedback)}`;
  const to = `$${hex2(lowered)}`;
  return [
    makeFix(
      song.text,
      $localize`:@@output.fix.lower-feedback:output.fix.lower-feedback ${from}:from: ${to}:to:`,
      [spliceArg(song.text, delay, 1, argumentText(delay, lowered))],
    ),
  ];
}

export const hazardFixes = {
  codes: new Set(['SST0500', 'SST0501', 'SST0506', 'SST0507']),
  fixes(request: FixRequest): readonly Fix[] {
    switch (request.diagnostic.code) {
      case 'SST0506':
        return deadCommand(request);
      case 'SST0507':
        return strandedBend(request);
      default:
        return runawayEcho(request);
    }
  },
};
