/**
 * `SST0510`-`SST0512` — a looping song whose repeat starts its loop at a
 * different tempo, or a channel's at a different fine tune or tremolo, from its
 * first pass.
 *
 * The driver sets the tempo (`main.asm:2187`) and each channel's fine tune and
 * tremolo (`main.asm:2142-2146`) only when a song starts, so whatever a pass ends
 * on carries into the repetition. Each is judged where the loop starts: at its
 * first note or rest, after any command written ahead of it. Here rather than
 * beside `unreachableChannels` in `@amk/spc`, because the tempo a song starts at
 * is `@amk/tokens`' `DEFAULT_TEMPO`, which that package may not reach.
 */

import { hex2 } from '@amk/core/hex';
import { SST } from '@amk/core/messages/sst';
import type { CommandAddress, Diagnostic, Span } from '@amk/core/types';
import type { CarriedSetting, SettingCommand, SongTimeline } from '@amk/spc/song-walk';
import { DEFAULT_TEMPO, tempoName } from '@amk/tokens/commands/units';

/** Whether the song has a loop for anything to carry into. */
function repeats(timeline: SongTimeline): boolean {
  const loop = timeline.loopTick;
  return loop !== null && !timeline.truncated && loop < timeline.ticks;
}

function spanOf(commandMap: readonly CommandAddress[], address: number): Span {
  const span = commandMap.find((command) => command.address === address)?.span;
  return span ?? { start: 0, end: 0, line: 1 };
}

/** A command as written in hex, `$E5 $00 $10 $40`. */
const spelling = (vcmd: number, operands: readonly number[]): string =>
  [vcmd, ...operands].map((byte) => `$${hex2(byte)}`).join(' ');

/**
 * Compares the tempo at the loop's first note or rest on the first pass with
 * the one there on a repeat, which starts at {@link SongTimeline.tempoAtEnd} and
 * runs only the tempo changes marked `repeats`. A `$E3` counts as its target.
 */
export function repeatTempo(
  timeline: SongTimeline,
  commandMap: readonly CommandAddress[],
): Diagnostic[] {
  const loop = timeline.loopTick;
  const carried = timeline.tempoAtEnd;
  if (loop === null || carried === null || !repeats(timeline)) {
    return [];
  }

  // `null` is the tempo the driver boots at, until the song sets one.
  let first: number | null = null;
  let again = carried.tempo;
  for (const change of timeline.tempoChanges) {
    if (change.tick > loop) {
      break;
    }

    first = change.tempo;
    if (change.repeats) {
      again = change.tempo;
    }
  }

  if ((first ?? DEFAULT_TEMPO) === again) {
    return [];
  }

  return [
    {
      severity: 'severe',
      code: 'SST0510',
      message: SST['0510'](tempoName(first), tempoName(again)),
      span: spanOf(commandMap, carried.address),
    },
  ];
}

/** A channel whose repeat starts its loop under a different setting from its first pass. */
interface Carry {
  channel: number;
  /** In force at the loop's first note or rest on the first pass; `null` for the song's start. */
  first: SettingCommand | null;
  /** In force there on the repeat — the command that carried over. */
  again: SettingCommand;
}

/**
 * The same comparison per channel, for a setting that reaches no other channel.
 * A repeat starts under the command the channel ended on, unless one is written
 * after the loop point and before its first note or rest. `value` is what the
 * driver acts on, so two spellings of one setting compare equal.
 */
function carries(
  timeline: SongTimeline,
  setting: CarriedSetting,
  value: (command: SettingCommand | null) => string,
): Carry[] {
  if (!repeats(timeline)) {
    return [];
  }

  return timeline.loopSettings.flatMap((loop, channel): Carry[] => {
    if (loop === null) {
      return [];
    }

    const { first, carried } = loop[setting];
    const again = first?.repeats ? first : carried;
    return again === null || value(first) === value(again) ? [] : [{ channel, first, again }];
  });
}

const fineTuneOf = (command: SettingCommand | null): number => command?.operands[0] ?? 0;

/** `SST0511`: a channel's `$EE`. A song starts every channel at 0. */
export function repeatFineTune(
  timeline: SongTimeline,
  commandMap: readonly CommandAddress[],
): Diagnostic[] {
  const name = (command: SettingCommand | null) => spelling(0xee, [fineTuneOf(command)]);
  return carries(timeline, 'fineTune', (command) => `${fineTuneOf(command)}`).map(
    ({ channel, first, again }) => ({
      severity: 'severe',
      code: 'SST0511',
      message: SST['0511'](channel, name(first), name(again)),
      span: spanOf(commandMap, again.address),
    }),
  );
}

/** An `$E5` with a depth, or `null` for none: a song's start, `$FD` and a zero depth alike. */
const tremoloOf = (command: SettingCommand | null): SettingCommand | null =>
  command !== null && command.vcmd === 0xe5 && (command.operands[2] ?? 0) !== 0 ? command : null;

/** `SST0512`: a channel's `$E5`/`$FD`. A song starts every channel without tremolo. */
export function repeatTremolo(
  timeline: SongTimeline,
  commandMap: readonly CommandAddress[],
): Diagnostic[] {
  const value = (command: SettingCommand | null) =>
    tremoloOf(command)?.operands.join(',') ?? 'none';
  return carries(timeline, 'tremolo', value).map(({ channel, first, again }) => {
    const before = tremoloOf(first);
    const after = tremoloOf(again);
    let message: string;
    if (before === null) {
      message = SST['0512.on'](channel, spelling(again.vcmd, again.operands));
    } else if (after === null) {
      message = SST['0512.off'](channel, spelling(before.vcmd, before.operands));
    } else {
      message = SST['0512'](
        channel,
        spelling(before.vcmd, before.operands),
        spelling(after.vcmd, after.operands),
      );
    }

    return {
      severity: 'severe',
      code: 'SST0512',
      message,
      span: spanOf(commandMap, again.address),
    };
  });
}
