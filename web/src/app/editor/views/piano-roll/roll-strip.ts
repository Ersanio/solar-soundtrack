import { NOTE_REST, NOTE_TIE } from '@amk/core/hardcoded-tables';
import { octaveOfNote } from '@amk/core/mml-text';
import type { CommandAddress, NoteAddress, Span } from '@amk/core/types';
import type { LoopRun, PitchSlide, SongTimeline, WalkNote } from '@amk/spc/song-walk';
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

/**
 * One place one item sounds: a song tick, and the walk note the expansion
 * joined it to — `null` past the pass cut, where there is no note to ask.
 *
 * A root note has one; a note inside a loop body has one per pass the body
 * plays, which is what "editing one instance edits them all" is drawn from.
 */
export interface StripInstance {
  tick: number;
  note: WalkNote | null;
}

/**
 * One nesting level of the channel's text: the channel's own run, or one loop
 * body it declares. Items are frame-local — a body's first note is at tick 0
 * of its frame however many times and wherever the body plays — and
 * {@link StripItem.instances} is where frame time becomes song time.
 */
export interface StripFrame {
  /** -1 for the channel's own text; else the body's first byte's ARAM address. */
  body: number;
  /** `[from, to)` into {@link Strip.items} — a frame's items are contiguous there. */
  from: number;
  to: number;
  /** Ticks one pass of this frame occupies (the root: the channel's own length). */
  ticks: number;
  /** The textual extent writes may touch: inside the brackets for a body. */
  span: Span;
  /** The runs that play this frame, oldest first. Empty for the root. */
  runs: readonly LoopRun[];
}

/**
 * How a construct's text recalls its body, for the gap gesture that splits it.
 *
 * `text` is the exact construct span from the join — never widened the way
 * {@link StripItem.unitSpan} may be by `growUnits` — so a rewrite of it touches
 * the construct and nothing else.
 */
export interface LoopSite {
  /** A `[ ]n` played in place, a `(n)m`/`*n` recall, or a `$E6` pair. */
  kind: 'declaration' | 'recall' | 'sub';
  text: Span;
  /** The declaration's closing `]n` command, where a split rewrites; else `null`. */
  close: Span | null;
}

/** One written note or rest, with every continuation of it. */
export interface StripItem {
  /**
   * `'construct'` is a loop standing in its containing frame — a declaration's
   * `[ ]n`, a `(n)m` or `*n` recall, or a `$E6` pair. It occupies ticks nothing
   * may enter, moves nothing, and its {@link unitSpan} is the whole textual
   * construct; its body's own notes are another frame's items.
   */
  kind: 'note' | 'rest' | 'construct';
  /**
   * The head segment's address, which is what the walk names the note by.
   * For a construct, the body's first byte's ARAM address — its frame's id.
   */
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
  /** Tick local to this item's frame. Root-frame local time is song time. */
  startTick: number;
  /** For a construct: the ticks one execution of it occupies (every pass). */
  ticks: number;
  /** The byte the letter and octave alone name; `$C7` for a rest; 0 for a construct. */
  written: number;
  /**
   * The octave the head was written under, or `null` for a rest — and for a
   * construct, whose body may leave any octave standing, so a reader on its far
   * side treats the octave as unknown and spells an explicit `o`.
   */
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
   * corroborated. For a looped note, whether its **first** instance is inside
   * the pass.
   */
  verified: boolean;
  /**
   * Every song tick this item sounds at, ascending — one entry for a root item,
   * one per pass for an item inside a loop body. Filled by the expansion
   * agreement, which is what joins each entry to its walk note.
   */
  instances: readonly StripInstance[];
  /** Index into {@link Strip.frames}. */
  frame: number;
  /** For a construct, how its text recalls the body; `null` for a note or rest. */
  loop: LoopSite | null;
  /**
   * A body head playing a drum loaded **before** the `[` — its first instance
   * sounds percussion while no drum `@` stands in the frame. Rewriting or
   * removing it would move the remap's consumption onto the next pitched note,
   * so gestures that touch it are refused.
   */
  remapFed: boolean;
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
  /** The root frame's items first, in text order, then each body frame's. */
  items: readonly StripItem[];
  /** `frames[0]` is the root; one more per loop body this channel declares. */
  frames: readonly StripFrame[];
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
  /** `CompileResult.commandMap` — what joins a loop run's call site back to text. */
  commandMap: readonly CommandAddress[];
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
 * Where text inserted "before this note" goes: the offset `growUnits` would give
 * the note's `unitSpan.start`, computed for one note without building a strip —
 * the note inspector serves notes inside `[ ]` bodies, which `channelStrip`
 * refuses whole. The same absorption rule over the same channel-filtered list,
 * so the insertion lands at a unit head on the next strip build, in front of the
 * note's own adjacent leading `o` and drum `@` — a drum `@` kept against its
 * note is what lets Normalize's `drumPerNote` stand down.
 */
export function unitStartBefore(
  source: string,
  commands: readonly Command[],
  note: Command,
): { start: number; line: number } {
  const mine = commands.filter((command) => command.channel === note.channel);
  let start = note.span.start;
  let line = note.span.line;

  for (let i = mine.length - 1; i >= 0; i--) {
    const command = mine[i];
    if (command.span.end > start) {
      continue;
    }

    if (!INLINE_GAP.test(source.slice(command.span.end, start)) || !leadsAUnit(command)) {
      break;
    }

    start = command.span.start;
    line = command.span.line;
  }

  return { start, line };
}

/**
 * Constructs that make one written note into no notes or into unknowable ones.
 *
 * `<` and `>` are deliberately absent: they are not commands to the scanner at
 * all, and they are harmless here. A note's octave comes from its own `written`
 * byte rather than from a running sum (`octaveOfNote`), a unit never swallows
 * one, and the octave a rewrite puts back is the one that was in force after the
 * note — so `o4 c4 > d4` repitches either note without disturbing the other.
 *
 * `[`, `]` and `*` are absent too: a loop is edited through its frames now, and
 * a bracket the frames cannot account for is its own refusal (`bracketsAgree`).
 */
const FORBIDDEN_KINDS = new Set(['{', '}', '"']);

/**
 * Why this channel cannot be spliced, or `null`.
 *
 * The checks the walk cannot make. A `{ }` triplet scales every length by two
 * thirds (`parser.ts:804-810`) and a tempo ratio divides every one of them
 * (`parser.ts:813`), and in both cases the strip and the walk agree perfectly
 * while the text the roll would write is wrong — so neither is catchable by
 * comparing ticks, and both are refused here.
 */
function forbiddenConstruct(
  index: TokenIndex,
  source: string,
  reachable: readonly Command[],
): string | null {
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

  // Over every command an edit here can reach — the channel's own, and the
  // interior of every body it plays, another channel's block included.
  for (const command of reachable) {
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

/** The sentence every expansion mismatch refuses with — one reading, one voice. */
const OUT_OF_ORDER = 'this channel does not play in the order it is written';

const runTotal = (run: LoopRun): number => run.passes.reduce((sum, pass) => sum + pass.ticks, 0);

const bodyKey = (body: { start: number; end: number }): string => `${body.start}:${body.end}`;

/** One call site of one body: the construct the text holds, and the runs that play it. */
interface ConstructSeed {
  /** The whole textual construct — brackets, label and count included. */
  span: Span;
  /** The body it plays, as a key into the frame table. */
  body: string;
  /** The runs at this site, oldest first — more than one where an outer loop replays it. */
  runs: LoopRun[];
  /** How the site recalls the body — settled where its span is. */
  kind: LoopSite['kind'];
  /** The declaration's closing `]n` command; `null` for the other kinds. */
  close: Span | null;
}

/** One body this channel declares, before its items are built. */
interface FrameSeed {
  body: { start: number; end: number };
  /** The interior extent — inside the brackets — that writes may touch. */
  span: Span;
  runs: LoopRun[];
}

/**
 * The loop structure of one channel, joined back to text — the frames its
 * bodies become, and the construct each call site stands as — or the sentence
 * refusing it.
 *
 * The join runs on two facts. A `]n`'s own `$E9` is the one dispatch
 * `recordCommand` drops (`parser.ts:649`), so a run whose `from` the command
 * map cannot name is the textual body playing at its own position, and its
 * brackets are found by pairing the scanner's `[` and `]` commands; a `(n)m`,
 * `*n` or either `$E6` arm is named directly. Everything the frames cannot
 * account for refuses, so a mis-read here turns into a sentence rather than a
 * mis-edit.
 */
function discoverLoops(
  request: StripRequest,
  commands: readonly Command[],
): { seeds: FrameSeed[]; constructs: ConstructSeed[] } | StripRefusal {
  const { source, channel, noteMap, commandMap, timeline, index } = request;
  const runs = timeline.loops.filter((run) => run.channel === channel);
  const mapped = new Map(commandMap.map((entry) => [entry.address, entry]));

  // Two runs whose bodies partially overlap are a crossed loop and subloop:
  // the driver plays them (`Music.cpp:1208-1290` guards nesting, not crossing),
  // and what it plays is not the text in the order it is written. A body whose
  // end stands before its start is the same shape seen from the subloop's side —
  // its mark inside a `[ ]` body lives in the loop block and its close out in
  // the channel, which the layout puts at a lower address.
  const CROSSED =
    'a loop and a subloop cross on this channel, so it does not play in the order it is written';
  for (const run of runs) {
    if (run.body.end < run.body.start) {
      return { refused: CROSSED };
    }

    for (const other of runs) {
      const overlaps = run.body.start < other.body.end && other.body.start < run.body.end;
      const nested =
        (run.body.start >= other.body.start && run.body.end <= other.body.end) ||
        (other.body.start >= run.body.start && other.body.end <= run.body.end);
      if (run !== other && overlaps && !nested) {
        return { refused: CROSSED };
      }
    }
  }

  const byBody = new Map<string, FrameSeed>();
  const sites = new Map<number, ConstructSeed>();
  const constructs: ConstructSeed[] = [];
  for (const run of runs) {
    const key = bodyKey(run.body);
    let seed = byBody.get(key);
    if (!seed) {
      seed = { body: run.body, span: { start: 0, end: 0, line: 1 }, runs: [] };
      byBody.set(key, seed);
    }

    seed.runs.push(run);

    let site = sites.get(run.from);
    if (!site) {
      site = {
        span: { start: 0, end: 0, line: 1 },
        body: key,
        runs: [],
        kind: 'recall',
        close: null,
      };
      sites.set(run.from, site);
      constructs.push(site);
    } else if (site.body !== key) {
      // One call site playing two bodies is nothing the compiler emits.
      return { refused: OUT_OF_ORDER };
    }

    site.runs.push(run);
  }

  // A body whose content sits inside a remote definition — a `*` or a label
  // recalling one — is remote code, which the roll leaves alone. Its content is
  // commands alone (a remote body may hold no note data, AMK0165), so the
  // command map is what names it, against every channel's commands: the
  // definition may be another channel's text.
  for (const seed of byBody.values()) {
    const content = commandMap.filter(
      (entry) => entry.address >= seed.body.start && entry.address < seed.body.end,
    );
    const remote = index.commands.some(
      (command) =>
        command.inRemoteDefinition &&
        content.some(
          (entry) => entry.span.start >= command.span.start && entry.span.start < command.span.end,
        ),
    );
    if (remote) {
      return { refused: 'this channel replays a remote code body, which the roll leaves alone' };
    }
  }

  // Every voice's runs of a body ride on its frame — a `(n)` declared on one
  // channel and recalled from another moves both voices when its length moves,
  // and the shift, the pad and the preview all read the runs to say so.
  for (const [key, seed] of byBody) {
    for (const run of timeline.loops) {
      if (run.channel !== channel && bodyKey(run.body) === key) {
        seed.runs.push(run);
      }
    }
  }

  // The scanner's `[` and `]` across every channel, paired by depth in text
  // order — every channel's, because a `(n)` body this channel recalls may be
  // declared in another channel's block. `[[` is two `[` commands and pairs
  // inside out, which the `$E6` route below never consults — a sub's two arms
  // are in the command map.
  const pairs: { open: Command; close: Command }[] = [];
  {
    const stack: Command[] = [];
    for (const command of index.commands) {
      if (command.kind === '[') {
        stack.push(command);
      } else if (command.kind === ']') {
        const open = stack.pop();
        if (open) {
          pairs.push({ open, close: command });
        }
      }
    }
  }

  /** The body's own text offsets, which are what name its bracket pair. */
  const contentOf = (seed: FrameSeed): number[] => {
    const content: number[] = [];
    for (const entry of noteMap) {
      if (entry.address >= seed.body.start && entry.address < seed.body.end) {
        content.push(entry.span.start);
      }
    }

    for (const entry of commandMap) {
      if (entry.address >= seed.body.start && entry.address < seed.body.end) {
        content.push(entry.span.start);
      }
    }

    return content;
  };

  /** A declaration's construct span reaches back over an abutting `(n)` label. */
  const widenOverLabel = (start: number): number => {
    if (source[start - 1] !== ')') {
      return start;
    }

    let at = start - 2;
    while (at >= 0 && /\d/.test(source[at])) {
      at--;
    }

    return at >= 0 && source[at] === '(' && at < start - 2 ? at : start;
  };

  const claimed = new Set<{ open: Command; close: Command }>();
  for (const [from, site] of sites) {
    const seed = byBody.get(site.body)!;
    const sub = site.runs[0].kind === 'sub';
    const call = mapped.get(from);

    if (sub) {
      // Both `$E6` arms are in the command map whatever they were spelled as —
      // `[[`, `]]n`, or hex — the opening pair's bytes standing two before the
      // body (`parser.ts:parseLoopStart`, `parseHexCommand`).
      const opening = mapped.get(seed.body.start - 2);
      if (!call || !opening) {
        return { refused: "the roll cannot line this channel's brackets up with what plays" };
      }

      site.kind = 'sub';
      site.span = { start: opening.span.start, end: call.span.end, line: opening.span.line };
      seed.span = { start: opening.span.end, end: call.span.start, line: opening.span.line };
      continue;
    }

    if (call) {
      // A `(n)m` or `*n` — the recall is the construct, whole.
      site.span = { ...call.span };
      continue;
    }

    // A declaration: the pair whose interior holds the body's own text. The
    // body's content names it — its notes, or failing those its commands.
    const content = contentOf(seed);
    const pair = pairs.find(
      (each) =>
        !claimed.has(each) &&
        content.length > 0 &&
        content.every((at) => at > each.open.span.end - 1 && at < each.close.span.start),
    );
    if (!pair) {
      return { refused: "the roll cannot line this channel's brackets up with what plays" };
    }

    if (pair.open.inRemoteDefinition || pair.close.inRemoteDefinition) {
      return { refused: 'this channel replays a remote code body, which the roll leaves alone' };
    }

    claimed.add(pair);
    site.kind = 'declaration';
    site.close = { ...pair.close.span };
    site.span = {
      start: widenOverLabel(pair.open.span.start),
      end: pair.close.span.end,
      line: pair.open.span.line,
    };
    seed.span = {
      start: pair.open.span.end,
      end: pair.close.span.start,
      line: pair.open.span.line,
    };
  }

  // A body declared in another channel's block has no declaration site here to
  // pair its brackets by, and still needs its interior located — that is where
  // this channel's edits to it land.
  for (const seed of byBody.values()) {
    if (seed.span.end > 0) {
      continue;
    }

    const content = contentOf(seed);
    const pair = pairs.find(
      (each) =>
        content.length > 0 &&
        content.every((at) => at > each.open.span.end - 1 && at < each.close.span.start),
    );
    if (!pair) {
      return { refused: "the roll cannot line this channel's brackets up with what plays" };
    }

    seed.span = {
      start: pair.open.span.end,
      end: pair.close.span.start,
      line: pair.open.span.line,
    };
  }

  // Every bracket the text holds has to be accounted for by a construct, or the
  // frames are not the reading the driver takes: an unterminated `$E6 $00`, a
  // remote definition a `*` replays, a call whose run a crossed shape clobbered.
  // A declaration's span runs bracket to bracket, so its body's interior
  // brackets — a subloop's arms — are contained by it as well as by their own.
  const spans = constructs.map((each) => each.span);
  const covered = (command: Command): boolean =>
    spans.some((span) => command.span.start >= span.start && command.span.end <= span.end);
  for (const command of commands) {
    if (command.inRemoteDefinition) {
      continue;
    }

    if (command.vcmd === 0xe6 && !covered(command)) {
      return {
        refused:
          command.args[0]?.value === 0
            ? 'this channel opens a subloop ($E6 $00) that nothing closes'
            : "the roll cannot line this channel's brackets up with what plays",
      };
    }

    if (
      (command.kind === '[' || command.kind === ']' || command.kind === '*') &&
      !covered(command)
    ) {
      return { refused: "the roll cannot line this channel's brackets up with what plays" };
    }
  }

  const seeds = [...byBody.values()].sort((a, b) => a.body.start - b.body.start);
  return { seeds, constructs };
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

  const markers = channelMarkers(index, source);
  const home = channelHome(source, channel, markers);
  if (!home.declared && movesTheStartingChannel(source, channel, markers, noteMap)) {
    return { refused: 'writing this channel would move the music written above the first `#N`' };
  }

  const discovered = discoverLoops(
    request,
    index.commands.filter((command) => command.channel === channel),
  );
  if (!isDiscovered(discovered)) {
    return discovered;
  }

  const { seeds, constructs } = discovered;

  // Every command an edit here can reach: the channel's own, plus the interior
  // of every body it plays — which for a `(n)` recalled across channels is
  // another channel's text. One list serves `growUnits`, the bend join and
  // `Strip.commands`, so identity holds across all three.
  const commands = index.commands.filter(
    (command) =>
      command.channel === channel ||
      seeds.some(
        (seed) => command.span.start >= seed.span.start && command.span.end <= seed.span.end,
      ),
  );

  const forbidden = forbiddenConstruct(index, source, commands);
  if (forbidden !== null) {
    return { refused: forbidden };
  }

  /** Innermost body holding an offset — the frame a piece of text belongs to. */
  const seedAt = (predicate: (seed: FrameSeed) => boolean): number => {
    let found = -1;
    seeds.forEach((seed, at) => {
      if (
        predicate(seed) &&
        (found < 0 ||
          seed.body.end - seed.body.start < seeds[found].body.end - seeds[found].body.start)
      ) {
        found = at;
      }
    });

    return found;
  };

  /** One cell of a frame's text: a note-map entry, or a whole construct. */
  interface Cell {
    at: number;
    entry?: NoteAddress;
    construct?: ConstructSeed;
  }

  const cells: Cell[][] = [[], ...seeds.map(() => [])];
  for (const entry of noteMap) {
    const inBody = seedAt(
      (seed) => entry.address >= seed.body.start && entry.address < seed.body.end,
    );
    if (inBody >= 0) {
      cells[inBody + 1].push({ at: entry.span.start, entry });
    } else if (entry.channel === channel) {
      cells[0].push({ at: entry.span.start, entry });
    }
  }

  for (const construct of constructs) {
    const inBody = seedAt(
      (seed) =>
        construct.span.start >= seed.span.start &&
        construct.span.end <= seed.span.end &&
        bodyKey(seed.body) !== construct.body,
    );
    cells[inBody >= 0 ? inBody + 1 : 0].push({ at: construct.span.start, construct });
  }

  for (const list of cells) {
    list.sort((a, b) => a.at - b.at);
  }

  const items: StripItem[] = [];
  const frames: StripFrame[] = [];
  /** The construct each item index stands as, for the expansion below. */
  const constructAt = new Map<number, ConstructSeed>();

  for (let frame = 0; frame < cells.length; frame++) {
    const seed = frame === 0 ? null : seeds[frame - 1];
    const from = items.length;
    let previousEnd = seed ? seed.span.start : 0;
    let tick = 0;

    for (const cell of cells[frame]) {
      const prefixAt = previousEnd;

      if (cell.construct) {
        const construct = cell.construct;
        const prefix = source.slice(prefixAt, construct.span.start);
        const lead = prefix.length - prefix.trimStart().length;
        constructAt.set(items.length, construct);
        items.push({
          kind: 'construct',
          address: construct.runs[0].body.start,
          segments: [],
          unitSpan: { ...construct.span },
          prefixSpan: {
            start: prefixAt + lead,
            end: construct.span.start,
            line: construct.span.line,
          },
          startTick: tick,
          ticks: runTotal(construct.runs[0]),
          written: 0,
          octave: null,
          exitOctave: null,
          hasLeadingOctave: false,
          drum: null,
          bend: null,
          slide: null,
          verified: true,
          instances: [],
          frame,
          loop: {
            kind: construct.kind,
            text: { ...construct.span },
            close: construct.close ? { ...construct.close } : null,
          },
          remapFed: false,
        });

        tick += runTotal(construct.runs[0]);
        previousEnd = construct.span.end;
        continue;
      }

      const entry = cell.entry!;
      const text = source.slice(entry.span.start, entry.span.end);
      const tie = entry.note === NOTE_TIE;
      const rest = entry.note === NOTE_REST;
      const pattern = tie ? TIE_TEXT : rest ? REST_TEXT : NOTE_TEXT;
      if (!pattern.test(text)) {
        return { refused: `\`${text}\` is not a note the roll can rewrite` };
      }

      const held = items.length > from ? items[items.length - 1] : undefined;
      if (tie) {
        if (!held || held.kind === 'construct') {
          return {
            refused: held
              ? 'this channel ties a note across a loop bracket'
              : 'this channel opens with a tie',
          };
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

      const prefix = source.slice(prefixAt, entry.span.start);
      const lead = prefix.length - prefix.trimStart().length;

      items.push({
        kind: rest ? 'rest' : 'note',
        address: entry.address,
        segments: [{ address: entry.address, span: entry.span, ticks: entry.ticks }],
        unitSpan: { ...entry.span },
        prefixSpan: { start: prefixAt + lead, end: entry.span.start, line: entry.span.line },
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
        instances: [],
        frame,
        loop: null,
        remapFed: false,
      });

      tick += entry.ticks;
      previousEnd = entry.span.end;
    }

    frames.push({
      body: seed ? seed.body.start : -1,
      from,
      to: items.length,
      ticks: tick,
      span: seed ? { ...seed.span } : { start: 0, end: source.length, line: 1 },
      runs: seed ? seed.runs : [],
    });
  }

  growUnits(source, commands, items);

  for (let at = 0; at < items.length; at++) {
    const item = items[at];
    // A unit that reached back over its own octave has taken text the previous
    // item's prefix would otherwise claim.
    if (item.unitSpan.start < item.prefixSpan.end) {
      item.prefixSpan = { ...item.prefixSpan, end: item.unitSpan.start };
    }

    if (item.kind === 'construct') {
      continue;
    }

    // Read off the unit boundaries rather than the prefix: a `$DD` written after
    // the channel's last item is in no prefix at all, and it rides on that item
    // exactly as any other does. From the *first* segment's end and not the
    // unit's, because a tie written after the command — `f+2 $DD $00 $D6 a+^2` —
    // puts the `$DD` between two of the note's frames, and `growUnits` ends a
    // unit at its last one, so a scan from there reaches past a slide the note
    // really does carry and no item claims it at all. Bounded to the item's own
    // frame, whose text ends at the closing bracket a body's last note rides to.
    const frame = frames[item.frame];
    const next = at + 1 < frame.to ? items[at + 1] : null;
    const until = next?.unitSpan.start ?? frame.span.end;
    item.bend =
      commands.find(
        (command) =>
          command.vcmd === 0xdd &&
          !command.inRemoteDefinition &&
          command.span.start >= item.segments[0].span.end &&
          command.span.start < until,
      ) ?? null;
  }

  const disagreement = expandAndJoin(items, frames, constructAt, timeline, channel);
  if (disagreement !== null) {
    return { refused: disagreement };
  }

  for (const item of items) {
    // A note is corroborated by the walk note its first instance joined to; a
    // rest or a construct sounds nothing to join, so the pass cut is the test.
    item.verified =
      timeline.ticks === 0 ||
      (item.kind === 'note'
        ? item.instances[0]?.note != null
        : (item.instances[0]?.tick ?? 0) < timeline.ticks);
    if (item.kind === 'note') {
      item.slide = item.instances[0]?.note?.bend ?? null;
      item.remapFed =
        frames[item.frame].body >= 0 &&
        item.drum === null &&
        item.instances[0]?.note?.percussion != null;
    }
  }

  return { channel, items, frames, ticks: frames[0].ticks, home, commands };
}

function isDiscovered(
  outcome: { seeds: FrameSeed[]; constructs: ConstructSeed[] } | StripRefusal,
): outcome is { seeds: FrameSeed[]; constructs: ConstructSeed[] } {
  return (outcome as StripRefusal).refused === undefined;
}

/**
 * The strip's own prediction of the voice's full play order, checked against
 * the walk note by note — the generalization of the old prefix agreement, which
 * it degenerates to on a channel with no constructs.
 *
 * The frames are expanded through their runs: a construct asserts that the next
 * run at its call site enters on the tick the expansion has reached, and every
 * pass of it re-walks the body frame, so one written note predicts one instance
 * per pass. Every walk note must then match its prediction on address, tick and
 * ticks; predictions past the pass cut stay unmatched — editable, just not
 * corroborated, the standing the old gate gave the tail. The matches are what
 * fill {@link StripItem.instances}, so the join and the agreement cannot drift.
 */
function expandAndJoin(
  items: StripItem[],
  frames: readonly StripFrame[],
  constructAt: ReadonlyMap<number, ConstructSeed>,
  timeline: SongTimeline,
  channel: number,
): string | null {
  /** Instance lists under construction — `StripItem.instances` is readonly. */
  const collected = items.map((): StripInstance[] => []);
  const predicted: { item: number; tick: number }[] = [];
  /** How many runs each call site has consumed, so passes replay in walk order. */
  const consumed = new Map<ConstructSeed, number>();
  let failed = false;

  const frameOf = new Map<number, number>();
  frames.forEach((frame, at) => {
    if (frame.body >= 0) {
      frameOf.set(frame.body, at);
    }
  });

  const expand = (frame: number, base: number, stack: readonly number[]): number => {
    if (failed || stack.includes(frame)) {
      failed = true;
      return 0;
    }

    let tick = base;
    for (let at = frames[frame].from; at < frames[frame].to; at++) {
      const item = items[at];
      const construct = constructAt.get(at);
      if (item.kind === 'construct' && construct) {
        const used = consumed.get(construct) ?? 0;
        const run = construct.runs[used];
        consumed.set(construct, used + 1);
        const body = frameOf.get(item.address);
        if (!run || body === undefined || run.passes[0].tick !== tick) {
          failed = true;
          return 0;
        }

        collected[at].push({ tick, note: null });
        for (const pass of run.passes) {
          if (pass.tick !== tick || expand(body, tick, [...stack, frame]) !== pass.ticks) {
            failed = true;
            return 0;
          }

          tick += pass.ticks;
        }

        continue;
      }

      collected[at].push({ tick, note: null });
      if (item.kind === 'note') {
        predicted.push({ item: at, tick });
      }

      tick += item.ticks;
    }

    return tick - base;
  };

  expand(0, 0, []);

  // Every run has to have been consumed exactly as often as its site was
  // reached — one left over is a call the text cannot account for.
  for (const [construct, used] of consumed) {
    if (used !== construct.runs.length) {
      failed = true;
    }
  }

  for (const construct of constructAt.values()) {
    if (!consumed.has(construct)) {
      failed = true;
    }
  }

  if (failed) {
    return OUT_OF_ORDER;
  }

  const played = timeline.notes.filter((note) => note.channel === channel);
  if (played.length > predicted.length) {
    return 'this channel plays more notes than it has written';
  }

  for (let at = 0; at < played.length; at++) {
    const note = played[at];
    const guess = predicted[at];
    const item = items[guess.item];
    if (note.address !== item.address || note.tick !== guess.tick || note.ticks !== item.ticks) {
      return OUT_OF_ORDER;
    }
  }

  // The instances were collected in play order per item, and the walk's notes
  // are matched in that same order, so the k-th entry of an item's list is its
  // k-th pass — which is what makes the join exact rather than a second one.
  for (let at = 0; at < played.length; at++) {
    const guess = predicted[at];
    const list = collected[guess.item];
    const slot = list.findIndex((instance) => instance.tick === guess.tick);
    if (slot >= 0) {
      list[slot] = { tick: guess.tick, note: played[at] };
    }
  }

  items.forEach((item, at) => {
    item.instances = collected[at];
  });

  return null;
}
