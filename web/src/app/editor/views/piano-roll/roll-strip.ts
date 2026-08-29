import { NOTE_REST, NOTE_TIE } from '@amk/core/hardcoded-tables';
import { octaveOfNote } from '@amk/core/mml-text';
import type { NoteAddress, Span } from '@amk/core/types';
import type { PitchSlide, SongTimeline, WalkNote } from '@amk/spc/song-walk';
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
   * The `$DD` this item carries, when there is one — written after its first
   * frame and before the next item, so a tie after the command is inside it.
   *
   * `$DD` is the one command read by the *preceding* note's read-ahead rather
   * than dispatched (`main.asm:L_10E4` peeks at `($30+x)`), so it belongs to
   * this item however the prefix rules file it, and deleting this item leaves it
   * with nothing to ride on. Where it also carries a `noteTarget`, that target
   * reads the octave this item leaves standing and emits nothing, so it is in no
   * item's `segments` and only this says it is there. The command's own span
   * already covers it (`tokens.ts:gather`).
   */
  bend: Command | null;
  /**
   * What the driver does with that `$DD`, off the walk — `null` where there is
   * no slide, and for an item past the end of the pass.
   *
   * {@link bend} is the command as it was *written*; this is the reading. The
   * operands are both, but `PitchSlide.afterTicks` and `frameTicks` are only
   * here: `$DD` is not dispatched, so where the driver arms it is decided by the
   * frame the read-ahead reads it in, and `emitNote` chunks a note of `$80` ticks
   * or more inside one `noteMap` entry — that boundary reaches {@link segments}
   * no more than it reaches the text. So `c4 $DD`, `c4^4 $DD` and `c1 $DD` carry
   * one set of operands and arm 0, 48 and 96 ticks in.
   */
  slide: PitchSlide | null;
  /**
   * False past the end of the pass, where the walk has no note to check the
   * item against — `walkSong` cuts at the shortest channel and sets the rest
   * aside as `unreachable` (`song-walk.ts:1069-1080`). Still editable; just not
   * corroborated.
   */
  verified: boolean;
}

/**
 * Where a channel with nothing written in it takes its first note.
 *
 * Every other anchor the roll splices against is a {@link StripItem}'s
 * `unitSpan`, and a channel with neither note nor rest has none. So this is the
 * offset a drawn note is written at, and whether a `#N` has to be written in
 * front of it.
 */
export interface ChannelHome {
  /** The end of the channel's own block, or of the document for a channel with no `#N`. */
  at: number;
  /** Whether a `#0`-`#7` for this channel is already written. */
  declared: boolean;
}

/**
 * A channel as somewhere rests can be appended: how long it plays, and where its
 * text ends.
 *
 * Everything the roll does to a channel's *notes* goes through a {@link Strip},
 * which most channels cannot be — a `[ ]` or a `"name=value"` refuses one. Adding
 * a rest after the last thing written is a much weaker operation than rewriting a
 * span: it needs no note map, no agreement with the walk, and it cannot reach
 * inside a loop body. So this is what a channel is to a caller that only wants to
 * make it longer, and every channel has one.
 */
export interface ChannelTail {
  /** `stats.channelTicks[channel]`. 0 for a channel the song does not play, which cuts nothing short. */
  ticks: number;
  /** The end of its own block, as {@link channelHome} — a run written here lands on this channel. */
  at: number;
}

export interface Strip {
  channel: number;
  items: readonly StripItem[];
  /** Where the channel's own music ends, in ticks. */
  ticks: number;
  /** Where its first note goes while {@link items} is empty. */
  home: ChannelHome;
  /** The channel's own commands, for the prefix a wholly overwritten item takes with it. */
  commands: readonly Command[];
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

/** Line breaks included, for winding back to the end of a channel's text. */
const WHITESPACE = /\s/;

/**
 * The commands a unit may swallow on the left of its head.
 *
 * Both directions stop at a `$DD` that names its target as a note, and that is
 * load-bearing rather than incidental: the `$DD` fails this from the left, and
 * the target's own note command fails it from the right, since `gather` raises
 * one for the target as well as filing it under `Command.noteTarget`. So in
 * `$DD $00 $18 o5 e g4` the `o5` belongs to the target and no unit reaches back
 * over the construct to claim it — which is what stops a repitch of `g4`
 * carrying it off — and no `unitSpan` boundary, which is where every insertion
 * in `roll-write.ts` is anchored, ever falls between the command and its target.
 */
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
  // `&` is an operator rather than a command, and the note after it emits
  // `$DD $00 <prevNoteLength> <note>` (`parser.ts:2963-2969`), so a length change
  // to the note *before* it silently changes the slide. The scanner cannot say
  // which channel an operator is on, so one anywhere refuses every channel. It
  // is native on every target — only the tie rewind is legacy-only
  // (`parser.ts:3027`) — and Normalize's `writePitchSlides` is what clears it.
  for (const token of index.tokens) {
    if (token.kind === 'operator' && source.slice(token.start, token.end) === '&') {
      return 'this song uses `&`, whose length comes from the note before it';
    }
  }

  for (const command of index.commands) {
    if (command.channel !== channel) {
      continue;
    }

    // A remote definition sits above the first `#N` and so gathers on this
    // channel, but its body runs only where a `$FC` fires it and plays none of
    // what is written here twice. Left in `growUnits`'s list all the same: a `]`
    // it cannot lead a unit with is a barrier there.
    if (command.inRemoteDefinition) {
      continue;
    }

    if (command.replacement !== undefined || command.headReplacement !== undefined) {
      return 'this channel is written through a "name=value" replacement';
    }

    if (FORBIDDEN_KINDS.has(command.kind)) {
      return `this channel uses \`${command.kind}\`, so one written note plays more than once`;
    }

    // A subloop the porter wrote as hex rather than as `[[ ]]`. Not caught by
    // the kinds above, which are the scanner's own, and not left to
    // `agreesWithWalk` either: one lying entirely past the walk's cut has no
    // played note to disagree with, so the strip would be built on the written
    // tick count where the driver plays each note n times. `unrollLoops` clears
    // it, so Normalize is the answer the toolbar offers beside this — except for
    // an unterminated `$E6 $00`, which opens a subloop nothing closes and so has
    // no construct to unroll. That is the same standing an unterminated `[[` has
    // here, `FORBIDDEN_KINDS` refusing it and Normalize leaving it alone.
    if (command.vcmd === 0xe6) {
      return 'this channel uses `$E6`, so one written note plays more than once';
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

/** A real `#0`-`#7`, and where it stands. */
export interface Marker {
  channel: number;
  start: number;
}

/**
 * Every real `#0`-`#7` in the document, in source order.
 *
 * `gather` raises no command for a channel marker, so they are read off the
 * tokens — the route `parseTimeInForce` takes for the same reason
 * (`commands/in-force.ts`). A malformed or out-of-range one is not a marker: the
 * parser reports it and leaves the previous channel standing (AMK0030, AMK0031).
 */
export function channelMarkers(index: TokenIndex, source: string): Marker[] {
  const markers: Marker[] = [];
  for (const token of index.tokens) {
    if (token.kind !== 'channel') {
      continue;
    }

    const channel = Number.parseInt(source.slice(token.start + 1, token.end), 10);
    if (channel >= 0 && channel <= 7) {
      markers.push({ channel, start: token.start });
    }
  }

  return markers;
}

/**
 * Where this channel's first note goes while it has neither note nor rest.
 *
 * The end of its own block where it has one — its **last** block, since source
 * order within a channel is execution order — and the end of the document where
 * it has none. Wound back over the whitespace that follows either way, so the
 * run lands against the text rather than after the blank line before whatever
 * comes next.
 */
export function channelHome(
  source: string,
  channel: number,
  markers: readonly Marker[],
): ChannelHome {
  let own = -1;
  markers.forEach((marker, index) => {
    if (marker.channel === channel) {
      own = index;
    }
  });

  let at = own < 0 ? source.length : (markers[own + 1]?.start ?? source.length);
  while (at > 0 && WHITESPACE.test(source[at - 1])) {
    at--;
  }

  return { at, declared: own >= 0 };
}

/**
 * Every channel as a {@link ChannelTail}, indexed by channel.
 *
 * `channelTicks` is `CompileStats.channelTicks` — the compiler's own count, and
 * the array `stats.introTicks + stats.loopTicks` is the minimum of
 * (`index.ts:41-45`), so a caller comparing one against the other is comparing
 * two readings of the same thing rather than two different ones.
 *
 * No view is taken of whether a channel could be spliced. That is
 * {@link channelStrip}'s business, and appending is not splicing.
 */
export function channelTails(
  source: string,
  index: TokenIndex,
  channelTicks: readonly number[],
): readonly ChannelTail[] {
  const markers = channelMarkers(index, source);
  return channelTicks.map((ticks, channel) => ({
    ticks,
    at: channelHome(source, channel, markers).at,
  }));
}

/**
 * Whether writing a `#N` for this channel would take the music above the first
 * marker away from the channel it plays on.
 *
 * `detectStartingChannel` probes the whole text for `#0`, then `#1`, up to `#7`,
 * and starts writing to the first it finds (`parser.ts:379-390`,
 * Music.cpp:383-406) — so everything above the first marker belongs to the
 * lowest channel declared anywhere, and a `#N` written for a lower one moves all
 * of it, along with the `$FA` prologue `link.ts:prependBlobPrefix` puts on that
 * same channel.
 *
 * The music is counted off the **note map** rather than off `index.commands`,
 * because an `#instruments` entry's bytes and a remote definition's body both
 * gather as commands standing above the first marker, and `orderChannels` keeps
 * both in the header — a refusal earned by those could not be cleared by the
 * Normalize button offered beside it. Two consequences, both deliberate: a
 * prelude of commands with no notes in it is not caught, and AddmusicK refuses
 * notes outside a channel outright (AMK0140, `parser.ts:2880`), so a song that
 * can earn this at all is an `#am4` or `#amm` one.
 *
 * The lowest channel is read off the markers where the parser reads a raw
 * substring of the preprocessed text, so a `#3` written only inside an `#spc`
 * string counts for the parser and not here. The two can disagree only by
 * refusing a write that would have been safe.
 */
function movesTheStartingChannel(
  source: string,
  channel: number,
  markers: readonly Marker[],
  noteMap: readonly NoteAddress[],
): boolean {
  const lowest = markers.reduce((held, marker) => Math.min(held, marker.channel), 8);
  const startingNow = lowest === 8 ? 0 : lowest;
  if (Math.min(channel, lowest) === startingNow) {
    return false;
  }

  const first = markers.length > 0 ? markers[0].start : source.length;
  return noteMap.some((entry) => entry.span.start < first);
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

  const markers = channelMarkers(index, source);
  const home = channelHome(source, channel, markers);
  if (!home.declared && movesTheStartingChannel(source, channel, markers, noteMap)) {
    return { refused: 'writing this channel would move the music written above the first `#N`' };
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
      bend: null,
      slide: null,
      verified: true,
    });

    tick += entry.ticks;
    previousEnd = entry.span.end;
  }

  growUnits(source, commands, items);

  for (let at = 0; at < items.length; at++) {
    const item = items[at];
    item.verified = timeline.ticks === 0 || item.startTick < timeline.ticks;
    // A unit that reached back over its own octave has taken text the previous
    // item's prefix would otherwise claim.
    if (item.unitSpan.start < item.prefixSpan.end) {
      item.prefixSpan = { ...item.prefixSpan, end: item.unitSpan.start };
    }

    // Read off the unit boundaries rather than the prefix: a `$DD` written after
    // the channel's last item is in no prefix at all, and it rides on that item
    // exactly as any other does. From the *first* segment's end and not the
    // unit's, because a tie written after the command — `f+2 $DD $00 $D6 a+^2` —
    // puts the `$DD` between two of the note's frames, and `growUnits` ends a
    // unit at its last one, so a scan from there reaches past a slide the note
    // really does carry and no item claims it at all.
    const until = items[at + 1]?.unitSpan.start ?? source.length;
    item.bend =
      commands.find(
        (command) =>
          command.vcmd === 0xdd &&
          !command.inRemoteDefinition &&
          command.span.start >= item.segments[0].span.end &&
          command.span.start < until,
      ) ?? null;
  }

  const played = timeline.notes.filter((note) => note.channel === channel);
  const disagreement = agreesWithWalk(items, played, timeline.ticks);
  if (disagreement !== null) {
    return { refused: disagreement };
  }

  // Index by index, over the very list the agreement was just taken over — which
  // is what makes the join exact rather than a second one that could quietly
  // disagree with it. Past `played.length` the pass has ended and there is no
  // walk note to ask, so those items keep no slide however plainly a `$DD` is
  // written after them.
  const sounded = items.filter((item) => item.kind === 'note');
  for (let at = 0; at < played.length; at++) {
    sounded[at].slide = played[at].bend;
  }

  return { channel, items, ticks: tick, home, commands };
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
  played: readonly WalkNote[],
  timelineTicks: number,
): string | null {
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
  if (first && timelineTicks > 0 && first.startTick < timelineTicks) {
    return 'this channel does not play in the order it is written';
  }

  return null;
}
