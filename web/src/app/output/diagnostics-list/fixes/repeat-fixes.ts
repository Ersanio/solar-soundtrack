/**
 * Fixes for a setting that carries into the song's repeat (`SST0510`-`SST0512`): the first
 * pass's setting written again where the loop starts, the remote code reset the message names
 * written there, or a toggle switched back at the end of the song.
 */

import { insertAt, padAround } from '@amk/tokens/edits';
import { channelHome, channelMarkers } from '../../../editor/views/piano-roll/roll-strip';
import {
  type RepeatFinding,
  repeatSettingFindings,
  repeatTempoFindings,
} from '../../../state/repeat-carry';
import type { CompiledSong, Fix, FixRequest } from './fixes';
import { eolOf, makeFix, textOf } from './fix-text';

/** The intro `/` on `channel`, or the offset before its first note or rest; `null` for neither. */
function loopStartOf(song: CompiledSong, channel: number): number | null {
  const markers = channelMarkers(song.index, song.text);
  const blocks = markers.flatMap((marker, i) =>
    marker.channel === channel
      ? [{ start: marker.start, end: markers[i + 1]?.start ?? song.text.length }]
      : [],
  );
  const inside = (offset: number) => blocks.some((b) => offset >= b.start && offset < b.end);
  const slashes = song.index.tokens.filter(
    (token) => token.kind === 'operator' && textOf(song.text, token) === '/' && inside(token.start),
  );
  if (slashes.length > 1) {
    return null;
  }

  if (slashes.length === 1) {
    return slashes[0].end;
  }

  const note = song.index.commands.find(
    (command) =>
      command.channel === channel &&
      command.noteLength !== undefined &&
      !command.inRemoteDefinition &&
      inside(command.span.start),
  );
  return note === undefined ? null : note.span.start;
}

/** `text` written at `offset` as a token of its own. */
function writeAt(song: CompiledSong, offset: number, text: string) {
  const { before, after } = padAround(song.text, offset);
  return insertAt(offset, `${before}${text}${after}`);
}

/** Channels that play, lowest first, with how long each is. */
function playing(song: CompiledSong): { channel: number; ticks: number }[] {
  const ticks = song.result.stats?.channelTicks ?? [];
  const used = song.timeline?.used ?? [];
  return ticks.flatMap((each, channel) =>
    used[channel] && each > 0 ? [{ channel, ticks: each }] : [],
  );
}

/**
 * The channel whose end the song ends on: the lowest of the shortest, since on that tick the
 * voices run in order and the first `$00` ends the phrase (`main.asm:L_0C01`).
 */
function endingChannel(song: CompiledSong): number | null {
  const channels = playing(song);
  const shortest = Math.min(...channels.map((each) => each.ticks));
  return channels.find((each) => each.ticks === shortest)?.channel ?? null;
}

function fixFor(song: CompiledSong, finding: RepeatFinding): Fix[] {
  if (finding.toggle) {
    const channel = endingChannel(song);
    if (channel === null || (finding.channel !== null && finding.channel !== channel)) {
      return [];
    }

    const { at } = channelHome(song.text, channel, channelMarkers(song.index, song.text));
    return [
      makeFix(
        song.text,
        $localize`:@@output.fix.repeat-toggle:output.fix.repeat-toggle ${finding.repeat}:command:`,
        [insertAt(at, `${eolOf(song.text)}${finding.repeat}`)],
      ),
    ];
  }

  const text = finding.reset ?? finding.first;
  const channel = finding.channel ?? playing(song)[0]?.channel;
  const at = text === null || channel === undefined ? null : loopStartOf(song, channel);
  if (text === null || at === null) {
    return [];
  }

  const summary =
    finding.reset === null
      ? $localize`:@@output.fix.repeat-again:output.fix.repeat-again ${text}:command:`
      : $localize`:@@output.fix.repeat-reset:output.fix.repeat-reset ${text}:reset:`;
  return [makeFix(song.text, summary, [writeAt(song, at, text)])];
}

export const repeatFixes = {
  codes: new Set(['SST0510', 'SST0511', 'SST0512']),
  fixes({ diagnostic, context }: FixRequest): readonly Fix[] {
    const song = context.compiled;
    if (song?.timeline == null) {
      return [];
    }

    const stats = song.result.stats;
    const ratio = stats && stats.targetAMKVersion >= 4 ? stats.tempoRatio : 1;
    const findings =
      diagnostic.code === 'SST0510'
        ? repeatTempoFindings(song.timeline, song.result.commandMap ?? [], song.text, ratio)
        : repeatSettingFindings(song.timeline, { result: song.result, text: song.text });
    const finding = findings.find(
      (each) =>
        each.diagnostic.code === diagnostic.code &&
        each.diagnostic.span.start === diagnostic.span.start &&
        each.diagnostic.message === diagnostic.message,
    );
    return finding === undefined ? [] : fixFor(song, finding);
  },
};
