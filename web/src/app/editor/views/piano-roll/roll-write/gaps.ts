/** The rests between two notes, made to come to the ticks the plan asks for, and the other channels padded so the song still reaches them. */

import { spellRest } from '@amk/core/mml-text';
import type { Span } from '@amk/core/types';
import type { Command } from '@amk/tokens';
import { commandScope, isPercussionInstrument } from '@amk/tokens/commands/in-force';
import { type Edit, insertAt } from '@amk/tokens/edits';
import {
  type EditContext,
  type EditRefusal,
  type PlacedNote,
  REFUSE_CROWDED,
  REFUSE_INSIDE,
  REFUSE_SPELL,
} from '../roll-edit';
import type { StripItem } from '../roll-strip';
import { afterBend, eol } from './spelling';
import { refuse, removeItem, removeSpan, spliceUnit } from './splice';
import { interiorFrom, type Region, writeInto } from './regions';
import { keptOctaves } from './octaves';
import { spawnInto } from './runs';

/**
 * Rests in the order they are written, taken out but the first, which is written
 * as all of them — or every one taken out where they come to nothing. What
 * `resizeLoop` rewrites a body's trailing or leading rests with.
 */
export function collapse(
  context: EditContext,
  rests: readonly StripItem[],
  want: number,
): Edit[] | null {
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
export function realiseRegion(
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
export function padChannels(
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
