import type { Span } from '@amk/core/types';
import type { WalkNote } from '@amk/spc/song-walk';
import type { Command } from '@amk/tokens';
import { type CommandGlyph } from '../../command-palette/command-icon';
import { glyphOf } from '../../command-palette/glyph-of';
import { definedAt } from '../../../state/commands-in-force';
import { type PlaceContext, keyOf, placeOf } from './percussion';
import {
  CHANNEL_FILL,
  KEY_WIDTH,
  NOTE_GAP,
  ROW_GAP,
  OVERVIEW_HEIGHT,
  OVERVIEW_PAD,
} from './roll-metrics';
import { type LaneStack, fitBarContent, keyName, noteLabel, overviewOffset } from './roll-layout';
import type { PlacedNote, Plan } from './roll-edit';

/**
 * The three pictures of the song, and the one function that places a note in all
 * of them.
 *
 * The roll's bars, the overview bar's minimap and the lit keys all ask
 * {@link rowOf} rather than each working a row out for itself, so an instrument
 * taken off the percussion lanes moves to the keyboard in every one of them at
 * once. Answering that question three times is how they would drift, which is
 * why the builders share a file.
 */

/**
 * How far a silenced channel is dimmed, in both pictures.
 *
 * One number, so a mute reads the same on the roll as on the overview bar.
 * Dimmed rather than hidden: a muted part is still part of the song.
 */
export const MUTED_OPACITY = 0.12;

/**
 * The same idea in the command lane, and a much higher number.
 *
 * A bar is a filled rectangle tens of pixels wide, so a twelfth of its colour is
 * still a shape the eye finds; a lane glyph is line art twelve pixels square,
 * and at that value its strokes are all but gone. What is left dimmed there is
 * also the part of a silenced channel that is still *heard* — its `t`, its `w`
 * and its echo writes, everything else having been dropped — so it has to be
 * legible rather than merely present. Soloing one channel is where that bites:
 * seven channels' worth of song settings are dimmed at once, and they are the
 * only record on screen of what is still running.
 */
export const LANE_MUTED_OPACITY = 0.45;

/** Shared by every bar with nothing acting on it, which on a plain song is most. */
const NOTHING_DEFINED: ReadonlySet<Command> = new Set<Command>();

/** One glyph on a bar: a command acting on that note, and where to draw it. */
export interface MarkGlyph {
  id: string;
  icon: CommandGlyph;
  x: number;
  y: number;
  size: number;
  /** The command's own span, which is what a click on it selects. */
  span: Span;
  /** For the tooltip, since a glyph has no room to say what it is. */
  label: string;
  /** This note puts the command in force, where the rest of a run inherits it. */
  defining: boolean;
}

/** One note, with everything the template needs already resolved. */
export interface Mark {
  id: string;
  x: number;
  w: number;
  gateW: number;
  y: number;
  h: number;
  fill: string;
  /** Dimmed rather than hidden, so a muted part still reads as part of the song. */
  opacity: number;
  /** Drawn behind the audible marks and inert to the pointer, so a live note over it is the one hit. */
  muted: boolean;
  /** `C6` on a key, `@23` on a drum lane. `null` when the bar has no room. */
  label: { text: string; x: number; y: number; size: number } | null;
  /** As many as fit; the inspector is where the whole list is. */
  glyphs: readonly MarkGlyph[];
  /**
   * Of every command acting on the note, the ones it puts in force.
   *
   * The whole set and not only the drawn glyphs': the hover names the commands
   * the bar had no room for, and it reads this rather than asking again, so the
   * two cannot answer differently.
   */
  defining: ReadonlySet<Command>;
  /**
   * The "and more" mark, drawn when the bar had room for only some of them.
   *
   * `defining` when one of the commands it stands for takes effect at this note,
   * so it wears the same plate a defining glyph does: the mark is what is left
   * of that glyph, and a bar too narrow to show it would otherwise say the note
   * inherits everything it plays under.
   */
  more: { x: number; y: number; size: number; defining: boolean } | null;
  note: WalkNote;
}

/** One note on the overview bar's minimap, in its channel's colour. */
export interface MinimapBar {
  id: string;
  x: number;
  w: number;
  y: number;
  h: number;
  /** The same class the roll's own bar for this note carries. */
  fill: string;
  /** Dimmed rather than dropped, so a muted part still reads as part of the song. */
  opacity: number;
}

/**
 * Which row a note belongs on.
 *
 * The placement itself is `placeOf`, which the fitted range is built from too,
 * so the two cannot disagree. This only turns its answer into a row.
 *
 * By instrument, not by note byte: every note played while a drum is loaded is
 * that drum being hit, so `@29 c d e` is three hits on one lane rather than
 * one drum and two notes scattered across the keyboard. The pitched ones only
 * look melodic because `parser.ts:2681` stops remapping after the first.
 */
export function rowOf(note: WalkNote, stack: LaneStack, context: PlaceContext): number {
  switch (placeOf(note, context)) {
    case 'drum':
      return stack.rowOfDrum.get(note.state.instrument ?? -1) ?? -1;

    case 'noise':
      return stack.noiseRow;

    case 'key': {
      const key = keyOf(note, context);

      return key === null ? -1 : (stack.rowOfKey.get(key) ?? -1);
    }

    case 'none':
      return -1;
  }
}

/**
 * What a note is called, which is the bar's name and the tooltip's heading.
 *
 * One helper for both, so a bar cannot say one thing and its own hover
 * another. Derived from where the mark actually sits: a bare `$D0` whose drum
 * the porter has taken off the lanes is drawn on a key, and calling it `@29`
 * would name a row it is not on.
 */
export function headingOf(note: WalkNote, context: PlaceContext, short = true): string {
  const place = placeOf(note, context);
  const key = keyOf(note, context);
  if (place === 'key' && key !== null) {
    return short ? noteLabel(key) : keyName(key);
  }

  return `@${note.state.instrument ?? 0}`;
}

export interface MarkRequest {
  notes: readonly WalkNote[];
  stack: LaneStack;
  context: PlaceContext;
  /** The tick window to draw, from `tickWindow`. */
  from: number;
  to: number;
  /** Pixels per tick. */
  zoom: number;
  rowHeight: number;
  /** Channel index to whether it is heard; a missing entry counts as audible. */
  audible: ReadonlyMap<number, boolean>;
  inForce: (note: WalkNote) => readonly Command[];
}

export function buildMarks(request: MarkRequest): Mark[] {
  const { notes, stack, context, from, to, zoom, rowHeight, audible, inForce } = request;
  if (zoom <= 0) {
    return [];
  }

  // Muted marks are drawn first, so a live note over one is the one on top.
  // Each list keeps the walk's own tick-then-channel order.
  const behind: Mark[] = [];
  const front: Mark[] = [];

  // Which commands a note puts in force is the list against the one before it on
  // its channel, and the walk's order is this loop's, so the neighbour is free
  // here where anything asking per note would have to go looking. Taken above
  // both guards: a note off the screen, or on no row at all, is still the note
  // the next one follows.
  const last: (WalkNote | null)[] = new Array<WalkNote | null>(CHANNEL_FILL.length).fill(null);

  for (const note of notes) {
    const previous = last[note.channel];
    last[note.channel] = note;

    if (note.tick > to || note.tick + note.ticks < from) {
      continue;
    }

    const row = rowOf(note, stack, context);
    if (row < 0) {
      continue;
    }

    const w = Math.max(1, note.ticks * zoom - NOTE_GAP);
    const h = Math.max(1, rowHeight - ROW_GAP * 2);
    const x = note.tick * zoom;
    const y = row * rowHeight + ROW_GAP;

    const acting = inForce(note).map((command) => ({
      command,
      entry: glyphOf(command),
    }));
    // Only the notes on screen ask, so the neighbour's list is fetched at most
    // once per drawn bar and the lookup's cache answers all but the first of a
    // run. A note with nothing acting on it needs no comparison at all.
    const defining =
      acting.length === 0
        ? NOTHING_DEFINED
        : definedAt(
            acting.map((each) => each.command),
            previous === null ? [] : inForce(previous),
          );

    // The ones the note puts in force lead, and the slot order the list arrives
    // in holds within each half. A bar drops from the end, so what survives a
    // narrow one is what starts at this note rather than whatever `SLOTS`
    // happens to name first — a `q` no note has touched for a page outranked
    // the `v` the bar was drawn to show.
    const glyphed = acting.filter((each) => each.entry !== null);
    const drawable =
      defining.size === 0
        ? glyphed
        : [
            ...glyphed.filter((each) => defining.has(each.command)),
            ...glyphed.filter((each) => !defining.has(each.command)),
          ];
    const name = headingOf(note, context);
    const content = fitBarContent(w, h, name, drawable.length);
    const muted = audible.get(note.channel) === false;

    (muted ? behind : front).push({
      id: `${note.address}:${note.tick}:${note.channel}`,
      x,
      w,
      gateW: Math.max(1, note.gateTicks * zoom - NOTE_GAP),
      y,
      h,
      fill: CHANNEL_FILL[note.channel],
      opacity: muted ? MUTED_OPACITY : 1,
      muted,
      label:
        content.name === null
          ? null
          : { text: name, x: x + content.name.x, y: y + content.name.y, size: content.name.size },
      // `fitBarContent` returns however many fit, taken from the front of the
      // list, so the glyphs that survive a narrow bar are the same ones every
      // time rather than shuffling as the roll is zoomed.
      glyphs: content.glyphs.map((box, at) => ({
        id: `${note.address}:${note.tick}:${drawable[at].command.span.start}`,
        icon: drawable[at].entry!.icon,
        x: x + box.x,
        y: y + box.y,
        size: box.size,
        span: drawable[at].command.span,
        label: drawable[at].entry!.label,
        defining: defining.has(drawable[at].command),
      })),
      defining,
      more:
        content.more === null
          ? null
          : {
              x: x + content.more.x,
              y: y + content.more.y,
              size: content.more.size,
              // The ones it stands for are the tail, the boxes having been
              // handed back in the list's own order; `charttest` pins that.
              defining: drawable
                .slice(content.glyphs.length)
                .some((each) => defining.has(each.command)),
            },
      note,
    });
  }

  return [...behind, ...front];
}

export interface MinimapRequest {
  notes: readonly WalkNote[];
  stack: LaneStack;
  context: PlaceContext;
  /** The song's whole length, which is the bar's width. */
  ticks: number;
  /** The roll's width, less the key column. */
  width: number;
  /** Channel index to whether it is heard; a missing entry counts as audible. */
  audible: ReadonlyMap<number, boolean>;
}

/**
 * The whole song, drawn small.
 *
 * Built from the song, the lane stack, the pane's width and the mixer, and
 * deliberately **not** from the playhead — the bars are the song rather than a
 * view of it, so this rebuilds on a recompile, a percussion change, a mute or a
 * resize, and never on a frame. The moving parts of the bar are the component's
 * own.
 */
export function buildMinimap(request: MinimapRequest): MinimapBar[] {
  const { notes, stack, context, ticks, width, audible } = request;
  const rows = stack.lanes.length;
  if (ticks <= 0 || width <= 0 || rows <= 0) {
    return [];
  }

  const inner = OVERVIEW_HEIGHT - OVERVIEW_PAD * 2;
  const h = Math.max(1, inner / rows);

  // Keyed by the pixel a bar lands on, the row it lands in and the channel it
  // belongs to. One channel's two notes through a pixel of a row are the same
  // picture, and keeping the wider of them holds a long note's reach against a
  // short one starting alongside it; two channels' are two pictures, since the
  // colour is which channel it is, and a key without the channel in it takes the
  // narrower of them out of the minimap altogether — two channels sharing a drum
  // lane is the commonest way that happens. Never more bars than notes, and far
  // fewer on a dense song, which is what keeps the whole song inside the DOM.
  //
  // Muted in one map and audible in the other, so a live bar is never veiled by
  // the wash of a channel that cannot be heard. Two maps rather than one and a
  // partition after it: a channel is silenced or it is not, so a key can only
  // ever land in one of them, and the id stays unique across both.
  const behind = new Map<string, MinimapBar>();
  const front = new Map<string, MinimapBar>();
  for (const note of notes) {
    const row = rowOf(note, stack, context);
    if (row < 0) {
      continue;
    }

    const x = KEY_WIDTH + overviewOffset(note.tick, ticks, width);
    const w = Math.max(1, overviewOffset(note.ticks, ticks, width));
    const key = `${Math.round(x)}:${row}:${note.channel}`;
    const muted = audible.get(note.channel) === false;
    const cells = muted ? behind : front;
    const held = cells.get(key);
    if (held && held.w >= w) {
      continue;
    }

    cells.set(key, {
      id: key,
      x,
      w,
      y: OVERVIEW_PAD + (row / rows) * inner,
      h,
      fill: CHANNEL_FILL[note.channel],
      opacity: muted ? MUTED_OPACITY : 1,
    });
  }

  return [...behind.values(), ...front.values()];
}

export interface HeldRequest {
  notes: readonly WalkNote[];
  stack: LaneStack;
  context: PlaceContext;
  /** Where the playhead is. */
  tick: number;
  audible: ReadonlyMap<number, boolean>;
}

/**
 * The rows sounding right now, from the timeline rather than the driver's
 * pointers.
 *
 * It is the only source that yields a pitch — the note map holds none — and
 * deriving the bar, the playhead and the lit key from one number is what stops
 * them disagreeing on screen. The caller takes the honesty test: if the editor
 * is not showing the text that is playing, it asks for nothing.
 */
export function heldRowsAt(request: HeldRequest): ReadonlySet<number> {
  const { notes, stack, context, tick, audible } = request;
  const held = new Set<number>();

  for (const note of notes) {
    if (note.tick > tick) {
      break; // sorted by tick
    }

    if (tick < note.tick + note.gateTicks && audible.get(note.channel) !== false) {
      const row = rowOf(note, stack, context);
      if (row >= 0) {
        held.add(row);
      }
    }
  }

  return held;
}

/** One bar of a gesture in flight: where it is, and what it means. */
export interface PreviewBar {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the roll draws over the song while a pointer is down. */
export interface Preview {
  /** The notes the gesture is moving, drawn solid in the channel's colour. */
  live: readonly PreviewBar[];
  /** The notes a push will shift, drawn as a striped outline with nothing in it. */
  pushed: readonly PreviewBar[];
  /** Where two notes would sound at once, drawn red over both. */
  clash: readonly PreviewBar[];
  /** Ticks a note is giving up to the gesture, drawn hatched over that note's own bar. */
  erased: readonly PreviewBar[];
  /** Why nothing will be committed, or `null`. The live bars are red while it is set. */
  refused: string | null;
}

/**
 * The row a planned note belongs on.
 *
 * The sibling of {@link rowOf}, for a note that does not exist yet and so has no
 * `WalkNote` to ask about. A drum's row is its instrument and a pitch's is its
 * written key, which is the same rule `rowOf` follows by a longer road.
 */
export function rowOfPlaced(
  note: { written: number; drum: number | null },
  stack: LaneStack,
): number {
  return note.drum === null
    ? (stack.rowOfKey.get(note.written - 0x80) ?? -1)
    : (stack.rowOfDrum.get(note.drum) ?? -1);
}

export interface PreviewRequest {
  plan: Plan;
  stack: LaneStack;
  zoom: number;
  rowHeight: number;
  /** The rows the clash wash covers, which is every row the plan touches. */
  rows: number;
}

/**
 * A gesture in flight, as boxes.
 *
 * Everything the porter sees while dragging comes off one {@link Plan}, so the
 * red wash and the striped bars can never disagree with what pointer-up will
 * commit — they are the same answer drawn twice rather than two answers.
 */
export function buildPreview(request: PreviewRequest): Preview {
  const { plan, stack, zoom, rowHeight } = request;
  // Structural rather than `PlacedNote`, so a run of erased ticks can be boxed
  // by the same arithmetic: all it needs is where it starts, how long it is, and
  // which row it belongs on.
  const box = (
    note: { startTick: number; ticks: number; written: number; drum: number | null },
    at: number,
    kind: string,
  ): PreviewBar | null => {
    const row = rowOfPlaced(note, stack);
    return row < 0
      ? null
      : {
          id: `${kind}:${at}:${note.startTick}`,
          x: note.startTick * zoom,
          y: row * rowHeight + ROW_GAP,
          w: Math.max(1, note.ticks * zoom - NOTE_GAP),
          h: Math.max(1, rowHeight - ROW_GAP * 2),
        };
  };

  const bars = (notes: readonly PlacedNote[], kind: string): PreviewBar[] =>
    notes.map((note, at) => box(note, at, kind)).filter((bar): bar is PreviewBar => bar !== null);

  return {
    live: bars(plan.touched, 'live'),
    pushed: bars(plan.pushed, 'pushed'),
    // A clash is a run of ticks rather than a note, so it is drawn down the
    // whole stack: the two notes it names are on different rows and a wash on
    // one of them would say the other was fine.
    clash: plan.clashes.map((clash, at) => ({
      id: `clash:${at}:${clash.from}`,
      x: clash.from * zoom,
      y: 0,
      w: Math.max(1, (clash.to - clash.from) * zoom),
      h: request.rows * rowHeight,
    })),
    // A run of ticks like a clash, but drawn on the row of the note giving them
    // up rather than down the stack: it names that one note, and it is that
    // note's own bar underneath it.
    erased: plan.erased
      .map((span, at) =>
        box(
          {
            startTick: span.from,
            ticks: span.to - span.from,
            written: span.written,
            drum: span.drum,
          },
          at,
          'erased',
        ),
      )
      .filter((bar): bar is PreviewBar => bar !== null),
    refused: plan.refused,
  };
}
