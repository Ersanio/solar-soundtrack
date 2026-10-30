import {
  octaveFor,
  parseWrittenPitch,
  spellDuration,
  spellNote,
  spellOctave,
  spellQ,
  spellRest,
} from '@amk/core/mml-text';
import type { Span } from '@amk/core/types';
import { type LoopRun, replacedByNextInSlot } from '@amk/spc/song-walk';
import { type Command, tokenize } from '@amk/tokens';
import { commandScope, isPercussionInstrument } from '@amk/tokens/commands/in-force';
import { MAX_LOOP_COUNT } from '@amk/tokens/commands/loops';
import {
  commandRewritable,
  type Edit,
  insertAt,
  padAround,
  spliceOut,
  spliceRange,
} from '@amk/tokens/edits';
import {
  type EditContext,
  type EditRefusal,
  type FramePlan,
  type PlacedNote,
  type Plan,
  REFUSE_BEND_RIDER,
  REFUSE_CLASH,
  REFUSE_CROWDED,
  REFUSE_INSIDE,
  REFUSE_LOOP_BODY_ROOM,
  REFUSE_LOOP_LEAD_ROOM,
  REFUSE_LOOP_LEFT_PASS,
  REFUSE_NESTED_LOOP,
  REFUSE_RAMP,
  REFUSE_SPELL,
  REFUSE_SUB_SPLIT,
  framePasses,
  isEdits,
  plannedFrameTicks,
} from './roll-edit';
import { octaveModel } from './roll-octave';
import {
  COMMENT,
  type LoopSite,
  type Strip,
  type StripFrame,
  type StripItem,
  channelMarkers,
} from './roll-strip';

/** The first interior index of a region — the frame's head where no note bounds it. */
function interiorFrom(gap: Region, frame: StripFrame): number {
  return gap.after < 0 ? frame.from : gap.after + 1;
}

/**
 * An accepted plan as text: the splices that put it in the document.
 *
 * It decides nothing about the **music** — which notes there are, on which tick,
 * at which pitch, are all settled by `roll-edit.ts` before it is called, and a
 * plan that is refused never reaches it — and everything about the **spelling**,
 * down to whether a note is rewritten where it stands or lifted out and written
 * again on the far side of one it was carried past. It can also refuse a
 * spelling it cannot produce.
 *
 * Nothing here knows about Angular, the DOM or pixels, so `rolltest` drives it
 * against a real compile and checks the result by walking it.
 */

function refuse(reason: string): EditRefusal {
  return { refused: reason };
}

/** A plan is committable when nothing is refused and nothing would sound at once. */
function committable(plan: Plan): boolean {
  return plan.refused === null && plan.clashes.length === 0;
}

/** The document's own line ending, so a block written into it matches the rest. */
export function eol(source: string): string {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

/** The octave {@link channelOpening} writes, and so the one it leaves in force. */
const OPENING_OCTAVE = 4;

/** `q[channel]` before anything sets it (`parser.ts:200`). */
const OPENING_Q = 0x7f;

/**
 * The state a fresh channel runs under, written out, so that nothing it plays
 * depends on what the block above it happened to leave standing.
 *
 * `octave` is one variable and leaks past a `#N`, which does not reset it
 * (`parser.ts:parseHash`), so `o4` is what a channel runs at only while nothing
 * has moved it (`parser.ts:193`). `q` and `@` are per channel and start at `$7F`
 * and 0 (`parser.ts:200`, `:199`). `v` and `y` are not parse-time state at all:
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
function channelOpening(channel: number, songTargetProgram: number): string {
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
function writtenLength(source: string, item: StripItem): string {
  const head = item.segments[0].span;
  return source.slice(head.start + headLength(source, item), head.end);
}

/**
 * A note written out: the octave in front of it, the note, its length, and the
 * octave put back after it where one is needed.
 */
function noteText(
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
  // the byte (`parser.ts:2911-2916`), so the `@` is the whole edit and no octave
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
 * Whether a note sets its own absolute octave, so an octave put back in front of
 * it would be saying the same thing twice.
 *
 * Including a note this same plan is moving: transposing a run of four would
 * otherwise write `o5 c o4 o5 d o4 o5 e o4 o5 f`, where every restore is undone
 * by the octave immediately after it.
 */
function writesItsOwnOctave(
  strip: Strip,
  index: number,
  survivors: ReadonlyMap<number, PlacedNote>,
): boolean {
  const note = strip.items[index];
  const planned = survivors.get(index);
  return (
    note.hasLeadingOctave || (planned?.drum === null && octaveFor(planned.written) !== note.octave)
  );
}

/**
 * The drum `@` a note plays that is written somewhere other than beside it
 * (`roll-strip.ts:drumApart`), or `null`. A rest between the two does not consume
 * it, so it is the note's alone: it goes when the note does, and has to stand
 * after any note written in front of it.
 */
function drumApart(item: StripItem): Command | null {
  return item.drum !== null && item.drum.span.end <= item.unitSpan.start ? item.drum : null;
}

/** Whether a run is being written into the region straight after `index`, or the one ending at it. */
function runAfter(regions: readonly Region[], index: number): boolean {
  return regions.some((region) => region.after === index && region.born.length > 0);
}

function runBefore(regions: readonly Region[], index: number): boolean {
  return regions.some((region) => region.before === index && region.born.length > 0);
}

/** Whether a run is laid over the item, which takes its whole unit out. */
function underRun(regions: readonly Region[], frame: StripFrame, index: number): boolean {
  return regions.some(
    (region) =>
      region.born.length > 0 && index >= interiorFrom(region, frame) && index < region.before,
  );
}

/**
 * What the edited text does with the octave first, after `index`'s unit.
 *
 * `'read'` where a note, a loop or a run being written reads it before anything
 * sets it, `'set'` where a note writes its own first, `'end'` where nothing
 * follows. A note being removed takes its own `o`s and its read with it; what is
 * written between its segments stays, and so does everything between units.
 *
 * Past the end of a body the text runs on into whatever follows the closing
 * bracket, which another frame of the same gesture may be rewriting, so that
 * answers `'read'`. Past the end of the channel it is the document's own next
 * event, `octave` being one variable that a `#N` does not reset.
 */
function octaveNext(
  context: EditContext,
  index: number,
  survivors: ReadonlyMap<number, PlacedNote>,
  regions: readonly Region[],
): 'read' | 'set' | 'end' {
  const { strip, frame } = context;
  const { octaves } = strip;
  if (runAfter(regions, index)) {
    return 'read';
  }

  let from = strip.items[index].unitSpan.end;
  for (let at = index + 1; at < frame.to; at++) {
    const item = strip.items[at];
    const between = octaves.first(from, item.unitSpan.start);
    if (between !== null) {
      return between;
    }

    if (item.kind === 'construct') {
      // A body written here reads what its text reads first; a recall parses no
      // notes, and the octave passes it by.
      const inner = octaves.first(item.unitSpan.start, item.unitSpan.end);
      if (inner !== null) {
        return inner;
      }

      from = item.unitSpan.end;
      continue;
    }

    if (item.kind === 'note' && survivors.has(at)) {
      return writesItsOwnOctave(strip, at, survivors) ? 'set' : 'read';
    }

    if (item.kind === 'note') {
      // A removed note: its read goes, and so do its own `o`s but the ones kept.
      const head = item.segments[0];
      const last = item.segments[item.segments.length - 1];
      const kept = underRun(regions, frame, at)
        ? { lead: false, trail: false }
        : keptOctaves(context, item);
      const found =
        (kept.lead ? octaves.first(item.unitSpan.start, head.span.start) : null) ??
        octaves.first(head.span.end, last.span.start) ??
        (kept.trail ? octaves.first(last.span.end, item.unitSpan.end) : null);
      if (found !== null) {
        return found;
      }
    } else {
      const found = octaves.first(item.unitSpan.start, item.unitSpan.end);
      if (found !== null) {
        return found;
      }
    }

    from = item.unitSpan.end;
  }

  return frame.body >= 0 ? 'read' : octaves.next(from);
}

/**
 * The octave to put back after a note whose own has been rewritten: the one in
 * force after the unit as it was written, or `null` where nothing reads it
 * before something sets it again ({@link octaveNext}).
 */
function exitOctaveFor(
  context: EditContext,
  index: number,
  survivors: ReadonlyMap<number, PlacedNote>,
  regions: readonly Region[],
): number | null {
  const item = context.strip.items[index];
  const exit = item.exitOctave ?? item.octave;
  return octaveNext(context, index, survivors, regions) === 'read' ? exit : null;
}

/**
 * The octave put back after a note, as the text that follows it.
 *
 * `''` where nothing is needed — a drum writes no octave to put back, and an
 * exit the note is already at is written by the note itself. `null` where `o`
 * cannot reach the octave asked for, which `<` and `>` can (`spellOctave`).
 */
function exitText(note: PlacedNote, exitOctave: number | null): string | null {
  if (exitOctave === null || note.drum !== null || exitOctave === octaveFor(note.written)) {
    return '';
  }

  const spelled = spellOctave(exitOctave);
  return spelled === null ? null : ` ${spelled}`;
}

/**
 * The octaves a drum's own unit carried, as the text to put back around it.
 *
 * `leadsAUnit` takes an `o` as well as a percussion `@` (`roll-strip.ts`), so a
 * drum's unit reaches over its `@` to an octave written beside it — and a drum
 * is written `@21 c<length>`, the letter having no say in the byte, so
 * {@link noteText} spells none and the splice would take that `o` away. It is
 * the octave every note after the drum is standing in, and a lane change says
 * nothing about it, so it is **restated** rather than respelled. `null` where
 * `o` cannot reach what was written.
 */
function drumOctaves(item: StripItem): { lead: string; exit: string } | null {
  // `channelStrip` refuses a channel whose note it cannot read an octave from,
  // so `-1` is unreachable rather than a case with an answer — and it refuses
  // through `spellOctave`, since dropping the `o` is the whole failure here.
  const lead = item.hasLeadingOctave ? spellOctave(item.octave ?? -1) : '';
  // Only an `o` the unit holds after its last segment; one standing between its
  // segments is not part of the splice and stays.
  const trailing = item.unitSpan.end > item.segments[item.segments.length - 1].span.end;
  const exit = !trailing || item.exitOctave === null ? '' : spellOctave(item.exitOctave);
  if (lead === null || exit === null) {
    return null;
  }

  return { lead: lead === '' ? '' : `${lead} `, exit: exit === '' ? '' : ` ${exit}` };
}

/**
 * The end of an item, past the `$DD` it carries.
 *
 * Where a run is written after a note, "after" has to mean after the whole of
 * what the driver reads as part of that note. See {@link writeInto}.
 */
function afterBend(item: StripItem): number {
  return Math.max(item.unitSpan.end, item.bend?.span.end ?? 0);
}

/**
 * `text`, with the comments the span it replaces holds put back after it.
 *
 * The parser never sees a comment (`roll-strip.ts:COMMENT`), so a rest it folded
 * across a `;` line has the comment inside its span. Each goes back with its own
 * line end, which is where it stood.
 */
function keepingComments(source: string, span: Span, text: string): string {
  const comments = source.slice(span.start, span.end).match(COMMENT);
  if (comments === null) {
    return text;
  }

  const line = eol(source);
  return `${text}${comments.map((comment) => ` ${comment}${line}`).join('')}`;
}

/** A unit's text replaced, keeping its comments. */
function spliceUnit(source: string, span: Span, text: string): Edit | null {
  return spliceRange(source, span, keepingComments(source, span, text));
}

/** A span and the whitespace in front of it taken out, keeping its comments. */
function removeSpan(source: string, span: Span): Edit[] {
  const edit = spliceOut(source, span);
  return edit ? [{ ...edit, text: keepingComments(source, span, edit.text) }] : [];
}

/** The unit and the whitespace in front of it, so a deletion leaves no double space. */
function removeItem(source: string, item: StripItem): Edit[] {
  return removeSpan(source, item.unitSpan);
}

/**
 * Whether anything in the edited song still sounds under a command.
 *
 * The one test that decides whether a removed item's declaration goes with it,
 * and it names no gesture: what a `v200` reaches is a fact about the song after
 * the edit, where "a carve took these ticks" is a fact about the edit path.
 *
 * `tick` is the command's own — the start of the item whose prefix holds it,
 * since a prefix runs just before the item it stands in front of. The scan
 * carries forward from that item looking for a note that **begins** at or after
 * it with the command still in force, which is `WalkCommand.onANote`'s question
 * asked of the plan rather than of the pass.
 *
 * Where a slot changes hands is the walk's own answer and not a table restated
 * here: the first note the pass played without the command in `origins` is the
 * note something else had taken the slot by. That is what makes `v200 c4 v100
 * d4` answer "nothing" for the `v200` while `v200 c4 d4` answers "`d4`", with no
 * source-side notion of which commands write the same thing.
 *
 * A note the pass never reached answers `true`: past the shortest channel the
 * walk has nothing to say, and a command is dropped only where something can say
 * it reaches nothing.
 */
function reachesSomething(
  context: EditContext,
  command: Command,
  tick: number,
  from: number,
  survivors: ReadonlyMap<number, PlacedNote>,
  born: readonly PlacedNote[],
): boolean {
  const { strip } = context;

  // Inside a body the question is unprovable: a command there is read once per
  // pass under per-instance state, and a `q` written in a body writes the
  // caller's slot as well as the block's — so the conservative answer is the
  // one the scan already gives a note past the pass cut, and the command stays.
  if (context.frame.body >= 0) {
    return true;
  }

  /** Where the slot changed hands, and so where this command stops reaching. */
  let end = Number.POSITIVE_INFINITY;
  for (let index = from; index < context.frame.to; index++) {
    const item = strip.items[index];
    // A loop's body may still read the command on any of its passes, and the
    // scan cannot see inside it — so nothing past this point can prove the
    // command reaches no one.
    if (item.kind === 'construct') {
      return true;
    }

    if (item.kind !== 'note' || item.startTick < tick) {
      continue;
    }

    if (!item.verified) {
      return true;
    }

    const acting = context.inForce(item.address);
    if (acting === null) {
      return true;
    }

    if (!acting.includes(command)) {
      end = item.startTick;
      break;
    }

    if (survivors.has(index)) {
      return true;
    }
  }

  return born.some((note) => note.startTick >= tick && note.startTick < end);
}

/**
 * Whether {@link reachesSomething} can speak for a command at all: a byte-less
 * `q`, `h` or drum `@` the walk folds into a note, or one whose slot the next
 * write takes over whole (`replacedByNextInSlot`). A switch-off, a `$F4` toggle
 * or a one-shot write is never shown in force at a note, so a note playing
 * without it proves nothing, and it stays.
 */
function droppable(command: Command): boolean {
  return (
    command.vcmd === undefined || replacedByNextInSlot(command.vcmd, command.args[0]?.value ?? 0)
  );
}

/**
 * The commands an item wholly overwritten takes with it: the `'note-state'`
 * ones in its prefix, which are its own declarations and nobody else's. A `t`
 * or a `w` acts on the whole song, an `l`, an `o`, a `<` or a `>` is parse
 * state every later note reads, and the intro `/` and a comment are not
 * commands at all — all of those stay exactly where they are written.
 *
 * The scope test is also the overlap guard: a trailing `o` claimed by the
 * previous unit (`roll-strip.ts:trailsAUnit`) lies inside both that unit's span
 * and this prefix, and `'position'` is what keeps the deletion off it.
 *
 * Callers skip the channel's first item, whose prefix reaches back over the
 * channel's own header: what stands above the first note or rest is the
 * channel's setup rather than that item's declaration.
 */
function prefixCommandsOf(strip: Strip, item: StripItem): Command[] {
  return strip.commands.filter(
    (command) =>
      command.span.start >= item.prefixSpan.start &&
      command.span.end <= item.prefixSpan.end &&
      !command.inRemoteDefinition &&
      // `$DD` is `'note-state'` and is nonetheless never this item's
      // declaration: it is read by the note *before* it (`main.asm:L_10E4`), so
      // it sits in this prefix while belonging to the item behind it, and
      // `reachesSomething` — which scans forward — has no way to say so. Left
      // where it was written, which is where `StripItem.bend` keeps track of it.
      command.vcmd !== 0xdd &&
      commandScope(command) === 'note-state',
  );
}

/**
 * The commands written between two of an item's segments, each on the tick it
 * runs at.
 *
 * A unit is more than one segment only where the porter wrote something between
 * the head and a `^` continuation (`roll-strip.ts:segments`), so this is the
 * mid-note ramp and whatever else stands with it. Every scope, not just
 * `'note-state'`: {@link removeItem} splices the whole unit, so a `t` written in
 * there would go as quietly as a `v`, and the caller has to know it is there.
 */
function insideCommands(strip: Strip, item: StripItem): { command: Command; tick: number }[] {
  const out: { command: Command; tick: number }[] = [];
  let at = item.startTick;
  for (let part = 1; part < item.segments.length; part++) {
    at += item.segments[part - 1].ticks;
    const from = item.segments[part - 1].span.end;
    const to = item.segments[part].span.start;
    for (const command of strip.commands) {
      // A `$DD` between two of a note's frames is that note's rider rather than
      // a command written inside it — it has no tick of its own, arming where
      // the read-ahead finds it — and `StripItem.bend` is what answers for it.
      if (command.vcmd === 0xdd) {
        continue;
      }

      if (command.span.start >= from && command.span.end <= to) {
        out.push({ command, tick: at });
      }
    }
  }

  return out;
}

/** A prefix command and the whitespace in front of it, as {@link removeItem} takes a unit. */
function removeCommand(source: string, command: Command): Edit[] {
  const edit = spliceOut(source, command.span);
  return edit ? [edit] : [];
}

/** Whether the born notes cover every tick of the rest. `order` is in tick order. */
function coveredByBorn(order: readonly PlacedNote[], rest: StripItem): boolean {
  let at = rest.startTick;
  for (const note of order) {
    if (note.startTick > at) {
      return false;
    }

    at = Math.max(at, note.startTick + note.ticks);
    if (at >= rest.startTick + rest.ticks) {
      return true;
    }
  }

  return false;
}

/** A survivor's splices, and the octave its text leaves standing once they land. */
interface Rewrite {
  edits: Edit[];
  leaves: number | null;
}

function isRewrite(outcome: Rewrite | EditRefusal): outcome is Rewrite {
  return (outcome as EditRefusal).refused === undefined;
}

/** What one surviving note needs written, which is usually nothing at all. */
function rewriteNote(
  context: EditContext,
  index: number,
  note: PlacedNote,
  survivors: ReadonlyMap<number, PlacedNote>,
  regions: readonly Region[],
  running: number | null,
): Rewrite | EditRefusal {
  const { source, strip, targetAMKVersion } = context;
  const { octaves } = strip;
  const item = strip.items[index];
  const samePitch =
    note.written === item.written && note.drum === (item.drum?.args[0]?.value ?? null);
  const sameLength = note.ticks === item.ticks;
  if (samePitch && sameLength) {
    return { edits: [], leaves: octaves.carry(running, item.unitSpan.start, item.unitSpan.end) };
  }

  const exit = exitOctaveFor(context, index, survivors, regions);
  // Empty for a pitched note, which spells its own octaves through `noteText`.
  const around = note.drum === null ? { lead: '', exit: '' } : drumOctaves(item);
  if (around === null) {
    return refuse(REFUSE_SPELL);
  }

  // An `o` the porter wrote at this note is theirs, and a note that keeps its
  // octave keeps saying so — a channel's opening `o4` is not redundancy to tidy.
  const stated = item.hasLeadingOctave && octaveFor(note.written) === item.octave;
  const standing = stated ? null : running;

  const last = item.segments[item.segments.length - 1];
  /**
   * What the rewritten unit leaves: a pitched note its own octave moved on by
   * whatever is written between its segments, which stays; a drum the unit's own
   * octaves, which {@link drumOctaves} restates.
   */
  const own =
    note.drum === null
      ? octaves.carry(octaveFor(note.written), item.segments[0].span.end, last.span.start)
      : octaves.carry(running, item.unitSpan.start, item.unitSpan.end);
  const leaves = note.drum === null && exit !== null ? exit : own;

  // One segment is one token, so the whole unit is rewritten together.
  if (item.segments.length === 1) {
    const length = sameLength ? writtenLength(source, item) : null;
    const text = noteText(note, length, exit, targetAMKVersion, standing);
    if (text === null) {
      return refuse(REFUSE_SPELL);
    }

    const edit = spliceUnit(source, item.unitSpan, `${around.lead}${text}${around.exit}`);
    return { edits: edit ? [edit] : [], leaves };
  }

  // The command inside the note stands a number of ticks into it, and only the
  // last continuation is rewritten, so a change that moves the note's **start**
  // carries the command along with it: the note keeps the ticks it kept, and the
  // ramp written inside them fires later than it was written to. Which ticks the
  // porter meant to keep is not something the gesture says, so it is refused.
  if (note.startTick !== item.startTick) {
    return refuse(REFUSE_INSIDE);
  }

  // More than one segment means a command sits inside the note — a mid-note
  // volume ramp is the usual one. Only the head and the last continuation are
  // rewritten, so the command keeps its place; a length below what the earlier
  // segments already hold has nowhere to go.
  const earlier = item.segments.slice(0, -1).reduce((sum, segment) => sum + segment.ticks, 0);
  const remaining = note.ticks - earlier;
  if (remaining < 1) {
    return refuse(REFUSE_RAMP);
  }

  const edits: Edit[] = [];
  const headSpan: Span = { ...item.unitSpan, end: item.segments[0].span.end };
  const headText = noteText(note, writtenLength(source, item), null, targetAMKVersion, standing);
  if (headText === null) {
    return refuse(REFUSE_SPELL);
  }

  const headEdit = spliceUnit(source, headSpan, `${around.lead}${headText}`);
  if (headEdit) {
    edits.push(headEdit);
  }

  const length = spellDuration(remaining, targetAMKVersion);
  if (length === null) {
    return refuse(REFUSE_SPELL);
  }

  // Against what the head and the text inside the note leave, not the head alone:
  // a `<` written before the `^` is still there.
  const spelled = exit === null || note.drum !== null || exit === own ? '' : spellOctave(exit);
  if (spelled === null) {
    return refuse(REFUSE_SPELL);
  }

  const tailEdit = spliceUnit(
    source,
    { start: last.span.start, end: item.unitSpan.end, line: last.span.line },
    `^${length}${spelled === '' ? '' : ` ${spelled}`}${around.exit}`,
  );
  if (tailEdit) {
    edits.push(tailEdit);
  }

  return { edits, leaves };
}

/** One stretch of text between two surviving notes, and what has to go in it. */
interface Region {
  /** Index of the note before it, or -1 for the head of the channel. */
  after: number;
  /** Index of the note after it, or `items.length` for the tail. */
  before: number;
  /** The rests written in it now. */
  rests: StripItem[];
  /** How many items of any kind are in it, so a spawn can tell a plain rest from a crowd. */
  between: number;
  /** Ticks it has to come to, or -1 for the tail, which may be any length. */
  ticks: number;
  /**
   * The stretch after the last note, which a channel may end wherever it likes.
   *
   * Carried rather than read off {@link Region.ticks} being negative: a gap
   * between two notes comes out negative too, when a plan asks for them in an
   * order the text does not have them in, so a negative count means either "the
   * tail, and any length will do" or "these two notes have swapped places", and
   * nothing in the number says which. This is a fact about where the region is.
   */
  tail: boolean;
  /** Notes being created in it, in tick order. */
  born: PlacedNote[];
  /** Where it starts, in ticks. */
  startTick: number;
}

/**
 * Rests in the order they are written, taken out but the first, which is written
 * as all of them — or every one taken out where they come to nothing. What
 * `resizeLoop` rewrites a body's trailing or leading rests with.
 */
function collapse(context: EditContext, rests: readonly StripItem[], want: number): Edit[] | null {
  const { source, targetAMKVersion } = context;
  const edits: Edit[] = [];
  for (const gone of rests.slice(1)) {
    edits.push(...removeItem(source, gone));
  }

  if (want <= 0) {
    edits.push(...removeItem(source, rests[0]));
    return edits;
  }

  const text = spellRest(want, targetAMKVersion);
  if (text === null) {
    return null;
  }

  const edit = spliceUnit(source, rests[0].unitSpan, `r${text}`);
  if (edit) {
    edits.push(edit);
  }

  return edits;
}

/** One stretch of a region's rest time: a segment of a rest, or of a note the plan removes. */
interface Piece {
  /** The text that goes with it — a removed note's first and last pieces take its own `o`s. */
  span: Span;
  startTick: number;
  ticks: number;
  item: StripItem;
  /** A note the plan removes, as against a rest already written. */
  removed: boolean;
}

/**
 * Which of a removed note's own `o`s stay in the text: one something still reads,
 * so the notes after it keep the octave they were written under with nothing put
 * back. One that only ever fed this note is dropped with it. Not where the unit
 * also holds the drum `@` this note consumed, which goes with it.
 */
function keptOctaves(context: EditContext, item: StripItem): { lead: boolean; trail: boolean } {
  const { octaves } = context.strip;
  const head = item.segments[0];
  const last = item.segments[item.segments.length - 1];
  const fedDrum =
    item.drum !== null &&
    item.drum.span.start >= item.unitSpan.start &&
    item.drum.span.start < head.span.start;
  return {
    lead: item.hasLeadingOctave && !fedDrum && octaves.next(head.span.end) === 'read',
    trail: item.unitSpan.end > last.span.end && octaves.next(item.unitSpan.end) === 'read',
  };
}

/** The region's interior as pieces, in text order: one per segment of each rest and removed note. */
function piecesOf(context: EditContext, gap: Region): Piece[] {
  const { strip, frame } = context;
  const pieces: Piece[] = [];
  for (let index = interiorFrom(gap, frame); index < gap.before; index++) {
    const item = strip.items[index];
    const kept = item.kind === 'note' ? keptOctaves(context, item) : { lead: false, trail: false };
    let tick = item.startTick;
    item.segments.forEach((segment, at) => {
      const first = at === 0;
      const last = at === item.segments.length - 1;
      pieces.push({
        span: {
          start: first && !kept.lead ? item.unitSpan.start : segment.span.start,
          end: last && !kept.trail ? item.unitSpan.end : segment.span.end,
          line: segment.span.line,
        },
        startTick: tick,
        ticks: segment.ticks,
        item,
        removed: item.kind === 'note',
      });
      tick += segment.ticks;
    });
  }

  return pieces;
}

/**
 * Whether a command has to stay on its tick when rests are rewritten around it.
 *
 * A command that emits a byte is read at a tick. An `o`, an `l`, a `<` or a `>`
 * is parse state, and `q`, `h` and a drum `@` fold into the next note, so none of
 * them says anything about time and each may stand anywhere among rests.
 */
function emitsAByte(command: Command): boolean {
  const kind = command.kind.toLowerCase();
  return (
    commandScope(command) !== 'position' &&
    kind !== 'q' &&
    kind !== 'h' &&
    !isPercussionInstrument(command)
  );
}

/**
 * Whether the text in `[from, to)` has to keep its tick: a command that emits a
 * byte, or the intro `/`. A command this plan deletes is gone already.
 */
function pinned(context: EditContext, from: number, to: number, deleted: readonly Span[]): boolean {
  const { strip } = context;
  if (strip.intros.some((span) => span.start >= from && span.start < to)) {
    return true;
  }

  return strip.commands.some(
    (command) =>
      command.span.start >= from &&
      command.span.start < to &&
      command.noteLength === undefined &&
      !deleted.some((span) => span.start === command.span.start) &&
      emitsAByte(command),
  );
}

/** The text between two of a region's pieces, and the tick it stands at. */
interface Bound {
  tick: number;
  /** Whether it holds anything that has to stay on that tick — see {@link pinned}. */
  hard: boolean;
  /** Whether it stands between two segments of one item, rather than between items. */
  inside: boolean;
}

/** A stretch of rest between two hard bounds, and the pieces written in it now. */
interface RestRun {
  pieces: Piece[];
  from: number;
  to: number;
}

/**
 * The rests between two notes, made to come to the ticks the plan asks for.
 *
 * Everything in the gap that is read at a tick keeps it: a `v200`, a `t60` and
 * the intro `/` stand where the command lane shows them. So the change goes to
 * the rest beside whichever note moved — after the note in front when its end
 * moved, before the note behind when its start did — and a note the plan removes
 * becomes rest where it stood. Between two such commands, rests and removed notes
 * are one stretch of rest, written as the one rest they are; a stretch that comes
 * to what it already held and lost no note is left exactly as written.
 *
 * A tail keeps the channel's length — or the body's, inside a loop — unless the
 * music now reaches past it. Shortening a loop is the box's right-end resize.
 *
 * A command a note has come to cover cannot keep its tick and is moved to the
 * note's edge; one written between two segments of an item moved that way is
 * refused instead, since which side of the item it belongs on is not something
 * the gesture says.
 */
function realiseRegion(
  context: EditContext,
  gap: Region,
  survivors: ReadonlyMap<number, PlacedNote>,
  deleted: readonly Span[],
): Edit[] | EditRefusal {
  const { source, strip, frame, targetAMKVersion } = context;

  // A gap between two notes that has to come to less than nothing is a plan
  // asking for them in an order the text does not have them in, which
  // `crossings` takes out before the regions are built. Refused rather than
  // written: there is no run of rests that realises it.
  if (!gap.tail && gap.ticks < 0) {
    return refuse(REFUSE_CROWDED);
  }

  if (gap.born.length > 0) {
    return spawnInto(context, gap, survivors, deleted);
  }

  const before = gap.after >= 0 ? strip.items[gap.after] : null;
  const after = gap.before < frame.to ? strip.items[gap.before] : null;
  const oldStart = before ? before.startTick + before.ticks : 0;
  const oldEnd = after ? after.startTick : frame.ticks;
  const newStart = gap.startTick;
  const newEnd = gap.tail ? Math.max(newStart, oldEnd) : newStart + gap.ticks;
  const pieces = piecesOf(context, gap);

  // Past a slide the note in front carries, which rides it and not the gap.
  const leadFrom = before ? afterBend(before) : -1;
  const trailTo = after ? after.unitSpan.start : frame.body >= 0 ? frame.span.end : strip.home.at;

  const bound = (from: number, to: number, tick: number, inside: boolean): Bound => ({
    tick,
    inside,
    hard: from >= 0 && pinned(context, from, to, deleted),
  });

  /** Bound `k` stands in front of piece `k`; the last one closes the region. */
  const bounds: Bound[] = [];
  if (pieces.length === 0) {
    bounds.push(bound(leadFrom, trailTo, oldStart, false));
  } else {
    bounds.push(bound(leadFrom, pieces[0].span.start, oldStart, false));
    for (let at = 1; at < pieces.length; at++) {
      const inside = pieces[at - 1].item === pieces[at].item;
      bounds.push(
        bound(pieces[at - 1].span.end, pieces[at].span.start, pieces[at].startTick, inside),
      );
    }

    bounds.push(bound(pieces[pieces.length - 1].span.end, trailTo, oldEnd, false));
  }

  const runs: RestRun[] = [];
  let from = newStart;
  let open: Piece[] = [];
  for (let at = 0; at < bounds.length; at++) {
    const here = bounds[at];
    if (here.hard) {
      const pin = Math.min(newEnd, Math.max(newStart, here.tick));
      if (here.inside && pin !== here.tick) {
        return refuse(pieces[at].item.kind === 'note' ? REFUSE_INSIDE : REFUSE_CROWDED);
      }

      runs.push({ pieces: open, from, to: pin });
      from = pin;
      open = [];
    }

    if (at < pieces.length) {
      open.push(pieces[at]);
    }
  }

  runs.push({ pieces: open, from, to: newEnd });

  const edits: Edit[] = [];
  for (let at = 0; at < runs.length; at++) {
    const run = runs[at];
    const want = run.to - run.from;
    if (run.pieces.length === 0) {
      if (want <= 0) {
        continue;
      }

      const text = spellRest(want, targetAMKVersion);
      if (text === null) {
        return refuse(REFUSE_SPELL);
      }

      // The side that moved: the last stretch belongs to the note behind, unless
      // it is the only one and it was the note in front that moved.
      const trailing = at === runs.length - 1 && (runs.length > 1 || newStart === oldStart);
      const edit =
        trailing && after
          ? insertAt(after.unitSpan.start, `r${text} `, after.unitSpan.line)
          : before
            ? insertAt(afterBend(before), ` r${text}`, before.unitSpan.line)
            : writeInto(context, gap, `r${text}`);
      if (edit === null) {
        return refuse(REFUSE_CROWDED);
      }

      edits.push(edit);
      continue;
    }

    const held = run.pieces.reduce((sum, piece) => sum + piece.ticks, 0);
    if (want === held && run.pieces.every((piece) => !piece.removed)) {
      continue;
    }

    // A rest a `$DD` rides has to stay in front of it (`main.asm:L_10E4`), and the
    // command is a hard bound, so it is the last piece of its stretch.
    const last = run.pieces[run.pieces.length - 1];
    const ridden = last.item.bend !== null && last.item.bend.span.start >= last.span.end;
    const keeper = ridden ? last : run.pieces[0];
    if (ridden && want <= 0) {
      return refuse(REFUSE_CROWDED);
    }

    for (const piece of run.pieces) {
      if (piece !== keeper || want <= 0) {
        edits.push(...removeSpan(source, piece.span));
        continue;
      }

      const text = spellRest(want, targetAMKVersion);
      if (text === null) {
        return refuse(REFUSE_SPELL);
      }

      const edit = spliceUnit(source, piece.span, `r${text}`);
      if (edit) {
        edits.push(edit);
      }
    }
  }

  return edits;
}

/**
 * Where text written into a gap goes, and which side its space goes on.
 *
 * After the note before the gap where there is one. Where there is not, at the
 * head of the **next surviving** note rather than of the channel's first item —
 * the first item may be a note this same plan is deleting, and an insertion
 * inside a range being removed is two edits over one run of text, which
 * CodeMirror merges rather than refuses.
 *
 * A channel with neither note nor rest has no item to anchor to at all, and
 * takes {@link Strip.home}: the end of its own block, or the end of the document
 * with a whole `#N` written in front of it (see {@link channelOpening}). The run
 * goes on a line of its own either way, so a `;` comment ending the block above
 * cannot swallow it, and a new block is set off by a blank line unless it is
 * opening an empty document.
 */
function writeInto(context: EditContext, gap: Region, run: string): Edit | null {
  const { source, strip } = context;
  if (gap.after >= 0) {
    // After the last thing written in the region, which for a region holding
    // nothing is the note before it. A `/` or a command written between that
    // note and the region's own items stands on the boundary the two meet at,
    // and the run belongs after it: put in front, a marker would come out a
    // whole region late, and every channel resumes from its own on each pass.
    //
    // A `$DD` is the same rule for a harder reason. It is not dispatched: the
    // preceding note's read-ahead peeks at the byte standing at the track
    // pointer (`main.asm:L_10E4`), so anything emitting a byte in front of it
    // means the peek misses and the command loop reaches a slot holding `$0000`.
    // A rest written between the two would sound right up to the moment it
    // played.
    return insertAt(afterBend(strip.items[gap.before - 1]), ` ${run}`, 1);
  }

  const next = gap.before < context.frame.to ? strip.items[gap.before] : undefined;
  if (next) {
    return insertAt(next.unitSpan.start, `${run} `, 1);
  }

  // No note after it either, so the region is the whole frame and the run goes
  // where its items were: after the last of them, as the branch above puts it
  // after the note before the gap. Not at the head of the first — every item in
  // here is a unit `planEdits` removes, `removeItem` takes the whitespace in
  // front of the unit with it, and an insertion at a head therefore lands
  // strictly inside a range being deleted, which `planEdits` refuses. The end of
  // the last only abuts one.
  const last = gap.before - 1 >= context.frame.from ? strip.items[gap.before - 1] : undefined;
  if (last) {
    return insertAt(last.unitSpan.end, ` ${run}`, 1);
  }

  // A body frame holding no items at all — commands alone between its brackets.
  // The run goes at the interior's end, against the closing arm.
  if (context.frame.body >= 0) {
    return insertAt(context.frame.span.end, ` ${run}`, 1);
  }

  const line = eol(source);
  if (strip.home.declared) {
    return insertAt(strip.home.at, `${line}${run}`, 1);
  }

  const gapAbove = strip.home.at === 0 ? '' : `${line}${line}`;
  const opening = channelOpening(strip.channel, context.songTargetProgram);
  return insertAt(strip.home.at, `${gapAbove}${opening}${line}${run}`, 1);
}

/**
 * A rest on the end of every other channel that would stop the song before `to`.
 *
 * The driver reloads all eight track pointers the moment one voice reads its
 * `$00` (`main.asm:L_0C01`, `Music.cpp:3209`), so the song is as long as its
 * shortest channel and a note past that point is written, compiled and never
 * heard. Making it heard means making every other channel reach it.
 *
 * A rest is appended rather than a channel rewritten, and that is what makes
 * this possible on a real song: it takes no note map, no agreement with the
 * walk and no {@link Strip}, so a channel full of `[ ]` loops — which
 * `channelStrip` refuses outright — is padded like any other. The run goes on a
 * line of its own for the reason {@link writeInto} does it: a `;` comment ending
 * the block would otherwise swallow it.
 *
 * A channel at 0 ticks is left alone. It is holding nothing back, and giving it
 * ticks it never had is not what drawing a note asked for. So is the channel
 * being edited, which the gesture's own splices already carry out to the note.
 */
function padChannels(
  context: EditContext,
  to: number,
  grown: ReadonlyMap<number, number>,
): Edit[] | null {
  const { source, strip, targetAMKVersion } = context;
  const line = eol(source);
  const edits: Edit[] = [];

  for (const [channel, tail] of context.channels.entries()) {
    // A voice that plays the edited body has already moved by its own passes'
    // worth of the length change — its tick count here predates the edit.
    const ticks = tail.ticks + (grown.get(channel) ?? 0);
    if (channel === strip.channel || tail.ticks <= 0 || ticks >= to) {
      continue;
    }

    // A channel already ending on a rest has that rest lengthened, so padding the
    // same channel twice does not leave two rests side by side.
    const text = spellRest(to - ticks + (tail.rest?.ticks ?? 0), targetAMKVersion);
    if (text === null) {
      return null;
    }

    const edit = tail.rest
      ? spliceUnit(source, tail.rest.span, `r${text}`)
      : insertAt(tail.at, `${line}r${text}`, 1);
    if (edit) {
      edits.push(edit);
    }
  }

  return edits;
}

/**
 * How far the gap gesture may drag a construct leftward: the rest ticks
 * directly in front of it that can go without moving anything else.
 *
 * Closing space moves every command written after it, so a command in the
 * construct's own prefix leaves no slack at all, and a rest whose prefix holds
 * one may itself be consumed — the command stands before it and keeps its tick
 * — but ends the walk there: taking anything earlier would slide it. A rest
 * with a command **inside** its unit is a barrier outright, a respelling to
 * `r…` eating the command's text; so is one whose unit `growUnits` widened
 * past its own segments, which holds an `o` the same way, and one carrying a
 * `$DD`, which rides whatever stands in front of it.
 */
export function gapSlack(strip: Strip, at: number): number {
  return slackBefore(strip, at).ticks;
}

/**
 * {@link gapSlack}'s walk, with the item a full close would leave the construct
 * against.
 *
 * `abuts` is `null` where nothing is left standing there to name: the walk
 * stopped on a rest whose prefix holds a command, which keeps its tick and so
 * stays between the two, or it ran back off the root frame's start. Where the
 * item directly in front is not a rest at all the slack is 0 and `abuts` is
 * that item, which is how a pair already touching is told from a pair with
 * something between them.
 */
function slackBefore(strip: Strip, at: number): { ticks: number; abuts: number | null } {
  const root = strip.frames[0];
  const construct = strip.items[at];
  if (!construct || holdsCommands(strip, construct.prefixSpan.start, construct.prefixSpan.end)) {
    return { ticks: 0, abuts: null };
  }

  let ticks = 0;
  for (let index = at - 1; index >= root.from; index--) {
    const rest = strip.items[index];
    if (!respellable(strip, rest)) {
      return { ticks, abuts: index };
    }

    ticks += rest.ticks;
    if (holdsCommands(strip, rest.prefixSpan.start, rest.prefixSpan.end)) {
      return { ticks, abuts: null };
    }
  }

  return { ticks, abuts: null };
}

/**
 * Anything with a tick of its own written in `[from, to)`: `note-state` and
 * `song` commands, and a remote `$FC` call, which is no item and hides in a
 * prefix.
 *
 * A note or rest token is its item, `o` and `l` are parse state with no tick,
 * and both are how the windows that read this stay readable at all.
 */
function holdsCommands(strip: Strip, from: number, to: number): boolean {
  return strip.commands.some(
    (command) =>
      command.span.start >= from &&
      command.span.start < to &&
      command.noteLength === undefined &&
      commandScope(command) !== 'position',
  );
}

/**
 * Whether a rest's length may be rewritten or its unit taken out whole.
 *
 * A rest with a command **inside** its unit is a barrier outright, a respelling
 * to `r…` eating the command's text; so is one whose unit `growUnits` widened
 * past its own segments, which holds an `o` the same way, and one carrying a
 * `$DD`, which rides whatever stands in front of it.
 */
function respellable(strip: Strip, item: StripItem | undefined): boolean {
  if (item?.kind !== 'rest' || item.bend !== null) {
    return false;
  }

  const head = item.segments[0];
  const tail = item.segments[item.segments.length - 1];
  return (
    item.unitSpan.start === head?.span.start &&
    item.unitSpan.end === tail?.span.end &&
    !holdsCommands(strip, item.unitSpan.start, item.unitSpan.end)
  );
}

/**
 * The rests at one end of a loop's body, in text order, and what they come to.
 *
 * {@link gapSlack}'s walk turned round for a frame's own interior, and it stops
 * for the same reasons — plus one of its own: anything with a tick between the
 * run and the bracket ends it, since a command written past the body's last rest
 * runs after them and changing their length would move it.
 */
export function bodyRests(
  strip: Strip,
  frame: StripFrame,
  edge: 'start' | 'end',
): { rests: StripItem[]; ticks: number } {
  const step = edge === 'end' ? -1 : 1;
  const from = edge === 'end' ? frame.to - 1 : frame.from;
  const rests: StripItem[] = [];
  let ticks = 0;

  for (let index = from; index >= frame.from && index < frame.to; index += step) {
    const rest = strip.items[index];
    if (!respellable(strip, rest)) {
      break;
    }

    // The run is written over as one piece, so a command standing between two of
    // its members would be eaten; one before the whole run keeps its tick.
    const bracket =
      edge === 'end'
        ? holdsCommands(strip, rest.unitSpan.end, frame.span.end)
        : holdsCommands(strip, rest.prefixSpan.start, rest.unitSpan.start);
    if (bracket) {
      break;
    }

    rests.push(rest);
    ticks += rest.ticks;
  }

  return { rests: edge === 'end' ? rests.reverse() : rests, ticks };
}

/** The voice's earliest entry into a body — the one occurrence whose start can move. */
export function firstPassOn(frame: StripFrame, channel: number): number {
  let first = Number.POSITIVE_INFINITY;
  for (const run of frame.runs) {
    if (run.channel === channel) {
      for (const pass of run.passes) {
        first = Math.min(first, pass.tick);
      }
    }
  }

  return first;
}

/**
 * How many of the voice's passes of this body begin before `tick`, and whether
 * one of them ends exactly on it.
 *
 * The count is how far a pass's own box travels per tick the body gains: pass
 * `j` begins `j × delta` later, so its far end moves by `(j + 1) × delta` and a
 * handle that is to follow the pointer asks for a `delta` that much smaller.
 *
 * `abuts` settles the seam where two passes meet, which is every interior edge
 * of a loop: the two boxes' handles overlap there and only the left one's right
 * end has an answer, a later pass's start not being a thing that can move.
 */
export function passesAt(
  frame: StripFrame,
  channel: number,
  tick: number,
): { before: number; abuts: boolean } {
  let before = 0;
  let abuts = false;
  for (const run of frame.runs) {
    if (run.channel !== channel) {
      continue;
    }

    for (const pass of run.passes) {
      before += pass.tick < tick ? 1 : 0;
      abuts ||= pass.tick + pass.ticks === tick;
    }
  }

  return { before, abuts };
}

/** The token a recall repeats itself with: its own `(n)`, or a bare `*`. */
function recallHead(source: string, site: LoopSite): string {
  if (site.label === null) {
    return '*';
  }

  return source.slice(site.text.start, source.indexOf(')', site.text.start) + 1);
}

/**
 * The construct a full leftward close would put this one back against, and the
 * count the two would play as one.
 *
 * Two occurrences of one body with nothing between them are one construct
 * written twice, which is the split {@link openGap} writes read backwards. The
 * body is named by its first byte's ARAM address, so two identically spelled
 * bodies are two bodies and never join.
 *
 * `null` where the pair cannot be spelled as one: a right-hand half that is not
 * a recall — a body's first occurrence is always the left one — anything but
 * the rests standing between them, or a total past {@link MAX_LOOP_COUNT},
 * where the gesture still closes the gap and simply leaves the two calls
 * standing.
 *
 * What may stand between them is asked of the **text**, and has to be: the
 * intro `/` has a tick and is no command at all — `gather` raises none for an
 * operator — so {@link holdsCommands} cannot see it, and a join written over
 * one would carry it past the whole occurrence and move the song's loop point
 * with every note still on its tick. Blank is what the split leaves, so the
 * round trip never meets this; a `;` comment and a stray `o5` are turned away
 * with it, which is the price of asking a question the safe set cannot answer.
 *
 * The counts come off the walk and never off the digits: a count written
 * through a `"REP=4"` replacement has none to read.
 */
export function loopJoin(
  source: string,
  strip: Strip,
  at: number,
  run: LoopRun,
): { at: number; count: number } | null {
  const item = strip.items[at];
  const { abuts } = slackBefore(strip, at);
  if (abuts === null || item.frame !== 0 || item.loop?.kind !== 'recall') {
    return null;
  }

  const before = strip.items[abuts];
  const sibling = before.loop;
  if (before.kind !== 'construct' || before.address !== item.address || sibling === null) {
    return null;
  }

  // A `[[ ]]` names no body a recall could reach, so the address test turns one
  // away before this does; said rather than inferred, because the half that
  // stays is the one being handed a count and a `$E6` pair has nowhere to take
  // one — `close` is null and `label` is null, which spells `*n` over it.
  if (sibling.kind === 'sub') {
    return null;
  }

  for (let index = abuts + 1; index <= at; index++) {
    const gap = source.slice(
      strip.items[index - 1].unitSpan.end,
      strip.items[index].unitSpan.start,
    );
    if (gap.trim() !== '') {
      return null;
    }
  }

  // The sibling's own run and not `passesAt`, which counts every earlier pass
  // of the body the voice plays: the partner is the nearest occurrence, which
  // is the only reading whose ticks close.
  const body = strip.frames.find((frame) => frame.body === item.address);
  const played = body?.runs.find(
    (each) => each.channel === run.channel && each.passes[0]?.tick === before.instances[0]?.tick,
  );
  const count = (played?.passes.length ?? 0) + run.passes.length;
  return played && count <= MAX_LOOP_COUNT ? { at: abuts, count } : null;
}

/**
 * The two halves written as the one construct they play as: the count of the
 * half in front becomes the total, and the half behind goes.
 *
 * The surviving half keeps its own spelling — a declaration's `]n`, a `(n)m` or
 * a `*n` — because what makes the two joinable is that they play the same body,
 * and that says nothing about how either was written.
 */
function joinInto(context: EditContext, site: LoopSite, sibling: LoopSite, count: number): Edit[] {
  const { source } = context;
  const target = sibling.kind === 'declaration' ? sibling.close : sibling.text;
  if (target === null) {
    return [];
  }

  const text =
    sibling.kind === 'declaration' ? `]${count}` : `${recallHead(source, sibling)}${count}`;
  const counted = spliceRange(source, target, text);
  const removed = spliceOut(source, site.text);
  return [counted, removed].filter((edit): edit is Edit => edit !== null);
}

/**
 * `ticks` of rest written in front of a construct, so the whole occurrence
 * starts that much later.
 *
 * After the construct's prefix commands, which keep their tick by running before
 * it, and never abutting the text in front of it without a space.
 */
function openBefore(context: EditContext, site: LoopSite, ticks: number): Edit[] | EditRefusal {
  const text = spellRest(ticks, context.targetAMKVersion);
  if (text === null) {
    return refuse(REFUSE_SPELL);
  }

  const { source } = context;
  const start = site.text.start;
  const lead = padAround(source, start).before;
  const opened = insertAt(start, `${lead}r${text} `, site.text.line);
  return opened ? [opened] : [];
}

/**
 * `need` ticks taken out of the free space in front of a construct, so the whole
 * occurrence starts that much earlier.
 *
 * Only ever the rests {@link gapSlack} prices, spliced from the construct
 * backward, and it refuses rather than doing part of the job: a body already
 * grown at its head cannot be handed a partial close.
 */
function closeBefore(context: EditContext, at: number, need: number): Edit[] | EditRefusal {
  const { source, strip, targetAMKVersion } = context;
  if (need > gapSlack(strip, at)) {
    return refuse(REFUSE_LOOP_LEAD_ROOM);
  }

  const edits: Edit[] = [];
  let left = need;

  for (let index = at - 1; index >= strip.frames[0].from && left > 0; index--) {
    const rest = strip.items[index];
    if (left >= rest.ticks) {
      const removed = spliceOut(source, rest.unitSpan);
      if (removed) {
        edits.push(removed);
      }

      left -= rest.ticks;
      continue;
    }

    const text = spellRest(rest.ticks - left, targetAMKVersion);
    if (text === null) {
      return refuse(REFUSE_SPELL);
    }

    const shortened = spliceUnit(source, rest.unitSpan, `r${text}`);
    if (shortened) {
      edits.push(shortened);
    }

    left = 0;
  }

  return left > 0 ? refuse(REFUSE_LOOP_LEAD_ROOM) : edits;
}

/**
 * The loop box's top or bottom edge dragged: `delta` ticks of time put in (or
 * taken out) where pass `pass` of `run` begins, everything on that voice from
 * there on sliding by the same amount.
 *
 * Time in means a tied rest; where the grab was mid-run, the recall's count is
 * split around it — `(1)5` grabbed at its third pass becomes `(1)2 r… (1)3`,
 * a declaration's `]3` becomes `] r… *2` (or its own label where it has one) —
 * and both halves replay the same body bytes, a recall's whole parse output
 * being its `$E9` (`parser.ts:2427-2507`, `Music.cpp:1003-1199`). The `*` a
 * declaration split writes directly follows its own `]` with only rests
 * between, and `prevLoop` is set by nothing but a normal `[`
 * (`parser.ts:2721`), so it recalls that declaration on every target. Counts
 * are written only above 1, and never with a space in front — `getInt` skips
 * none (`parser.ts:731`), so `(1) 2` would be `(1)1` and a stray character.
 *
 * Time out is only ever free space: the rests {@link gapSlack} prices, spliced
 * from the construct backward. The gesture and this clamp through the one
 * function, so what the drag allowed is what is written. Spending the whole of
 * that slack closes the gap, and where the occurrence in front plays the same
 * body the two are written back up as one construct with the counts added
 * ({@link loopJoin}) — the split above, read backwards.
 */
export function openGap(
  context: EditContext,
  at: number,
  run: LoopRun,
  pass: number,
  delta: number,
): Edit[] | EditRefusal {
  const { source, strip, targetAMKVersion } = context;
  const item = strip.items[at];
  const site = item?.loop;
  if (!item || !site || delta === 0) {
    return [];
  }

  // A construct inside another loop's body has no song-time text position to
  // move: its text plays wherever the outer loop does. The press refuses this
  // before a drag begins; this is the same answer for a caller that did not.
  if (item.frame !== 0) {
    return refuse(REFUSE_NESTED_LOOP);
  }

  const edits: Edit[] = [];

  if (delta > 0 && pass === 0) {
    // The whole occurrence moves.
    const opened = openBefore(context, site, delta);
    if (!isEdits(opened)) {
      return opened;
    }

    edits.push(...opened);
  } else if (delta > 0) {
    if (site.kind === 'sub') {
      return refuse(REFUSE_SUB_SPLIT);
    }

    const total = run.passes.length;
    if (pass >= total) {
      return [];
    }

    const text = spellRest(delta, targetAMKVersion);
    if (text === null) {
      return refuse(REFUSE_SPELL);
    }

    const head = recallHead(source, site);
    const first = pass > 1 ? String(pass) : '';
    const second = total - pass > 1 ? String(total - pass) : '';
    const split =
      site.kind === 'recall'
        ? spliceRange(source, site.text, `${head}${first} r${text} ${head}${second}`)
        : site.close && spliceRange(source, site.close, `]${first} r${text} ${head}${second}`);
    if (!split) {
      return refuse(REFUSE_SPELL);
    }

    edits.push(split);
  } else {
    if (pass !== 0) {
      return [];
    }

    const slack = gapSlack(strip, at);
    const need = Math.min(-delta, slack);
    if (need <= 0) {
      return [];
    }

    const closed = closeBefore(context, at, need);
    if (!isEdits(closed)) {
      return closed;
    }

    edits.push(...closed);

    // Spending the whole slack puts the construct back against the occurrence
    // in front of it, and two occurrences of one body touching are one
    // construct written twice. A close that stops short leaves a gap, which is
    // still two.
    const join = need === slack ? loopJoin(source, strip, at, run) : null;
    const sibling = join === null ? null : strip.items[join.at].loop;
    if (join && sibling) {
      edits.push(...joinInto(context, site, sibling, join.count));
    }
  }

  // The voice's end moves with everything after the split, and a moved note
  // past the song's end pads the other channels out to it, as a dragged one
  // does — the tail was written to be heard where it is going.
  const tail = context.channels[run.channel];
  const reach = (tail?.ticks ?? 0) + delta;
  if (delta > 0 && reach > context.playableTicks) {
    const padded = padChannels(context, reach, new Map([[run.channel, delta]]));
    if (padded === null) {
      return refuse(REFUSE_SPELL);
    }

    edits.push(...padded);
  }

  return edits.sort((a, b) => a.span.start - b.span.start);
}

/**
 * The loop box's left or right end dragged: the body's own length changed by
 * `delta` ticks — grown by a rest at that end, shrunk by taking that end's rests
 * away — so every pass of it grows or tightens together.
 *
 * The two ends differ in what pays for the change. The **right** end puts the
 * ticks at the body's tail and the construct stands still, so the voice's music
 * runs `passes × delta` longer. The **left** end puts them at the body's head
 * and pulls the construct back by the same amount, so the grabbed occurrence's
 * first pass plays exactly where it played — a note at body-local `x` becomes
 * `(t0 - delta) + delta + x` — and the voice's end moves by one delta less, that
 * one having come out of the rests in front rather than been added to the song.
 * Which is why the left end is the **first occurrence's** alone: a later one's
 * start is carried by the passes before it, and no rest in front can hold it
 * still.
 *
 * It writes its own splices rather than going through {@link planEdits}, which
 * moves no note here and would have nothing to say. And it is the one gesture
 * that may rewrite a body's trailing rests: {@link realiseRegion} leaves a tail
 * alone deliberately — a channel ends where its music ends, and a deletion must
 * not silently shorten the loop — where this gesture's whole subject is that
 * length.
 */
export function resizeLoop(
  context: EditContext,
  at: number,
  body: StripFrame,
  grabbed: number,
  edge: 'start' | 'end',
  delta: number,
): Edit[] | EditRefusal {
  const { strip, targetAMKVersion } = context;
  const item = strip.items[at];
  const site = item?.loop;
  if (!item || !site || delta === 0) {
    return [];
  }

  if (edge === 'start') {
    // The construct has to move, and one inside another body has no song-time
    // position to move to: its text plays wherever the outer loop does.
    if (item.frame !== 0) {
      return refuse(REFUSE_NESTED_LOOP);
    }

    if (grabbed !== firstPassOn(body, strip.channel)) {
      return refuse(REFUSE_LOOP_LEFT_PASS);
    }
  }

  const edits: Edit[] = [];
  const run = bodyRests(strip, body, edge);
  const want = run.ticks + delta;
  if (want < 0) {
    return refuse(REFUSE_LOOP_BODY_ROOM);
  }

  if (run.rests.length > 0) {
    const written = collapse(context, run.rests, want);
    if (written === null) {
      return refuse(REFUSE_SPELL);
    }

    edits.push(...written);
  } else {
    // Nothing at that end to grow, so a rest of its own — at the very edge of
    // the body's interior, which for the head is what keeps a command written
    // there on its tick: it runs at body-local `delta`, and the pass begins
    // `delta` earlier.
    const text = spellRest(delta, targetAMKVersion);
    if (text === null) {
      return refuse(REFUSE_SPELL);
    }

    const anchor = edge === 'end' ? body.span.end : body.span.start;
    // A bracket is its own separator, so only a token in front of the rest needs
    // a space put between them.
    const lead = /[\s[\]]/.test(context.source[anchor - 1] ?? '[') ? '' : ' ';
    const spaced = insertAt(
      anchor,
      edge === 'end' ? `${lead}r${text}` : `${lead}r${text} `,
      body.span.line,
    );
    if (spaced) {
      edits.push(spaced);
    }
  }

  if (edge === 'start') {
    const moved = delta > 0 ? closeBefore(context, at, delta) : openBefore(context, site, -delta);
    if (!isEdits(moved)) {
      return moved;
    }

    edits.push(...moved);
  }

  // Every voice that plays this body gets `its own passes × delta` longer; the
  // one whose construct moved gives a delta back, the rests in front having paid
  // for it. A moved note past the song's end pads the other channels out to meet
  // it, as a dragged one does.
  const grown = new Map<number, number>();
  for (const each of body.runs) {
    grown.set(each.channel, (grown.get(each.channel) ?? 0) + each.passes.length * delta);
  }

  if (edge === 'start') {
    grown.set(strip.channel, (grown.get(strip.channel) ?? 0) - delta);
  }

  let reach = 0;
  for (const [voice, by] of grown) {
    reach = Math.max(reach, (context.channels[voice]?.ticks ?? 0) + by);
  }

  if (delta > 0 && reach > context.playableTicks) {
    const padded = padChannels(context, reach, grown);
    if (padded === null) {
      return refuse(REFUSE_SPELL);
    }

    edits.push(...padded);
  }

  return edits.sort((a, b) => a.span.start - b.span.start);
}

function rested(rests: readonly StripItem[], from: number): number {
  return rests.slice(from).reduce((sum, rest) => sum + rest.ticks, 0);
}

/**
 * A piece of text the run has to write at a tick of its own: the song's intro
 * `/`, or a command the run is carrying over from the text it replaces.
 */
interface RunMark {
  tick: number;
  text: string;
}

/**
 * The note and the rests either side of it, as one run of text, with whatever
 * has to stand at a tick inside it written in.
 *
 * A `/` puts the channel's loop re-entry at the byte it stands on
 * (`parser.ts:parseIntro`) and every channel resumes from its own on each pass
 * round the loop, so a marker on the wrong tick leaves the channel playing
 * against the rest of the song; a carried `v` or `y` moved off its tick
 * re-voices the note it was written for. A mark is therefore a tick rather than
 * a place in the run, and where one does not fall on a boundary the piece it
 * lands inside is written as two: a rest as two rests, and the note as a head
 * and a `^` continuation, which is still one note — a tie emits `$C6` and the
 * driver carries the note through it. Several marks inside one piece split it
 * that many times.
 *
 * `from` is the run's own first tick, so a mark can be given in the song's ticks
 * as the intro is. `exitOctave` is the octave the run leaves standing, for a
 * channel with no note left to be handed it (see {@link spawnInto}).
 *
 * `null` where a length in the run has no spelling on this target.
 */
function spawnRun(
  context: EditContext,
  born: readonly PlacedNote[],
  gaps: readonly number[],
  from: number,
  running: number | null,
  marks: readonly RunMark[],
  exitOctave: number | null,
): string | null {
  const { targetAMKVersion } = context;
  const parts: string[] = [];
  let at = from;
  /** How far down `marks` the run has written, which is sorted by tick. */
  let next = 0;
  /**
   * The octave the run has left standing so far.
   *
   * Carried from note to note for the reason {@link noteText} takes it at all:
   * a run that writes two notes an octave apart spells the second's `o` and a
   * run that writes two in one octave spells it once.
   */
  let inForce = running;

  /** Every mark the run has reached, which is where one falls between two pieces. */
  const mark = (): void => {
    while (next < marks.length && marks[next].tick <= at) {
      parts.push(marks[next].text);
      next++;
    }
  };

  /** Whether a mark falls strictly inside the piece running from here to `end`. */
  const splits = (end: number): boolean =>
    next < marks.length && marks[next].tick > at && marks[next].tick < end;

  const rest = (ticks: number): boolean => {
    if (ticks === 0) {
      return true;
    }

    const end = at + ticks;
    while (splits(end)) {
      const piece = spellRest(marks[next].tick - at, targetAMKVersion);
      if (piece === null) {
        return false;
      }

      parts.push(`r${piece}`);
      at = marks[next].tick;
      mark();
    }

    const last = spellRest(end - at, targetAMKVersion);
    if (last === null) {
      return false;
    }

    parts.push(`r${last}`);
    at = end;
    return true;
  };

  /** The octave a note leaves standing: its own, or what it was handed if a drum. */
  const leftBy = (each: PlacedNote, exit: number | null): number | null =>
    each.drum === null ? (exit ?? octaveFor(each.written)) : inForce;

  // Only the last note in the run puts an octave back, since only the last one
  // is what the text after the run reads.
  const note = (each: PlacedNote, last: boolean): boolean => {
    const exit = last ? exitOctave : null;
    const end = at + each.ticks;
    /** Whether the note's own head is still to be written. */
    let head = true;
    while (splits(end)) {
      const piece = spellDuration(marks[next].tick - at, targetAMKVersion);
      const text =
        piece === null
          ? null
          : head
            ? noteText(each, piece, null, targetAMKVersion, inForce)
            : `^${piece}`;
      if (text === null) {
        return false;
      }

      parts.push(text);
      head = false;
      at = marks[next].tick;
      mark();
    }

    if (head) {
      const whole = noteText(each, null, exit, targetAMKVersion, inForce);
      if (whole === null) {
        return false;
      }

      parts.push(whole);
    } else {
      const piece = spellDuration(end - at, targetAMKVersion);
      // The `^` is where the note ends, so the octave goes after it rather than
      // between the pieces.
      const put = exitText(each, exit);
      if (piece === null || put === null) {
        return false;
      }

      parts.push(`^${piece}${put}`);
    }

    at = end;
    inForce = leftBy(each, exit);
    return true;
  };

  mark();
  for (let index = 0; index < born.length; index++) {
    if (!rest(gaps[index])) {
      return null;
    }

    mark();
    if (!note(born[index], index === born.length - 1)) {
      return null;
    }

    mark();
  }

  if (!rest(gaps[born.length])) {
    return null;
  }

  mark();
  return parts.join(' ');
}

/**
 * The rest a note being drawn is written over, out of the ones its region holds.
 *
 * Usually a region is one rest and this is that rest. It is more than one where
 * something the note map does not carry has been written between them — a `/`,
 * or a command — and then the note belongs to whichever rest its own start falls
 * in. Rewriting that one alone is what keeps everything between them where it
 * was written, so there is nothing to guess at.
 *
 * A note starting at or past where the tail's music stopped takes the last rest
 * there, and the run written over it reaches out to the note — which is how a
 * note drawn past the end of a channel extends it.
 *
 * `null` where the region holds no rest at all, and where a note starts in one
 * rest and ends in another: the run written between them would have to move,
 * and only the porter knows which side of the note it belongs on.
 */
function restFor(gap: Region, born: PlacedNote): StripItem | null {
  for (const rest of gap.rests) {
    if (born.startTick >= rest.startTick && born.startTick < rest.startTick + rest.ticks) {
      return born.startTick + born.ticks <= rest.startTick + rest.ticks ? rest : null;
    }
  }

  const last = gap.rests[gap.rests.length - 1];
  return gap.tail && last !== undefined && born.startTick >= last.startTick + last.ticks
    ? last
    : null;
}

/**
 * The interior items the run consumes: the smallest contiguous stretch holding
 * every note this plan removes, every note being born, and every rest one of
 * those touches. The items outside it — untouched rests, and whatever is
 * written in their prefixes — are left byte-identical, which is what lets a
 * note erase its neighbour without disturbing a `v200` declared for a rest the
 * gesture never reached.
 *
 * Every interior note is in it by construction: a surviving note would bound
 * the region instead, so each one here is being removed and its ticks have to
 * be re-expressed by the run. Only a rest can stand aside, and only one no
 * born note reaches into — unless it touches the window at an end where the run
 * leaves a rest of its own, and then it joins, or the two rests would be written
 * side by side.
 */
function windowOf(
  source: string,
  strip: Strip,
  frame: StripFrame,
  gap: Region,
  order: readonly PlacedNote[],
): StripItem[] {
  const interior = strip.items.slice(interiorFrom(gap, frame), gap.before);
  let from = Infinity;
  let to = -Infinity;
  for (const item of interior) {
    if (item.kind !== 'rest') {
      from = Math.min(from, item.startTick);
      to = Math.max(to, item.startTick + item.ticks);
    }
  }

  for (const note of order) {
    from = Math.min(from, note.startTick);
    to = Math.max(to, note.startTick + note.ticks);
  }

  // A rest partly under the stretch joins it whole, which can reach the next.
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of interior) {
      if (item.startTick < to && item.startTick + item.ticks > from) {
        if (item.startTick < from) {
          from = item.startTick;
          grew = true;
        }

        if (item.startTick + item.ticks > to) {
          to = item.startTick + item.ticks;
          grew = true;
        }
      }
    }
  }

  const chosen = interior.filter(
    (item) => item.startTick < to && item.startTick + item.ticks > from,
  );
  if (chosen.length === 0 || order.length === 0) {
    return chosen;
  }

  const touching = (left: StripItem, right: StripItem): boolean =>
    source.slice(left.unitSpan.end, right.unitSpan.start).trim() === '';
  let first = interior.indexOf(chosen[0]);
  let last = interior.indexOf(chosen[chosen.length - 1]);
  const lastBorn = order[order.length - 1];
  if (order[0].startTick > from) {
    while (
      first > 0 &&
      interior[first - 1].kind === 'rest' &&
      touching(interior[first - 1], interior[first])
    ) {
      first--;
    }
  }

  if (lastBorn.startTick + lastBorn.ticks < to) {
    while (
      last < interior.length - 1 &&
      interior[last + 1].kind === 'rest' &&
      touching(interior[last], interior[last + 1])
    ) {
      last++;
    }
  }

  return interior.slice(first, last + 1);
}

/** Text a run takes over from the window it is laid over, and the tick it stood on. */
interface Carried {
  span: Span;
  tick: number;
  /**
   * Whether it stands inside a unit the plan is splicing, and so is already
   * being taken out — a command between a note's segments goes with the note's
   * `unitSpan`, where one between two units is left behind by both.
   */
  inside: boolean;
  /** Written out again on its tick, or only taken out: an octave the run states for itself. */
  mark: boolean;
}

/**
 * What a run laid over the window has to take over from the text it replaces,
 * or `null` where something in there cannot be taken over at all.
 *
 * A `v`, a `t`, an echo write or the intro `/` carries no ticks of its own but
 * does carry a **position**: the tick of the boundary it stands at. A run
 * rewrites every boundary strictly inside the window, so anything written on one
 * has to be re-emitted by the run itself, at that same tick — which is what a
 * {@link RunMark} is. One written before the window's first item or after its
 * last stands on a boundary the run starts or ends at, and stays exactly where
 * it is, which is why only the interior is read.
 *
 * Two places a boundary can be written on: between two of the window's items,
 * and inside one of them, between the head and a `^` continuation the porter
 * put a command between (`roll-strip.ts:segments`).
 *
 * What says nothing about time is not carried. A `;` comment and an `l` between
 * two items are left where they were written — every length the run writes is
 * its own — and an `o`, `<` or `>` is taken out, the run stating the octave it
 * needs and putting back the one the original had after it (`spawnInto`). An
 * `l` inside a unit going is carried, so it is not lost with the unit.
 *
 * Refused: a `$DD`, which needs a *byte* in front of it rather than a tick
 * (`main.asm:L_10E4`) and whose note target would read the run's octave; a
 * bracket; and a command written through a `"name=value"`, whose span is
 * collapsed onto its call site (`edits.ts:commandRewritable`).
 *
 * A command this plan deletes along with the item it defined stands on no
 * boundary at all, so the spans in `deleted` read as blank.
 */
function windowCarries(
  context: EditContext,
  window: readonly StripItem[],
  deleted: readonly Span[],
  lead?: { from: number; to: number; tick: number },
): Carried[] | null {
  const { source, strip } = context;
  const carried: Carried[] = [];

  /**
   * Everything written between two offsets, all of it standing on one tick. In
   * front of the window an octave is left where it is: the run is written after
   * it and enters under it.
   */
  const between = (
    from: number,
    to: number,
    tick: number,
    inside: boolean,
    front = false,
  ): boolean => {
    let at = from;
    while (at < to) {
      if (/\s/.test(source[at]) || deleted.some((span) => at >= span.start && at < span.end)) {
        at++;
        continue;
      }

      if (source[at] === ';') {
        const end = source.indexOf('\n', at);
        at = end < 0 || end > to ? to : end;
        continue;
      }

      const intro = strip.intros.find((span) => span.start === at);
      if (intro !== undefined) {
        carried.push({ span: intro, tick, inside, mark: true });
        at = intro.end;
        continue;
      }

      if (source[at] === '<' || source[at] === '>') {
        if (!front) {
          carried.push({ span: { start: at, end: at + 1, line: 1 }, tick, inside, mark: false });
        }

        at++;
        continue;
      }

      const command = strip.commands.find((each) => at >= each.span.start && at < each.span.end);
      if (
        command === undefined ||
        command.inRemoteDefinition ||
        !commandRewritable(command) ||
        command.vcmd === 0xdd ||
        commandScope(command) === 'structure'
      ) {
        return false;
      }

      const kind = command.kind.toLowerCase();
      if (isPercussionInstrument(command)) {
        // A drum `@` belongs to the note it feeds, wherever the run puts notes:
        // `planEdits` takes it out with that note or moves it to its head.
      } else if (kind === 'o') {
        if (!front) {
          carried.push({ span: command.span, tick, inside, mark: false });
        }
      } else if (kind !== 'l' || inside) {
        carried.push({ span: command.span, tick, inside, mark: true });
      }

      at = command.span.end;
    }

    return true;
  };

  // The text in front of the window, where the run begins before the window's
  // first item: taken over where it can be, and left where it stands otherwise.
  if (lead !== undefined && !between(lead.from, lead.to, lead.tick, false, true)) {
    carried.length = 0;
  }

  for (let index = 0; index < window.length; index++) {
    const item = window[index];
    if (index > 0) {
      const previous = window[index - 1];
      if (!between(previous.unitSpan.end, item.unitSpan.start, item.startTick, false)) {
        return null;
      }
    }

    let at = item.startTick;
    for (let part = 1; part < item.segments.length; part++) {
      at += item.segments[part - 1].ticks;
      const gap = { from: item.segments[part - 1].span.end, to: item.segments[part].span.start };
      if (!between(gap.from, gap.to, at, true)) {
        return null;
      }
    }
  }

  return carried;
}

/**
 * A note being created, written into the gap it lands in.
 *
 * Two roads, and which one is taken is what decides whether anything written in
 * the region may move.
 *
 * **In place.** The note goes over the one rest it falls inside
 * (see {@link restFor}), and everything else in the region stays exactly where
 * it was written. This is the road for a region holding several rests with
 * something positional between them, and it takes one note at a time.
 *
 * **Laid out afresh, over the window.** The stretch the gesture actually
 * touches ({@link windowOf}) is written as one run of rests and notes, and the
 * items outside it are not touched at all — a rest the notes never reached
 * keeps its bytes and its declarations both. Within the window everything but
 * the whitespace must be leaving: an item's unit
 * `planEdits` removes, or a declaration deleted with the item that owned it,
 * whose spans only ever abut this run rather than overlap it. That is what
 * lets a region hold more than one note being created — a carve's split leaves
 * a tail beside the note that split it — while a `v200` on the far side of the
 * region stands.
 *
 * On either road, a rest the born notes wholly cover is erased from existence
 * the way a carved-out note is, and its defining commands go with it
 * ({@link prefixCommandsOf}) — read off tick geometry rather than off the
 * carve, since rests are not notes and `plan.erased` never names one, which
 * also means a note drawn exactly over a whole rest erases it in every mode.
 *
 * A builder answering `null` is refused too, rather than passed on as no edits:
 * `planEdits` pushes what each region returns and goes on to the next, so a note
 * that quietly wrote nothing would leave the rest of the gesture committed.
 */
function spawnInto(
  context: EditContext,
  gap: Region,
  survivors: ReadonlyMap<number, PlacedNote>,
  deleted: readonly Span[],
): Edit[] | EditRefusal {
  const { source, strip } = context;
  if (gap.born.length === 0) {
    return refuse(REFUSE_CROWDED);
  }

  const order = [...gap.born].sort((a, b) => a.startTick - b.startTick);
  const born = order[order.length - 1];

  const empty = strip.items.length === 0;
  // A channel being written from nothing has just had its own `o4` put in front
  // of it, so a note in that octave has nothing to add (`channelOpening`).
  const opening = empty && !strip.home.declared;

  const end = born.startTick + born.ticks;
  /**
   * Where the channel ends now, which a note drawn into its last rest must not
   * move: the tail region carries `ticks: -1` for "may be any length", not "has
   * none", and reading that as nothing to fill silently eats the rest the note
   * landed in. A channel with nothing on it ends where the song does, so that
   * its first note does not make it the shortest and cut every other channel
   * short, for the reason {@link padChannels} states.
   *
   * A note drawn past the end extends the channel rather than being refused, in
   * either case, and {@link padChannels} brings the rest of the song out to meet
   * it — so the channel does not become the long one and the note is heard.
   *
   * For a body frame it is the body's own length, and growing past it is the
   * length change every pass and everything after the loop move by.
   */
  const channelEnd =
    context.frame.body >= 0 ? context.frame.ticks : empty ? context.playableTicks : strip.ticks;

  /**
   * The rest being written over, and the ticks the run written there has to come
   * to.
   *
   * One rest spans its whole region, so the run answers to the **region**: the
   * note may reach past where that rest ended, because the notes after it are
   * being pushed along to make room for it. Several rests means something
   * carrying no ticks of its own was written between them — the `/` a channel is
   * opened with, or a command — and then only the rest the note falls inside is
   * rewritten, so the run answers to **that rest** and everything between them
   * stays where it was written. A push cannot be served that way, so a region
   * whose ticks no longer come to the rests it holds is refused instead.
   */
  const single = gap.rests.length === 1 && gap.between === 1;
  const settled = gap.tail || gap.ticks === rested(gap.rests, 0);
  const inPlace =
    order.length === 1 && gap.rests.length > 0 && gap.between === gap.rests.length && settled;

  /** Whether the run is laid out afresh rather than fitted inside one rest. */
  let laidOut = true;
  let over: StripItem | null;
  /**
   * The interior items the run consumes ({@link windowOf}); the ones outside it
   * keep their bytes, kept declarations included. The first two roads consume
   * what they always did — the region's one rest, or the one the note falls
   * inside — so for them it only feeds the bookkeeping below.
   */
  let window: readonly StripItem[];
  if (single) {
    over = gap.rests[0];
    window = gap.rests;
  } else if (inPlace) {
    over = restFor(gap, born);
    laidOut = false;
    // A note that starts in one rest and ends in another: the run written
    // between them would have to move, and only the porter knows which side of
    // the note it belongs on.
    if (over === null) {
      return refuse(REFUSE_CROWDED);
    }

    window = [over];
  } else {
    window = windowOf(source, strip, context.frame, gap, order);
    over = window.find((item) => item.kind === 'rest') ?? null;
  }

  const wide = window.length === gap.between;
  // A run that leaves items of the region standing cannot absorb a resize:
  // their ticks are exactly what it must not rewrite. No gesture builds such a
  // region — a pushed note bounds its own region, and a carve keeps the
  // region's ticks — so this is a guard rather than a road.
  if (laidOut && !wide && !gap.tail) {
    let interiorTicks = 0;
    for (let index = interiorFrom(gap, context.frame); index < gap.before; index++) {
      interiorTicks += strip.items[index].ticks;
    }

    if (gap.ticks !== interiorTicks) {
      return refuse(REFUSE_CROWDED);
    }
  }

  // Only a run reaching the tail's end may grow, and that is what lets a note
  // be drawn past the end of a channel at all.
  const grows =
    gap.tail &&
    (laidOut
      ? gap.between === 0 || window[window.length - 1] === strip.items[gap.before - 1]
      : over === gap.rests[gap.rests.length - 1]);

  // A wide window answers to the region's own bounds, which for a note being
  // fitted among pushed neighbours are not the old items' — a narrow one to its
  // items, whose ticks the guard above holds still.
  const windowLast = window[window.length - 1];
  const narrow = windowLast !== undefined && !wide;
  const runFrom =
    laidOut || over === null ? (narrow ? window[0].startTick : gap.startTick) : over.startTick;
  const runTo = grows
    ? Math.max(end, channelEnd)
    : laidOut || over === null
      ? narrow
        ? windowLast.startTick + windowLast.ticks
        : gap.startTick + gap.ticks
      : over.startTick + over.ticks;

  // Everything in the window but the whitespace is either leaving — a unit
  // `planEdits` removes, or a declaration deleted with the item that owned it,
  // which arrives here as a span so the run can tell text that is going from
  // text that would have to move — or is written out again by the run on the
  // tick it stands on (`windowCarries`). So is what stands in front of the
  // window's first item where the run begins before that item did: written there,
  // a `/` or a `t` would run where the run starts.
  const leadFrom = gap.after >= 0 ? afterBend(strip.items[gap.after]) : -1;
  const lead =
    laidOut && window.length > 0 && leadFrom >= 0 && runFrom < window[0].startTick
      ? { from: leadFrom, to: window[0].unitSpan.start, tick: window[0].startTick }
      : undefined;
  const carried = windowCarries(context, window, deleted, lead);
  if (carried === null) {
    return refuse(REFUSE_CROWDED);
  }

  /** One rest before each note, and one more after the last — `order.length + 1`. */
  const gaps: number[] = [];
  let at = runFrom;
  for (const each of order) {
    if (each.startTick < at) {
      return refuse(REFUSE_CROWDED);
    }

    gaps.push(each.startTick - at);
    at = each.startTick + each.ticks;
  }

  if (runTo < at) {
    return refuse(REFUSE_CROWDED);
  }

  gaps.push(runTo - at);

  /** What the run has to write at a tick of its own, in the song's ticks. */
  const marks: RunMark[] = [];
  // The tick the song loops back to, where this channel is being opened and the
  // run reaches it. `gap.startTick` is 0 for an empty channel — it has one
  // region and it begins at the top — so the run covers the channel's own ticks.
  if (
    empty &&
    context.introTicks !== null &&
    context.introTicks >= runFrom &&
    context.introTicks <= runTo
  ) {
    marks.push({ tick: context.introTicks, text: '/' });
  }

  for (const each of carried) {
    if (each.mark) {
      marks.push({ tick: each.tick, text: source.slice(each.span.start, each.span.end) });
    }
  }

  marks.sort((a, b) => a.tick - b.tick);

  const { octaves } = strip;
  const previous = gap.after >= 0 ? strip.items[gap.after] : null;

  /**
   * Where the run's text begins in the original, which is what it enters under:
   * everything in the window is leaving, so the octave there is the one standing
   * in front of the window's first item. With no window it is where
   * {@link writeInto} puts the run.
   */
  const enterAt =
    window[0]?.unitSpan.start ??
    (gap.after >= 0
      ? afterBend(strip.items[gap.before - 1])
      : gap.before < context.frame.to
        ? strip.items[gap.before].unitSpan.start
        : strip.home.declared && empty
          ? strip.home.at
          : null);
  /** And where the original text takes up again after it. */
  const afterRun = windowLast?.unitSpan.end ?? enterAt;
  // Stated outright where the run takes over a note that stated its own, and on a
  // channel's first note, so the channel does not depend on the block above it.
  const states = empty || (window[0]?.kind === 'note' && window[0].hasLeadingOctave);
  const inForce = opening
    ? OPENING_OCTAVE
    : states || enterAt === null
      ? null
      : octaves.at(enterAt);

  /**
   * The octave the run leaves standing: its last pitched note's, since a spawn
   * writes an absolute `o` wherever one is in doubt, and a drum writes none and
   * leaves whatever stood.
   */
  const pitched = order.filter((each) => each.drum === null);
  const lastPitched = pitched[pitched.length - 1];
  const leaves = lastPitched === undefined ? inForce : octaveFor(lastPitched.written);

  // The next *surviving* item, which is what bounds the region — the first note
  // item may be one this plan is removing, and an octave inserted at its head is
  // an edit inside a range being deleted. Bounded to the frame: past its end is
  // another frame's text.
  const reader = gap.before < context.frame.to ? strip.items[gap.before] : null;

  /**
   * What the reader has to be handed: a loop the octave its body was written
   * under, a note the one its byte says — unless it writes its own.
   */
  const wanted =
    reader === null
      ? null
      : reader.kind === 'construct'
        ? octaves.first(reader.unitSpan.start, reader.unitSpan.end) === 'read'
          ? octaves.at(reader.unitSpan.start)
          : null
        : writesItsOwnOctave(strip, gap.before, survivors)
          ? null
          : reader.octave;

  /**
   * At the reader's head where nothing between the run and it moves the octave,
   * which is where the text settles — an `o` written there is that note's leading
   * octave on the next pass. Otherwise straight after the run, with the octave the
   * original had there, so a `<` or `>` standing between still does its job.
   */
  let restoreAtReader = false;
  let trailing: number | null = null;
  if (reader !== null && afterRun !== null) {
    const arriving = octaves.carry(leaves, afterRun, reader.unitSpan.start);
    if (wanted !== null && arriving !== wanted) {
      const there = octaves.moves(afterRun, reader.unitSpan.start) ? octaves.at(afterRun) : null;
      trailing = there;
      restoreAtReader = there === null;
    }
  } else if (reader === null) {
    // Nothing left in the frame to hand it to, so the run carries it: `octave`
    // is one variable, and leaks past a `#N` into the block below — unless what
    // comes next sets its own, or nothing does.
    const standing = previous ? (previous.exitOctave ?? previous.octave) : null;
    const left = afterRun === null ? standing : (octaves.at(afterRun) ?? standing);
    const reads = context.frame.body >= 0 || afterRun === null || octaves.next(afterRun) === 'read';
    trailing = reads && left !== null && left !== leaves ? left : null;
  }

  // A pitched last note carries the octave after itself; a drum writes none, so
  // the run does at its end instead.
  const lastBorn = order[order.length - 1];
  const exitOnNote = lastBorn.drum === null ? trailing : null;
  const run = spawnRun(context, order, gaps, runFrom, inForce, marks, exitOnNote);
  if (run === null) {
    return refuse(REFUSE_SPELL);
  }

  const putBack = trailing === null || exitOnNote !== null ? '' : spellOctave(trailing);
  if (putBack === null) {
    return refuse(REFUSE_SPELL);
  }

  const text = putBack === '' ? run : `${run} ${putBack}`;

  let restore: Edit | null = null;
  if (restoreAtReader && reader !== null && wanted !== null) {
    const spelled = spellOctave(wanted);
    if (spelled === null) {
      return refuse(REFUSE_SPELL);
    }

    restore = insertAt(reader.unitSpan.start, `${spelled} `, 1);
  }

  // No rest to write over — the window holds nothing but notes this plan is
  // removing — so the run is inserted after its last item, where the removals
  // leave a hole of exactly the run's ticks and the insertion only abuts them.
  // A window with no items at all is a run written beside the region's anchors,
  // which is {@link writeInto}'s to place.
  const edit = over
    ? spliceUnit(source, over.unitSpan, text)
    : windowLast !== undefined
      ? insertAt(windowLast.unitSpan.end, ` ${text}`, 1)
      : writeInto(context, gap, text);
  if (edit === null) {
    return refuse(REFUSE_CROWDED);
  }

  // A run laid out afresh is the whole window's ticks, so everything in it the
  // run did not go over is gone: the rests, and the notes this plan removes. Each
  // goes as its own edit rather than the whole stretch going as one splice, since
  // two edits over one run of text is what `planEdits` refuses.
  const gone = laidOut
    ? window.filter((item) => item !== over).flatMap((item) => removeItem(source, item))
    : [];

  // A carried command the run has re-emitted has to come out of where it was
  // written, unless the unit it stands inside is itself being spliced — that
  // takes it along, and taking it twice is two edits over one run of text.
  const taken = carried
    .filter((each) => !each.inside)
    .flatMap((each) => removeSpan(source, each.span));

  // The run first where the two land on the same offset — a run inserted at the
  // head of the note it is being written in front of — so `coalesce` joins them
  // in the order they are read.
  return restore ? [edit, ...gone, ...taken, restore] : [edit, ...gone, ...taken];
}

/**
 * How far past the song a plan reaches, and how much each voice has already
 * grown to meet it — the two figures {@link padChannels} is asked with.
 *
 * The notes the gesture is answerable for are the ones it placed itself and the
 * ones its push cascade shoved out of the way. Not every note in the plan — a
 * channel already running past the cut is an ordinary shape, and reading its
 * tail as "reach" would have a deletion lengthen the song. A carve fills
 * `pushed` too, and its pieces are left out for that same reason: it only ever
 * makes a note shorter, so every piece it leaves sits at a tick the channel had
 * already reached, and a carve out in a channel's tail would otherwise pad every
 * other channel out to meet a note nothing moved. `erased` is what says a carve
 * is what filled it — the two resolvers never both run, since the mode picks one.
 *
 * A body edit's reach is in song ticks: the moved notes' furthest instance, with
 * every pass start carried by how many of **its own voice's** passes the length
 * change has already stretched in front of it, each voice's music sliding by its
 * own passes alone. `delta` prices the change once, off the same layout the
 * commit writes; `grown` is each voice's own total, for a pad whose channel tick
 * counts predate the edit.
 *
 * The pad belongs to the **gesture** and not to a frame: a gesture spanning
 * frames plans each of them alone, and two frames each padding the other
 * channels out to their own reach writes the rest twice, `coalesce`
 * concatenating rather than deduping. {@link planGroupEdits} prices it once.
 */
function planReach(
  strip: Strip,
  frame: StripFrame,
  plan: Plan,
): { reach: number; grown: ReadonlyMap<number, number> } {
  const moved = plan.erased.length > 0 ? plan.touched : [...plan.touched, ...plan.pushed];
  const grown = new Map<number, number>();
  const flat = moved.reduce((furthest, note) => Math.max(furthest, note.startTick + note.ticks), 0);
  if (frame.body < 0) {
    return { reach: flat, grown };
  }

  // The same per-voice ordinals the shift and the preview count, so the pad
  // cannot count a pass differently from the bars drawn into it.
  const delta = plannedFrameTicks(strip, frame, plan) - frame.ticks;
  let projected = 0;
  for (const pass of framePasses(frame)) {
    for (const note of moved) {
      projected = Math.max(
        projected,
        pass.tick + pass.ordinal * delta + note.startTick + note.ticks,
      );
    }

    // The last pass a voice plays leaves its whole count standing.
    grown.set(pass.channel, (pass.ordinal + 1) * delta);
  }

  return { reach: projected, grown };
}

/**
 * Several frames' plans written out as one commit — one undo step.
 *
 * A gesture that moves no tick may reach into a loop written inside the one it
 * started in (`spansFrames`), and each frame is planned and spelled on its
 * own: the frames are disjoint text, so the pieces should not overlap, and two
 * that do are refused rather than handed on. One frame refusing refuses the
 * lot, because a group half written is a song of neither shape.
 *
 * The frame reaching furthest is the one that pads the other channels out, and
 * every other frame is told the song is already that long — which it will be,
 * by the time these edits land together. `context.frame` on the way in is
 * ignored; each plan brings its own.
 */
export function planGroupEdits(
  context: EditContext,
  plans: readonly FramePlan[],
): Edit[] | EditRefusal {
  const reaches = plans.map(({ frame, plan }) => planReach(context.strip, frame, plan).reach);
  const furthest = reaches.indexOf(Math.max(...reaches, 0));
  const edits: Edit[] = [];
  for (let at = 0; at < plans.length; at++) {
    const written = planEdits(
      {
        ...context,
        frame: plans[at].frame,
        playableTicks:
          at === furthest
            ? context.playableTicks
            : Math.max(context.playableTicks, reaches[furthest]),
      },
      plans[at].plan,
    );
    if (!isEdits(written)) {
      return written; // One frame refused, so nothing lands anywhere.
    }

    edits.push(...written);
  }

  return ordered(edits) ?? refuse(REFUSE_CROWDED);
}

export function planEdits(context: EditContext, plan: Plan): Edit[] | EditRefusal {
  if (!committable(plan)) {
    return refuse(plan.refused ?? REFUSE_CLASH);
  }

  const { source, strip, frame } = context;
  const edits: Edit[] = [];
  const survivors = new Map<number, PlacedNote>();
  const born: PlacedNote[] = [];
  for (const note of plan.notes) {
    if (note.from >= 0) {
      survivors.set(note.from, note);
    } else {
      born.push(note);
    }
  }

  // A note carried *past* another cannot be rewritten where it stands. The text
  // is a sequence and a channel's positions are the running sum of its
  // durations, so a note whose new tick puts it on the other side of one of its
  // neighbours has to come out of the text and go back in over there. It is
  // moved out of `survivors`, which is all it takes: the loop below removes the
  // unit of anything it does not find there, and `regionsOf` hands a born note
  // to the region its new tick lands in.
  const lifted = new Set<number>();
  for (const index of crossings(strip, frame, survivors)) {
    const note = survivors.get(index);
    if (!note) {
      continue;
    }

    // A command written inside the note stands between two of its segments and
    // so inside the unit that is about to be taken out — `removeItem` splices
    // the whole span, and the run written on the far side is the note alone.
    // Moving one is not permission to throw a `v200` away, and which side of the
    // note the porter meant it to follow is not something a drag can say. This
    // is the same ground as `rewriteNote` refusing to move such a note's start.
    if (strip.items[index].segments.length > 1) {
      return refuse(REFUSE_INSIDE);
    }

    survivors.delete(index);
    lifted.add(index);
    born.push({ ...note, from: -1 });
  }

  // A note that has come to stand across the intro `/` or a song-wide command is
  // written again where it now plays too, so the run can split it around that
  // tick and the song loops back, or changes tempo, where it always did. Not one
  // with a command inside it or a slide riding it, which cannot be lifted; those
  // push the marker to their edge.
  for (const [index, note] of [...survivors]) {
    const item = strip.items[index];
    if (
      item.segments.length === 1 &&
      item.bend === null &&
      coversMarker(strip, frame, index, note)
    ) {
      survivors.delete(index);
      lifted.add(index);
      born.push({ ...note, from: -1 });
    }
  }

  // Built here rather than at the pass below that realises them: an octave put
  // back at a note's head has to agree with what the run in front of it leaves,
  // and `survivors` and `born` are both settled once the crossings are out.
  const regions = regionsOf(strip, frame, survivors, born);

  /** The born notes in tick order, which both passes below read. */
  const order = [...born].sort((a, b) => a.startTick - b.startTick);

  // An item the plan removes takes the `'note-state'` commands written in its
  // prefix and inside its own unit with it, but only the ones nothing still
  // sounds under (`reachesSomething`). Removal and not erasure: a Backspace, a
  // glue and a carve are one case, since which gesture emptied the ticks says
  // nothing about what a command reaches. A note the plan lifts across a
  // neighbour is moving rather than dying, so its prefix travels with it. The
  // channel's first item is exempt whatever happens to it — its prefix reaches
  // back over the channel's own header.
  const unheard = new Set<Command>();
  /** Those a removed unit's own splice takes out, and so need no edit of their own. */
  const swallowed = new Set<Command>();
  for (let index = frame.from; index < frame.to; index++) {
    const item = strip.items[index];
    const removed =
      item.kind === 'note'
        ? !survivors.has(index) && !lifted.has(index)
        : item.kind === 'rest' && coveredByBorn(order, item);
    if (!removed) {
      continue;
    }

    if (index > frame.from) {
      for (const command of prefixCommandsOf(strip, item)) {
        if (
          droppable(command) &&
          !reachesSomething(context, command, item.startTick, index, survivors, born)
        ) {
          unheard.add(command);
        }
      }
    }

    // A command written inside the unit is asked the same question, on its own
    // tick — but only a `'note-state'` one may be dropped at all. A `t` acts on
    // the song, so no note ever has it in force and the reach test would answer
    // "nothing" for a command every channel is listening to.
    for (const { command, tick } of insideCommands(strip, item)) {
      if (
        commandScope(command) === 'note-state' &&
        !command.inRemoteDefinition &&
        droppable(command) &&
        !reachesSomething(context, command, tick, index, survivors, born)
      ) {
        unheard.add(command);
        if (underRun(regions, frame, index)) {
          swallowed.add(command);
        }
      }
    }
  }

  // Every drop is written out here rather than beside the item that owned it:
  // a rest's prefix would otherwise have nowhere to go. One written inside a unit
  // a run is laid over goes with that unit's own removal; anywhere else the
  // unit's segments become rest around it and it needs an edit of its own.
  for (const command of unheard) {
    if (!swallowed.has(command)) {
      edits.push(...removeCommand(source, command));
    }
  }

  const deleted: Span[] = [...unheard].map((command) => command.span);

  const { octaves } = strip;
  /**
   * The octave the edited text has in force where the walk has got to, or `null`
   * where it cannot be said — carried down the channel so a note only writes one
   * where the one standing is not the one it needs. Text the plan does not touch
   * moves it as it always did, read off the original ({@link OctaveModel.carry}).
   */
  let running: number | null =
    frame.from < frame.to ? octaves.at(strip.items[frame.from].unitSpan.start) : null;
  let at = frame.from < frame.to ? strip.items[frame.from].unitSpan.start : 0;
  /**
   * The end of the last edit after which the edited text stopped agreeing with
   * the original about the octave, while it still disagrees — the place an octave
   * put back restores the original from, so a `<` or `>` standing after it still
   * does its job. `null` once the two agree again.
   */
  let diverged: number | null = null;
  /**
   * The octaves put back, held apart so they are written after the regions: a
   * rest realised at a reader's head lands at the same offset, `coalesce` joins
   * two empty ranges there in this array's order, and the rest has to be read
   * first.
   */
  const restores: Edit[] = [];

  /** Hands `reader` the octave the original gave it, from where the two parted. */
  const restoreFor = (reader: StripItem, wanted: number): EditRefusal | null => {
    const back = diverged === null ? null : octaves.at(diverged);
    const inPlace =
      diverged !== null && back !== null && octaves.moves(diverged, reader.unitSpan.start);
    const spelled = spellOctave(inPlace && back !== null ? back : wanted);
    if (spelled === null) {
      return refuse(REFUSE_SPELL);
    }

    const restore =
      inPlace && diverged !== null
        ? insertAt(diverged, ` ${spelled}`, reader.unitSpan.line)
        : insertAt(reader.unitSpan.start, `${spelled} `, reader.unitSpan.line);
    if (restore) {
      restores.push(restore);
    }

    running = wanted;
    diverged = null;
    return null;
  };

  /** Records where an edit ended, and whether the octave still agrees there. */
  const settle = (end: number): void => {
    diverged = running === octaves.at(end) ? null : end;
    at = end;
  };

  for (let index = frame.from; index < frame.to; index++) {
    const item = strip.items[index];
    /** The octave standing before the text in front of this item, and where that text starts. */
    const entering = running;
    const gapFrom = at;
    running = octaves.carry(running, at, item.unitSpan.start);
    // A run written in front of this item answers for its head (`spawnInto`).
    const answered = runBefore(regions, index);

    if (item.kind === 'construct') {
      // A body written here reads the octave its text was written under, unless
      // that text sets its own first; a recall parses no notes and reads nothing.
      const reads = octaves.first(item.unitSpan.start, item.unitSpan.end) === 'read';
      const wanted = octaves.at(item.unitSpan.start);
      if (answered) {
        running = reads ? wanted : null;
        diverged = null;
      } else if (reads && wanted !== null && running !== wanted) {
        const refused = restoreFor(item, wanted);
        if (refused) {
          return refused;
        }
      }

      running = octaves.carry(running, item.unitSpan.start, item.unitSpan.end);
      settle(item.unitSpan.end);
      continue;
    }

    if (item.kind === 'rest') {
      running = octaves.carry(running, item.unitSpan.start, item.unitSpan.end);
      at = item.unitSpan.end;
      continue;
    }

    const note = survivors.get(index);
    if (!note) {
      // A `$DD` reads the note in front of it rather than being dispatched
      // (`main.asm:L_10E4`), so taking that note away does not leave a slide
      // that does nothing — it leaves one the command loop reaches, whose
      // dispatch slot is `$0000`. Nothing else can decide this: `reachesSomething`
      // asks what still sounds *after* a command, and the loss is in front of it.
      if (item.bend !== null) {
        return refuse(REFUSE_BEND_RIDER);
      }

      // The drum it played goes with it, or the next note would play it instead.
      const apart = drumApart(item);
      if (apart !== null && !unheard.has(apart)) {
        edits.push(...removeCommand(source, apart));
      }

      // Its text is the region's to rewrite. Under a run the whole unit goes and the
      // run states what it needs (`spawnInto`); elsewhere its segments become rest
      // and its own `o`s stay where something still reads them (`keptOctaves`).
      // What is written between its segments stays either way.
      const head = item.segments[0];
      const last = item.segments[item.segments.length - 1];
      const kept = underRun(regions, frame, index)
        ? { lead: false, trail: false }
        : keptOctaves(context, item);
      if (kept.lead) {
        running = octaves.carry(running, item.unitSpan.start, head.span.start);
      }

      running = octaves.carry(running, head.span.end, last.span.start);
      if (kept.trail) {
        running = octaves.carry(running, last.span.end, item.unitSpan.end);
      }

      settle(item.unitSpan.end);
      continue;
    }

    // A note moved to the octave standing before the `<` and `>` in front of it
    // has those taken out rather than an `o` written after them: they are read by
    // this note alone, and `o4 c4 > d4` with `d4` dropped an octave is `o4 c4 d4`.
    // What the note leaves is put back by its exit, as for any rewrite.
    const shifts =
      answered ||
      note.drum !== null ||
      item.hasLeadingOctave ||
      entering === null ||
      octaveFor(note.written) !== entering ||
      octaveFor(note.written) === item.octave
        ? null
        : octaves.shiftsIn(gapFrom, item.unitSpan.start);
    if (shifts !== null && shifts.length > 0) {
      for (const shift of shifts) {
        edits.push(
          ...removeSpan(source, { start: shift, end: shift + 1, line: item.unitSpan.line }),
        );
      }

      running = entering;
    }

    if (answered) {
      // What the run leaves is the original's here, or this note spells its own.
      running = writesItsOwnOctave(strip, index, survivors) ? null : item.octave;
      diverged = null;
    } else if (!writesItsOwnOctave(strip, index, survivors) && running !== item.octave) {
      const refused = item.octave === null ? null : restoreFor(item, item.octave);
      if (refused) {
        return refused;
      }
    }

    const written = rewriteNote(context, index, note, survivors, regions, running);
    if (!isRewrite(written)) {
      return written;
    }

    edits.push(...written.edits);

    // A drum written apart from its note: a rewrite puts the `@` beside the note,
    // and a run written in front of the note would take the drum, so it goes to
    // the note's head — after the run, which is why it is held with the restores.
    const apart = drumApart(item);
    if (apart !== null && (written.edits.length > 0 || answered)) {
      edits.push(...removeCommand(source, apart));
      if (written.edits.length === 0) {
        const moved = insertAt(
          item.unitSpan.start,
          `${source.slice(apart.span.start, apart.span.end)} `,
          item.unitSpan.line,
        );
        if (moved) {
          restores.push(moved);
        }
      }
    }

    running = written.leaves;
    settle(item.unitSpan.end);
  }

  // Past the frame's last item the original goes on as it was written: the rest of
  // the channel, and then the blocks below, `octave` being one variable that a
  // `#N` does not reset. Put back only where something there reads it, and not
  // where a run in the tail has already answered.
  const tailRun = regions.some((region) => region.tail && region.born.length > 0);
  const lastItem = frame.from < frame.to ? strip.items[frame.to - 1] : null;
  if (!tailRun && lastItem !== null) {
    const wanted =
      octaves.at(at) ??
      (lastItem.kind === 'note' ? (lastItem.exitOctave ?? lastItem.octave) : null);
    const reads = frame.body >= 0 || octaves.next(at) === 'read';
    if (reads && wanted !== null && running !== wanted) {
      const back = diverged === null ? null : octaves.at(diverged);
      const inPlace = diverged !== null && back !== null && octaves.moves(diverged, at);
      const spelled = spellOctave(inPlace && back !== null ? back : wanted);
      if (spelled === null) {
        return refuse(REFUSE_SPELL);
      }

      const restore = insertAt(
        inPlace && diverged !== null ? diverged : at,
        ` ${spelled}`,
        lastItem.unitSpan.line,
      );
      if (restore) {
        restores.push(restore);
      }
    }
  }

  const { reach, grown } = planReach(strip, frame, plan);

  // Before the regions, and that is load-bearing rather than tidiness: a channel
  // being opened writes its `#N` at `strip.home.at`, which for an undeclared one
  // is the wound-back end of the document — the same offset as the tail of
  // whichever channel is written last. Both are empty ranges, `coalesce` joins
  // them into one, and the joined text is in this array's order. The other way
  // round, the rest lands inside the block just opened.
  if (reach > context.playableTicks) {
    const padded = padChannels(context, reach, grown);
    if (padded === null) {
      return refuse(REFUSE_SPELL);
    }

    edits.push(...padded);
  }

  for (const region of regions) {
    const written = realiseRegion(context, region, survivors, deleted);
    if (!isEdits(written)) {
      return written;
    }

    edits.push(...written);
  }

  // After the regions, and load-bearing for the reason they are put off at all:
  // a rest realised at a reader's head has to be read before the octave written
  // there.
  edits.push(...restores);

  const sorted = ordered(edits);
  if (sorted === null) {
    return refuse(REFUSE_CROWDED);
  }

  const dead = deadOctaves(context, sorted);
  return dead.length === 0 ? sorted : (ordered([...sorted, ...dead]) ?? refuse(REFUSE_CROWDED));
}

/**
 * The edits in offset order, joined where they touch, or `null` where two overlap.
 *
 * Shortest first at a shared offset, so an insertion sits ahead of the
 * replacement it abuts and `coalesce` can join the two into one. CodeMirror
 * merges overlapping ranges instead of refusing them, so refusing them is the
 * roll's own invariant to hold rather than something it can be told.
 */
function ordered(edits: readonly Edit[]): Edit[] | null {
  const sorted = coalesce(
    [...edits].sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end),
  );
  for (let at = 1; at < sorted.length; at++) {
    if (sorted[at].span.start < sorted[at - 1].span.end) {
      return null;
    }
  }

  return sorted;
}

/**
 * The porter's own `o`, `<` and `>` an edit has left with nothing to read them —
 * read by something before it and by nothing after — taken out, so an edit leaves
 * no octave standing in front of another that undoes it.
 *
 * Only the edited channel's, and only text no edit touches. Taking out an octave
 * nothing reads changes no note, so this is spelling and never music.
 */
function deadOctaves(context: EditContext, sorted: readonly Edit[]): Edit[] {
  const { source, strip, frame } = context;
  if (sorted.length === 0) {
    return [];
  }

  const index = tokenize(source);
  const markers = channelMarkers(index, source);
  /** The channel a root offset is written on; `-1` above the first marker. */
  const owner = (offset: number): number => {
    let channel = -1;
    for (const marker of markers) {
      if (marker.start > offset) {
        break;
      }

      channel = marker.channel;
    }

    return channel;
  };

  // A body's text is its own frame's, which the same gesture may be rewriting.
  const inBody = (offset: number): boolean =>
    strip.frames.some(
      (each) =>
        each !== frame &&
        each.body >= 0 &&
        offset >= each.span.start &&
        offset < each.span.end &&
        (frame.body < 0 || each.span.start >= frame.span.start),
    );
  const ours = (offset: number): boolean =>
    !inBody(offset) &&
    (frame.body >= 0
      ? offset >= frame.span.start && offset < frame.span.end
      : owner(offset) === strip.channel);

  const candidates: Span[] = [
    ...index.tokens
      .filter((token) => token.kind === 'octaveShift')
      .map((token) => ({ start: token.start, end: token.end, line: token.line })),
    ...index.commands
      .filter(
        (command) =>
          command.kind.toLowerCase() === 'o' &&
          command.replacement === undefined &&
          !command.inRemoteDefinition,
      )
      .map((command) => command.span),
  ];

  let text = '';
  let cursor = 0;
  /** Where each edit's own text lands in the edited text. */
  const written: { start: number; end: number }[] = [];
  for (const edit of sorted) {
    text += source.slice(cursor, edit.span.start);
    written.push({ start: text.length, end: text.length + edit.text.length });
    text += edit.text;
    cursor = edit.span.end;
  }

  text += source.slice(cursor);
  const after = octaveModel(text, tokenize(text));
  /** Where an offset no edit covers lands in the edited text. */
  const moved = (offset: number): number =>
    sorted.reduce(
      (at, edit) =>
        edit.span.end <= offset ? at + edit.text.length - (edit.span.end - edit.span.start) : at,
      offset,
    );

  const out: Edit[] = [];
  for (const span of candidates) {
    if (!ours(span.start)) {
      continue;
    }

    const gone = removeSpan(source, span);
    const from = gone[0]?.span.start ?? span.start;
    const touched = sorted.some(
      (edit) =>
        (edit.span.start < span.end && edit.span.end > from) ||
        (edit.span.start === edit.span.end && edit.span.start > from && edit.span.start < span.end),
    );
    const end = moved(span.start) + span.end - span.start;
    if (touched || after.next(end) === 'read') {
      continue;
    }

    // Read before the edit, or unread already and now standing straight in front
    // of an octave the edit wrote, which is the stacking `o4 o3` this is for — but
    // not where that octave is the one that overrode it before, rewritten in place.
    const next = after.nextAt(end);
    const was = strip.octaves.nextAt(span.end);
    const restated =
      was !== null && sorted.some((edit) => was >= edit.span.start && was < edit.span.end);
    const behindOurs =
      !restated &&
      next !== null &&
      written.some((range) => next >= range.start && next < range.end);
    if (strip.octaves.next(span.end) === 'read' || behindOurs) {
      out.push(...gone);
    }
  }

  return out;
}

/**
 * Joins edits that touch into one.
 *
 * Deleting a note and writing the rest that takes its place meet at a single
 * offset, and two edits sharing an offset are two ways of saying one thing:
 * which of them lands first decides the result, and nothing in the pair says
 * which should. One edit over the joined run has one answer.
 */
export function coalesce(sorted: readonly Edit[]): Edit[] {
  const joined: Edit[] = [];
  for (const edit of sorted) {
    const held = joined[joined.length - 1];
    if (held?.span.end === edit.span.start) {
      joined[joined.length - 1] = {
        span: { ...held.span, end: edit.span.end },
        text: held.text + edit.text,
        expect: held.expect + edit.expect,
      };
      continue;
    }

    joined.push(edit);
  }

  return joined;
}

/**
 * The notes whose place in the text is no longer their place in the music.
 *
 * {@link regionsOf} walks the channel in the order it is **written** and sizes
 * each gap as the distance from the note before it, so it holds only while tick
 * order and text order are the same thing. A gesture that carries a note past
 * one of its neighbours breaks that, and the note has to be written again on the
 * far side rather than rewritten where it stands.
 *
 * Only a note that ended up somewhere other than where it is written can break
 * it, which is the test rather than membership of {@link Plan.touched}: a push
 * moves notes the gesture never named, and a carve trims a head, so "the gesture
 * moved it" is not the same question. The ones still on their own tick are in
 * text order by construction — a channel's ticks are the running sum of its
 * durations — so taking the movers out is enough to put the rest back in
 * agreement rather than the first step of a search.
 *
 * A note that moved cannot always cross, and this asks anyway: a push settles a
 * note against the edge that displaced it, so getting past a neighbour would
 * mean lying across it, and an overlap no push resolved is a clash `committable`
 * has already turned the plan away for.
 */
function crossings(
  strip: Strip,
  frame: StripFrame,
  survivors: ReadonlyMap<number, PlacedNote>,
): number[] {
  const crossed: number[] = [];
  for (const [at, note] of survivors) {
    if (note.startTick === strip.items[at].startTick) {
      continue; // Where it is written, so nothing can have got past it.
    }

    let over = false;
    for (const [index, other] of survivors) {
      // Written after it but played before it, or the other way about.
      if (index !== at && index > at !== other.startTick > note.startTick) {
        over = true;
        break;
      }
    }

    // A construct is a neighbour too, with a tick nothing moves: a note whose
    // planned tick puts it on the other side of a loop than its text does has
    // to come out and go back in over there like any other crossing.
    for (let index = frame.from; !over && index < frame.to; index++) {
      const item = strip.items[index];
      if (item.kind === 'construct' && index > at !== item.startTick > note.startTick) {
        over = true;
      }
    }

    if (over) {
      crossed.push(at);
    }
  }

  return crossed;
}

/**
 * Whether a note moved or resized now plays across, or on the far side of, an
 * intro `/` or a song-wide command written in its frame — which keeps its tick
 * only if the note is written again where it now plays.
 *
 * A marker's tick is that of the first item written after it. Only markers
 * between the frame's own items count, and not one inside a loop's body, which
 * is another frame's text.
 */
function coversMarker(strip: Strip, frame: StripFrame, at: number, note: PlacedNote): boolean {
  const item = strip.items[at];
  if ((note.startTick === item.startTick && note.ticks === item.ticks) || frame.from >= frame.to) {
    return false;
  }

  const first = strip.items[frame.from].unitSpan.start;
  const last = strip.items[frame.to - 1].unitSpan.end;
  const markers = [
    ...strip.intros,
    ...strip.commands
      .filter((command) => command.noteLength === undefined && commandScope(command) === 'song')
      .map((command) => command.span),
  ].filter(
    (span) =>
      span.start >= first &&
      span.start < last &&
      !strip.items
        .slice(frame.from, frame.to)
        .some((each) => span.start >= each.unitSpan.start && span.start < each.unitSpan.end),
  );

  const end = note.startTick + note.ticks;
  for (const span of markers) {
    let tick = frame.ticks;
    for (let index = frame.from; index < frame.to; index++) {
      if (strip.items[index].unitSpan.start >= span.end) {
        tick = strip.items[index].startTick;
        break;
      }
    }

    const written = item.unitSpan.end <= span.start;
    if (written ? end > tick : note.startTick < tick) {
      return true;
    }
  }

  return false;
}

/**
 * The stretches of text between the frame's anchors, with what belongs in each.
 *
 * An anchor is a surviving note at its planned tick, or a construct at its
 * fixed one — a loop bounds a region exactly as a note does, its ticks being
 * nothing a gesture may rewrite.
 */
function regionsOf(
  strip: Strip,
  frame: StripFrame,
  survivors: ReadonlyMap<number, PlacedNote>,
  born: readonly PlacedNote[],
): Region[] {
  const anchors: { index: number; startTick: number; end: number }[] = [];
  for (let index = frame.from; index < frame.to; index++) {
    const item = strip.items[index];
    const note = survivors.get(index);
    if (note) {
      anchors.push({ index, startTick: note.startTick, end: note.startTick + note.ticks });
    } else if (item.kind === 'construct') {
      anchors.push({ index, startTick: item.startTick, end: item.startTick + item.ticks });
    }
  }

  const regions: Region[] = [];
  let after = -1;
  let startTick = 0;
  for (const anchor of anchors) {
    regions.push(
      makeRegion(strip, frame, after, anchor.index, startTick, anchor.startTick - startTick),
    );
    after = anchor.index;
    startTick = anchor.end;
  }

  regions.push(makeRegion(strip, frame, after, frame.to, startTick, -1, true));

  for (const note of [...born].sort((a, b) => a.startTick - b.startTick)) {
    const home =
      regions.find(
        (each) =>
          each.ticks >= 0 &&
          note.startTick >= each.startTick &&
          note.startTick + note.ticks <= each.startTick + each.ticks,
      ) ?? regions[regions.length - 1];
    home.born.push(note);
  }

  return regions;
}

function makeRegion(
  strip: Strip,
  frame: StripFrame,
  after: number,
  before: number,
  startTick: number,
  ticks: number,
  tail = false,
): Region {
  const rests: StripItem[] = [];
  let between = 0;
  const head = after < 0 ? frame.from : after + 1;
  for (let index = head; index < before; index++) {
    between++;
    if (strip.items[index].kind === 'rest') {
      rests.push(strip.items[index]);
    }
  }

  return { after, before, rests, ticks, tail, born: [], startTick, between };
}
