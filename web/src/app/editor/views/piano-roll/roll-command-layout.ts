import type { Span } from '@amk/core/types';
import type { Command } from '@amk/tokens';
import { commandScope } from '@amk/tokens/commands/in-force';
import { commandRewritable } from '@amk/tokens/edits';
import { clamp } from '../../../util/math';
import type { TimelineCommand } from '../../../state/command-timeline';
import type { CommandGlyph } from '../../command-palette/command-icon';
import { glyphOf } from '../../command-palette/glyph-of';
import { LANE_GLYPH, LANE_MUTED_OPACITY, LANE_PAD, LANE_ROW } from './roll-metrics';
import { CHANNEL_TEXT } from '../../../util/channel-palette';

/**
 * The command lane's layout: every command the song puts in force, stacked so
 * that none covers another.
 *
 * Angular-free and pinned by `charttest`, in the mould of `roll-layout.ts`.
 * Which commands the song has and when it runs them is
 * `state/command-timeline.ts`; this answers the geometry, and the one question
 * about the song it does answer is what the **mixer** silences — a fact about
 * the moment rather than about the compile, which is why it is not up there.
 */

/** One command glyph in the lane, with everything the template needs resolved. */
export interface LaneGlyph {
  id: string;
  icon: CommandGlyph;
  x: number;
  y: number;
  size: number;
  /** The command's own span, which is what a click on it selects. */
  span: Span;
  /** The tick the driver ran it at, which is what a drag moves it off. */
  tick: number;
  /** 0-7, so a drag knows which channel's boundaries to snap to. */
  channel: number;
  /** The command itself, so a move never has to find it again through a second scan. */
  command: Command;
  /**
   * Whether the span is the command and nothing else, and so may be deleted or
   * moved.
   *
   * A command written through a `"name=value"` has its span collapsed onto the
   * call site (`parser.ts:3861-3873`), so taking that range out would eat
   * whatever else the expansion produced along with it.
   */
  removable: boolean;
  /** `grab` for a glyph a drag can carry, `pointer` for one that can only be clicked. */
  cursor: 'grab' | 'pointer';
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

export interface CommandLane {
  glyphs: readonly LaneGlyph[];
  /** Rows in use, which is how far the lane can be scrolled. */
  depth: number;
}

const EMPTY: CommandLane = { glyphs: [], depth: 0 };

export interface LaneRequest {
  events: readonly TimelineCommand[];
  /** The document, for spelling a command as it was written in the hover. */
  text: string;
  /** Pixels per tick — the roll's own, so a glyph is under the note it acts on. */
  zoom: number;
  /** Channel index to whether it is heard; a missing entry counts as audible. */
  audible: ReadonlyMap<number, boolean>;
  /**
   * The channel being edited, whose commands take the rows above every other
   * channel's. Null for none.
   *
   * `editChannel` and not the roll's `editing`, which falls back to the channel
   * of the bar under the pointer: rows would then be re-dealt on a hover, and a
   * glyph that changes row while the pointer wanders is saying something about
   * the pointer rather than about the song.
   */
  active: number | null;
  /** The song's own length, which is what holds the end glyphs inside it. */
  songTicks: number;
}

/**
 * Where a glyph's box starts, in the roll's own coordinates.
 *
 * **Centred on its tick**, so a command that runs on a beat straddles that
 * beat's rule rather than hanging off its right side. The box is what the packer
 * and the template both work in, so the centring is done once, here, and every
 * reader is spared knowing about it.
 *
 * Held inside the song at both ends: centring the command at tick 0 would put
 * half its box at a negative x, behind the key column and under the clip, and
 * one on the last tick would hang past the end-of-song rule. Those two sit flush
 * instead. The bound is the **song's** own span and not the pane's, because a
 * clamp against the camera would move a glyph as the roll scrolled past it, and
 * a glyph that moves while the roll moves is saying something about the scroll.
 */
export function laneGlyphX(tick: number, zoom: number, songTicks: number): number {
  const song = songTicks * zoom;
  return clamp(tick * zoom - LANE_GLYPH / 2, 0, Math.max(0, song - LANE_GLYPH));
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
 * The **edited channel is packed first** and the rest are packed strictly below
 * it, so its commands are always in the top rows and reading them needs no
 * scroll. It is a band rather than a preference — the second group starts at the
 * first row the first group did not reach — because a shared row would put
 * another channel's glyph among the ones the porter is working on, which is the
 * thing the split is for.
 *
 * Over the **whole song** and not the window on screen, though only the window
 * is drawn. Rows then depend on the song, the zoom and which channel is being
 * edited, and on nothing else — a window-scoped pack would re-deal them at every
 * turnover, and a glyph that changed row as the roll scrolled past it would be
 * saying something about the scrolling.
 *
 * `x` is {@link laneGlyphX} and is never nudged along to make room, because
 * where a glyph is *is* the claim the lane makes. Room is found by going deeper, and
 * there is no floor to how deep: **every command the song runs gets a row**. A
 * cap would mean a tick whose commands are the reason the porter opened the lane
 * is the one tick it declines to show, and a count in place of the glyphs is not
 * an answer to "what runs here" — the stack is scrolled, and the seam above the
 * lane takes it taller.
 */
export function packCommandLane(request: LaneRequest): CommandLane {
  const { events, text, zoom, audible, active, songTicks } = request;
  if (zoom <= 0 || events.length === 0) {
    return EMPTY;
  }

  const glyphs: LaneGlyph[] = [];
  /** Where each row is free from, in the roll's own coordinates. */
  const freeFrom: number[] = [];
  let depth = 0;
  /** The first row this group may use, which is everything the last one filled. */
  let floor = 0;

  const place = (event: TimelineCommand): void => {
    const entry = glyphOf(event.command);
    if (entry === null) {
      return; // `<`, `>`, `^`, `]` and `*`, which the catalogue does not offer at all.
    }

    const muted = audible.get(event.channel) === false;
    // A muted channel's own settings reach nothing anybody can hear, so they are
    // not drawn at all; its `t`, `w` and echo writes still run the whole song,
    // so those stay, at the lane's own dim value rather than the roll's.
    if (muted && commandScope(event.command) !== 'song') {
      return;
    }

    const x = laneGlyphX(event.tick, zoom, songTicks);
    let row = floor;
    while (row < freeFrom.length && freeFrom[row] > x) {
      row++;
    }

    freeFrom[row] = x + LANE_GLYPH + LANE_PAD;
    depth = Math.max(depth, row + 1);

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
      tick: event.tick,
      channel: event.channel,
      command: event.command,
      removable,
      cursor: removable ? 'grab' : 'pointer',
      tint: CHANNEL_TEXT[event.channel],
      opacity: muted ? LANE_MUTED_OPACITY : 1,
      title:
        `${entry.label} · ${written} · #${event.channel} · tick ${event.tick}` +
        (removable ? ' · drag to move · right-click to delete' : ''),
    });
  };

  // Each group is still in the timeline's own tick order, which is what lets a
  // row be a single high-water mark rather than a list of gaps.
  if (active !== null) {
    for (const event of events) {
      if (event.channel === active) {
        place(event);
      }
    }

    floor = depth;
  }

  for (const event of events) {
    if (event.channel !== active) {
      place(event);
    }
  }

  return { glyphs, depth };
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
  return {
    glyphs: lane.glyphs.filter((glyph) => glyph.x >= left && glyph.x <= right),
    depth: lane.depth,
  };
}
