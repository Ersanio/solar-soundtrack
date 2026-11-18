/**
 * SST0502's two fixes, for a song that ends before some of its channels do: Pad lengthens every
 * channel that ends early, so all of it is heard, and Trim cuts what can never be heard, so the
 * song keeps its length.
 *
 * The song is as long as its shortest channel, because the driver reloads all eight track
 * pointers the moment one voice reads its `$00` (`main.asm:L_0C01`, `Music.cpp:3209`).
 */

import { spellDuration, spellRest } from '@amk/core/mml-text';
import type { NoteAddress } from '@amk/core/types';
import { commandStartingAt } from '@amk/tokens';
import { type Edit, insertAt, spliceOut, spliceRange } from '@amk/tokens/edits';
import { channelMarkers, channelTails } from '../../../editor/views/piano-roll/roll-strip';
import { spliceUnit } from '../../../editor/views/piano-roll/roll-write/splice';
import type { CompiledSong, Fix, FixRequest } from './fixes';
import { eolOf, makeFix, textOf } from './fix-text';

/** Tokens that make a channel's text something other than one run of notes in playing order. */
const NOT_A_RUN = new Set(['loopStart', 'loopEnd', 'loopCall', 'label', 'remote', 'replacement']);

/** The song's channel lengths, or `null` where a written length is not the length it plays for. */
function lengthsOf(song: CompiledSong): { ticks: readonly number[]; version: number } | null {
  const stats = song.result.stats;
  if (!stats || song.timeline === null) {
    return null;
  }

  // `divideByTempoRatio` (`parser.ts:691`) does nothing below `#amk 4`.
  const ratio = stats.targetAMKVersion >= 4 ? stats.tempoRatio : 1;
  if (ratio !== 1) {
    return null;
  }

  const used = song.timeline.used;
  return {
    ticks: stats.channelTicks.map((ticks, channel) => (used[channel] ? ticks : 0)),
    version: stats.targetAMKVersion,
  };
}

/** Pad: a rest on the end of each channel that ends early, as `padChannels` writes one. */
function pad(song: CompiledSong): Fix[] {
  const lengths = lengthsOf(song);
  if (lengths === null) {
    return [];
  }

  const longest = Math.max(...lengths.ticks);
  const tails = channelTails(song.text, song.index, lengths.ticks, song.result.noteMap ?? []);
  const edits: (Edit | null)[] = [];
  for (const [channel, ticks] of lengths.ticks.entries()) {
    if (ticks <= 0 || ticks >= longest) {
      continue;
    }

    // A channel already ending on a rest has that rest lengthened rather than a second beside it.
    const tail = tails[channel];
    const rest = spellRest(longest - ticks + (tail.rest?.ticks ?? 0), lengths.version);
    if (rest === null) {
      return [];
    }

    edits.push(
      tail.rest
        ? spliceUnit(song.text, tail.rest.span, `r${rest}`)
        : insertAt(tail.at, `${eolOf(song.text)}r${rest}`),
    );
  }

  return [
    makeFix(
      song.text,
      $localize`:@@output.fix.pad:output.fix.pad`,
      edits,
      'pad',
      $localize`:@@output.fix.label.pad:output.fix.label.pad`,
    ),
  ];
}

/** Where a channel's text is, block by block. */
function blocksOf(song: CompiledSong, channel: number): { start: number; end: number }[] {
  const markers = channelMarkers(song.index, song.text);
  return markers.flatMap((marker, i) =>
    marker.channel === channel
      ? [{ start: marker.start, end: markers[i + 1]?.start ?? song.text.length }]
      : [],
  );
}

/**
 * The edits that end `channel` at `end` ticks: a note across that tick shortened to it, and
 * everything from the first note after it to the channel's last taken out. `null` where the
 * channel is not one run of notes in playing order, so no offset in its text is a tick.
 */
function cutAt(song: CompiledSong, channel: number, end: number, version: number): Edit[] | null {
  const blocks = blocksOf(song, channel);
  const inside = (offset: number) =>
    blocks.some((block) => offset >= block.start && offset < block.end);
  const unplain = song.index.tokens.some(
    (token) =>
      inside(token.start) &&
      (NOT_A_RUN.has(token.kind) ||
        (token.kind === 'operator' && /[{}]/.test(textOf(song.text, token)))),
  );
  if (blocks.length !== 1 || unplain || song.index.ties.some((tie) => tie.channel === channel)) {
    return null;
  }

  const entries: NoteAddress[] = (song.result.noteMap ?? [])
    .filter((entry) => entry.channel === channel)
    .sort((a, b) => a.span.start - b.span.start);
  const edits: Edit[] = [];
  let tick = 0;
  for (const [i, entry] of entries.entries()) {
    if (tick >= end) {
      const last = entries[entries.length - 1];
      const cut = spliceOut(song.text, { ...entry.span, end: last.span.end });
      return cut === null ? edits : [...edits, cut];
    }

    if (tick + entry.ticks > end) {
      const shortened = shorten(song, entry, end - tick, version);
      if (shortened === null) {
        return null;
      }

      edits.push(shortened);
      if (i === entries.length - 1) {
        return edits;
      }
    }

    tick += entry.ticks;
  }

  return edits;
}

/** A note or rest rewritten to last `ticks`, its pitch left as written. */
function shorten(
  song: CompiledSong,
  entry: NoteAddress,
  ticks: number,
  version: number,
): Edit | null {
  const command = commandStartingAt(song.index.commands, entry.span.start);
  const first = command?.noteLength?.[0];
  const length = spellDuration(ticks, version);
  if (!command || !first || length === null || first.triplet) {
    return null;
  }

  const start = first.exact ? first.digits.start - 1 : first.digits.start;
  return spliceRange(song.text, { ...command.span, start }, length);
}

/** Trim: every channel that runs past the song's end, cut at it. */
function trim(song: CompiledSong): Fix[] {
  const lengths = lengthsOf(song);
  if (lengths === null) {
    return [];
  }

  const playing = lengths.ticks.filter((ticks) => ticks > 0);
  const shortest = Math.min(...playing);
  if (playing.length < 2 || shortest <= 0) {
    return [];
  }

  const edits: Edit[] = [];
  for (const [channel, ticks] of lengths.ticks.entries()) {
    if (ticks <= shortest) {
      continue;
    }

    const cut = cutAt(song, channel, shortest, lengths.version);
    if (cut === null) {
      return [];
    }

    edits.push(...cut);
  }

  return [
    makeFix(
      song.text,
      $localize`:@@output.fix.trim:output.fix.trim`,
      edits,
      'trim',
      $localize`:@@output.fix.label.trim:output.fix.label.trim`,
    ),
  ];
}

export const lengthFixes = {
  codes: new Set(['SST0502']),
  fixes({ context }: FixRequest): readonly Fix[] {
    const song = context.compiled;
    return song === null ? [] : [...pad(song), ...trim(song)];
  },
};
