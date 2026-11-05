/** A note being created, written into the gap it lands in: alone, or as a run laid over a window that carries the commands written there. */

import { octaveFor, spellDuration, spellOctave, spellRest } from '@amk/core/mml-text';
import type { Span } from '@amk/core/types';
import { commandScope, isPercussionInstrument } from '@amk/tokens/commands/in-force';
import { commandRewritable, type Edit, insertAt } from '@amk/tokens/edits';
import {
  type EditContext,
  type EditRefusal,
  type PlacedNote,
  REFUSE_CROWDED,
  REFUSE_SPELL,
} from '../roll-edit';
import type { Strip, StripFrame, StripItem } from '../roll-strip';
import { afterBend, exitText, noteText, OPENING_OCTAVE } from './spelling';
import { refuse, removeItem, removeSpan, spliceUnit } from './splice';
import { interiorFrom, type Region, writeInto } from './regions';
import { writesItsOwnOctave } from './octaves';

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
export function spawnInto(
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
