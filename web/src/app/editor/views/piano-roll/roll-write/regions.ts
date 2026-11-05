/** A plan's regions — each stretch of text between two surviving notes and what has to go in it — and where text written into one goes. */

import { type Edit, insertAt } from '@amk/tokens/edits';
import type { EditContext, PlacedNote } from '../roll-edit';
import type { Strip, StripFrame, StripItem } from '../roll-strip';
import { afterBend, channelOpening, eol } from './spelling';

/** The first interior index of a region — the frame's head where no note bounds it. */
export function interiorFrom(gap: Region, frame: StripFrame): number {
  return gap.after < 0 ? frame.from : gap.after + 1;
}

/** One stretch of text between two surviving notes, and what has to go in it. */
export interface Region {
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
export function writeInto(context: EditContext, gap: Region, run: string): Edit | null {
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
 * The stretches of text between the frame's anchors, with what belongs in each.
 *
 * An anchor is a surviving note at its planned tick, or a construct at its
 * fixed one — a loop bounds a region exactly as a note does, its ticks being
 * nothing a gesture may rewrite.
 */
export function regionsOf(
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
