import { type Signal, computed, signal } from '@angular/core';

import { NOTE_MIN } from '@amk/core/hardcoded-tables';
import { octaveFor, spellDuration, spellNote } from '@amk/core/mml-text';
import type { Span } from '@amk/core/types';
import type { LoopRun, PitchSlide } from '@amk/spc/song-walk';
import type { Command } from '@amk/tokens';
import type { Edit } from '@amk/tokens/edits';
import type { LaneStack } from './roll-layout';
import { rowAtY, tickAtX } from './roll-layout';
import { snapDuration, snapTick, stepDrawLength } from './roll-lengths';
import {
  type Preview,
  type PreviewBar,
  buildPreview,
  joinPreviews,
  rowOfPlaced,
} from './roll-preview';
import { KEY_WIDTH, NOTE_GAP, barRect } from './roll-metrics';
import {
  type BodyRows,
  type EditContext,
  type EditMode,
  type FramePlan,
  type Gesture,
  type PassShift,
  type PlacedNote,
  type Plan,
  type ShiftBoundaries,
  REFUSE_CLASH,
  REFUSE_LOOP_BODY_ROOM,
  REFUSE_LOOP_LEAD_ROOM,
  REFUSE_LOOP_LEFT_PASS,
  REFUSE_NESTED_LOOP,
  REFUSE_SUB_SPLIT,
  frameAt,
  framePasses,
  isEdits,
  passShiftsFor,
  planFrames,
  plannedFrameTicks,
  shiftBoundariesFor,
} from './roll-edit';
import { type NoteAnchor, anchorsFor, notesAtAnchors } from './roll-selection';
import {
  type ChannelTail,
  type Strip,
  type StripFrame,
  type StripItem,
  constructFor,
  framesInside,
} from './roll-strip';
import {
  bodyRests,
  firstPassOn,
  gapSlack,
  loopJoin,
  openGap,
  passesAt,
  planGroupEdits,
  resizeLoop,
} from './roll-write';

/**
 * The roll's pointer: what a press means, what a drag is doing, and what
 * pointer-up commits.
 *
 * A composable in the shape of `roll-clock.ts` — signals and handlers, no
 * template — because the alternative is another three hundred lines in
 * `piano-roll.ts`, which is already the biggest file in the view. Every decision
 * it makes is `roll-edit.ts`'s: this holds the pointer, works out which note and
 * which tick it is over, and asks. What comes back is one {@link Plan}, and the
 * preview, the bubble and the commit are all read off that same plan, so what is
 * drawn during a drag cannot disagree with what lands at the end of it.
 */

/**
 * How near an edge a press has to be to mean "stretch" rather than "move".
 *
 * Held to a third of the bar either side, so a short note keeps a middle to grab:
 * two six-pixel zones on an eight-pixel bar would leave no way to move it.
 */
const EDGE_PX = 6;

/** Pointer movement below this is a click, not a drag. Shared with the command lane. */
export const SLOP_PX = 3;

/**
 * How far a pointer is from each end of a bar, and how wide the stretch zone is.
 *
 * Measured against the bar as **drawn**, which is `NOTE_GAP` short of the slot it
 * occupies — otherwise the right-hand handle is two pixels narrower than the
 * left one, and the porter is aiming at what they can see.
 */
function edgesAt(
  from: number,
  ticks: number,
  tick: number,
  zoom: number,
  inset: number,
): { left: number; right: number; zone: number } {
  const width = Math.max(1, ticks * zoom - inset);
  return {
    left: (tick - from) * zoom,
    right: (from + ticks - tick) * zoom - inset,
    zone: Math.min(EDGE_PX, Math.max(2, width / 3)),
  };
}

function edgesOf(
  item: StripItem,
  tick: number,
  zoom: number,
): { left: number; right: number; zone: number } {
  return edgesAt(item.startTick, item.ticks, tick, zoom, NOTE_GAP);
}

/**
 * Which end of a loop box a press landed on, or `null` for its top and bottom
 * rules, which are the construct's own handle.
 *
 * Measured against the box **as drawn** — `data-ticks`, not the run's length,
 * which `buildLoopRegions` clips where the song ends inside a pass. The stroke
 * is nine pixels wide and centred on the outline, so a press can only reach
 * four and a half of them inside; `EDGE_PX` is the outer reach, and the corners
 * belong to the ends, which is what a corner should do.
 */
function loopEnd(handle: Element, tick: number, zoom: number): 'start' | 'end' | null {
  const from = Number(handle.getAttribute('data-tick'));
  const ticks = Number(handle.getAttribute('data-ticks'));
  if (!Number.isFinite(from) || !Number.isFinite(ticks) || ticks <= 0) {
    return null;
  }

  // The stroke straddles the outline, so half of each end's band is *outside*
  // the box — a press there is on that end as plainly as one just inside it,
  // and only the far side of each band is a bound worth having.
  const edge = edgesAt(from, ticks, tick, zoom, 1);
  if (edge.left >= -EDGE_PX && edge.left <= edge.zone) {
    return 'start';
  }

  return edge.right >= -EDGE_PX && edge.right <= edge.zone ? 'end' : null;
}

export interface GestureSources {
  /** The channel being edited, as a strip, or `null` when there is nothing to edit. */
  strip: Signal<Strip | null>;
  /** The lane stack, for turning a row into a pitch and back. */
  stack: Signal<LaneStack>;
  zoom: Signal<number>;
  rowHeight: Signal<number>;
  /** The tick at the roll's left edge. */
  viewTick: Signal<number>;
  /** What a position snaps to, in ticks; `0` for none. */
  snap: Signal<number>;
  /** What an overlap does: take the ticks, shift the notes in the way, or refuse. */
  editMode: Signal<EditMode>;
  /** The length a drawn note takes. */
  lastLength: Signal<number>;
  targetAMKVersion: Signal<number>;
  /** Which of the three programs the song compiles for, for writing a channel out. */
  songTargetProgram: Signal<number>;
  /** How long the song plays, which is how far a channel being opened is filled out. */
  playableTicks: Signal<number>;
  /** The tick the song loops back to, so a channel being opened gets its own `/` there. */
  introTicks: Signal<number | null>;
  /** Every channel as somewhere rests can be appended, for a gesture that lengthens the song. */
  channels: Signal<readonly ChannelTail[]>;
  /** What the walk had in force at a note, for deciding what a removed item takes with it. */
  inForce: Signal<(address: number) => readonly Command[] | null>;
  source: Signal<string>;
}

export interface GestureSinks {
  /** Commit a gesture. One call, one undo step. */
  commit: (edits: readonly Edit[]) => void;
  /** Remember the length the porter last drew or resized to. */
  rememberLength: (ticks: number) => void;
  /**
   * Sound a note as written, at the tick and for the length it is being put on,
   * with the `$DD` riding on it where the walk found one — a note is not heard
   * as it plays without its slide.
   */
  audition: (
    written: number,
    drum: number | null,
    tick: number,
    ticks: number,
    slide: PitchSlide | null,
  ) => void;
  /**
   * Sound a stretch of the song as it stands — the ticks a selection covers.
   *
   * Not the selected notes on their own: what a porter picked out is a piece of
   * the song, and it is heard the way the transport would play it, every channel
   * the mixer allows and every command that runs in between.
   */
  auditionSpan: (tick: number, ticks: number) => void;
  /** Name the channel a bar belongs to, as a click on a note already does. */
  pick: (channel: number) => void;
  /**
   * Name the loop construct a press on a box's edge took hold of, and the body
   * that pass plays.
   *
   * `pick` for a loop. A body played from three places is three constructs and
   * one text, and the press leaves the caret on the body's first note — so
   * without this the panel beside the roll cannot tell a press on the
   * declaration's box from one on a `(n)m`'s ghost.
   */
  inspectLoop: (text: Span, body: Span) => void;
}

/** What the pointer is doing between down and up. */
interface Drag {
  kind: 'move' | 'stretch' | 'spawn' | 'marquee' | 'erase' | 'gap' | 'resize' | 'transpose';
  /** Where it started, in ticks and rows. */
  fromTick: number;
  fromRow: number;
  /** Where it is now. */
  tick: number;
  row: number;
  /** For a stretch or a loop resize, which end is being pulled. */
  edge: 'start' | 'end';
  /** The item the press landed on, for a move or a stretch. */
  item: number;
  /** Whether the pointer has moved far enough to be a drag at all. */
  moved: boolean;
  /** `Ctrl` was down when it started: copy for a note, marquee for empty grid. */
  copy: boolean;
  /** `Ctrl` on a bar: a press that stays a click toggles it in the selection. */
  additive: boolean;
  /** The row last auditioned, so a drag sounds once per row rather than per pixel. */
  sounded: number;
  /** The pixel the press landed on, for the slop test. */
  atX: number;
  atY: number;
  /** `Alt` is down: tick precision, for this gesture only. */
  fine: boolean;
  /**
   * `Shift` is down, which locks a move to the axis it set off along: the row
   * where it went sideways, the tick where it went up or down.
   *
   * Refreshed on every move as {@link Drag.fine} is, because it only constrains
   * a gesture that already exists — unlike {@link Drag.anchored}, which decides
   * what the gesture *is* and so is settled at the press.
   */
  shift: boolean;
  /**
   * The axis the press first moved along, in pixels: latched where the slop
   * test passes and never re-derived, so a near-diagonal drag cannot flip a
   * `Shift` lock mid-gesture. `null` until the press has really moved.
   *
   * It settles a loop box's rule as well as a `Shift` lock: sideways the pass
   * slides along the song, up or down the body transposes, and the press is
   * neither until the pointer has said which. Latched for the same reason —
   * a gesture that changed what it was every time the pointer wandered off the
   * diagonal would be undoing and redoing two different edits under the hand.
   */
  axis: 'x' | 'y' | null;
  /**
   * `Shift` was down on a press that landed on empty grid: the note is pinned to
   * the tick pressed and its end follows the pointer, rather than the whole note
   * being carried along under it.
   */
  anchored: boolean;
  /** The length a drawn note takes, once the wheel has said; `null` follows the setting. */
  length: number | null;
  /** The frame the gesture runs in — the grabbed item's, or the pass under a spawn. */
  frame: number;
  /**
   * What a press on a loop box's edge resolved, and `null` on every other
   * press. The two kinds that read it take the same construct, run and pass: a
   * `'gap'` moves that pass occurrence in song time, opening or closing a gap of
   * rests at the boundary before it, where a `'resize'` changes the body's own
   * length at the end that was grabbed. The press itself selects the body's
   * whole group and plays it, and a click keeps that as its answer.
   *
   * A `'transpose'` carries it and reads none of it: what it changes is the
   * body's pitches, which no pass position and no rest space has a say in — a
   * nested construct that cannot slide anywhere transposes like any other.
   */
  loop: {
    /** The run whose pass was grabbed — its channel is the one voice that slides. */
    run: LoopRun;
    /** Which pass, 0-indexed. 0 moves the whole occurrence; later ones split the recall. */
    pass: number;
    /** The grabbed pass's start, in song ticks — everything at or after it slides. */
    splitTick: number;
    /** The rest ticks directly before the construct — the most a leftward drag may close. */
    slack: number;
    /**
     * The count a leftward drag spending the whole slack would write, where
     * closing the gap puts this occurrence back against another of the same
     * body; `null` where it would leave two constructs standing.
     *
     * Priced here off the same `loopJoin` the commit calls, so the readout
     * cannot promise a join the write does not make.
     */
    joins: number | null;
    /**
     * Rest ticks at the end of the body being pulled: the most a resize may take
     * out of it before it would cut into a note. 0 for a slide.
     */
    room: number;
    /**
     * Passes of this body the voice plays before the grabbed one, which is how
     * far its own far end travels per tick the body gains — pass `j` begins `j`
     * deltas later, so its right end moves by `j + 1` of them.
     */
    ahead: number;
    /** The sentence where this handle cannot be dragged at all; the selection still stands. */
    refused: string | null;
  } | null;
  /**
   * What turns the frame's local ticks into song ticks for this gesture: the
   * grabbed instance's pass start, or the covering pass's for a spawn. 0 on the
   * root, where local time is song time.
   */
  origin: number;
}

/**
 * Where the pointer is when nothing is pressed, in pixels off the `<svg>`'s box.
 *
 * Pixels rather than ticks because the roll scrolls under a still pointer, and a
 * stored tick would slide left with the music.
 */
interface Hover {
  x: number;
  y: number;
  /** Over a note bar — this channel's or another's. */
  onMark: boolean;
  /**
   * Over a loop box's edge, and which part of it: an end resizes the body,
   * `'slide'` — the top and bottom rules — moves the pass along the song
   * sideways and transposes the body up and down.
   */
  edge: 'start' | 'end' | 'slide' | null;
  /** `Ctrl` is down, so a press would draw a box rather than a note. */
  marquee: boolean;
  fine: boolean;
}

/** The tick a press starts a drawn note on, so the ghost and the press agree. */
function spawnTick(tick: number, snap: number, fine: boolean): number {
  return Math.max(0, fine ? Math.round(tick) : snapTick(tick, snap));
}

/**
 * The tick a drag would put its note on, which is not the tick under the pointer.
 *
 * The two differ by up to half a snap step, and the difference is audible rather
 * than cosmetic: a preview is the song emulated up to the tick it is given, so
 * the tick decides the instrument, volume, `q` and transposition the note is
 * heard under. `item` is the bar being carried, and `undefined` for a spawn.
 *
 * What snaps is the **distance moved**, not where it lands: a note keeps
 * whatever it had against the grid and travels a whole number of steps, which is
 * what `←` and `→` have always done. A note is only ever on the grid because
 * something put it there, and a drag is not that thing — `Alt+Q` is. A spawn is
 * the exception and has to be: a note that does not exist yet has no position of
 * its own to be relative to, so it lands on the grid like the ghost that
 * promised it would.
 */
function draggedTick(held: Drag, item: StripItem | undefined, snap: number): number {
  if (held.kind === 'spawn' || !item) {
    // Snapped in song ticks, where the grid is, then taken local: a pass that
    // starts off the grid still draws where the pointer and the lines agree.
    return Math.max(0, spawnTick(held.tick, snap, held.fine) - held.origin);
  }

  const moved = held.tick - held.fromTick;
  return item.startTick + (held.fine ? Math.round(moved) : snapTick(moved, snap));
}

/** Rows are semitones down the keyboard, so a row step is a semitone step. */
function keysBetween(stack: LaneStack, from: number, to: number): number {
  const a = stack.lanes[from];
  const b = stack.lanes[to];
  return a?.kind === 'key' && b?.kind === 'key' ? b.index - a.index : 0;
}

export interface RollGestures {
  /** The notes the porter has selected, by their index in the strip. */
  selection: Signal<ReadonlySet<number>>;
  /**
   * The loop bodies every note of whose group is selected, by body address.
   * What draws a box's outline solid rather than dashed, and what puts the
   * loop's own name in its corner.
   *
   * Read off the selection rather than latched where an edge press set it: a
   * group is as selected when a marquee or `Ctrl+A` caught all of it as when it
   * was taken by its own box, and an outline that only closed up one of those
   * ways would be saying something about the gesture rather than about the song.
   */
  selectedBodies: Signal<ReadonlySet<number>>;
  /** What to draw over the song right now, or `null` when nothing is happening. */
  preview: Signal<Preview | null>;
  /** The notes the preview is already drawing, by their index in the strip. */
  moving: Signal<ReadonlySet<number>>;
  /** The edited body's pass ends per voice, or `null` outside a body gesture. */
  shiftBoundaries: Signal<ShiftBoundaries | null>;
  /** The held body-length change, which everything downstream slides by per boundary passed. */
  shiftDelta: Signal<number>;
  /**
   * Where the changed body's own passes go, which {@link shiftBoundaries} cannot
   * say — it answers a tick, and a pass's edges are the boundaries themselves.
   * Empty outside a body-length change.
   */
  passShifts: Signal<readonly PassShift[]>;
  /**
   * The bodies a gesture is editing and the rows each one's notes span once its
   * plan lands, so the loops' boxes stay round the notes they are drawn round.
   *
   * One entry per frame the gesture reaches, since a transpose taken by a box's
   * rule carries the loops written inside that body. The root has no box and is
   * left out, and so is a plan with no notes to stand on — a refusal with
   * nowhere to draw leaves the box where it was, which is the reading the red
   * bars already take.
   */
  bodyRows: Signal<readonly BodyRows[]>;
  /** The marquee box, in song coordinates. */
  marquee: Signal<{ x: number; y: number; w: number; h: number } | null>;
  /** The note a press would draw, or `null` where a press would draw none. */
  ghost: Signal<PreviewBar | null>;
  /** The length readout that follows a stretch, as the volume slider's does. */
  bubble: Signal<{ text: string; x: number; y: number } | null>;
  /** What the pointer should look like where it is. */
  cursor: Signal<string>;
  /** True while a gesture is in flight, so the hover tooltip stands aside. */
  busy: Signal<boolean>;
  /**
   * Why the gesture will not be written out, or `null`.
   *
   * What the plan refuses is known while the pointer is still down, and is
   * already on the roll as red bars and a red wash; this is that in words. What
   * the **splice** refuses is not known until the commit, which is the moment the
   * gesture is undone — so that reason is held rather than shown and dropped.
   */
  refusal: Signal<string | null>;

  onPointerDown(event: PointerEvent, box: DOMRect): void;
  onPointerMove(event: PointerEvent, box: DOMRect): void;
  onPointerUp(event: PointerEvent): void;
  /** The pointer has left the roll, so there is nowhere for the ghost to be. */
  onPointerLeave(): void;
  /**
   * Size the note being drawn, one rung of {@link stepDrawLength}'s ladder up
   * (`1`) or down (`-1`), or one tick at a time under `fine`.
   *
   * Answers whether there was a note being drawn at all, so the wheel that asked
   * knows whether to keep its own meaning.
   */
  stepLength(direction: number, fine: boolean): boolean;
  /** Runs a gesture the keyboard asked for — delete, nudge, quantize and the rest. */
  run(gesture: Gesture): void;
  /**
   * What a change to the document does to the selection.
   *
   * The one place it is decided, and the reason no commit clears the selection
   * itself: a set of indices means something for exactly as long as the strip it
   * indexes into stands, so it is dropped when that text goes and not a moment
   * before — which is what keeps an outline on screen for the compile the roll
   * spends with no strip at all.
   *
   * `keepsNotes` is `EditBatch.keepsNotes` as the editor really applied it: a
   * splice into one command's own text, so the channel comes back with the same
   * items in the same order and the indices still name the notes they named,
   * with nothing to carry. A gesture's own commit carries its plan's answer
   * instead ({@link restoreSelection}). Anything else is text the roll cannot
   * account for, and an index into it names whatever moved into that place.
   */
  sourceChanged(keepsNotes: boolean): void;
  /** Puts a carried selection back on the strip the commit it rode on produced. */
  restoreSelection(strip: Strip): void;
  selectAll(): void;
  clearSelection(): void;
  toggle(item: number): void;
}

/** The pitch a row stands for, or `null` where the row is not one a note can go on. */
function pitchOfRow(
  stack: LaneStack,
  row: number,
): { written: number; drum: number | null } | null {
  const lane = stack.lanes[row];
  if (!lane) {
    return null;
  }

  if (lane.kind === 'key') {
    return { written: NOTE_MIN + lane.index, drum: null };
  }

  // A drum's lane is its instrument and its letter says nothing, so `c` is as
  // good a pitch as any — the byte the driver reads is `$D0`-`$D8` either way.
  // The noise lane is not a note anyone can write, so it takes nothing.
  return lane.kind === 'drum' ? { written: NOTE_MIN + 24, drum: lane.index } : null;
}

/**
 * Which strip item is under a song tick and a row, and which of its instances —
 * `index: -1` for none. Every pass of a looped note answers, so grabbing the
 * third pass grabs the note, with the pass remembered for the sound and the
 * frame the gesture runs in.
 */
function itemAt(
  strip: Strip,
  stack: LaneStack,
  tick: number,
  row: number,
): { index: number; instance: number } {
  for (let index = 0; index < strip.items.length; index++) {
    const item = strip.items[index];
    if (item.kind !== 'note' || rowOfItem(item, stack) !== row) {
      continue;
    }

    for (let instance = 0; instance < item.instances.length; instance++) {
      const at = item.instances[instance].tick;
      if (tick >= at && tick < at + item.ticks) {
        return { index, instance };
      }
    }
  }

  return { index: -1, instance: 0 };
}

function rowOfItem(item: StripItem, stack: LaneStack): number {
  return rowOfPlaced({ written: item.written, drum: item.drum?.args[0]?.value ?? null }, stack);
}

export function rollGestures(sources: GestureSources, sinks: GestureSinks): RollGestures {
  const selection = signal<ReadonlySet<number>>(new Set<number>());
  const drag = signal<Drag | null>(null);
  const hover = signal<Hover | null>(null);

  /**
   * Where the selection is going once the commit in flight has been compiled.
   *
   * A gesture is the one writer that can say: its plan knows where every note it
   * did not delete ended up. Held from the commit until the strip that commit
   * produced arrives, which is a compile away — the roll has no strip at all in
   * between, so there is nothing to index into and nothing to draw.
   *
   * A plain field: nothing renders it. The channel is part of it because a strip
   * is rebuilt for whichever channel is being edited, and with none picked that
   * is the one under the pointer — a turnover the pointer caused must not be
   * taken for the one the commit did.
   */
  let pending: { channel: number; anchors: readonly NoteAnchor[] } | null = null;

  /** The gesture the pointer is describing, or `null` when it is not describing one. */
  const gestureNow = computed<Gesture | null>(() => {
    const held = drag();
    const strip = sources.strip();
    if (
      !held ||
      !strip ||
      held.kind === 'marquee' ||
      held.kind === 'erase' ||
      held.kind === 'gap' ||
      held.kind === 'resize'
    ) {
      return null;
    }

    const stack = sources.stack();
    const snap = sources.snap();

    // `Alt` drops both snaps for the length of one gesture without touching the
    // setting: a position lands on the tick under the pointer (`draggedTick`),
    // and a length on the tick count itself rather than the nearest note value.
    const fine = held.fine;

    if (held.kind === 'spawn') {
      // The new note follows the pointer, which is what "in the dragged state"
      // means: press, and it is already there; drag, and it goes where you drag.
      // Anchored, it does the opposite: the start stays where it was pressed and
      // the pointer pulls the end, so the row is the pressed one too.
      const pitch = pitchOfRow(stack, held.anchored ? held.fromRow : held.row);
      if (!pitch) {
        return null;
      }

      const startTick = held.anchored
        ? Math.max(0, spawnTick(held.fromTick, snap, fine) - held.origin)
        : draggedTick(held, undefined, snap);
      // The wheel has no say while anchored — the pointer owns the length — and
      // the length answers to the note values a stretch does rather than to the
      // grid, since what is being chosen is a duration.
      const drawn = held.length ?? sources.lastLength();
      const reach = Math.max(1, Math.round(held.tick - held.origin - startTick));

      return {
        kind: 'spawn',
        startTick,
        ticks: held.anchored ? (fine ? reach : snapDuration(reach)) : drawn,
        written: pitch.written,
        drum: pitch.drum,
      };
    }

    // A group taken by its own box transposes as one, and its notes are the
    // selection the press put there. The travel is read in **rows**, a row of
    // the keyboard being a semitone — not `keysBetween`, which answers 0
    // wherever either row is a drum or the noise lane, and a body that plays
    // percussion has its box's rules up there. `held.item` is the construct,
    // which is a note of the channel the loop is written on and not one of the
    // body's, so the branches below have nothing to say about this.
    if (held.kind === 'transpose') {
      const group = [...selection()];
      return group.length === 0
        ? null
        : {
            kind: 'move',
            items: group,
            deltaTicks: 0,
            deltaKeys: held.fromRow - held.row,
            copy: false,
          };
    }

    const items = selection().has(held.item) ? [...selection()] : [held.item];
    const item = strip.items[held.item];
    if (!item) {
      return null;
    }

    if (held.kind === 'stretch') {
      // A length snaps to the note values themselves — `1`, `2`, `4`… and their
      // dotted forms — rather than to the grid, because a note in MML is a
      // duration and the porter is choosing one. The pointer's song tick is
      // taken local first, since the item's ticks are its frame's.
      const local = held.tick - held.origin;
      const end = item.startTick + item.ticks;
      const wanted = held.edge === 'end' ? local - item.startTick : end - local;
      // The wheel wins where it has spoken: a press that is being sized by the
      // wheel is not being sized by the pointer as well, and `stepLength` only
      // hands a length to a press that never moved.
      const length =
        held.length ??
        (fine ? Math.max(1, Math.round(wanted)) : snapDuration(Math.max(1, Math.round(wanted))));
      return {
        kind: 'stretch',
        items,
        edge: held.edge,
        deltaTicks: held.edge === 'end' ? length - item.ticks : item.ticks - length,
      };
    }

    // `Shift` locks the drag to the axis it first moved along: set off sideways
    // and the note travels the song without its pitch coming along for the
    // ride; set off up or down and it changes pitch without leaving its tick.
    return {
      kind: 'move',
      items,
      deltaTicks:
        held.shift && held.axis === 'y' ? 0 : draggedTick(held, item, snap) - item.startTick,
      deltaKeys: held.shift && held.axis !== 'y' ? 0 : keysBetween(stack, held.fromRow, held.row),
      copy: held.copy,
    };
  });

  /**
   * The gesture planned in every frame it names an item in, the held frame
   * first — one entry unless it is one of the two that may span brackets.
   */
  const plans = computed<readonly FramePlan[]>(() => {
    const strip = sources.strip();
    const gesture = gestureNow();
    const held = drag();
    return strip && gesture && held
      ? planFrames(strip, gesture, sources.editMode(), held.frame)
      : [];
  });

  /**
   * Whether the press has become something to draw: a drag past the slop, a note
   * being spawned, or a press the wheel has given a length.
   *
   * A press on a note that turns out to be a click would otherwise flash a bar
   * over the note it is standing on. Two exceptions: drawing, where "in the
   * dragged state" means the new note is there from the press, and a press the
   * wheel has resized, which has something to show and no movement to show it by.
   *
   * It never goes back down within a gesture, which is what lets
   * {@link shiftBoundaries} be dealt on it: the transition is the slop, where the
   * pointer is captured and there is no longer a click to protect.
   */
  const underWay = computed<boolean>(() => {
    const held = drag();
    return held !== null && (held.moved || held.kind === 'spawn' || held.length !== null);
  });

  /** The plans as far as the porter is concerned: nothing until {@link underWay}. */
  const shownPlans = computed<readonly FramePlan[]>(() => (underWay() ? plans() : []));

  /**
   * The held frame's share of that, for the readers that price one frame — the
   * body-length arithmetic, and the readout, both of which are its alone.
   */
  const shownPlan = computed<Plan | null>(() => shownPlans()[0]?.plan ?? null);

  /** The frame the gesture runs in, or the root while nothing is held. */
  const heldFrame = computed<StripFrame | null>(() => {
    const strip = sources.strip();
    const held = drag();
    // A construct drag holds no body-length plan: its shift comes off the drag
    // itself (see {@link gapDelta} and {@link resizeDelta}), so the plan-side
    // readers — `moving`, `preview`, and `frameDelta`'s own tail — stand down and
    // the buckets alone draw it.
    return strip && held && held.kind !== 'gap' && held.kind !== 'resize'
      ? strip.frames[held.frame]
      : null;
  });

  /** The body being resized, which `heldFrame` stands down for. */
  const resizedFrame = computed<StripFrame | null>(() => {
    const strip = sources.strip();
    const held = drag();
    return strip && held?.kind === 'resize' ? (strip.frames[held.frame] ?? null) : null;
  });

  /**
   * The held gap change, in ticks — the edge drag's inserted (positive) or
   * closed (negative) time. The distance snaps, as a note drag's does, and the
   * left is clamped at the free rest space the press priced ({@link gapSlack}
   * through `Drag.loop.slack`), so the preview never promises a close the
   * commit cannot write.
   */
  const gapDelta = computed<number>(() => {
    const held = drag();
    const gap = held?.kind === 'gap' ? held.loop : null;
    if (!held || gap?.refused !== null || !held.moved) {
      return 0;
    }

    const moved = held.tick - held.fromTick;
    const snapped = held.fine ? Math.round(moved) : snapTick(moved, sources.snap());
    return Math.max(-gap.slack, snapped);
  });

  /**
   * What a resize's pointer is asking the body to grow by, before the clamp:
   * positive grows it at either end, so pulling the left end leftwards and the
   * right end rightwards both count up.
   *
   * A pass's far end travels by one delta for itself and one for each pass in
   * front of it, so the travel is divided by that count before it is snapped —
   * the end being dragged then follows the pointer, which is the whole of what a
   * handle promises, and the body still changes by a whole number of steps. The
   * left end has no such division: it is the first occurrence's alone, and the
   * construct moving back by the same delta is what holds it under the pointer.
   */
  const resizeWanted = computed<number>(() => {
    const held = drag();
    const loop = held?.kind === 'resize' ? held.loop : null;
    if (!held || loop?.refused !== null || !held.moved) {
      return 0;
    }

    const moved = held.tick - held.fromTick;
    const asked = held.edge === 'start' ? -moved : moved / (loop.ahead + 1);
    return held.fine ? Math.round(asked) : snapTick(asked, sources.snap());
  });

  /**
   * And what the commit can actually write. A shrink stops at the body's own
   * rests at that end, so it never cuts into a note; a leftward grow stops at
   * the free space in front of the construct, which is the clamp the slide's own
   * leftward drag already goes through. The gesture and the write price the
   * change once, so what the preview promised is what lands.
   */
  const resizeDelta = computed<number>(() => {
    const held = drag();
    const loop = held?.kind === 'resize' ? held.loop : null;
    if (!held || !loop) {
      return 0;
    }

    const ceiling = held.edge === 'start' ? loop.slack : Number.POSITIVE_INFINITY;
    return Math.max(-loop.room, Math.min(ceiling, resizeWanted()));
  });

  /**
   * The frame's tick change the plan asks for — the body-length edit's price,
   * by which every later pass and everything after the loop will move. 0 for a
   * root gesture, whose length change pads rather than shifts.
   */
  const frameDelta = computed<number>(() => {
    const kind = drag()?.kind;
    if (kind === 'gap') {
      return gapDelta();
    }

    if (kind === 'resize') {
      return resizeDelta();
    }

    const strip = sources.strip();
    const frame = heldFrame();
    const now = shownPlan();
    if (!strip || !frame || !now || frame.body < 0 || now.refused !== null) {
      return 0;
    }

    return plannedFrameTicks(strip, frame, now) - frame.ticks;
  });

  /**
   * The edited body's passes, for projecting a frame-local bar into every pass
   * it will play at — every voice's, since a `(n)` recalled across channels
   * plays there too. `ordinal` counts the passes **of that voice** in front,
   * which is how many deltas its start slides by: each voice's music shifts by
   * its own passes alone. One entry, at 0, for the root.
   */
  const heldPasses = computed<readonly { tick: number; ordinal: number }[]>(() => {
    const frame = heldFrame();
    // The same walk {@link passShifts} counts, so the bars the preview projects
    // into a pass and the box drawn round them cannot count it differently.
    return frame && frame.body >= 0 ? framePasses(frame) : [{ tick: 0, ordinal: 0 }];
  });

  /**
   * The edited body's pass ends per voice, or `null` outside a body gesture.
   * Depends on the held frame and on {@link underWay} alone, so the buckets built
   * over it are dealt once per gesture rather than once per pointer move.
   *
   * A press that has not become a drag deals none: the deal moves every bar past
   * the body's first pass end into the bucket group its own count of boundaries
   * names, and a bar re-parented while the button is down is destroyed before the
   * release. The browser raises no `click` on a node that has gone, so a press
   * dealt from the start would lose the inspector's question and the double
   * click's go-to on every pass of a loop but the first.
   */
  const shiftBoundaries = computed<ShiftBoundaries | null>(() => {
    if (!underWay()) {
      return null;
    }

    // A gap slides one voice past one boundary: everything at or after the
    // grabbed pass's start moves by the whole delta, the comparison the
    // buckets already make for a note standing exactly on a boundary.
    const held = drag();
    if (held?.kind === 'gap') {
      return held.loop ? new Map([[held.loop.run.channel, [held.loop.splitTick]]]) : null;
    }

    // A resize's ticks land at the end that was grabbed, and where in the pass
    // they land is what decides the boundary — the left end's construct having
    // been pulled back by that same delta, its own first pass is no step.
    const resized = resizedFrame();
    if (held?.kind === 'resize' && held.loop && resized && resized.body >= 0) {
      return shiftBoundariesFor(
        resized,
        held.edge,
        held.edge === 'start'
          ? { channel: held.loop.run.channel, tick: held.loop.splitTick }
          : null,
      );
    }

    const frame = heldFrame();
    return frame && frame.body >= 0 ? shiftBoundariesFor(frame, 'end', null) : null;
  });

  /**
   * The same change as {@link shiftBoundaries}, for the changed body's own
   * passes — the loop boxes drawn on them, which the marks' rule cannot place.
   *
   * In deltas, so it holds still from the press and only what a step is worth
   * changes per move. A `'gap'` raises none, both frames standing down for it as
   * they do for the preview: a slide changes no body's length, and every box
   * including the slid pass's own moves the way a mark on its edges moves.
   */
  const passShifts = computed<readonly PassShift[]>(() => {
    const held = drag();
    const frame = resizedFrame() ?? heldFrame();
    if (!held || !frame || frame.body < 0) {
      return [];
    }

    const lead = held.kind === 'resize' && held.edge === 'start' ? held.loop : null;
    return passShiftsFor(
      frame,
      lead ? 'start' : 'end',
      lead ? { channel: lead.run.channel, tick: lead.splitTick } : null,
    );
  });

  /** The rows each edited body's notes span once its plan lands. */
  const bodyRows = computed<readonly BodyRows[]>(() => {
    const stack = sources.stack();
    const rows: BodyRows[] = [];
    for (const { frame, plan: now } of shownPlans()) {
      if (frame.body < 0) {
        continue; // The root has no box to answer for.
      }

      // The plan's whole list, not what the gesture moved: a box is drawn round
      // every note of its pass, and the ones standing still are as much of it as
      // the ones being carried. A frame's plan holds only the notes written in
      // its own text, so a loop playing inside this one is another entry here
      // and the union of the boxes is what puts the two together.
      let low = Number.POSITIVE_INFINITY;
      let high = Number.NEGATIVE_INFINITY;
      for (const note of now.notes) {
        const row = rowOfPlaced(note, stack);
        if (row >= 0) {
          low = Math.min(low, row);
          high = Math.max(high, row);
        }
      }

      if (low <= high) {
        rows.push({ body: frame.body, low, high });
      }
    }

    return rows;
  });

  const preview = computed<Preview | null>(() => {
    const parts = shownPlans();
    if (parts.length === 0) {
      return null;
    }

    const stack = sources.stack();
    const zoom = sources.zoom();
    const rowHeight = sources.rowHeight();
    // The length change is the held frame's alone, and so is the striped rewrite
    // it needs; a frame a tick-neutral gesture reached into changes no length.
    const delta = frameDelta();
    return joinPreviews(
      parts.map(({ frame, plan: now }, at) => {
        let shown = now;
        // A length change stands the whole body's bars aside (see {@link moving}),
        // so the ones the gesture did not touch are drawn here instead — striped,
        // the mark of a note moved as a consequence rather than by the hand.
        if (at === 0 && delta !== 0) {
          const drawn = new Set([...now.touched, ...now.pushed]);
          const carried = now.notes.filter((note) => !drawn.has(note));
          shown = { ...now, pushed: [...now.pushed, ...carried] };
        }

        return buildPreview({
          plan: shown,
          stack,
          zoom,
          rowHeight,
          rows: stack.lanes.length,
          passes: at === 0 ? heldPasses() : framePasses(frame),
          delta: at === 0 ? delta : 0,
          body: frame.body,
        });
      }),
    );
  });

  /**
   * The notes the preview has taken over, so the roll's own bars leave them out
   * and a note being dragged is drawn once rather than twice.
   *
   * By strip index, as {@link RollGestures.selection} is; the roll turns both
   * into the addresses its marks are keyed by. Three cases fall out of
   * `PlacedNote.from` rather than needing a rule each: a copy keeps its original,
   * because `planGesture` gives a copied note `from: -1`; a drawn note has no
   * original at all, for the same reason; and a refusal with nothing to draw
   * carries no notes, so every bar goes back where it was.
   */
  const moving = computed<ReadonlySet<number>>(() => {
    const carried = new Set<number>();
    for (const { plan: now } of shownPlans()) {
      for (const note of now.touched) {
        if (note.from >= 0) {
          carried.add(note.from);
        }
      }
    }

    // While the gesture changes the body's length, the whole body is the
    // preview's: every pass of every item moves, and the projected bars are
    // the honest picture, so the song's own are stood aside.
    const strip = sources.strip();
    const frame = heldFrame();
    if (strip && frame && frameDelta() !== 0) {
      for (let index = frame.from; index < frame.to; index++) {
        if (strip.items[index].kind === 'note') {
          carried.add(index);
        }
      }
    }

    return carried;
  });

  const marquee = computed(() => {
    const held = drag();
    if (held?.kind !== 'marquee') {
      return null;
    }

    const zoom = sources.zoom();
    const rowHeight = sources.rowHeight();
    const x = Math.min(held.fromTick, held.tick) * zoom;
    const w = Math.abs(held.tick - held.fromTick) * zoom;
    const y = Math.min(held.fromRow, held.row) * rowHeight;
    const h = (Math.abs(held.row - held.fromRow) + 1) * rowHeight;
    return { x, y, w, h };
  });

  /**
   * The note a press would draw, drawn before it is pressed.
   *
   * Every reason it is `null` is a reason `onPointerDown` would not spawn a note
   * either, so the ghost never offers a press that would be ignored. It asks
   * `planGesture` nothing: a plan would put the red clash wash and the pushed
   * bars on screen for a pointer that has committed to nothing.
   */
  const ghost = computed<PreviewBar | null>(() => {
    const at = hover();
    const strip = sources.strip();
    // The edge is a handle, not empty grid: a press there grabs the group, so
    // the ghost promising a drawn note would promise the wrong thing.
    if (!at || !strip || drag() || at.onMark || at.edge !== null || at.marquee) {
      return null;
    }

    const stack = sources.stack();
    const rowHeight = sources.rowHeight();
    const row = rowAtY(at.y, rowHeight, stack.lanes.length);
    if (at.x < KEY_WIDTH || row < 0 || !pitchOfRow(stack, row)) {
      return null;
    }

    const zoom = sources.zoom();
    const tick = tickAtX(at.x, sources.viewTick(), zoom);
    if (itemAt(strip, stack, tick, row).index >= 0) {
      // This channel's own note: a press there moves or stretches it, which the
      // cursor is already saying.
      return null;
    }

    return {
      id: 'ghost',
      x: spawnTick(tick, sources.snap(), at.fine) * zoom,
      ...barRect(row, rowHeight, sources.lastLength(), zoom),
    };
  });

  const bubble = computed(() => {
    const held = drag();

    // An edge drag's readout is where the grabbed pass is going; the pointer's
    // own row places it, a construct having no row of its own.
    if (held?.kind === 'gap') {
      const delta = gapDelta();
      if (!held.loop || delta === 0) {
        return null;
      }

      // A pull that spends the whole slack closes the gap, and where that puts
      // the pass back against another of the same body the commit writes the
      // two as one call: say so while the button is still down.
      const going = held.loop.splitTick + delta;
      const joins = held.loop.joins !== null && delta === -held.loop.slack;
      return {
        text: joins ? `tick ${going} · one call of ${held.loop.joins}` : `tick ${going}`,
        x: going * sources.zoom(),
        y: held.row * sources.rowHeight(),
      };
    }

    // A transposed group moves no note in time, so the readout is the interval
    // every one of them takes rather than a tick or a length. It follows the
    // pointer, a body having no one row of its own to sit on.
    if (held?.kind === 'transpose') {
      const keys = held.fromRow - held.row;
      if (keys === 0) {
        return null;
      }

      return {
        text: `${keys > 0 ? '+' : ''}${keys} ${Math.abs(keys) === 1 ? 'semitone' : 'semitones'}`,
        x: held.tick * sources.zoom(),
        y: held.row * sources.rowHeight(),
      };
    }

    // A resize's is the body's new length, which is what every pass of it takes,
    // read at the end being pulled.
    const resized = resizedFrame();
    if (held?.kind === 'resize' && held.loop && resized) {
      const delta = resizeDelta();
      if (delta === 0) {
        return null;
      }

      const ticks = resized.ticks + delta;
      const spelled = spellDuration(ticks, sources.targetAMKVersion());
      // Where the end being dragged is going: its pass has slid by the passes in
      // front of it, and the box itself is then the body's new length.
      const going =
        held.edge === 'end'
          ? held.loop.splitTick + held.loop.ahead * delta + ticks
          : held.loop.splitTick - delta;
      return {
        text: `${spelled === null ? '' : `${spelled} · `}${ticks} ticks`,
        x: going * sources.zoom(),
        y: held.row * sources.rowHeight(),
      };
    }

    const now = shownPlan();
    if (!held || !now || now.touched.length === 0) {
      return null;
    }

    const note = now.touched[0];
    const version = sources.targetAMKVersion();
    // The pointer's own pass: a frame-local tick means nothing to a porter
    // reading the grid, so the readout and the box are both projected through
    // the grabbed pass's origin.
    const label =
      held.kind === 'move'
        ? `tick ${held.origin + note.startTick}`
        : `${lengthLabel(note, version, now.touched.length === 1)} · ${note.ticks} ticks`;
    return {
      text: label,
      x: (held.origin + note.startTick + note.ticks / 2) * sources.zoom(),
      y: rowOfPlaced(note, sources.stack()) * sources.rowHeight(),
    };
  });

  /**
   * What the pointer should look like, which is what says a gesture is there.
   *
   * Off {@link Hover} rather than set from the move that reported it: the roll
   * scrolls under a still pointer while the song plays, so a bar arrives under a
   * cursor that was told `crosshair` and nothing would say otherwise until the
   * pointer moved. A drag comes first, and keeps its cursor wherever it wanders.
   */
  const cursor = computed<string>(() => {
    const held = drag();
    if (held) {
      // An anchored spawn is drawing a note by its right edge, so it says what a
      // stretch says rather than what a draw does.
      return held.kind === 'stretch' || held.kind === 'resize' || held.anchored
        ? 'ew-resize'
        : held.kind === 'move' || held.kind === 'gap' || held.kind === 'transpose'
          ? 'grabbing'
          : 'crosshair';
    }

    const at = hover();
    if (!at) {
      return 'default';
    }

    // A loop box's top and bottom rules are the whole construct's handle — it
    // moves in both axes, so they say what a bar's middle says; its ends resize
    // the loop, as a bar's do.
    if (at.edge !== null) {
      return at.edge === 'slide' ? 'grab' : 'ew-resize';
    }

    const stack = sources.stack();
    const zoom = sources.zoom();
    const row = rowAtY(at.y, sources.rowHeight(), stack.lanes.length);
    const tick = tickAtX(at.x, sources.viewTick(), zoom);
    return hoverCursor(sources.strip(), stack, zoom, tick, row, at.x, at.onMark);
  });

  /** True once a gesture is really under way, so the hover tooltip stands aside. */
  const busy = computed(() => {
    const held = drag();
    return (
      shownPlans().length > 0 || ((held?.kind === 'gap' || held?.kind === 'resize') && held.moved)
    );
  });

  /**
   * The reason the last commit gave for turning a gesture away, against the
   * document it was given for.
   *
   * Held rather than shown and dropped, because a `planEdits` refusal arrives at
   * the pointer-up that would have committed it: the gesture snaps back and the
   * roll goes quiet, so a message that left with it would never be read. The
   * document is what dates it — every commit that does happen writes one, and a
   * reason given for text that has since moved is answering about nothing.
   */
  const latched = signal<{ reason: string; source: string } | null>(null);

  const refusal = computed<string | null>(() => {
    const now = shownPlans();
    if (now.length > 0) {
      // A gesture in flight answers for itself, and a group is written whole or
      // not at all, so one frame's refusal is the whole gesture's. The clash is
      // spelled out here rather than carried in the plan because `planGesture`
      // reports it as ticks for the roll to wash red; `planEdits` gives the same
      // sentence at the commit, and this is it while the pointer is still down.
      const said = now.find((each) => each.plan.refused !== null)?.plan.refused;
      return said ?? (now.some((each) => each.plan.clashes.length > 0) ? REFUSE_CLASH : null);
    }

    // An edge drag that cannot go anywhere says why for as long as it is held;
    // the press it started as has already done its selecting.
    const held = drag();
    if ((held?.kind === 'gap' || held?.kind === 'resize') && held.moved && held.loop?.refused) {
      return held.loop.refused;
    }

    // And a resize the clamp has pinned at nothing says which end ran out — the
    // pointer is still moving, so silence would read as the roll ignoring it.
    if (held?.kind === 'resize' && held.moved) {
      const wanted = resizeWanted();
      if (wanted !== 0 && resizeDelta() === 0) {
        return wanted > 0 ? REFUSE_LOOP_LEAD_ROOM : REFUSE_LOOP_BODY_ROOM;
      }
    }

    const kept = latched();
    return kept !== null && kept.source === sources.source() ? kept.reason : null;
  });

  /** Where a pointer is, in the song's own terms. */
  const at = (event: PointerEvent, box: DOMRect): { tick: number; row: number } => {
    const tick = tickAtX(event.clientX - box.left, sources.viewTick(), sources.zoom());
    const row = Math.floor((event.clientY - box.top) / sources.rowHeight());
    return { tick, row };
  };

  const soundRow = (
    row: number,
    tick: number,
    ticks: number,
    slide: PitchSlide | null = null,
  ): void => {
    const pitch = pitchOfRow(sources.stack(), row);
    if (pitch) {
      sinks.audition(pitch.written, pitch.drum, Math.max(0, Math.round(tick)), ticks, slide);
    }
  };

  /**
   * Sound the note a drag is carrying, where it is going and at the length it is.
   *
   * Handed the drag rather than reading the signal, because both callers are
   * building the next one and neither has set it yet. A spawn's length is the one
   * the wheel chose; a move keeps the bar's own, which `Drag.length` never holds.
   *
   * A bar being carried keeps its slide, which a spawn has none of: the `$DD`'s
   * target is absolute, so a note dropped on a new row really would still slide
   * to the same note.
   */
  const soundDrag = (held: Drag, row: number): void => {
    const item = sources.strip()?.items[held.item];
    const ticks = held.kind === 'spawn' ? held.length : item?.ticks;
    // A gesture an axis is locked out of sounds where it is pinned, not where
    // the pointer wandered — that is where the note is going. The frame-local
    // tick goes back through the grabbed pass's origin, since the audition is
    // the song emulated up to a song tick.
    const going = held.anchored || (held.shift && held.axis !== 'y') ? held.fromRow : row;
    const local =
      held.shift && held.axis === 'y' && item
        ? item.startTick
        : draggedTick(held, item, sources.snap());
    soundRow(going, held.origin + local, ticks ?? sources.lastLength(), item?.slide ?? null);
  };

  /** Everything `planEdits` reads besides the plan itself, as of right now. */
  const contextFor = (strip: Strip, frame: StripFrame): EditContext => ({
    source: sources.source(),
    strip,
    targetAMKVersion: sources.targetAMKVersion(),
    songTargetProgram: sources.songTargetProgram(),
    playableTicks: sources.playableTicks(),
    introTicks: sources.introTicks(),
    channels: sources.channels(),
    frame,
    inForce: sources.inForce(),
  });

  /**
   * A plan written out, or the reason it was not, kept where the three commits
   * can share it.
   *
   * Answers the edits so that each caller can do what it alone does with them —
   * `finish` remembers the length it drew, `erase` does not.
   */
  const write = (strip: Strip, parts: readonly FramePlan[]): readonly Edit[] | null => {
    if (parts.length === 0) {
      return null;
    }

    const outcome = planGroupEdits(contextFor(strip, parts[0].frame), parts);
    if (!isEdits(outcome)) {
      latched.set({ reason: outcome.refused, source: sources.source() });
      return null;
    }

    latched.set(null);
    return outcome;
  };

  /** The selection as the plans leave it, kept for the strip they are about to build. */
  const carry = (strip: Strip, parts: readonly FramePlan[]): void => {
    pending = { channel: strip.channel, anchors: anchorsFor(strip, parts, selection()) };
  };

  const finish = (): void => {
    const strip = sources.strip();
    const parts = plans();
    const now = parts[0]?.plan;
    const held = drag();
    drag.set(null);
    if (!strip || !now || !held) {
      return;
    }

    const edits = write(strip, parts);
    if (edits && edits.length > 0) {
      if (now.touched.length > 0) {
        sinks.rememberLength(now.touched[0].ticks);
      }

      carry(strip, parts);
      sinks.commit(edits);
    }
  };

  /** Bodies the selection holds whole, for the label their boxes carry. */
  const selectedBodies = computed<ReadonlySet<number>>(() => {
    const strip = sources.strip();
    const chosen = selection();
    const whole = new Set<number>();
    if (!strip || chosen.size === 0) {
      return whole;
    }

    for (const frame of strip.frames) {
      if (frame.body < 0) {
        continue;
      }

      let notes = 0;
      let held = 0;
      for (let index = frame.from; index < frame.to; index++) {
        const item = strip.items[index];
        if (item.kind === 'note' && item.instances.length > 0) {
          notes++;
          held += chosen.has(index) ? 1 : 0;
        }
      }

      if (notes > 0 && notes === held) {
        whole.add(frame.body);
      }
    }

    return whole;
  });

  const api: RollGestures = {
    selection: selection.asReadonly(),
    selectedBodies,
    preview,
    moving,
    shiftBoundaries,
    shiftDelta: frameDelta,
    passShifts,
    bodyRows,
    marquee,
    ghost,
    bubble,
    cursor,
    busy,
    refusal,

    onPointerDown(event: PointerEvent, box: DOMRect): void {
      // The hover is left where it is: `drag` is what stands it aside, in both
      // the ghost and the cursor, and a press that turns out to be a click has
      // somewhere to go back to.
      // The left button edits and the right one erases; every other button
      // belongs to somebody else. The middle one is the camera's pan, which the
      // roll handles above this so that it works with no channel picked.
      if (event.button !== 0 && event.button !== 2) {
        return;
      }

      // A loop box's edge is the construct's handle: a press names the channel,
      // selects the body's whole group — that group and nothing else — and plays
      // the pass it landed on. Keeping hold then resizes the loop from either
      // end, or, from the top and bottom rules, drags the grabbed pass along the
      // song sideways and transposes the whole body up and down. Before the
      // strip guard, because the edge may be another channel's and naming it is
      // what makes that channel's strip the one to read.
      const handle =
        event.button === 0 ? (event.target as Element | null)?.closest('.loop-edge') : null;
      if (handle) {
        sinks.pick(Number(handle.getAttribute('data-channel')));
        const grabbed = sources.strip();
        const body = Number(handle.getAttribute('data-body'));
        const passTick = Number(handle.getAttribute('data-tick'));
        const frame = grabbed?.frames.findIndex((each) => each.body === body) ?? -1;
        if (!grabbed || frame < 0) {
          return; // The channel is named; a channel that cannot edit selects nothing.
        }

        // The group is the body's own notes and the notes of every loop written
        // inside it: the box is already drawn round them — a note is in every
        // region holding its tick, since a subloop's pass sits inside its
        // loop's — so a group leaving them out would be a box promising a move
        // it could not make. A body merely *called* from inside this one is not
        // among them (`framesInside`): its text plays elsewhere in the song too.
        const group = new Set<number>();
        for (const each of [
          grabbed.frames[frame],
          ...framesInside(grabbed, grabbed.frames[frame]),
        ]) {
          for (let index = each.from; index < each.to; index++) {
            const item = grabbed.items[index];
            if (item.kind === 'note' && item.instances.length > 0) {
              group.add(index);
            }
          }
        }

        latched.set(null);
        selection.set(group);

        // The construct the box stands for on this channel — the item whose
        // occupation covers the grabbed pass — and the run that pass belongs
        // to, whose own start is the boundary everything after slides past.
        const construct = constructFor(grabbed, body, passTick);
        let run: LoopRun | undefined;
        let pass = -1;
        for (const each of grabbed.frames[frame].runs) {
          const found =
            each.channel === grabbed.channel
              ? each.passes.findIndex((p) => p.tick === passTick)
              : -1;
          if (found >= 0) {
            run = each;
            pass = found;
            break;
          }
        }

        if (construct < 0 || !run) {
          return; // The selection is the press's whole answer.
        }

        sinks.auditionSpan(passTick, run.passes[pass].ticks);

        const { tick, row } = at(event, box);
        const standing = grabbed.items[construct];
        if (standing.loop) {
          // The construct is this box's own — a `(n)m` for a ghost, the
          // `(n)[ … ]m` for the dashed one — where the frame's span is the body
          // they share, which is what retires the answer when the caret leaves.
          sinks.inspectLoop(standing.loop.text, grabbed.frames[frame].span);
        }

        const played = grabbed.frames[frame];
        const passes = passesAt(played, grabbed.channel, passTick);
        // Two passes of a body meet at every interior edge of a loop, and their
        // handles overlap there. The seam belongs to the pass on the **left**:
        // its far end resizes from any pass, where a later pass's start is not
        // a thing that can move at all.
        const grabbedEnd = loopEnd(handle, tick, sources.zoom());
        const end = grabbedEnd === 'start' && passes.abuts ? 'end' : grabbedEnd;
        // A nested construct plays wherever its outer loop does, so it has no
        // song-time position to slide and none to grow leftwards into. Its
        // right end is a plain body-length change, which stretching the note at
        // that end already writes, so it is left alone.
        const outer = standing.frame !== 0;
        const refused =
          end === null
            ? outer
              ? REFUSE_NESTED_LOOP
              : standing.loop?.kind === 'sub' && pass > 0
                ? REFUSE_SUB_SPLIT
                : null
            : end === 'start'
              ? outer
                ? REFUSE_NESTED_LOOP
                : passTick !== firstPassOn(played, grabbed.channel)
                  ? REFUSE_LOOP_LEFT_PASS
                  : null
              : null;
        const free = !outer && refused === null ? gapSlack(grabbed, construct) : 0;
        // Priced only where a slide could spend it: a resize never joins, and a
        // later pass has an earlier one of its own run in front of it.
        const joined =
          end === null && pass === 0 && free > 0
            ? loopJoin(sources.source(), grabbed, construct, run)
            : null;

        drag.set({
          kind: end === null ? 'gap' : 'resize',
          fromTick: tick,
          fromRow: row,
          tick,
          row,
          edge: end ?? 'end',
          item: construct,
          moved: false,
          copy: false,
          additive: false,
          sounded: -1,
          fine: event.altKey,
          shift: event.shiftKey,
          axis: null,
          anchored: false,
          length: null,
          frame,
          loop: {
            run,
            pass,
            splitTick: run.passes[pass].tick,
            slack: end === null ? (pass === 0 ? free : 0) : free,
            joins: joined?.count ?? null,
            room: end === null ? 0 : bodyRests(grabbed, played, end).ticks,
            ahead: passes.before,
            refused,
          },
          origin: 0,
          atX: event.clientX,
          atY: event.clientY,
        });
        return;
      }

      const strip = sources.strip();
      if (!strip) {
        return;
      }

      const { tick, row } = at(event, box);
      if (event.clientX - box.left < KEY_WIDTH || row < 0 || row >= sources.stack().lanes.length) {
        return;
      }

      // A reason given for a gesture that is over belongs to that gesture, and
      // the porter starting another has read it or has not.
      latched.set(null);

      const { index, instance } = itemAt(strip, sources.stack(), tick, row);

      // The pointer is **not** captured here, and the default is not prevented:
      // both of those stop the browser raising `click` and `dblclick` on the bar,
      // and those are how a note is inspected and how a double click goes to it
      // in the source. Capture is taken on the first move that is really a drag
      // (see `onPointerMove`), which is late enough to leave a click alone and
      // early enough to follow a drag off the edge of the roll.

      // The right button erases, as it does in FL: press to take one note away,
      // drag to sweep a run of them. It captures at once, having no click to
      // protect, and its own menu is stopped by `contextmenu`.
      if (event.button === 2) {
        (event.currentTarget as Element).setPointerCapture(event.pointerId);
        event.preventDefault();
        drag.set({
          kind: 'erase',
          fromTick: tick,
          fromRow: row,
          tick,
          row,
          edge: 'end',
          item: index,
          moved: false,
          copy: false,
          additive: false,
          sounded: -1,
          fine: event.altKey,
          shift: event.shiftKey,
          axis: null,
          anchored: false,
          length: null,
          frame: index >= 0 ? strip.items[index].frame : 0,
          origin: 0,
          loop: null,
          atX: event.clientX,
          atY: event.clientY,
        });
        if (index >= 0) {
          // Names the channel first, as the left button does: with none picked,
          // the strip is the channel under the pointer, and an erase is as much
          // a gesture on that channel as a drag is.
          sinks.pick(strip.channel);
          erase(index);
        }

        return;
      }

      if (index < 0) {
        // A bar of some *other* channel is not empty grid, whatever this
        // channel's strip says: the click belongs to that bar, which names its
        // channel and asks the inspector about its note, exactly as it did
        // before the roll could be drawn on.
        if ((event.target as Element | null)?.closest('.mark')) {
          return;
        }

        // Ctrl on empty grid is the marquee; a plain press draws a note. A
        // press inside a loop's pass draws into the body — the note will play
        // on every pass, and the ghost's siblings say so before it lands.
        const kind = event.ctrlKey || event.metaKey ? 'marquee' : 'spawn';
        const covering = kind === 'spawn' ? frameAt(strip, tick) : { frame: 0, base: 0 };
        const started: Drag = {
          kind,
          fromTick: tick,
          fromRow: row,
          tick,
          row,
          edge: 'end',
          item: -1,
          moved: false,
          copy: false,
          additive: false,
          sounded: row,
          fine: event.altKey,
          shift: event.shiftKey,
          axis: null,
          anchored: kind === 'spawn' && event.shiftKey,
          length: null,
          frame: covering.frame,
          origin: covering.base,
          loop: null,
          atX: event.clientX,
          atY: event.clientY,
        };

        if (kind === 'spawn') {
          soundDrag(started, row);
        }

        drag.set(started);
        return;
      }

      const item = strip.items[index];
      sinks.pick(strip.channel);

      // `Ctrl` on a bar is both "add this one to the selection" and "copy it
      // rather than move it", and which of the two it turns out to be is not
      // known until the pointer either moves or does not. So the press starts
      // an ordinary copy-drag and leaves the set exactly as it found it; the
      // pointer-up toggles the bar if the drag never happened.
      const additive = event.ctrlKey || event.metaKey;

      // A plain press selects the bar it landed on, so one click outlines one
      // note. A press on a note already in the selection leaves the set alone,
      // so a group still drags as a group; the pointer-up collapses it to the
      // one note if the press turns out to be a click.
      if (!additive && !selection().has(index)) {
        selection.set(new Set([index]));
      }

      // The clicked pass, not the first: its own tick decides the instrument,
      // volume and everything else the song has in force there, so `@0` and
      // `@17` recalls of one body sound as themselves. The origin is what turns
      // the frame's local ticks back into that pass's song ticks.
      const grabbed = item.instances[instance] ?? item.instances[0];
      const origin = grabbed !== undefined ? grabbed.tick - item.startTick : 0;

      const zoom = sources.zoom();
      const { left, right, zone } = edgesOf(item, tick - origin, zoom);
      const edge = left <= zone ? 'start' : right <= zone ? 'end' : null;
      // The bar's own tick and length: nothing has moved yet, and snapping here
      // would sound an off-grid note somewhere it has not been asked to go.
      soundRow(row, grabbed?.tick ?? item.startTick, item.ticks, grabbed?.note?.bend ?? item.slide);

      drag.set({
        kind: edge ? 'stretch' : 'move',
        fromTick: tick,
        fromRow: row,
        tick,
        row,
        edge: edge ?? 'end',
        item: index,
        moved: false,
        copy: additive,
        additive,
        sounded: row,
        fine: event.altKey,
        shift: event.shiftKey,
        axis: null,
        anchored: false,
        length: null,
        frame: item.frame,
        origin,
        loop: null,
        atX: event.clientX,
        atY: event.clientY,
      });
    },

    onPointerMove(event: PointerEvent, box: DOMRect): void {
      const strip = sources.strip();
      const { tick, row } = at(event, box);
      const held = drag();

      if (!held) {
        // Nothing is being dragged, so where the pointer is is all there is to
        // record; the cursor and the ghost are both read off it.
        const handle = (event.target as Element | null)?.closest('.loop-edge');
        hover.set({
          x: event.clientX - box.left,
          y: event.clientY - box.top,
          onMark: Boolean((event.target as Element | null)?.closest('.mark')),
          edge: handle ? (loopEnd(handle, tick, sources.zoom()) ?? 'slide') : null,
          marquee: event.ctrlKey || event.metaKey,
          fine: event.altKey,
        });
        return;
      }

      const moved =
        held.moved ||
        Math.abs(event.clientX - held.atX) > SLOP_PX ||
        Math.abs(event.clientY - held.atY) > SLOP_PX;

      // The moment a press becomes a drag, take the pointer — late enough to
      // have left `click` and `dblclick` alone, early enough to follow the drag
      // when it leaves the roll.
      if (moved && !held.moved) {
        const target = event.currentTarget as Element;
        if (!target.hasPointerCapture(event.pointerId)) {
          target.setPointerCapture(event.pointerId);
        }
      }

      const axis =
        held.axis ??
        (moved
          ? Math.abs(event.clientX - held.atX) >= Math.abs(event.clientY - held.atY)
            ? 'x'
            : 'y'
          : null);
      const next: Drag = {
        ...held,
        // A press on a loop box's top or bottom rule is not yet either of the
        // things it can be, and the axis is what says which: sideways it slides
        // the grabbed pass along the song, up or down it transposes the whole
        // body. Settled once, where the axis latches, so a drag that wanders off
        // the diagonal keeps the edit it started.
        kind: held.kind === 'gap' && axis === 'y' ? 'transpose' : held.kind,
        tick,
        row,
        moved,
        fine: event.altKey,
        shift: event.shiftKey,
        axis,
      };
      if (held.kind === 'erase') {
        drag.set(next);
        const under = strip ? itemAt(strip, sources.stack(), tick, row).index : -1;
        if (under >= 0) {
          erase(under);
        }

        return;
      }

      // A drag sounds the note again each time it changes row, and never more
      // often than that: one render is a whole silent run of the song. An edge
      // drag carries a construct, which is nothing one note could sound — and a
      // transposed body is a whole set of them, which is no more one note. A
      // carried selection sounds the note under the pointer: the group moves by
      // one delta, so that note names the interval every other note took.
      if (
        row !== held.sounded &&
        held.kind !== 'marquee' &&
        held.kind !== 'stretch' &&
        held.kind !== 'gap' &&
        held.kind !== 'resize' &&
        held.kind !== 'transpose'
      ) {
        next.sounded = row;
        soundDrag(next, row);
      }

      drag.set(next);
    },

    onPointerUp(event: PointerEvent): void {
      const held = drag();
      const target = event.currentTarget as Element;
      if (target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }

      if (!held) {
        return;
      }

      if (held.kind === 'marquee') {
        commitMarquee(held);
        drag.set(null);
        return;
      }

      if (held.kind === 'erase') {
        drag.set(null);
        return;
      }

      // The two edge drags that write the construct itself land here: the
      // click's whole job was done at the press — the group is the selection and
      // the pass has sounded — and a drag writes what it held, through the same
      // clamp the preview showed. A transpose is an ordinary plan over the
      // body's notes and goes out through `finish` with the rest.
      if (held.kind === 'gap' || held.kind === 'resize') {
        const delta = held.kind === 'gap' ? gapDelta() : resizeDelta();
        const clamped = held.kind === 'resize' ? refusal() : null;
        const loop = held.loop;
        const strip = sources.strip();
        drag.set(null);
        if (!held.moved || !loop) {
          return;
        }

        if (loop.refused !== null) {
          latched.set({ reason: loop.refused, source: sources.source() });
          return;
        }

        if (delta === 0 || !strip) {
          // A resize the clamp pinned at nothing has a reason, and it is worth
          // more once the pointer is up than while it was moving: the gesture
          // snapped back, and nothing else would say why.
          if (clamped !== null) {
            latched.set({ reason: clamped, source: sources.source() });
          }

          return;
        }

        const context = contextFor(strip, strip.frames[0]);
        const outcome =
          held.kind === 'gap'
            ? openGap(context, held.item, loop.run, loop.pass, delta)
            : resizeLoop(
                context,
                held.item,
                strip.frames[held.frame],
                loop.splitTick,
                held.edge,
                delta,
              );
        if (!isEdits(outcome)) {
          latched.set({ reason: outcome.refused, source: sources.source() });
          return;
        }

        latched.set(null);
        if (outcome.length > 0) {
          // No anchors: neither of these goes through a `Plan`, and
          // `resizeLoop` moves the brackets, so notes cross into and out of the
          // body and the ordinals they have now are not the ones the next strip
          // gives them. The change to the document is what drops the selection.
          sinks.commit(outcome);
        }

        return;
      }

      // A press that never became a drag is a **click**, and a click on a note
      // belongs to the bar: it selects that note alone, names the channel, asks
      // the inspector about it, and a second one goes to it in the source.
      // Committing a move of nowhere would only be an undo step that changes
      // nothing. Two exceptions — a click on empty grid is how a note is drawn
      // at all, and a press the wheel has resized has something to commit even
      // though the pointer never went anywhere.
      if (!held.moved && held.kind !== 'spawn' && held.length === null) {
        if (held.additive) {
          this.toggle(held.item);
        } else {
          selection.set(new Set([held.item]));
        }

        // The note clicked is the note the next one is drawn the length of, as
        // it is in FL: picking a note up is how its length is picked up too.
        const item = sources.strip()?.items[held.item];
        if (item) {
          sinks.rememberLength(item.ticks);
        }

        drag.set(null);
        return;
      }

      finish();
    },

    onPointerLeave(): void {
      hover.set(null);
    },

    stepLength(direction: number, fine: boolean): boolean {
      const held = drag();
      // An edge press has no one note the wheel could be sizing, whichever of
      // the three things it has become.
      if (!held || held.kind === 'gap' || held.kind === 'resize' || held.kind === 'transpose') {
        return false;
      }

      // A note being drawn is sized from the length it was drawn at. A note the
      // press landed on is sized from its own, and only while that press has not
      // moved: `planGesture` takes one gesture, so a note carried *and* resized
      // is two, and the pointer is already saying which one it means. Once the
      // wheel has spoken the press is a stretch of the note's far end and stays
      // one, however far the pointer wanders afterwards.
      const item = sources.strip()?.items[held.item];
      const sizable =
        held.kind === 'spawn'
          ? sources.lastLength()
          : (held.kind === 'move' || held.kind === 'stretch') && !held.moved && item
            ? item.ticks
            : null;
      if (sizable === null) {
        return false;
      }

      // `fine` is the wheel's own `Alt` rather than `held.fine`, which is only
      // refreshed by a pointer move — and it is not written back, so sizing a
      // note by ticks leaves the start it was pressed on where the porter put it.
      const now = held.length ?? sizable;
      const next = fine ? Math.max(1, now + direction) : stepDrawLength(now, direction);

      // No audition. A note is sounded on the press and on each change of row,
      // and one of those is a whole silent run of the song; one per notch of the
      // wheel would be a queue of them arriving long after the wheel stopped.
      drag.set(
        held.kind === 'spawn'
          ? { ...held, length: next }
          : { ...held, kind: 'stretch', edge: 'end', length: next },
      );
      return true;
    },

    run(gesture: Gesture): void {
      const strip = sources.strip();
      if (!strip) {
        return;
      }

      // A gesture that moves no tick may span brackets — a delete, and the
      // transpose the arrow keys run over a group a loop box's rule widened. It
      // is planned once per frame and the splices land as one commit, which is
      // one undo step; anything that moves a tick stays one plan over one frame
      // and is refused there in its own words.
      const first = 'items' in gesture ? gesture.items[0] : undefined;
      const held = first !== undefined ? (strip.items[first]?.frame ?? 0) : 0;
      const parts = planFrames(strip, gesture, sources.editMode(), held);
      const edits = write(strip, parts);
      if (edits && edits.length > 0) {
        carry(strip, parts);
        sinks.commit(edits);
      }
    },

    sourceChanged(keepsNotes: boolean): void {
      if (!keepsNotes) {
        selection.set(new Set<number>());
      }
    },

    /**
     * Consumed whichever way it goes — a second strip is a second edit, and the
     * plan spoke for one. The channel is checked because a strip is rebuilt for
     * whichever channel is being edited, and with none picked that is the one
     * under the pointer: a turnover the pointer caused is not the one the commit
     * did.
     */
    restoreSelection(strip: Strip): void {
      const held = pending;
      pending = null;
      if (held?.channel === strip.channel) {
        selection.set(notesAtAnchors(strip, held.anchors));
      }
    },

    selectAll(): void {
      const strip = sources.strip();
      if (!strip) {
        return;
      }

      const all = new Set<number>();
      strip.items.forEach((item, index) => {
        if (item.kind === 'note' && item.instances.length > 0) {
          all.add(index);
        }
      });
      selection.set(all);
    },

    clearSelection(): void {
      // The anchors go too: Escape, a channel change and a mute all say this is
      // not the subject any more, and a carried restore would put it back.
      pending = null;
      selection.set(new Set<number>());
    },

    toggle(item: number): void {
      selection.update((held) => {
        const next = new Set(held);
        if (!next.delete(item)) {
          next.add(item);
        }

        return next;
      });
    },
  };

  return api;

  /** The right button's delete of one note: the keyboard's, aimed by the pointer. */
  function erase(index: number): void {
    api.run({ kind: 'delete', items: [index] });
  }

  function commitMarquee(held: Drag): void {
    const strip = sources.strip();
    if (!strip) {
      return;
    }

    const stack = sources.stack();
    const from = Math.min(held.fromTick, held.tick);
    const to = Math.max(held.fromTick, held.tick);
    const top = Math.min(held.fromRow, held.row);
    const bottom = Math.max(held.fromRow, held.row);

    const inside = new Set<number>();
    // The ticks the notes it caught actually cover, which is what the porter
    // asked to hear — the box's own edges are wherever the pointer stopped.
    let low = Number.POSITIVE_INFINITY;
    let high = 0;
    strip.items.forEach((item, index) => {
      if (item.kind !== 'note') {
        return;
      }

      const row = rowOfItem(item, stack);
      if (row < top || row > bottom) {
        return;
      }

      // Any pass inside the box selects the note — the box is drawn in song
      // ticks and a looped note is wherever its instances are.
      for (const each of item.instances) {
        if (each.tick + item.ticks > from && each.tick < to) {
          inside.add(index);
          low = Math.min(low, each.tick);
          high = Math.max(high, each.tick + item.ticks);
        }
      }
    });

    selection.set(inside);
    if (inside.size > 0) {
      sinks.auditionSpan(low, high - low);
    }
  }
}

/**
 * What the pointer should look like where it is, which is `onPointerDown`'s own
 * decision tree read back: a press does what the cursor says it will.
 *
 * `edgesOf` is the same call the press makes, so the `ew-resize` and the stretch
 * cover the same pixels by construction rather than by two constants agreeing.
 */
function hoverCursor(
  strip: Strip | null,
  stack: LaneStack,
  zoom: number,
  tick: number,
  row: number,
  offsetX: number,
  onMark: boolean,
): string {
  if (!strip || offsetX < KEY_WIDTH || row < 0) {
    return 'default';
  }

  const { index, instance } = itemAt(strip, stack, tick, row);
  if (index < 0) {
    // A bar of another channel is not empty grid: a press there names its
    // channel and asks the inspector about its note, and draws nothing. Neither
    // does one on the noise lane, which is no pitch a note can be written on.
    if (onMark) {
      return 'pointer';
    }

    return pitchOfRow(stack, row) === null ? 'default' : 'crosshair';
  }

  const item = strip.items[index];
  const origin = (item.instances[instance]?.tick ?? item.startTick) - item.startTick;
  const { left, right, zone } = edgesOf(item, tick - origin, zoom);
  return left <= zone || right <= zone ? 'ew-resize' : 'grab';
}

/**
 * A length as the bubble says it — `d16` for one note, `16` for a group.
 *
 * The note's own text, spelled the way `roll-edit.ts` spells it at commit, so
 * the readout during a gesture is what will be written at the end of it: a `c`
 * for a drum, whose letter has no say in the byte, and `=37` where the duration
 * has no name of its own. Not an `l`, which the roll never writes and which
 * cannot take a `=` below `#amk 4` anyway.
 *
 * The letter belongs to `touched[0]`, so a stretch of several notes drops it and
 * says the length alone: they all take that length, and only one of them is a
 * `d`. The octave is left off — `noteText` writes one only where the octave in
 * force differs, which is not settled until the splice, and the row the bubble
 * sits on says the pitch already.
 */
function lengthLabel(note: PlacedNote, version: number, alone: boolean): string {
  const spelled = spellDuration(note.ticks, version);
  if (spelled === null) {
    return `${note.ticks} ticks`;
  }

  if (!alone) {
    return spelled;
  }

  const octave = note.drum === null ? octaveFor(note.written) : null;
  const head = note.drum !== null ? 'c' : octave === null ? null : spellNote(note.written, octave);
  return `${head ?? ''}${spelled}`;
}
