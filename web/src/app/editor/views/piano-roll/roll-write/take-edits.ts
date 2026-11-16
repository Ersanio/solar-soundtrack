/** A recorded take written out: each channel's notes spliced in against a reading of its own, and the whole of it handed back as one edit. */

import type { CompileResult } from '@amk/core/types';
import { type SongTimeline, walkSong } from '@amk/spc/song-walk';
import { type Command, type TokenIndex, tokenize } from '@amk/tokens';
import { type Edit, spliceRange } from '@amk/tokens/edits';
import { commandsInForceOf } from '../../../../state/commands-in-force';
import {
  type EditContext,
  type EditMode,
  type Refusal,
  type TakeNote,
  isEdits,
  planGesture,
} from '../roll-edit';
import { channelStrip, channelTails, isStrip } from '../roll-strip';
import { loopWalls, onWall } from '../roll-take';
import { planEdits } from './plan-edits';
import { refuse } from './splice';

export const REFUSE_TAKE = $localize`:@@roll.that-take-could-not-be:roll.that-take-could-not-be`;

/** One text compiled, walked and scanned: everything a strip is built against. */
export interface SongReading {
  source: string;
  result: CompileResult;
  timeline: SongTimeline;
  /** The one scan of `source`; `inForce` answers with its `Command` objects. */
  index: TokenIndex;
  inForce: (address: number) => readonly Command[] | null;
}

/** A text read, or `null` where it does not compile. */
export type ReadSong = (source: string) => SongReading | null;

/** A compile of `source` as a {@link SongReading}, or `null` where it produced no song. */
export function songReading(
  source: string,
  result: CompileResult | null,
  aramAddress: number,
): SongReading | null {
  if (!result?.ok || !result.data) {
    return null;
  }

  const timeline = walkSong(result.data, aramAddress);
  const index = tokenize(source);
  const acting = commandsInForceOf({
    index,
    text: source,
    commands: new Map((result.commandMap ?? []).map((entry) => [entry.address, entry])),
    notes: new Map((result.noteMap ?? []).map((entry) => [entry.address, entry])),
  });
  const walked = new Map(timeline.notes.map((note) => [note.address, note]));

  return {
    source,
    result,
    timeline,
    index,
    inForce: (address) => {
      const note = walked.get(address);
      return note === undefined ? null : acting(note);
    },
  };
}

/** One channel's share of a take. */
export interface ChannelTake {
  channel: number;
  notes: readonly TakeNote[];
}

/** One channel's notes as splices into the text `reading` was made of. */
function channelEdits(
  reading: SongReading,
  take: ChannelTake,
  mode: EditMode,
): { edits: Edit[]; dropped: number } | Refusal {
  const { source, result, timeline, index } = reading;
  const strip = channelStrip({
    source,
    channel: take.channel,
    noteMap: result.noteMap ?? [],
    commandMap: result.commandMap ?? [],
    timeline,
    index,
    tempoRatio: result.stats?.tempoRatio ?? 1,
  });
  if (!isStrip(strip)) {
    return strip;
  }

  const walls = loopWalls(strip);
  const notes = take.notes.filter((note) => !onWall(note, walls));
  const dropped = take.notes.length - notes.length;
  if (notes.length === 0) {
    return { edits: [], dropped };
  }

  const stats = result.stats;
  const frame = strip.frames[0];
  const context: EditContext = {
    source,
    strip,
    targetAMKVersion: stats?.targetAMKVersion ?? 4,
    songTargetProgram: stats?.songTargetProgram ?? 0,
    playableTicks: stats ? stats.introTicks + stats.loopTicks : 0,
    introTicks: stats?.hasIntro === true ? stats.introTicks : null,
    channels: channelTails(source, index, stats?.channelTicks ?? [], result.noteMap ?? []),
    frame,
    inForce: reading.inForce,
  };

  const edits = planEdits(context, planGesture(strip, { kind: 'take', notes }, mode, frame));
  return isEdits(edits) ? { edits, dropped } : edits;
}

/** Sorted, non-overlapping splices applied to the text they were made for. */
function applied(source: string, edits: readonly Edit[]): string {
  let text = source;
  for (const edit of [...edits].sort((a, b) => b.span.start - a.span.start)) {
    text = text.slice(0, edit.span.start) + edit.text + text.slice(edit.span.end);
  }

  return text;
}

/** Everything between the first and the last character that differs, as one splice. */
function difference(before: string, after: string): Edit | null {
  let start = 0;
  const shared = Math.min(before.length, after.length);
  while (start < shared && before[start] === after[start]) {
    start++;
  }

  let tail = 0;
  while (
    tail < shared - start &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }

  let line = 1;
  for (let at = 0; at < start; at++) {
    if (before[at] === '\n') {
      line++;
    }
  }

  return spliceRange(
    before,
    { start, end: before.length - tail, line },
    after.slice(start, after.length - tail),
  );
}

/**
 * A whole take as one edit, or the reason it cannot be written.
 *
 * The channels are written one at a time, lowest first, each against a fresh
 * reading of the text the one before it left. So every step is one channel's
 * gesture on a song that compiles — padding the other channels out to a note
 * past the end, or opening a channel the song has not declared, is `planEdits`'
 * own work, done once per channel with nothing for two channels to disagree
 * about. One channel refusing refuses the take.
 *
 * `dropped` counts the notes that landed on a loop and were left out.
 */
export function takeEdits(
  source: string,
  takes: readonly ChannelTake[],
  mode: EditMode,
  read: ReadSong,
): { edit: Edit | null; dropped: number } | Refusal {
  let text = source;
  let dropped = 0;
  for (const take of [...takes].sort((a, b) => a.channel - b.channel)) {
    if (take.notes.length === 0) {
      continue;
    }

    const reading = read(text);
    if (reading === null) {
      return refuse(REFUSE_TAKE);
    }

    const written = channelEdits(reading, take, mode);
    if ('refused' in written) {
      return written;
    }

    text = applied(text, written.edits);
    dropped += written.dropped;
  }

  return { edit: difference(source, text), dropped };
}
