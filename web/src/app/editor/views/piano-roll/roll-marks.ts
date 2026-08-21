import type { Span } from '@amk/core/types';
import type { WalkNote } from '@amk/spc/song-walk';
import type { Command } from '@amk/tokens';
import { type CommandGlyph } from '../../command-palette/command-icon';
import { glyphOf } from '../../command-palette/glyph-of';
import { type PlaceContext, keyOf, placeOf } from './percussion';
import {
  CHANNEL_FILL,
  KEY_WIDTH,
  NOTE_GAP,
  ROW_GAP,
  SCRUB_HEIGHT,
  SCRUB_PAD,
} from './roll-metrics';
import { type LaneStack, fitBarContent, keyName, noteLabel, scrubOffset } from './roll-layout';

/**
 * The three pictures of the song, and the one function that places a note in all
 * of them.
 *
 * The roll's bars, the scrub bar's minimap and the lit keys all ask
 * {@link rowOf} rather than each working a row out for itself, so an instrument
 * taken off the percussion lanes moves to the keyboard in every one of them at
 * once. Answering that question three times is how they would drift, which is
 * why the builders share a file.
 */

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
  /** The "and more" mark, drawn when the bar had room for only some of them. */
  more: { x: number; y: number; size: number } | null;
  note: WalkNote;
}

/** One note on the scrub bar's minimap. Every bar is the same colour. */
export interface ScrubBar {
  id: string;
  x: number;
  w: number;
  y: number;
  h: number;
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

  for (const note of notes) {
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
    const drawable = acting.filter((each) => each.entry !== null);
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
      opacity: muted ? 0.12 : 1,
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
      })),
      more:
        content.more === null
          ? null
          : { x: x + content.more.x, y: y + content.more.y, size: content.more.size },
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
}

/**
 * The whole song, drawn small.
 *
 * Built from the song, the lane stack and the pane's width, and deliberately
 * **not** from the playhead — the bars are the song rather than a view of it, so
 * this rebuilds on a recompile, a percussion change or a resize, and never on a
 * frame. The moving parts of the bar are the component's own.
 */
export function buildMinimap(request: MinimapRequest): ScrubBar[] {
  const { notes, stack, context, ticks, width } = request;
  const rows = stack.lanes.length;
  if (ticks <= 0 || width <= 0 || rows <= 0) {
    return [];
  }

  const inner = SCRUB_HEIGHT - SCRUB_PAD * 2;
  const h = Math.max(1, inner / rows);

  // Keyed by the pixel a bar lands on and the row it lands in. Every bar is
  // one colour, so two notes sharing a pixel of a row are the same picture;
  // keeping the wider of them holds a long note's reach against a short one
  // starting alongside it. Never more bars than notes, and far fewer on a
  // dense song, which is what keeps the whole song inside the DOM.
  const cells = new Map<string, ScrubBar>();
  for (const note of notes) {
    const row = rowOf(note, stack, context);
    if (row < 0) {
      continue;
    }

    const x = KEY_WIDTH + scrubOffset(note.tick, ticks, width);
    const w = Math.max(1, scrubOffset(note.ticks, ticks, width));
    const key = `${Math.round(x)}:${row}`;
    const held = cells.get(key);
    if (held && held.w >= w) {
      continue;
    }

    cells.set(key, { id: key, x, w, y: SCRUB_PAD + (row / rows) * inner, h });
  }

  return [...cells.values()];
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
