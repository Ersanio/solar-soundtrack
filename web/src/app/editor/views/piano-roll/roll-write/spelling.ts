/** How the roll spells what it writes: a note and its length, a channel's opening, the document's own line ending. */

import {
  octaveFor,
  parseWrittenPitch,
  spellDuration,
  spellNote,
  spellOctave,
  spellQ,
} from '@amk/core/mml-text';
import type { Command } from '@amk/tokens';
import type { PlacedNote } from '../roll-edit';
import type { StripItem } from '../roll-strip';

/** The document's own line ending, so a block written into it matches the rest. */
export function eol(source: string): string {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

/** The octave {@link channelOpening} writes, and so the one it leaves in force. */
export const OPENING_OCTAVE = 4;

/** `q[channel]` before anything sets it (`parser.ts:215`). */
const OPENING_Q = 0x7f;

/**
 * The state a fresh channel runs under, written out, so that nothing it plays
 * depends on what the block above it happened to leave standing.
 *
 * `octave` is one variable and leaks past a `#N`, which does not reset it
 * (`parser.ts:parseHash`), so `o4` is what a channel runs at only while nothing
 * has moved it (`parser.ts:208`). `q` and `@` are per channel and start at `$7F`
 * and 0 (`parser.ts:215`, `:214`). `v` and `y` are not parse-time state at all:
 * the driver boots every voice at `$FF` volume and `$0A` pan, dead centre of
 * `y`'s 0 to 20 (`main.asm:2134-2138`). The octave is literal, having one
 * spelling on every target, and `q` goes through {@link spellQ}, whose two
 * digits are upper case.
 *
 * No `l`, which leaks the same way and would be the one thing here the roll then
 * had to keep in step: every length it writes is the note's own
 * ({@link spellDuration}), so nothing it puts in this channel reads a default.
 *
 * No `@` on Addmusic 4.05 or AddmusicM, where an `@` switches instrument tuning
 * on and resets `h` instead of saying what is already true. No `t`, which
 * reaches all eight channels
 * and is not what drawing one note asked for, and no `h`, which replaces an
 * instrument's tuning rather than adding to it, so `h0` is not "no transposition".
 */
export function openingCommands(songTargetProgram: number): string {
  const parts = [`o${OPENING_OCTAVE}`, spellQ(OPENING_Q)];
  if (songTargetProgram === 0) {
    parts.push('@0');
  }

  parts.push('v255', 'y10');
  return parts.join(' ');
}

/** A channel the song has not declared, written out: its `#N` and {@link openingCommands}. */
export function channelOpening(channel: number, songTargetProgram: number): string {
  return `#${channel} ${openingCommands(songTargetProgram)}`;
}

/** How many characters of an item's head are the note itself rather than its length. */
function headLength(source: string, item: StripItem): number {
  if (item.kind === 'rest') {
    return 1;
  }

  const head = source.slice(item.segments[0].span.start, item.segments[0].span.end);
  return parseWrittenPitch(head)?.length ?? 1;
}

/** The length text of an item as written, so a pitch edit never spells one in. */
export function writtenLength(source: string, item: StripItem): string {
  const head = item.segments[0].span;
  return source.slice(head.start + headLength(source, item), head.end);
}

/**
 * A note written out: the octave in front of it, the note, its length, and the
 * octave put back after it where one is needed.
 */
export function noteText(
  note: PlacedNote,
  lengthText: string | null,
  exitOctave: number | null,
  version: number,
  running: number | null,
): string | null {
  const length = lengthText ?? spellDuration(note.ticks, version);
  if (length === null) {
    return null;
  }

  // A drum's lane is its instrument. The letter it is written at has no say in
  // the byte (`parser.ts:2743-2748`), so the `@` is the whole edit and no octave
  // is needed either way.
  if (note.drum !== null) {
    return `@${note.drum} c${length}`;
  }

  const octave = octaveFor(note.written);
  const head = octave === null ? null : spellNote(note.written, octave);
  if (octave === null || head === null) {
    return null;
  }

  // The octave is written only where the one already in force is not the one
  // this note needs. `running` is what the *edited* text leaves in force, so a
  // run of notes moved together writes `o5` once rather than in front of each.
  const wantsOctave = running === null || running !== octave;
  const lead = wantsOctave ? spellOctave(octave) : '';
  const exit = exitText(note, exitOctave);
  if (lead === null || exit === null) {
    return null;
  }

  return `${lead ? `${lead} ` : ''}${head}${length}${exit}`;
}

/**
 * The drum `@` a note plays that is written somewhere other than beside it
 * (`roll-strip.ts:drumApart`), or `null`. A rest between the two does not consume
 * it, so it is the note's alone: it goes when the note does, and has to stand
 * after any note written in front of it.
 */
export function drumApart(item: StripItem): Command | null {
  return item.drum !== null && item.drum.span.end <= item.unitSpan.start ? item.drum : null;
}

/**
 * The octave put back after a note, as the text that follows it.
 *
 * `''` where nothing is needed — a drum writes no octave to put back, and an
 * exit the note is already at is written by the note itself. `null` where `o`
 * cannot reach the octave asked for, which `<` and `>` can (`spellOctave`).
 */
export function exitText(note: PlacedNote, exitOctave: number | null): string | null {
  if (exitOctave === null || note.drum !== null || exitOctave === octaveFor(note.written)) {
    return '';
  }

  const spelled = spellOctave(exitOctave);
  return spelled === null ? null : ` ${spelled}`;
}

/**
 * The end of an item, past the `$DD` it carries.
 *
 * Where a run is written after a note, "after" has to mean after the whole of
 * what the driver reads as part of that note. See {@link writeInto}.
 */
export function afterBend(item: StripItem): number {
  return Math.max(item.unitSpan.end, item.bend?.span.end ?? 0);
}
