/**
 * `SST0510` and `SST0511` — a looping song whose repeat starts its loop under a
 * different tempo, or a channel's under a different setting, from its first pass.
 *
 * The driver sets these only when a song starts (`PlaySong`, `main.asm:2082-2206`),
 * so whatever a pass ends on carries into the repetition. Each is judged where
 * the loop starts: at its first note or rest, after any command written ahead
 * of it. The walk says which settings differ (`SongTimeline.carries`); this
 * names them. The tempo is here rather than beside `unreachableChannels` in
 * `@amk/spc` because the tempo a song starts at is `@amk/tokens`'
 * `DEFAULT_TEMPO`, which that package may not reach.
 */

import { FIRST_PERCUSSION_INSTRUMENT } from '@amk/core/hardcoded-tables';
import { hex2 } from '@amk/core/hex';
import { SST } from '@amk/core/messages/sst';
import type { CommandAddress, CompileResult, Diagnostic, Span } from '@amk/core/types';
import type { SettingCarry, SettingCommand } from '@amk/spc/repeat-settings';
import type { SongTimeline } from '@amk/spc/song-walk';
import { type Command, type TokenIndex, commandStartingAt, tokenize } from '@amk/tokens';
import { parseTimeInForce } from '@amk/tokens/commands/in-force';
import { DEFAULT_TEMPO, tempoName } from '@amk/tokens/commands/units';

const NOWHERE: Span = { start: 0, end: 0, line: 1 };

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
  if (loop === null || carried === null || timeline.truncated || loop >= timeline.ticks) {
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

  const span = commandMap.find((command) => command.address === carried.address)?.span;
  return [
    {
      severity: 'severe',
      code: 'SST0510',
      message: SST['0510'](tempoName(first), tempoName(again)),
      span: span ?? NOWHERE,
    },
  ];
}

/** A compile and the text it was compiled from, which its spans index. */
export interface CompiledSong {
  result: CompileResult;
  text: string;
}

/** `$E5 $00 $10 $40`, for a command no map names. */
const hexSpelling = (bytes: readonly number[]): string =>
  bytes.map((byte) => `$${hex2(byte)}`).join(' ');

/**
 * `SST0511`: each setting in {@link SongTimeline.carries}, named as it was
 * written and underlined where it was.
 */
export function repeatSettings(timeline: SongTimeline, compiled: CompiledSong): Diagnostic[] {
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
        text: span === null ? hexSpelling(command.bytes) : text.slice(span.start, span.end),
      };
    }

    // A `q` byte or a drum, which the compiler folded into a note: the `q` or
    // `@21`-`@29` in force at that note is what was written.
    const [byte] = command.bytes;
    const isQ = byte < 0x80;
    const fallback = isQ ? `q${hex2(byte)}` : `@${FIRST_PERCUSSION_INSTRUMENT + byte - 0xd0}`;
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

  return timeline.carries.map((carry: SettingCarry): Diagnostic => {
    const repeat = written(carry.repeat);
    const first = carry.first === null ? null : written(carry.first).text;
    const { channel } = carry;
    const message = carry.repeat.toggle
      ? SST['0511.toggle'](repeat.text, channel)
      : first === null
        ? SST['0511.default'](repeat.text, channel)
        : SST['0511'](repeat.text, channel, first);

    return { severity: 'severe', code: 'SST0511', message, span: repeat.span ?? NOWHERE };
  });
}
