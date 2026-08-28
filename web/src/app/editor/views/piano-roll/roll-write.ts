import {
  octaveFor,
  parseWrittenPitch,
  spellDuration,
  spellNote,
  spellOctave,
  spellQ,
} from '@amk/core/mml-text';
import type { Span } from '@amk/core/types';
import type { Command } from '@amk/tokens';
import { commandScope } from '@amk/tokens/commands/in-force';
import { commandRewritable, type Edit, insertAt, spliceOut, spliceRange } from '@amk/tokens/edits';
import {
  type EditContext,
  type EditRefusal,
  type PlacedNote,
  type Plan,
  REFUSE_BEND_RIDER,
  REFUSE_CLASH,
  REFUSE_CROWDED,
  REFUSE_INSIDE,
  REFUSE_RAMP,
  REFUSE_SPELL,
  isEdits,
} from './roll-edit';
import type { Strip, StripItem } from './roll-strip';

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
function eol(source: string): string {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

/** The octave {@link channelOpening} writes, and so the one it leaves in force. */
const OPENING_OCTAVE = 4;

/** Everything that can move the octave, as text — see {@link spawnInto}. */
const MOVES_OCTAVE = /[o<>]/;

/** `q[channel]` before anything sets it (`parser.ts:200`). */
const OPENING_Q = 0x7f;

/**
 * A channel the song has not declared, written out: its `#N` and the state a
 * fresh channel runs under, so that nothing it plays depends on what the block
 * above it happened to leave standing.
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
 * on and resets `h` instead of saying what is already true; that is the gate
 * `normalize.ts:writeDefaults` takes. No `t`, which reaches all eight channels
 * and is not what drawing one note asked for, and no `h`, which replaces an
 * instrument's tuning rather than adding to it, so `h0` is not "no transposition".
 */
function channelOpening(channel: number, songTargetProgram: number): string {
  const parts = [`o${OPENING_OCTAVE}`, spellQ(OPENING_Q)];
  if (songTargetProgram === 0) {
    parts.push('@0');
  }

  parts.push('v255', 'y10');
  return `#${channel} ${parts.join(' ')}`;
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

/** The index of the next note on the channel at or after `from`, or -1 for none. */
function noteFrom(strip: Strip, from: number): number {
  for (let at = from; at < strip.items.length; at++) {
    if (strip.items[at].kind === 'note') {
      return at;
    }
  }

  return -1;
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
 * The octave a run spawned in the region ending at `index` leaves standing.
 *
 * Two readers, and one answer serves both. A note bounding the region reads it:
 * {@link spawnInto} answers for that note either way — it writes the octave at
 * the note's head, or it has proved the run already leaves the right one — so a
 * number here means `planEdits` has nothing to add at that head. The block below
 * a `#N` reads it too, where the region is the tail and nothing on the channel
 * survived, since `octave` is global parser state.
 *
 * `null` where no run was spawned there, and where the one that was ends on a
 * drum: that writes no octave at all and leaves whatever stood, which is
 * `leaves` being null in {@link spawnInto} and is the one case neither reader
 * can be answered for.
 */
function spawnLeaves(regions: readonly Region[], index: number): number | null {
  const gap = regions.find((each) => each.before === index && each.born.length > 0);
  if (gap === undefined) {
    return null;
  }

  // The last note in tick order is the one whose octave the run leaves, which
  // is what `spawnInto` takes for its own `born`. On the tick alone rather than
  // through `byTick`, which breaks ties on `from`: two notes on one tick sound
  // at once, and `committable` has already turned that plan away.
  const last = gap.born.reduce((furthest, note) =>
    note.startTick >= furthest.startTick ? note : furthest,
  );
  return last.drum === null ? octaveFor(last.written) : null;
}

/**
 * The octave to put back after a note whose own has been rewritten.
 *
 * The octave in force after the unit as it was written — unless the next note on
 * the channel sets its own. The last note of a channel always restores, because
 * `octave` is global parser state and leaks past a `#N` into whatever block comes
 * after it.
 */
function exitOctaveFor(
  strip: Strip,
  index: number,
  survivors: ReadonlyMap<number, PlacedNote>,
): number | null {
  const item = strip.items[index];
  const exit = item.exitOctave ?? item.octave;
  // A `$DD` target reads the octave where it stands, and it stands before the
  // next item — so the next item writing its own is not an answer for it. It is
  // in no `segments`, so `noteFrom` cannot see it and only `bend` says it is
  // there.
  if (item.bend?.noteTarget !== undefined) {
    return exit;
  }

  const next = noteFrom(strip, index + 1);
  return next >= 0 && writesItsOwnOctave(strip, next, survivors) ? null : exit;
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
 * The end of an item, past the `$DD` it carries.
 *
 * Where a run is written after a note, "after" has to mean after the whole of
 * what the driver reads as part of that note. See {@link writeInto}.
 */
function afterBend(item: StripItem): number {
  return Math.max(item.unitSpan.end, item.bend?.span.end ?? 0);
}

/** The unit and the whitespace in front of it, so a deletion leaves no double space. */
function removeItem(source: string, item: StripItem): Edit[] {
  const edit = spliceOut(source, item.unitSpan);
  return edit ? [edit] : [];
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
  /** Where the slot changed hands, and so where this command stops reaching. */
  let end = Number.POSITIVE_INFINITY;
  for (let index = from; index < strip.items.length; index++) {
    const item = strip.items[index];
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

/** What one surviving note needs written, which is usually nothing at all. */
function rewriteNote(
  context: EditContext,
  index: number,
  note: PlacedNote,
  survivors: ReadonlyMap<number, PlacedNote>,
  running: number | null,
): Edit[] | EditRefusal {
  const { source, strip, targetAMKVersion } = context;
  const item = strip.items[index];
  const samePitch =
    note.written === item.written && note.drum === (item.drum?.args[0]?.value ?? null);
  const sameLength = note.ticks === item.ticks;
  if (samePitch && sameLength) {
    return [];
  }

  const exit = exitOctaveFor(strip, index, survivors);

  // One segment is one token, so the whole unit is rewritten together.
  if (item.segments.length === 1) {
    const length = sameLength ? writtenLength(source, item) : null;
    const text = noteText(note, length, exit, targetAMKVersion, running);
    if (text === null) {
      return refuse(REFUSE_SPELL);
    }

    const edit = spliceRange(source, item.unitSpan, text);
    return edit ? [edit] : [];
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
  const headText = noteText(note, writtenLength(source, item), null, targetAMKVersion, running);
  if (headText === null) {
    return refuse(REFUSE_SPELL);
  }

  const headEdit = spliceRange(source, headSpan, headText);
  if (headEdit) {
    edits.push(headEdit);
  }

  const tail = item.segments[item.segments.length - 1];
  const length = spellDuration(remaining, targetAMKVersion);
  if (length === null) {
    return refuse(REFUSE_SPELL);
  }

  const put = exitText(note, exit);
  if (put === null) {
    return refuse(REFUSE_SPELL);
  }

  const tailEdit = spliceRange(
    source,
    { start: tail.span.start, end: item.unitSpan.end, line: tail.span.line },
    `^${length}${put}`,
  );
  if (tailEdit) {
    edits.push(tailEdit);
  }

  return edits;
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

/** A stretch of rests that will be written as the one rest they are — see {@link restRuns}. */
interface RestRun {
  /** In order. The first is the one the whole run is written into. */
  rests: StripItem[];
  /** Whether a unit this plan removes is what joined two of them. */
  joined: boolean;
}

/**
 * A region's rests, grouped into the stretches that will end up touching.
 *
 * Two rests are one run when everything between them is whitespace or a unit
 * this plan removes — and every non-rest item strictly inside a region is a
 * note being deleted, by construction of {@link regionsOf}, so a deleted note
 * between two rests joins them. Two rests written touching already are one run
 * too, since the text says so.
 *
 * A `v200`, a `y`, a `$ED` or the intro `/` between them is not whitespace, and
 * the run stops there: those carry a position, and a run is written over as one
 * piece. Spans are {@link StripItem.unitSpan} rather than `prefixSpan` because a
 * deleted note's unit swallows the `o` written beside it (`roll-strip.ts`,
 * `growUnits`) and {@link removeItem} takes the whole unit with it.
 */
function restRuns(context: EditContext, gap: Region): RestRun[] {
  const { source, strip } = context;
  const runs: RestRun[] = [];
  let open: RestRun | null = null;
  /** Whether nothing but whitespace and removed units has been passed since the last rest. */
  let clean = false;
  /** And whether one of those removed units is what stands between them. */
  let removed = false;

  for (let index = gap.after + 1; index < gap.before; index++) {
    const item = strip.items[index];
    const touches =
      index > gap.after + 1 &&
      source.slice(strip.items[index - 1].unitSpan.end, item.unitSpan.start).trim() === '';

    if (item.kind !== 'rest') {
      clean = clean && touches;
      removed = true;
      continue;
    }

    if (open !== null && clean && touches) {
      open.rests.push(item);
      open.joined ||= removed;
    } else {
      open = { rests: [item], joined: false };
      runs.push(open);
    }

    clean = true;
    removed = false;
  }

  return runs;
}

/**
 * Trailing rests a deletion left touching, written as the one rest they are.
 *
 * Nothing rewrites the tail's length — the channel ends where its music ends —
 * so the only runs collapsed here are the ones this gesture is what joined. A
 * run the porter wrote touching has had nothing done to it and is left as
 * written, which is the same line {@link realiseRegion} takes when a gap's ticks
 * do not change.
 *
 * The total is preserved, so the channel is exactly as long afterwards.
 */
function joinTail(context: EditContext, gap: Region): Edit[] | null {
  const edits: Edit[] = [];
  for (const run of restRuns(context, gap)) {
    if (!run.joined) {
      continue;
    }

    const written = collapse(context, run, rested(run.rests, 0));
    if (written === null) {
      return null;
    }

    edits.push(...written);
  }

  return edits;
}

/**
 * A run written as one rest of `want` ticks, or removed outright where it is
 * asked for none.
 *
 * The rests it leaves behind go one edit each rather than the whole run going as
 * a single splice, and that is load-bearing: `planEdits` puts a deleted note's
 * octave restore back at that note's own `unitSpan.end`, which a splice over the
 * run would enclose — and CodeMirror merges overlapping ranges rather than
 * refusing them, so `planEdits` refuses the gesture instead. Abutting edits are
 * what {@link coalesce} joins, in the order they are read.
 */
function collapse(context: EditContext, run: RestRun, want: number): Edit[] | null {
  const { source, targetAMKVersion } = context;
  const edits: Edit[] = [];
  for (const gone of run.rests.slice(1)) {
    edits.push(...removeItem(source, gone));
  }

  if (want <= 0) {
    edits.push(...removeItem(source, run.rests[0]));
    return edits;
  }

  const text = spellDuration(want, targetAMKVersion);
  if (text === null) {
    return null;
  }

  const edit = spliceRange(source, run.rests[0].unitSpan, `r${text}`);
  if (edit) {
    edits.push(edit);
  }

  return edits;
}

/** What a stretch of runs holds now, from `from` on. */
function heldBy(runs: readonly RestRun[], from: number): number {
  return runs.slice(from).reduce((sum, run) => sum + rested(run.rests, 0), 0);
}

/**
 * The rests between the notes, made to come to the ticks the plan asks for.
 *
 * Every change is taken from the rest **nearest the note before it**, so
 * anything written later in the gap keeps its distance from the note it was
 * written for: a `v200` two beats ahead of a note stays two beats ahead of it. A
 * shrink that exhausts one rest deletes it and carries on into the next; a gap
 * with no rest at all has one written in straight after the note before it.
 *
 * What the change is taken from is a **run** of rests rather than one rest
 * (`restRuns`): a note deleted from between two of them leaves them touching,
 * and two touching rests are one rest. A run whose ticks are what they already
 * were is left exactly as written, so rests the porter wrote touching are only
 * ever joined by a gesture that had to move them anyway.
 */
function realiseRegion(
  context: EditContext,
  gap: Region,
  survivors: ReadonlyMap<number, PlacedNote>,
  deleted: readonly Span[],
): Edit[] | EditRefusal {
  const { targetAMKVersion } = context;
  const edits: Edit[] = [];

  // The tail is free: a channel may end wherever the music ends. What it is not
  // free to leave is two rests where a deleted note stood between them.
  if (gap.tail && gap.born.length === 0) {
    const joined = joinTail(context, gap);
    return joined ?? refuse(REFUSE_SPELL);
  }

  // A gap between two notes that has to come to less than nothing is a plan
  // asking for them in an order the text does not have them in, which
  // `crossings` takes out before the regions are built. Refused rather than
  // written: there is no run of rests that realises it, and the answer that
  // looks plausible — leave the text alone — is a channel slid along.
  if (!gap.tail && gap.ticks < 0) {
    return refuse(REFUSE_CROWDED);
  }

  if (gap.born.length > 0) {
    return spawnInto(context, gap, survivors, deleted);
  }

  const runs = restRuns(context, gap);
  let left = gap.ticks;
  for (let at = 0; at < runs.length; at++) {
    const run = runs[at];
    const held = rested(run.rests, 0);
    const last = at === runs.length - 1;
    const want = last ? left : at === 0 ? Math.max(0, left - heldBy(runs, 1)) : held;
    if (want !== held) {
      const written = collapse(context, run, want);
      if (written === null) {
        return refuse(REFUSE_SPELL);
      }

      edits.push(...written);
    }

    if (want <= 0) {
      continue;
    }

    left -= want;
  }

  if (left === 0) {
    return edits;
  }

  if (left < 0) {
    return refuse(REFUSE_CROWDED); // The rests could not give up enough; a command would have to move.
  }

  const text = spellDuration(left, targetAMKVersion);
  if (text === null) {
    return refuse(REFUSE_SPELL);
  }

  const edit = writeInto(context, gap, `r${text}`);
  return edit ? [...edits, edit] : refuse(REFUSE_CROWDED);
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

  const next = strip.items[gap.before];
  if (next) {
    return insertAt(next.unitSpan.start, `${run} `, 1);
  }

  // No note after it either, so the region is the whole channel and the run goes
  // where its items were: after the last of them, as the branch above puts it
  // after the note before the gap. Not at the head of the first — every item in
  // here is a unit `planEdits` removes, `removeItem` takes the whitespace in
  // front of the unit with it, and an insertion at a head therefore lands
  // strictly inside a range being deleted, which `planEdits` refuses. The end of
  // the last only abuts one.
  const last = strip.items[gap.before - 1];
  if (last) {
    return insertAt(last.unitSpan.end, ` ${run}`, 1);
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
function padChannels(context: EditContext, to: number): Edit[] | null {
  const { source, strip, targetAMKVersion } = context;
  const line = eol(source);
  const edits: Edit[] = [];

  for (const [channel, tail] of context.channels.entries()) {
    if (channel === strip.channel || tail.ticks <= 0 || tail.ticks >= to) {
      continue;
    }

    const text = spellDuration(to - tail.ticks, targetAMKVersion);
    if (text === null) {
      return null;
    }

    const edit = insertAt(tail.at, `${line}r${text}`, 1);
    if (edit) {
      edits.push(edit);
    }
  }

  return edits;
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
      const piece = spellDuration(marks[next].tick - at, targetAMKVersion);
      if (piece === null) {
        return false;
      }

      parts.push(`r${piece}`);
      at = marks[next].tick;
      mark();
    }

    const last = spellDuration(end - at, targetAMKVersion);
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
 * born note reaches into.
 */
function windowOf(strip: Strip, gap: Region, order: readonly PlacedNote[]): StripItem[] {
  const interior = strip.items.slice(gap.after + 1, gap.before);
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

  return interior.filter((item) => item.startTick < to && item.startTick + item.ticks > from);
}

/** A command a run has to write for itself, and the tick it stands on. */
interface CarriedCommand {
  command: Command;
  tick: number;
  /**
   * Whether it stands inside a unit the plan is splicing, and so is already
   * being taken out — a command between a note's segments goes with the note's
   * `unitSpan`, where one between two units is left behind by both.
   */
  inside: boolean;
}

/**
 * What a run laid over the window has to take over from the text it replaces,
 * or `null` where something in there cannot be taken over at all.
 *
 * A `v`, a `y`, a `$ED` or the intro `/` carries no ticks of its own but does
 * carry a **position**: the tick of the boundary it stands at. A run rewrites
 * every boundary strictly inside the window, so anything written on one has to
 * be re-emitted by the run itself, at that same tick — which is what a
 * {@link RunMark} is. One written before the window's first item or after its
 * last stands on a boundary the run starts or ends at, and stays exactly where
 * it is, which is why only the interior is read.
 *
 * Two places a boundary can be written on: between two of the window's items,
 * and inside one of them, between the head and a `^` continuation the porter
 * put a command between (`roll-strip.ts:segments`).
 *
 * Only a `'note-state'` command is carried. A `t` or a `w` acts on the song and
 * not on this channel's next note, an `l` or a naked `o` is parse state the run
 * spells for itself and two writers on one variable is worse than a refusal, a
 * `;` comment and the intro `/` are not commands at all, and a command written
 * through a `"name=value"` has a span collapsed onto its call site
 * (`edits.ts:commandRewritable`). Each of those refuses.
 *
 * A command this plan deletes along with the item it defined stands on no
 * boundary at all, so the spans in `deleted` read as blank.
 */
function windowCarries(
  context: EditContext,
  window: readonly StripItem[],
  deleted: readonly Span[],
): CarriedCommand[] | null {
  const { source, strip } = context;
  const carried: CarriedCommand[] = [];

  /** Everything written between two offsets, all of it standing on one tick. */
  const between = (from: number, to: number, tick: number, inside: boolean): boolean => {
    let at = from;
    while (at < to) {
      if (/\s/.test(source[at]) || deleted.some((span) => at >= span.start && at < span.end)) {
        at++;
        continue;
      }

      const command = strip.commands.find((each) => at >= each.span.start && at < each.span.end);
      if (
        command === undefined ||
        command.inRemoteDefinition ||
        !commandRewritable(command) ||
        // A `RunMark` re-emits its command at a tick, and `$DD` needs a *byte*
        // in front of it rather than a tick (`main.asm:L_10E4`) — and where it
        // names its target as a note, that target would read the run's octave
        // rather than the one it was written under. `StripItem.bend` is what
        // keeps it where it is; the run being refused here is the same answer.
        command.vcmd === 0xdd ||
        commandScope(command) !== 'note-state'
      ) {
        return false;
      }

      carried.push({ command, tick, inside });
      at = command.span.end;
    }

    return true;
  };

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
   */
  const channelEnd = empty ? context.playableTicks : strip.ticks;

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
    window = windowOf(strip, gap, order);
    over = window.find((item) => item.kind === 'rest') ?? null;
  }

  // Everything in the window but the whitespace is either leaving — a unit
  // `planEdits` removes, or a declaration deleted with the item that owned it,
  // which arrives here as a span so the run can tell text that is going from
  // text that would have to move — or is a `'note-state'` command the run writes
  // for itself on the tick it stands on. A `t`, an `l` or a `/` in there still
  // refuses, for the reason deleting the notes around it would move it: what it
  // stood against has gone, and the run has nothing to say on its behalf.
  const carried = windowCarries(context, window, deleted);
  if (carried === null) {
    return refuse(REFUSE_CROWDED);
  }

  const wide = window.length === gap.between;
  // A run that leaves items of the region standing cannot absorb a resize:
  // their ticks are exactly what it must not rewrite. No gesture builds such a
  // region — a pushed note bounds its own region, and a carve keeps the
  // region's ticks — so this is a guard rather than a road.
  if (laidOut && !wide && !gap.tail) {
    let interiorTicks = 0;
    for (let index = gap.after + 1; index < gap.before; index++) {
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
    marks.push({
      tick: each.tick,
      text: source.slice(each.command.span.start, each.command.span.end),
    });
  }

  marks.sort((a, b) => a.tick - b.tick);

  /**
   * The octave the run leaves standing, which is the note's own: a spawn writes
   * an absolute `o` in front of itself wherever one is in doubt, and a drum
   * writes none at all and so leaves whatever stood.
   */
  const leaves = born.drum === null ? octaveFor(born.written) : null;
  // The next *surviving* note, which is what bounds the region — `noteFrom`
  // would find the first note item, and that may be one this plan is removing:
  // an octave inserted at its head is an edit inside a range being deleted, and
  // two edits over one run of text is what `planEdits` refuses.
  const reader = gap.before < strip.items.length ? gap.before : -1;

  /**
   * The note that reads the octave the run leaves, and so has to be given the
   * one it was written under.
   *
   * Its own head, rather than the end of the run: `<` and `>` are not commands
   * to the scanner at all, so nothing here can say which side of the run one
   * written in this gap sits on, and a note's head is past every one of them. It
   * is also where the text settles — an `o` written there is that note's leading
   * octave on the next pass (`roll-strip.ts:growUnits`), where one left between
   * two rests is claimed by no unit and is what makes a later edit unreadable.
   */
  const owed =
    leaves !== null && reader >= 0 && !writesItsOwnOctave(strip, reader, survivors)
      ? strip.items[reader].octave
      : null;

  // Nothing left on the channel to hand it to, so the run carries it: `octave`
  // is global parser state and leaks past a `#N` into the block below.
  const previous = gap.after >= 0 ? strip.items[gap.after] : null;
  const standing = previous ? (previous.exitOctave ?? previous.octave) : null;
  const trailing = reader < 0 ? standing : null;

  /**
   * The octave in force where the run goes, or `null` for not known — a note
   * drawn at the octave already standing writes no `o` in front of itself.
   *
   * The note before the gap gives it, out of its own byte, so a `<` or a `>`
   * written above that note is already in it. What is left is the text between
   * that note and where the run lands, which has to move the octave nowhere:
   * only `o`, `<` and `>` can, and a channel the strip built holds no `[ ]`,
   * `(n)` or `"x=y"` to hide one inside (`roll-strip.ts:forbiddenConstruct`), so
   * reading the three characters off the text is exact. It over-matches one
   * written in a comment, which costs the note an `o` it did not need and
   * nothing else.
   */
  const runAt = over
    ? over.unitSpan.start
    : (windowLast?.unitSpan.end ?? previous?.unitSpan.end ?? 0);
  const inForce =
    previous !== null && !MOVES_OCTAVE.test(source.slice(previous.unitSpan.end, runAt))
      ? standing
      : null;

  /** The head the octave would be put back at, which is where the reader begins. */
  const readAt = reader >= 0 ? strip.items[reader].unitSpan.start : 0;
  /**
   * Where the run's text ends, which is where the splice over `over` and the
   * insertions below put it: the rest it was written over, the window's last
   * item, or the reader's own head for a region at the top of the channel.
   */
  const runEnd = over
    ? over.unitSpan.end
    : (windowLast?.unitSpan.end ??
      (gap.after >= 0 ? strip.items[gap.before - 1].unitSpan.end : readAt));

  /**
   * Whether the note after the gap can be left as it is.
   *
   * The run leaves {@link leaves} standing, so that note reads what it was
   * written under exactly when the two are the same octave and nothing between
   * the run and its head moves the octave again. What can is the three
   * characters the scan above reads, on the other side of the run, and for the
   * same reason: `o`, `<` and `>` are all that move it, and a channel the strip
   * built holds no `[ ]`, `(n)` or `"x=y"` to hide one inside. It over-matches
   * one written in a comment and one inside a unit this plan is deleting, which
   * costs the note an `o` it did not need and nothing else.
   */
  const untouched = owed === leaves && !MOVES_OCTAVE.test(source.slice(runEnd, readAt));

  const run = spawnRun(
    context,
    order,
    gaps,
    runFrom,
    opening ? OPENING_OCTAVE : inForce,
    marks,
    trailing,
  );
  if (run === null) {
    return refuse(REFUSE_SPELL);
  }

  let restore: Edit | null = null;
  if (owed !== null && !untouched) {
    const spelled = spellOctave(owed);
    if (spelled === null) {
      return refuse(REFUSE_SPELL);
    }

    restore = insertAt(strip.items[reader].unitSpan.start, `${spelled} `, 1);
  }

  // No rest to write over — the window holds nothing but notes this plan is
  // removing — so the run is inserted after its last item, where the removals
  // leave a hole of exactly the run's ticks and the insertion only abuts them.
  // A window with no items at all is a run written beside the region's anchors,
  // which is {@link writeInto}'s to place.
  const edit = over
    ? spliceRange(source, over.unitSpan, run)
    : windowLast !== undefined
      ? insertAt(windowLast.unitSpan.end, ` ${run}`, 1)
      : writeInto(context, gap, run);
  if (edit === null) {
    return refuse(REFUSE_CROWDED);
  }

  // A run laid out afresh is the whole window's ticks, so the rests in it that
  // it did not go over are gone: what they held is in the run now. Each goes as
  // its own edit rather than the whole stretch going as one splice, since
  // anything between them is a unit `planEdits` is removing and two edits over
  // one run of text is what it refuses.
  const gone = laidOut
    ? window
        .filter((item) => item.kind === 'rest' && item !== over)
        .flatMap((item) => removeItem(source, item))
    : [];

  // A carried command the run has re-emitted has to come out of where it was
  // written, unless the unit it stands inside is itself being spliced — that
  // takes it along, and taking it twice is two edits over one run of text.
  const taken = carried
    .filter((each) => !each.inside)
    .flatMap((each) => removeCommand(source, each.command));

  // The run first where the two land on the same offset — a run inserted at the
  // head of the note it is being written in front of — so `coalesce` joins them
  // in the order they are read.
  return restore ? [edit, ...gone, ...taken, restore] : [edit, ...gone, ...taken];
}

export function planEdits(context: EditContext, plan: Plan): Edit[] | EditRefusal {
  if (!committable(plan)) {
    return refuse(plan.refused ?? REFUSE_CLASH);
  }

  const { source, strip } = context;
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
  for (const index of crossings(strip, survivors)) {
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

  // Built here rather than at the pass below that realises them: an octave put
  // back at a note's head has to agree with what the run in front of it leaves,
  // and `survivors` and `born` are both settled once the crossings are out.
  const regions = regionsOf(strip, survivors, born);

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
  for (let index = 0; index < strip.items.length; index++) {
    const item = strip.items[index];
    const removed =
      item.kind === 'note'
        ? !survivors.has(index) && !lifted.has(index)
        : coveredByBorn(order, item);
    if (!removed) {
      continue;
    }

    if (index > 0) {
      for (const command of prefixCommandsOf(strip, item)) {
        if (!reachesSomething(context, command, item.startTick, index, survivors, born)) {
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
        !reachesSomething(context, command, tick, index, survivors, born)
      ) {
        unheard.add(command);
        swallowed.add(command);
      }
    }
  }

  // Every drop is written out here rather than beside the item that owned it:
  // a rest's prefix would otherwise have nowhere to go, since the item loop
  // below passes over rests and the run that covers one only rewrites its unit.
  for (const command of unheard) {
    if (!swallowed.has(command)) {
      edits.push(...removeCommand(source, command));
    }
  }

  const deleted: Span[] = [...unheard].map((command) => command.span);

  // The octave the edited text leaves in force, carried down the channel so a
  // note only writes one where the one already standing is not the one it needs.
  // `null` is "not known": before the first note, and after anything between two
  // notes that moved the octave itself — which is what the comparison against the
  // previous note's own exit detects, since the compiler gave both of them.
  let running: number | null = null;
  let previous: StripItem | null = null;
  /** Whether a unit has been removed since the last surviving note. */
  let dropped = false;
  /**
   * The octaves put back in front of the notes that read them, held apart so
   * they are written after the regions.
   *
   * A rest realised into the gap a deleted first note left goes in at the next
   * surviving note's head as well (`writeInto`), and `coalesce` joins two empty
   * ranges at one offset in the order this array holds them. The rest has to be
   * read first: an `o` behind it is claimed by no unit on the next strip build.
   */
  const restores: Edit[] = [];

  for (let index = 0; index < strip.items.length; index++) {
    const item = strip.items[index];
    if (item.kind !== 'note') {
      continue;
    }

    if (previous !== null && (previous.exitOctave ?? previous.octave) !== item.octave) {
      // Something between the two notes moved the octave — a `<`, a `>`, or an
      // `o` no unit claimed. What we were carrying is not what enters this one.
      running = null;
    }

    // Nothing has diverged from the original here yet, so the octave in force is
    // the one the note was written under — which the compiler gave us. Without
    // this seed the first note edited in a channel always gains an `o` saying
    // what was already true. A unit carrying its own leading `o` stays unknown,
    // since that `o` is about to be rewritten along with the note. So does a
    // note standing after a unit that has gone: what the compiler gave us is
    // what the text said before the `o` inside that unit was deleted.
    if (running === null && !item.hasLeadingOctave && !dropped) {
      running = item.octave;
    }

    const note = survivors.get(index);
    if (!note) {
      // A command written inside the unit is inside the span `removeItem`
      // splices, so it would go with the note and say nothing about it. Where a
      // run is being laid over these ticks it is taken over on its own tick
      // (`windowCarries`); where nothing is, there is no tick left to put it on
      // and no gesture can say which side of the deletion the porter meant it to
      // follow, so it is refused instead of quietly eaten.
      if (
        !coveredByBorn(order, item) &&
        insideCommands(strip, item).some(({ command }) => !unheard.has(command))
      ) {
        return refuse(REFUSE_INSIDE);
      }

      // A `$DD` reads the note in front of it rather than being dispatched
      // (`main.asm:L_10E4`), so taking that note away does not leave a slide
      // that does nothing — it leaves one the command loop reaches, whose
      // dispatch slot is `$0000`. Nothing else can decide this: `reachesSomething`
      // asks what still sounds *after* a command, and the loss is in front of it.
      if (item.bend !== null) {
        return refuse(REFUSE_BEND_RIDER);
      }

      // The unit takes the `o` written beside it with it (`roll-strip.ts`,
      // `growUnits`), and what stood in force for the notes after it goes too.
      // `running` is left alone: what stands after a removed unit is what stood
      // before it, which is what it already holds.
      edits.push(...removeItem(source, item));

      dropped = true;
      previous = item;
      continue;
    }

    // A unit removed since the last surviving note took the octave this one was
    // written under with it, so it is given one of its own — at its head, where
    // the text settles: an `o` written there is this note's leading octave on
    // the next pass, where one left between two rests is claimed by no unit and
    // is what makes a later edit there unreadable. Once, however many notes
    // went, because it is the note that reads the octave that asks for it rather
    // than each note that dropped one — and not at all where a run spawned into
    // the region in front of it has already answered for the same head.
    if (
      dropped &&
      !writesItsOwnOctave(strip, index, survivors) &&
      spawnLeaves(regions, index) === null &&
      item.octave !== running
    ) {
      const spelled = item.octave === null ? null : spellOctave(item.octave);
      if (spelled === null) {
        return refuse(REFUSE_SPELL);
      }

      const restore = insertAt(item.unitSpan.start, `${spelled} `, item.unitSpan.line);
      if (restore) {
        restores.push(restore);
      }

      running = item.octave;
    }

    dropped = false;

    const written = rewriteNote(context, index, note, survivors, running);
    if (!isEdits(written)) {
      return written;
    }

    edits.push(...written);
    const exit = exitOctaveFor(strip, index, survivors);
    // A drum writes no octave, so it leaves whatever was standing.
    const own: number | null = note.drum === null ? octaveFor(note.written) : running;
    running = exit ?? own;
    previous = item;
  }

  // Nothing left on the channel to hand it to, so the octave the last unit put
  // in force stays where that unit was: `octave` is global parser state and
  // leaks past a `#N` into the block below. `coalesce` joins it to the unit's
  // own removal, and the note before it claims it as a trailing `o` on the next
  // pass. Only the last note deleted off the tail leaves `dropped` set, so a run
  // of them writes one.
  if (dropped && previous !== null) {
    const standing = previous.exitOctave ?? previous.octave;
    // A run spawned into the tail spells its own last note's octave, so that is
    // what the block below reads and there is nothing here to say.
    const left = spawnLeaves(regions, strip.items.length) ?? running;
    if (standing !== null && standing !== left) {
      const spelled = spellOctave(standing);
      if (spelled === null) {
        return refuse(REFUSE_SPELL);
      }

      const restore = insertAt(previous.unitSpan.end, ` ${spelled}`, previous.unitSpan.line);
      if (restore) {
        restores.push(restore);
      }
    }
  }

  /**
   * How far past the song this gesture reaches, over the notes it is answerable
   * for: the ones it placed itself, and the ones its push cascade shoved out of
   * the way. Not every note in the plan — a channel already running past the cut
   * is an ordinary shape, and reading its tail as "reach" would have a deletion
   * lengthen the song.
   *
   * A carve fills `pushed` too, and its pieces are left out for that same
   * reason: it only ever makes a note shorter, so every piece it leaves sits at
   * a tick the channel had already reached, and a carve out in a channel's tail
   * would otherwise pad every other channel out to meet a note nothing moved.
   * `erased` is what says a carve is what filled it — the two resolvers never
   * both run, since the mode picks one.
   */
  const moved = plan.erased.length > 0 ? plan.touched : [...plan.touched, ...plan.pushed];
  const reach = moved.reduce(
    (furthest, note) => Math.max(furthest, note.startTick + note.ticks),
    0,
  );

  // Before the regions, and that is load-bearing rather than tidiness: a channel
  // being opened writes its `#N` at `strip.home.at`, which for an undeclared one
  // is the wound-back end of the document — the same offset as the tail of
  // whichever channel is written last. Both are empty ranges, `coalesce` joins
  // them into one, and the joined text is in this array's order. The other way
  // round, the rest lands inside the block just opened.
  if (reach > context.playableTicks) {
    const padded = padChannels(context, reach);
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

  // Shortest first at a shared offset, so an insertion sits ahead of the
  // replacement it abuts and `coalesce` can join the two into one.
  const sorted = coalesce(
    edits.sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end),
  );
  for (let at = 1; at < sorted.length; at++) {
    // CodeMirror merges overlapping ranges instead of refusing them, so this is
    // the roll's own invariant to hold rather than something it can be told.
    if (sorted[at].span.start < sorted[at - 1].span.end) {
      return refuse(REFUSE_CROWDED);
    }
  }

  return sorted;
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
function crossings(strip: Strip, survivors: ReadonlyMap<number, PlacedNote>): number[] {
  const crossed: number[] = [];
  for (const [at, note] of survivors) {
    if (note.startTick === strip.items[at].startTick) {
      continue; // Where it is written, so nothing can have got past it.
    }

    for (const [index, other] of survivors) {
      // Written after it but played before it, or the other way about.
      if (index !== at && index > at !== other.startTick > note.startTick) {
        crossed.push(at);
        break;
      }
    }
  }

  return crossed;
}

/** The stretches of text between the surviving notes, with what belongs in each. */
function regionsOf(
  strip: Strip,
  survivors: ReadonlyMap<number, PlacedNote>,
  born: readonly PlacedNote[],
): Region[] {
  const anchors: { index: number; note: PlacedNote }[] = [];
  for (let index = 0; index < strip.items.length; index++) {
    const note = survivors.get(index);
    if (note) {
      anchors.push({ index, note });
    }
  }

  const regions: Region[] = [];
  let after = -1;
  let startTick = 0;
  for (const anchor of anchors) {
    regions.push(
      makeRegion(strip, after, anchor.index, startTick, anchor.note.startTick - startTick),
    );
    after = anchor.index;
    startTick = anchor.note.startTick + anchor.note.ticks;
  }

  regions.push(makeRegion(strip, after, strip.items.length, startTick, -1, true));

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
  after: number,
  before: number,
  startTick: number,
  ticks: number,
  tail = false,
): Region {
  const rests: StripItem[] = [];
  let between = 0;
  for (let index = after + 1; index < before; index++) {
    between++;
    if (strip.items[index].kind === 'rest') {
      rests.push(strip.items[index]);
    }
  }

  return { after, before, rests, ticks, tail, born: [], startTick, between };
}
