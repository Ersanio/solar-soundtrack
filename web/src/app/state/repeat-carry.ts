/**
 * `SST0510`-`SST0512` — a looping song whose repeat starts its loop under a
 * different tempo, channel setting or song setting from its first pass.
 *
 * The driver sets these only when a song starts (`PlaySong`, `main.asm:2082-2206`),
 * so whatever a pass ends on carries into the repetition. Each is judged where
 * the loop starts: at its first note or rest, after any command written ahead
 * of it. The walk says which settings differ (`SongTimeline.carries`); this
 * names them. The tempo is here rather than beside `unreachableChannels` in
 * `@amk/spc` because the tempo a song starts at is `@amk/tokens`'
 * `DEFAULT_TEMPO`, which that package may not reach.
 */

import {
  FIRST_PERCUSSION_INSTRUMENT,
  FIRST_PERCUSSION_NOTE,
  VCMD,
} from '@amk/core/hardcoded-tables';
import { hex2, hexBytes } from '@amk/core/hex';
import { SST } from '@amk/core/messages/sst';
import type { CommandAddress, CompileResult, Diagnostic, Span } from '@amk/core/types';
import type { SettingCarry, SettingCommand } from '@amk/spc/repeat-settings';
import type { SongTimeline, TempoChange } from '@amk/spc/song-walk';
import { type Command, type TokenIndex, commandStartingAt, tokenize } from '@amk/tokens';
import { parseTimeInForce } from '@amk/tokens/commands/in-force';
import { DEFAULT_TEMPO, tempoName } from '@amk/tokens/commands/units';

const NOWHERE: Span = { start: 0, end: 0, line: 1 };

/** One carry-over, with what a fix needs to write the first pass's setting back. */
export interface RepeatFinding {
  diagnostic: Diagnostic;
  /** The channel the setting is kept for, or `null` for one the whole song shares. */
  channel: number | null;
  /**
   * The first pass's setting as written, or `null` where the loop starts under the song's own
   * start value. For the tempo, what to write: the `t` or `$E2` as written, or `t` and the byte
   * where a `t` is not divided on its way in, and `null` where neither will do.
   */
  first: string | null;
  /** The command the pass ends on, as written. */
  repeat: string;
  /** It flips the setting, so writing it again switches it back. */
  toggle: boolean;
  /** The remote code reset the message names, where it names one. */
  reset: string | null;
}

/**
 * {@link repeatTempoFindings}' diagnostic, which is all the editor's list needs.
 */
export function repeatTempo(
  timeline: SongTimeline,
  commandMap: readonly CommandAddress[],
): Diagnostic[] {
  return repeatTempoFindings(timeline, commandMap, null).map((finding) => finding.diagnostic);
}

/**
 * Compares the tempo at the loop's first note or rest on the first pass with
 * the one there on a repeat, which starts at {@link SongTimeline.tempoAtEnd} and
 * runs only the tempo changes marked `repeats`. A `$E3` counts as its target.
 *
 * `text` is what `commandMap`'s spans index, for {@link RepeatFinding.first}; without it that is
 * `null`. `tempoRatio` is what a written `t` is divided by (`parser.ts:691`), so a byte can be
 * written back as a `t` only at 1.
 */
export function repeatTempoFindings(
  timeline: SongTimeline,
  commandMap: readonly CommandAddress[],
  text: string | null,
  tempoRatio = 1,
): RepeatFinding[] {
  const loop = timeline.loopTick;
  const carried = timeline.tempoAtEnd;
  if (loop === null || carried === null || timeline.truncated || loop >= timeline.ticks) {
    return [];
  }

  // `null` is the tempo the driver boots at, until the song sets one.
  let first: TempoChange | null = null;
  let again = carried.tempo;
  for (const change of timeline.tempoChanges) {
    if (change.tick > loop) {
      break;
    }

    first = change;
    if (change.repeats) {
      again = change.tempo;
    }
  }

  const tempo = first?.tempo ?? null;
  if ((tempo ?? DEFAULT_TEMPO) === again) {
    return [];
  }

  const spanOf = (address: number) =>
    commandMap.find((command) => command.address === address)?.span;
  const span = spanOf(carried.address);
  const written = first?.fadeTicks === 0 ? spanOf(first.address) : undefined;
  return [
    {
      diagnostic: {
        severity: 'severe',
        code: 'SST0510',
        message: SST['0510'](tempoName(tempo), tempoName(again)),
        span: span ?? NOWHERE,
      },
      channel: null,
      first:
        text === null
          ? null
          : written
            ? text.slice(written.start, written.end)
            : tempoRatio === 1
              ? `t${tempo ?? DEFAULT_TEMPO}`
              : null,
      repeat: text !== null && span ? text.slice(span.start, span.end) : `t${again}`,
      toggle: false,
      reset: null,
    },
  ];
}

/** A compile and the text it was compiled from, which its spans index. */
export interface CompiledSong {
  result: CompileResult;
  text: string;
}

/** Remote code's types 1, 2 and 5, which count down through rests. */
const COUNTING_TYPES: ReadonlySet<number> = new Set([1, 2, 5]);

/**
 * The remote code wording for a call the first pass does not have at the loop
 * start, and the reset it names, or `null` where the generic one stands: another
 * call in the first pass, or a song below `#amk 2`, which has no remote code syntax.
 */
function remoteMessage(
  carry: SettingCarry,
  command: string,
  channel: number,
  amkVersion: number,
): { message: string; reset: string } | null {
  const [lead, , , type] = carry.repeat.bytes;
  if (carry.first !== null || amkVersion < 2 || lead !== VCMD.RemoteCode || type === undefined) {
    return null;
  }

  // `(!!n)` from `#amk 3` (`parser.ts:2302-2323`): -1 cancels the key-on slot and
  // any other non-zero number the other one.
  const keyOn = carry.setting === 'remoteKeyOn';
  const reset =
    amkVersion >= 3 ? (keyOn ? '(!!-1)' : `(!!${type})`) : keyOn ? '(!0, 8)' : '(!0, 7)';
  const keyOff = carry.onRest ? SST['0511.remote.key-off-rest'] : SST['0511.remote.key-off'];
  const message = keyOn
    ? type === 0xff
      ? SST['0511.remote.key-on'](command, channel, reset)
      : type === 6
        ? keyOff(command, channel, reset)
        : null
    : COUNTING_TYPES.has(type)
      ? SST['0511.remote.timed'](command, channel, reset)
      : type === 3
        ? keyOff(command, channel, reset)
        : null;
  return message === null ? null : { message, reset };
}

/**
 * `SST0511` and `SST0512`: {@link repeatSettingFindings}' diagnostics, which is all the editor's
 * list needs.
 */
export function repeatSettings(timeline: SongTimeline, compiled: CompiledSong): Diagnostic[] {
  return repeatSettingFindings(timeline, compiled).map((finding) => finding.diagnostic);
}

/**
 * Each setting in {@link SongTimeline.carries}, named as it was written and
 * underlined where it was. Remote code names the reset that cancels it.
 */
export function repeatSettingFindings(
  timeline: SongTimeline,
  compiled: CompiledSong,
): RepeatFinding[] {
  if (timeline.carries.length === 0) {
    return [];
  }

  const { result, text } = compiled;
  const commands = new Map((result.commandMap ?? []).map((entry) => [entry.address, entry.span]));
  const notes = new Map((result.noteMap ?? []).map((entry) => [entry.address, entry.span]));

  // Only a `q` or a drum needs the source scanned, so it is scanned only then.
  let scanned: { index: TokenIndex; folded: ReadonlyMap<Command, readonly Command[]> } | null =
    null;
  const scan = () => {
    if (scanned === null) {
      const index = tokenize(text);
      scanned = { index, folded: parseTimeInForce(index, text) };
    }

    return scanned;
  };

  /** Where a command was written, and its text there. */
  const written = (command: SettingCommand): { span: Span | null; text: string } => {
    if (!command.onNote) {
      const span = commands.get(command.address) ?? null;
      return {
        span,
        text: span === null ? hexBytes(command.bytes) : text.slice(span.start, span.end),
      };
    }

    // A `q` byte or a drum, which the compiler folded into a note: the `q` or
    // `@21`-`@29` in force at that note is what was written.
    const [byte] = command.bytes;
    const isQ = byte < 0x80;
    const fallback = isQ
      ? `q${hex2(byte)}`
      : `@${FIRST_PERCUSSION_INSTRUMENT + byte - FIRST_PERCUSSION_NOTE}`;
    const note = notes.get(command.address) ?? null;
    if (note === null) {
      return { span: null, text: fallback };
    }

    const { index, folded } = scan();
    const own = commandStartingAt(index.commands, note.start);
    const source = (own === null ? undefined : folded.get(own))?.find(
      (each) => each.kind.toLowerCase() === (isQ ? 'q' : '@'),
    );
    return source === undefined
      ? { span: note, text: fallback }
      : { span: source.span, text: text.slice(source.span.start, source.span.end) };
  };

  return timeline.carries.map((carry: SettingCarry): RepeatFinding => {
    const repeat = written(carry.repeat);
    const first = carry.first === null ? null : written(carry.first).text;
    const { channel } = carry;
    const toggle = carry.repeat.toggle;
    let code: string;
    let message: string;
    let reset: string | null = null;
    if (channel !== null) {
      code = 'SST0511';
      const remote = toggle
        ? null
        : remoteMessage(carry, repeat.text, channel, result.stats?.targetAMKVersion ?? 0);
      reset = remote?.reset ?? null;
      message = toggle
        ? SST['0511.toggle'](repeat.text, channel)
        : (remote?.message ??
          (first === null
            ? SST['0511.default'](repeat.text, channel)
            : SST['0511'](repeat.text, channel, first)));
    } else {
      code = 'SST0512';
      message = toggle
        ? SST['0512.toggle'](repeat.text)
        : first === null
          ? SST['0512.default'](repeat.text)
          : SST['0512'](repeat.text, first);
    }

    return {
      diagnostic: { severity: 'severe', code, message, span: repeat.span ?? NOWHERE },
      channel,
      first,
      repeat: repeat.text,
      toggle,
      reset,
    };
  });
}
