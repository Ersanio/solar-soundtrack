/**
 * Fixes to the bytes that compile clean and break the song: a runaway echo's feedback lowered, a
 * dead `$F7` deleted, a `$DD` moved back against the note it was written to ride on, and an
 * arpeggio's earlier loop points deleted, and the ones it ends in.
 */

import { VCMD } from '@amk/core/hardcoded-tables';
import { hex2 } from '@amk/core/hex';
import { FIR_TAPS, type FirTaps, echoStability, signedByte } from '@amk/spc/fir';
import type { Command } from '@amk/tokens';
import { bendAnchor, deadLoopPoints, trailingLoopPoints } from '@amk/tokens/command-hazards';
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

/**
 * SST0507 (blocked): the `$DD`, its note target with it, moved to directly after the note — behind
 * any `$DD` already standing there, so a chain keeps its order.
 */
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

  const chain = song.index.commands.filter(
    (other) =>
      other.vcmd === VCMD.PitchBend &&
      other.channel === command.channel &&
      other.span.start >= anchor.note.end &&
      other.span.end <= anchor.by.span.start,
  );
  const at = chain[chain.length - 1]?.span.end ?? anchor.note.end;
  const between = song.index.tokens.filter(
    (token) => token.start >= at && token.end <= command.span.start,
  );
  if (!between.every((token) => MOVABLE_ACROSS.has(token.kind))) {
    return [];
  }

  const moved = { ...command.span, end: command.noteTarget?.span.end ?? command.span.end };
  return [
    makeFix(song.text, $localize`:@@output.fix.move-bend:output.fix.move-bend`, [
      insertAt(at, ` ${song.text.slice(moved.start, moved.end)}`),
      spliceOut(song.text, moved),
    ]),
  ];
}

/**
 * SST0517: every loop point before the last deleted and the count lowered to match. The driver
 * passes over those without taking a step, so the arpeggio plays the same steps.
 */
function deadLoopPointsFix(request: FixRequest): Fix[] {
  const song = request.context.live;
  const command = commandOf(song, request);
  if (command?.vcmd !== VCMD.Arpeggio || !commandRewritable(command)) {
    return [];
  }

  const dead = deadLoopPoints(command);
  const count = command.args[0]?.value;
  if (
    dead.length === 0 ||
    count !== command.args.length - 2 ||
    !argEditable(command, 0) ||
    !dead.every((entry) => argEditable(command, entry + 2))
  ) {
    return [];
  }

  return [
    makeFix(song.text, $localize`:@@output.fix.remove-loop-points:output.fix.remove-loop-points`, [
      spliceArg(song.text, command, 0, argumentText(command, count - dead.length)),
      ...dead.map((entry) => spliceOut(song.text, command.args[entry + 2].span)),
    ]),
  ];
}

/**
 * SST0519: the loop points the list ends in deleted and the count lowered to match, so the list
 * wraps to the loop point before them, or to its start. A list of nothing else is left with a count
 * of `$00` and its duration, which is Off as the inspector writes it.
 */
function loopPastEndFix(request: FixRequest): Fix[] {
  const song = request.context.live;
  const command = commandOf(song, request);
  if (command?.vcmd !== VCMD.Arpeggio || !commandRewritable(command)) {
    return [];
  }

  const trailing = trailingLoopPoints(command);
  const count = command.args[0]?.value;
  const dropped = command.args.slice(command.args.length - trailing);
  if (
    trailing === 0 ||
    count !== command.args.length - 2 ||
    !argEditable(command, 0) ||
    dropped.some((arg) => arg.replacement !== undefined)
  ) {
    return [];
  }

  const kept = count - trailing;
  const summary =
    kept === 0
      ? $localize`:@@output.fix.arpeggio-off:output.fix.arpeggio-off`
      : trailing === 1
        ? $localize`:@@output.fix.trailing-loop-points.one:output.fix.trailing-loop-points.one`
        : $localize`:@@output.fix.trailing-loop-points.other:output.fix.trailing-loop-points.other ${trailing}:count:`;
  return [
    makeFix(song.text, summary, [
      spliceArg(song.text, command, 0, argumentText(command, kept)),
      ...dropped.map((arg) => spliceOut(song.text, arg.span)),
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
  codes: new Set(['SST0500', 'SST0501', 'SST0506', 'SST0507', 'SST0517', 'SST0519']),
  fixes(request: FixRequest): readonly Fix[] {
    switch (request.diagnostic.code) {
      case 'SST0506':
        return deadCommand(request);
      case 'SST0507':
        return strandedBend(request);
      case 'SST0517':
        return deadLoopPointsFix(request);
      case 'SST0519':
        return loopPastEndFix(request);
      default:
        return runawayEcho(request);
    }
  },
};
