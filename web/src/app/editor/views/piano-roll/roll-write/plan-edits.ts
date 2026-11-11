/** A gesture's plan written out as text: `planEdits` for one frame, `planGroupEdits` for one commit, and the edits put in order. */

import { octaveFor, spellOctave } from '@amk/core/mml-text';
import type { Span } from '@amk/core/types';
import type { Command } from '@amk/tokens';
import { commandScope } from '@amk/tokens/commands/in-force';
import { type Edit, insertAt } from '@amk/tokens/edits';
import {
  type EditContext,
  type Refusal,
  framePasses,
  type FramePlan,
  isEdits,
  type PlacedNote,
  type Plan,
  plannedFrameTicks,
  REFUSE_BEND_RIDER,
  REFUSE_CLASH,
  REFUSE_CROWDED,
  REFUSE_INSIDE,
  REFUSE_SPELL,
} from '../roll-edit';
import type { Strip, StripFrame, StripItem } from '../roll-strip';
import { drumApart } from './spelling';
import { refuse, removeSpan } from './splice';
import { regionsOf } from './regions';
import { deadOctaves, keptOctaves, runBefore, underRun, writesItsOwnOctave } from './octaves';
import {
  coveredByBorn,
  droppable,
  insideCommands,
  prefixCommandsOf,
  reachesSomething,
  removeCommand,
} from './removal';
import { isRewrite, rewriteNote } from './rewrite-note';
import { padChannels, realiseRegion } from './gaps';

/*
 * An accepted plan as text: the splices that put it in the document.
 *
 * It decides nothing about the **music** — which notes there are, on which tick,
 * at which pitch, are all settled by `roll-edit.ts` before it is called, and a
 * plan that is refused never reaches it — and everything about the **spelling**,
 * down to whether a note is rewritten where it stands or lifted out and written
 * again on the far side of one it was carried past. It can also refuse a
 * spelling it cannot produce.
 *
 * Nothing in `roll-write/` knows about Angular, the DOM or pixels, so `rolltest`
 * drives it against a real compile and checks the result by walking it.
 */

/** A plan is committable when nothing is refused and nothing would sound at once. */
function committable(plan: Plan): boolean {
  return plan.refused === null && plan.clashes.length === 0;
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
): Edit[] | Refusal {
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

export function planEdits(context: EditContext, plan: Plan): Edit[] | Refusal {
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
  const restoreFor = (reader: StripItem, wanted: number): Refusal | null => {
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
