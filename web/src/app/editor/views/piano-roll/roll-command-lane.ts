import type { Span } from '@amk/core/types';
import { commandRewritable } from '@amk/tokens/edits';
import type { TimelineCommand } from '../../../state/command-timeline';
import type { CommandGlyph } from '../../command-palette/command-icon';
import { glyphOf } from '../../command-palette/glyph-of';
import { CHANNEL_TEXT, LANE_GLYPH, LANE_PAD, LANE_ROW } from './roll-metrics';
import { MUTED_OPACITY } from './roll-marks';

/**
 * The command lane's layout: every command the song puts in force, stacked so
 * that none covers another.
 *
 * Angular-free and pinned by `charttest`, in the mould of `roll-layout.ts`. The
 * question it answers is only ever about geometry — which commands there are and
 * when is `state/command-timeline.ts`.
 */

/** How deep a column may go before the rest of it becomes a count. */
export const MAX_LANE_ROWS = 12;

/** One command glyph in the lane, with everything the template needs resolved. */
export interface LaneGlyph {
  id: string;
  icon: CommandGlyph;
  x: number;
  y: number;
  size: number;
  /** The command's own span, which is what a click on it selects. */
  span: Span;
  /**
   * Whether the span is the command and nothing else, and so may be deleted.
   *
   * A command written through a `"name=value"` has its span collapsed onto the
   * call site (`parser.ts:3861-3873`), so taking that range out would eat
   * whatever else the expansion produced along with it.
   */
  removable: boolean;
  /** The channel's `text-ch-*`, since a glyph is tinted by `color` and not by `fill`. */
  tint: string;
  /** Dimmed rather than dropped, so a muted part still reads as part of the song. */
  opacity: number;
  /**
   * The hover, which names the channel as well as the command.
   *
   * Not optional: `styles.css` states that nothing here identifies a channel by
   * colour alone, the eight not clearing the all-pairs separation gate. It also
   * carries the erase, which is the only thing on screen that says a glyph can
   * be deleted at all.
   */
  title: string;
}

/** What a column had no room for, drawn where its deepest glyph would have been. */
export interface LaneMore {
  id: string;
  x: number;
  y: number;
  size: number;
  count: number;
}

export interface CommandLane {
  glyphs: readonly LaneGlyph[];
  more: readonly LaneMore[];
  /** Rows in use, which is how far the lane can be scrolled. */
  depth: number;
}

const EMPTY: CommandLane = { glyphs: [], more: [], depth: 0 };

export interface LaneRequest {
  events: readonly TimelineCommand[];
  /** The document, for spelling a command as it was written in the hover. */
  text: string;
  /** Pixels per tick — the roll's own, so a glyph is under the note it acts on. */
  zoom: number;
  /** Channel index to whether it is heard; a missing entry counts as audible. */
  audible: ReadonlyMap<number, boolean>;
}

/**
 * Where each command goes, over the whole song at once.
 *
 * Rows are first-fit left to right: a glyph takes the first row whose last glyph
 * has cleared it, and one row deeper otherwise. Commands landing on one tick
 * share an x and so necessarily stack, which is what the lane is for; commands a
 * few ticks apart stack too once the zoom is low enough for their boxes to
 * collide, so no glyph is ever drawn over another at any zoom.
 *
 * Over the **whole song** and not the window on screen, though only the window
 * is drawn. Rows then depend on the song and the zoom and on nothing else — a
 * window-scoped pack would re-deal them at every turnover, and a glyph that
 * changed row as the roll scrolled past it would be saying something about the
 * scrolling.
 *
 * `x` is `tick * zoom` and is never nudged along to make room, because where a
 * glyph is *is* the claim the lane makes. Room is found by going deeper.
 */
export function packCommandLane(request: LaneRequest): CommandLane {
  const { events, text, zoom, audible } = request;
  if (zoom <= 0 || events.length === 0) {
    return EMPTY;
  }

  const glyphs: LaneGlyph[] = [];
  /** Where each row is free from, in the roll's own coordinates. */
  const freeFrom: number[] = [];
  /** Overflowing columns by x, so a stack too deep to draw is still counted. */
  const spilled = new Map<number, number>();
  let depth = 0;

  for (const event of events) {
    const entry = glyphOf(event.command);
    if (entry === null) {
      continue; // `<`, `>` and `^`, which the catalogue does not offer at all.
    }

    const x = event.tick * zoom;
    let row = 0;
    while (row < freeFrom.length && freeFrom[row] > x) {
      row++;
    }

    if (row >= MAX_LANE_ROWS) {
      spilled.set(x, (spilled.get(x) ?? 0) + 1);
      continue;
    }

    freeFrom[row] = x + LANE_GLYPH + LANE_PAD;
    depth = Math.max(depth, row + 1);

    const muted = audible.get(event.channel) === false;
    const written = text.slice(event.command.span.start, event.command.span.end);
    const removable = commandRewritable(event.command);
    glyphs.push({
      // Its place in the packed list leads, because tick, channel and span do
      // not identify one: `[[ v100 v200 ]]2` holds no note, so both turns run at
      // tick 0 on one channel and each `v` is written once.
      id: `${glyphs.length}:${event.tick}:${event.command.span.start}`,
      icon: entry.icon,
      x,
      y: row * LANE_ROW,
      size: LANE_GLYPH,
      span: event.command.span,
      removable,
      tint: CHANNEL_TEXT[event.channel],
      opacity: muted ? MUTED_OPACITY : 1,
      title:
        `${entry.label} · ${written} · #${event.channel} · tick ${event.tick}` +
        (removable ? ' · right-click to delete' : ''),
    });
  }

  // Drawn in the deepest row rather than past it, so the mark is somewhere the
  // lane can actually be scrolled to. It stands for a list and not a command, so
  // it has no span to reveal and no handler of its own — the inspector is where
  // the whole list is, as it is for a bar too narrow for its glyphs.
  const more = [...spilled].map(([x, count]) => ({
    id: `more:${x}`,
    x,
    y: (MAX_LANE_ROWS - 1) * LANE_ROW,
    size: LANE_GLYPH,
    count,
  }));

  return { glyphs, more, depth };
}

/**
 * The slice of a packed lane inside a tick window, which is all it ever draws.
 *
 * `depth` is the whole song's and not the slice's: it is how far the lane can be
 * scrolled, and a scroll range that shrank as the roll moved past a deep column
 * would take the porter's position with it.
 */
export function laneWindow(lane: CommandLane, from: number, to: number, zoom: number): CommandLane {
  const left = from * zoom - LANE_GLYPH;
  const right = to * zoom;
  const inside = (item: { x: number }) => item.x >= left && item.x <= right;
  return { glyphs: lane.glyphs.filter(inside), more: lane.more.filter(inside), depth: lane.depth };
}
