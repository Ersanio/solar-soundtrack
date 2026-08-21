import { NOTE_REST, NOTE_TIE } from '@amk/core/hardcoded-tables';
import { octaveOfNote } from '@amk/core/mml-text';
import type { NoteAddress, Span } from '@amk/core/types';
import type { SongTimeline } from '@amk/spc/song-walk';
import type { Command, TokenIndex } from '@amk/tokens';
import { isPercussionInstrument } from '@amk/tokens/commands/in-force';

/**
 * One channel of a song as a sequence the roll can splice: what is written, what
 * tick it falls on, and which run of text an edit has to rewrite to move it.
 *
 * The walk knows where every note sounds and nothing about the text; the
 * compiler's `noteMap` knows the text and nothing about ticks. The strip is the
 * join, and it is built from `noteMap` — because `noteMap` carries **rests**,
 * which the walk drops (`song-walk.ts:emitNote` returns early for `$C7`), and a
 * gap the roll can address is exactly a rest it can rewrite.
 *
 * Everything here is arithmetic over plain data, so `rolltest` can drive it
 * against a real compile the way `charttest` drives `roll-layout.ts`.
 */

/** A `^` continuation the parser did not fold into the note it extends. */
export interface StripSegment {
  address: number;
  span: Span;
  ticks: number;
}

/** One written note or rest, with every continuation of it. */
export interface StripItem {
  kind: 'note' | 'rest';
  /** The head segment's address, which is what the walk names the note by. */
  address: number;
  /**
   * The head, then its `^` continuations in order.
   *
   * More than one only when something other than whitespace separates them —
   * `c4 v200 ^8` is an ordinary mid-note volume ramp and is two `noteMap`
   * entries, because `accumulateTiedLength` folds across whitespace and nothing
   * else (`parser.ts:2963-3004`). Which is why a length change rewrites the
   * *last* segment: the ramp has to stay where the porter put it.
   */
  segments: readonly StripSegment[];
  /**
   * Everything an edit to this item rewrites: the segments, plus the `o` and
   * drum `@` written beside the head, plus any `o` written straight after the
   * tail. Extending over them is what makes a second drag of the same note
   * rewrite the octave it wrote the first time instead of adding another.
   */
  unitSpan: Span;
  /**
   * From the previous item's end to this one's start, less leading whitespace —
   * the commands written to run just before this note. It belongs to the item
   * and travels with it, so a `v200` written before a note stays before it.
   */
  prefixSpan: Span;
  startTick: number;
  ticks: number;
  /** The byte the letter and octave alone name; `$C7` for a rest. */
  written: number;
  /** The octave the head was written under, or `null` for a rest. */
  octave: number | null;
  /**
   * The octave in force after the unit, where a trailing `o` moved it on. Null
   * when nothing does, which is when {@link octave} is also the exit.
   */
  exitOctave: number | null;
  /** Whether the unit already carries an absolute `o`, and so must keep carrying one. */
  hasLeadingOctave: boolean;
  /** The drum `@21`-`@29` folded into this note, when one was. */
  drum: Command | null;
  /**
   * False past the end of the pass, where the walk has no note to check the
   * item against — `walkSong` cuts at the shortest channel and sets the rest
   * aside as `unreachable` (`song-walk.ts:1069-1080`). Still editable; just not
   * corroborated.
   */
  verified: boolean;
}

export interface Strip {
  channel: number;
  items: readonly StripItem[];
  /** Where the channel's own music ends, in ticks. */
  ticks: number;
}

/** Why a channel cannot be spliced, in the words the toolbar shows. */
export interface StripRefusal {
  refused: string;
}

export interface StripRequest {
  source: string;
  channel: number;
  noteMap: readonly NoteAddress[];
  timeline: SongTimeline;
  index: TokenIndex;
  /** `CompileStats.tempoRatio`. Anything but 1 is refused — see the gate. */
  tempoRatio: number;
}

export function isStrip(strip: Strip | StripRefusal): strip is Strip {
  return (strip as Strip).items !== undefined;
}

/**
 * Text a note, rest or tie is allowed to be for the roll to rewrite it.
 *
 * `spanAt` collapses a span that came through a `"find=value"` replacement to a
 * single character (`parser.ts:3861-3873`), so a note written as `x` with
 * `"x=c4"` has a one-character span reading `x` — and an `expect` guard cannot
 * see it, because the roll would slice the same text. Reading the span back and
 * insisting it is a note is what catches that, and the scanner's refusal to
 * fold repeated bare `r`s along with it.
 *
 * A length segment is digits, or `=` and digits, either way with dots; a
 * continuation is `^` for anything and also a repeated `r` for a rest, both of
 * which `accumulateTiedLength` folds across whitespace.
 */
const LENGTH = String.raw`(?:\d*|=\d+)\.*`;
const NOTE_TEXT = new RegExp(String.raw`^[a-gA-G][+-]?${LENGTH}(?:\s*\^\s*${LENGTH})*$`);
const REST_TEXT = new RegExp(String.raw`^[rR]${LENGTH}(?:\s*[\^rR]\s*${LENGTH})*$`);
const TIE_TEXT = new RegExp(String.raw`^\^${LENGTH}(?:\s*\^\s*${LENGTH})*$`);

/** Only spaces and tabs, so a unit never grows across a line break. */
const INLINE_GAP = /^[ \t]*$/;

/** The commands a unit may swallow on the left of its head. */
function leadsAUnit(command: Command): boolean {
  return command.kind.toLowerCase() === 'o' || isPercussionInstrument(command);
}

/** And on the right of its tail. Only an octave restore trails a note. */
function trailsAUnit(command: Command): boolean {
  return command.kind.toLowerCase() === 'o';
}

/**
 * Constructs that make one written note into no notes, or into many played ones.
 *
 * `<` and `>` are deliberately absent: they are not commands to the scanner at
 * all, and they are harmless here. A note's octave comes from its own `written`
 * byte rather than from a running sum (`octaveOfNote`), a unit never swallows
 * one, and the octave a rewrite puts back is the one that was in force after the
 * note — so `o4 c4 > d4` repitches either note without disturbing the other.
 */
const FORBIDDEN_KINDS = new Set(['[', ']', '*', '(', ')', '{', '}', '"']);

/**
 * Why this channel cannot be spliced, or `null`.
 *
 * The checks the walk cannot make. A `{ }` triplet scales every length by two
 * thirds (`parser.ts:804-810`) and a tempo ratio divides every one of them
 * (`parser.ts:813`), and in both cases the strip and the walk agree perfectly
 * while the text the roll would write is wrong — so neither is catchable by
 * comparing ticks, and both are refused here.
 */
function forbiddenConstruct(index: TokenIndex, channel: number, source: string): string | null {
  // `&` is an operator rather than a command, and it takes its duration from
  // `prevNoteLength` (`parser.ts:2772-2777`), so a length change to the note
  // before it silently changes the slide. The scanner cannot say which channel
  // an operator is on, so one anywhere refuses every channel — it exists only on
  // the legacy targets, where it is rare.
  for (const token of index.tokens) {
    if (token.kind === 'operator' && source.slice(token.start, token.end) === '&') {
      return 'this song uses `&`, whose length comes from the note before it';
    }
  }

  for (const command of index.commands) {
    if (command.channel !== channel) {
      continue;
    }

    if (command.replacement !== undefined || command.headReplacement !== undefined) {
      return 'this channel is written through a "name=value" replacement';
    }

    if (FORBIDDEN_KINDS.has(command.kind)) {
      return `this channel uses \`${command.kind}\`, so one written note plays more than once`;
    }

    // A note used as `$DD`'s last parameter emits no note event at all
    // (`parser.ts:2934`), so the strip believes the notes either side of the
    // slide are adjacent — and a rest written between them breaks the lookahead,
    // which skips only spaces, `o`, `<` and `>` (`parser.ts:3397-3428`).
    if (command.vcmd === 0xdd) {
      return 'this channel uses `$DD`, whose target note is not in the song data';
    }

    if (command.noteLength?.some((segment) => segment.triplet)) {
      return 'this channel has notes inside `{ }`, whose lengths are two thirds of what they say';
    }
  }

  return null;
}

/**
 * Grows each note's unit over the commands written beside it, left first.
 *
 * Left first because the two directions compete: in `c4 o5 d4` the `o5` is
 * adjacent to both notes, and only one unit may own it or two edits would
 * overlap. **Leading wins**, which is also what makes the octave restore stable:
 * a repitch of `c4` writes `o3 c4 o4 d4`, and on the next pass that `o4` is
 * `d4`'s own leading octave rather than `c4`'s trailing one. The text stops
 * moving after one edit.
 *
 * Rests are left alone entirely. A rest's pitch means nothing, so an `o` beside
 * one belongs to whichever note it was written for.
 */
function growUnits(
  source: string,
  commands: readonly Command[],
  items: readonly StripItem[],
): void {
  const claimed = new Set<Command>();
  const notes = items.filter((item) => item.kind === 'note');

  for (const item of notes) {
    let start = item.segments[0].span.start;
    for (let i = commands.length - 1; i >= 0; i--) {
      const command = commands[i];
      if (command.span.end > start) {
        continue;
      }

      if (!INLINE_GAP.test(source.slice(command.span.end, start)) || !leadsAUnit(command)) {
        break;
      }

      if (isPercussionInstrument(command)) {
        item.drum ??= command;
      } else {
        item.hasLeadingOctave = true;
      }

      claimed.add(command);
      start = command.span.start;
    }

    item.unitSpan = { ...item.unitSpan, start };
  }

  for (const item of notes) {
    let end = item.segments[item.segments.length - 1].span.end;
    for (const command of commands) {
      if (command.span.start < end) {
        continue;
      }

      if (
        claimed.has(command) ||
        !INLINE_GAP.test(source.slice(end, command.span.start)) ||
        !trailsAUnit(command)
      ) {
        break;
      }

      item.exitOctave = command.args[0]?.value ?? item.exitOctave;
      claimed.add(command);
      end = command.span.end;
    }

    item.unitSpan = { ...item.unitSpan, end };
  }
}

/**
 * The channel as a strip, or the reason it cannot be one.
 *
 * The caller's precondition is that the compile succeeded and that the document
 * has not moved since — `EditorStore.compiledText() === source()`, the same test
 * every other span-based reader in the app takes.
 */
export function channelStrip(request: StripRequest): Strip | StripRefusal {
  const { source, channel, noteMap, timeline, index, tempoRatio } = request;

  if (timeline.truncated || timeline.problems.length > 0) {
    return { refused: 'the song is longer than the roll can read' };
  }

  if (tempoRatio !== 1) {
    return { refused: 'this song divides its tempo, so a written length is not a tick count' };
  }

  const forbidden = forbiddenConstruct(index, channel, source);
  if (forbidden !== null) {
    return { refused: forbidden };
  }

  const entries = noteMap
    .filter((entry) => entry.channel === channel)
    .sort((a, b) => a.address - b.address);

  const commands = index.commands.filter((command) => command.channel === channel);

  const items: StripItem[] = [];
  let previousEnd = 0;
  let tick = 0;

  for (const entry of entries) {
    const text = source.slice(entry.span.start, entry.span.end);
    const tie = entry.note === NOTE_TIE;
    const rest = entry.note === NOTE_REST;
    const pattern = tie ? TIE_TEXT : rest ? REST_TEXT : NOTE_TEXT;
    if (!pattern.test(text)) {
      return { refused: `\`${text}\` is not a note the roll can rewrite` };
    }

    const held = items[items.length - 1];
    if (tie) {
      if (!held) {
        return { refused: 'this channel opens with a tie' };
      }

      held.segments = [
        ...held.segments,
        { address: entry.address, span: entry.span, ticks: entry.ticks },
      ];
      held.ticks += entry.ticks;
      tick += entry.ticks;
      previousEnd = entry.span.end;
      continue;
    }

    const octave = rest ? null : octaveOfNote(entry.written, text);
    if (!rest && octave === null) {
      return { refused: `the roll cannot read the octave \`${text}\` was written at` };
    }

    const prefix = source.slice(previousEnd, entry.span.start);
    const lead = prefix.length - prefix.trimStart().length;

    items.push({
      kind: rest ? 'rest' : 'note',
      address: entry.address,
      segments: [{ address: entry.address, span: entry.span, ticks: entry.ticks }],
      unitSpan: { ...entry.span },
      prefixSpan: { start: previousEnd + lead, end: entry.span.start, line: entry.span.line },
      startTick: tick,
      ticks: entry.ticks,
      written: entry.written,
      octave,
      exitOctave: null,
      hasLeadingOctave: false,
      drum: null,
      verified: true,
    });

    tick += entry.ticks;
    previousEnd = entry.span.end;
  }

  growUnits(source, commands, items);

  for (const item of items) {
    item.verified = timeline.ticks === 0 || item.startTick < timeline.ticks;
    // A unit that reached back over its own octave has taken text the previous
    // item's prefix would otherwise claim.
    if (item.unitSpan.start < item.prefixSpan.end) {
      item.prefixSpan = { ...item.prefixSpan, end: item.unitSpan.start };
    }
  }

  const disagreement = agreesWithWalk(items, timeline, channel);
  if (disagreement !== null) {
    return { refused: disagreement };
  }

  return { channel, items, ticks: tick };
}

/**
 * The walk's notes on this channel against the strip's, as a **prefix**.
 *
 * Not an equality: `walkSong` ends the pass at the shortest channel in use and
 * sets everything past it aside (`song-walk.ts:1069-1080`), so a channel longer
 * than the shortest is simply the commonest shape a song has — an equality here
 * would refuse editing on most songs and then point at Normalize, which does not
 * fix it. What the prefix does catch is a `[ ]`, a `*n` or a `(1)n`, where one
 * written note is played several times and the two stop lining up at once.
 */
function agreesWithWalk(
  items: readonly StripItem[],
  timeline: SongTimeline,
  channel: number,
): string | null {
  const played = timeline.notes.filter((note) => note.channel === channel);
  const written = items.filter((item) => item.kind === 'note');

  for (let at = 0; at < played.length; at++) {
    const item = written[at];
    if (!item) {
      return 'this channel plays more notes than it has written';
    }

    const note = played[at];
    if (
      note.address !== item.address ||
      note.tick !== item.startTick ||
      note.ticks !== item.ticks
    ) {
      return "a loop or a call plays one of this channel's notes more than once";
    }
  }

  const first = written[played.length];
  if (first && timeline.ticks > 0 && first.startTick < timeline.ticks) {
    return 'this channel does not play in the order it is written';
  }

  return null;
}
