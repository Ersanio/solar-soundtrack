import { type Signal, computed, signal } from '@angular/core';

import { NOTE_MIN } from '@amk/core/hardcoded-tables';
import { octaveFor, spellDuration, spellNote } from '@amk/core/mml-text';
import type { PitchSlide } from '@amk/spc/song-walk';
import type { Command } from '@amk/tokens';
import type { Edit } from '@amk/tokens/edits';
import type { LaneStack } from './roll-layout';
import { rowAtY, tickAtX } from './roll-layout';
import { snapDuration, snapTick, stepDrawLength } from './roll-lengths';
import { type Preview, type PreviewBar, buildPreview, rowOfPlaced } from './roll-preview';
import { KEY_WIDTH, NOTE_GAP, barRect } from './roll-metrics';
import {
  type EditContext,
  type EditMode,
  type Gesture,
  type PlacedNote,
  type Plan,
  REFUSE_CLASH,
  isEdits,
  planGesture,
  plannedFrameTicks,
} from './roll-edit';
import { type ChannelTail, type Strip, type StripFrame, type StripItem } from './roll-strip';
import { planEdits } from './roll-write';

/**
 * Where each channel's shift steps up by one more `delta` while a body-length
 * edit is held: the pass **ends** of the edited body, ascending per voice. A
 * mark moves by `delta` times the boundaries at or before its tick. Stable from
 * the press — only the delta changes per move, so the buckets built over these
 * hold still and one transform slides them.
 */
export type ShiftBoundaries = ReadonlyMap<number, readonly number[]>;

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
function edgesOf(
  item: StripItem,
  tick: number,
  zoom: number,
): { left: number; right: number; zone: number } {
  const width = Math.max(1, item.ticks * zoom - NOTE_GAP);
  return {
    left: (tick - item.startTick) * zoom,
    right: (item.startTick + item.ticks - tick) * zoom - NOTE_GAP,
    zone: Math.min(EDGE_PX, Math.max(2, width / 3)),
  };
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
  /** Name the channel a bar belongs to, as a click on a note already does. */
  pick: (channel: number) => void;
}

/** What the pointer is doing between down and up. */
interface Drag {
  kind: 'move' | 'stretch' | 'spawn' | 'marquee' | 'erase';
  /** Where it started, in ticks and rows. */
  fromTick: number;
  fromRow: number;
  /** Where it is now. */
  tick: number;
  row: number;
  /** For a stretch, which end is being pulled. */
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
   * The press grabbed a loop box's edge, so the selection it set is the body's
   * whole group: a click keeps it as the answer rather than collapsing it to
   * the anchor note, and the wheel sizes nothing.
   */
  group: boolean;
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
  /** Over a loop box's edge, which a press grabs as the whole group's handle. */
  onEdge: boolean;
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
  /** What to draw over the song right now, or `null` when nothing is happening. */
  preview: Signal<Preview | null>;
  /** The notes the preview is already drawing, by their index in the strip. */
  moving: Signal<ReadonlySet<number>>;
  /** The edited body's pass ends per voice, or `null` outside a body gesture. */
  shiftBoundaries: Signal<ShiftBoundaries | null>;
  /** The held body-length change, which everything downstream slides by per boundary passed. */
  shiftDelta: Signal<number>;
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

/**
 * The frame a press on empty grid belongs to: the deepest body whose pass holds
 * the tick, else the root. `base` is that pass's own start, which is what turns
 * a song tick into the frame's local one.
 */
function frameAt(strip: Strip, tick: number): { frame: number; base: number } {
  let found = { frame: 0, base: 0 };
  let depth = Number.POSITIVE_INFINITY;
  strip.frames.forEach((frame, at) => {
    if (frame.body < 0) {
      return;
    }

    for (const run of frame.runs) {
      for (const pass of run.passes) {
        if (tick >= pass.tick && tick < pass.tick + pass.ticks && frame.ticks < depth) {
          found = { frame: at, base: pass.tick };
          depth = frame.ticks;
        }
      }
    }
  });

  return found;
}

function rowOfItem(item: StripItem, stack: LaneStack): number {
  return rowOfPlaced({ written: item.written, drum: item.drum?.args[0]?.value ?? null }, stack);
}

export function rollGestures(sources: GestureSources, sinks: GestureSinks): RollGestures {
  const selection = signal<ReadonlySet<number>>(new Set<number>());
  const drag = signal<Drag | null>(null);
  const hover = signal<Hover | null>(null);

  /** The gesture the pointer is describing, or `null` when it is not describing one. */
  const gestureNow = computed<Gesture | null>(() => {
    const held = drag();
    const strip = sources.strip();
    if (!held || !strip || held.kind === 'marquee' || held.kind === 'erase') {
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

  const plan = computed<Plan | null>(() => {
    const strip = sources.strip();
    const gesture = gestureNow();
    const held = drag();
    return strip && gesture && held
      ? planGesture(strip, gesture, sources.editMode(), strip.frames[held.frame])
      : null;
  });

  /**
   * The plan as far as the porter is concerned: nothing until a press has
   * actually become a drag.
   *
   * A press on a note that turns out to be a click would otherwise flash a bar
   * over the note it is standing on. Two exceptions: drawing, where "in the
   * dragged state" means the new note is there from the press, and a press the
   * wheel has resized, which has something to show and no movement to show it by.
   */
  const shownPlan = computed<Plan | null>(() => {
    const held = drag();
    return held && (held.moved || held.kind === 'spawn' || held.length !== null) ? plan() : null;
  });

  /** The frame the gesture runs in, or the root while nothing is held. */
  const heldFrame = computed<StripFrame | null>(() => {
    const strip = sources.strip();
    const held = drag();
    return strip && held ? strip.frames[held.frame] : null;
  });

  /**
   * The frame's tick change the plan asks for — the body-length edit's price,
   * by which every later pass and everything after the loop will move. 0 for a
   * root gesture, whose length change pads rather than shifts.
   */
  const frameDelta = computed<number>(() => {
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
    if (!frame || frame.body < 0) {
      return [{ tick: 0, ordinal: 0 }];
    }

    const flat = frame.runs
      .flatMap((run) => run.passes.map((pass) => ({ tick: pass.tick, channel: run.channel })))
      .sort((a, b) => a.tick - b.tick);
    const seen = new Map<number, number>();
    return flat.map((pass) => {
      const ordinal = seen.get(pass.channel) ?? 0;
      seen.set(pass.channel, ordinal + 1);
      return { tick: pass.tick, ordinal };
    });
  });

  /**
   * The edited body's pass ends per voice, or `null` outside a body gesture.
   * Depends on the held frame alone, so the buckets built over it are dealt
   * once per gesture rather than once per pointer move.
   */
  const shiftBoundaries = computed<ShiftBoundaries | null>(() => {
    const frame = heldFrame();
    if (!frame || frame.body < 0) {
      return null;
    }

    const boundaries = new Map<number, number[]>();
    for (const run of frame.runs) {
      const ends = boundaries.get(run.channel) ?? [];
      for (const pass of run.passes) {
        ends.push(pass.tick + pass.ticks);
      }

      boundaries.set(run.channel, ends);
    }

    for (const ends of boundaries.values()) {
      ends.sort((a, b) => a - b);
    }

    return boundaries;
  });

  const preview = computed<Preview | null>(() => {
    const held = shownPlan();
    if (!held) {
      return null;
    }

    // A length change stands the whole body's bars aside (see {@link moving}),
    // so the ones the gesture did not touch are drawn here instead — striped,
    // the mark of a note moved as a consequence rather than by the hand.
    const delta = frameDelta();
    let shown = held;
    if (delta !== 0) {
      const drawn = new Set([...held.touched, ...held.pushed]);
      const carried = held.notes.filter((note) => !drawn.has(note));
      shown = { ...held, pushed: [...held.pushed, ...carried] };
    }

    return buildPreview({
      plan: shown,
      stack: sources.stack(),
      zoom: sources.zoom(),
      rowHeight: sources.rowHeight(),
      rows: sources.stack().lanes.length,
      passes: heldPasses(),
      delta,
    });
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
    for (const note of shownPlan()?.touched ?? []) {
      if (note.from >= 0) {
        carried.add(note.from);
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
    if (!at || !strip || drag() || at.onMark || at.onEdge || at.marquee) {
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
      return held.kind === 'stretch' || held.anchored
        ? 'ew-resize'
        : held.kind === 'move'
          ? 'grabbing'
          : 'crosshair';
    }

    const at = hover();
    if (!at) {
      return 'default';
    }

    // A loop box's edge is the group's handle, and says so the way a bar's
    // middle does.
    if (at.onEdge) {
      return 'grab';
    }

    const stack = sources.stack();
    const zoom = sources.zoom();
    const row = rowAtY(at.y, sources.rowHeight(), stack.lanes.length);
    const tick = tickAtX(at.x, sources.viewTick(), zoom);
    return hoverCursor(sources.strip(), stack, zoom, tick, row, at.x, at.onMark);
  });

  /** True once a gesture is really under way, so the hover tooltip stands aside. */
  const busy = computed(() => shownPlan() !== null);

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
    const now = shownPlan();
    if (now !== null) {
      // A gesture in flight answers for itself. The clash is spelled out here
      // rather than carried in the plan because `planGesture` reports it as ticks
      // for the roll to wash red; `planEdits` gives the same sentence at the
      // commit, and this is it while the pointer is still down.
      return now.refused ?? (now.clashes.length > 0 ? REFUSE_CLASH : null);
    }

    const held = latched();
    return held !== null && held.source === sources.source() ? held.reason : null;
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
   * `finish` remembers the length it drew and drops the selection, `erase` does
   * neither.
   */
  const write = (strip: Strip, frame: StripFrame, now: Plan): readonly Edit[] | null => {
    const outcome = planEdits(contextFor(strip, frame), now);
    if (!isEdits(outcome)) {
      latched.set({ reason: outcome.refused, source: sources.source() });
      return null;
    }

    latched.set(null);
    return outcome;
  };

  const finish = (): void => {
    const strip = sources.strip();
    const now = plan();
    const held = drag();
    drag.set(null);
    if (!strip || !now || !held) {
      return;
    }

    const edits = write(strip, strip.frames[held.frame], now);
    if (edits && edits.length > 0) {
      if (now.touched.length > 0) {
        sinks.rememberLength(now.touched[0].ticks);
      }

      sinks.commit(edits);
      selection.set(new Set<number>());
    }
  };

  return {
    selection: selection.asReadonly(),
    preview,
    moving,
    shiftBoundaries,
    shiftDelta: frameDelta,
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

      // A loop box's edge is the group's handle: a press names the channel,
      // selects the body's whole group — that group and nothing else — and
      // holds it as a move, so keeping the button down drags every note of the
      // loop at once and letting go without moving is the selection. Before the
      // strip guard, because the edge may be another channel's and naming it is
      // what makes that channel's strip the one to read.
      const handle =
        event.button === 0 ? (event.target as Element | null)?.closest('.loop-edge') : null;
      if (handle) {
        sinks.pick(Number(handle.getAttribute('data-channel')));
        const grabbed = sources.strip();
        const body = Number(handle.getAttribute('data-body'));
        const frame = grabbed?.frames.findIndex((each) => each.body === body) ?? -1;
        if (!grabbed || frame < 0) {
          return; // The channel is named; a channel that cannot edit selects nothing.
        }

        const group = new Set<number>();
        for (let index = grabbed.frames[frame].from; index < grabbed.frames[frame].to; index++) {
          const item = grabbed.items[index];
          if (item.kind === 'note' && item.instances.length > 0) {
            group.add(index);
          }
        }

        const anchor = group.values().next();
        if (anchor.done) {
          return;
        }

        latched.set(null);
        selection.set(group);
        const { tick, row } = at(event, box);
        drag.set({
          kind: 'move',
          fromTick: tick,
          fromRow: row,
          tick,
          row,
          edge: 'end',
          item: anchor.value,
          moved: false,
          copy: event.ctrlKey || event.metaKey,
          additive: false,
          sounded: row,
          fine: event.altKey,
          shift: event.shiftKey,
          axis: null,
          anchored: false,
          length: null,
          frame,
          origin: Number(handle.getAttribute('data-tick')),
          group: true,
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
          group: false,
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
          group: false,
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
        group: false,
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
        hover.set({
          x: event.clientX - box.left,
          y: event.clientY - box.top,
          onMark: Boolean((event.target as Element | null)?.closest('.mark')),
          onEdge: Boolean((event.target as Element | null)?.closest('.loop-edge')),
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

      const next: Drag = {
        ...held,
        tick,
        row,
        moved,
        fine: event.altKey,
        shift: event.shiftKey,
        axis:
          held.axis ??
          (moved
            ? Math.abs(event.clientX - held.atX) >= Math.abs(event.clientY - held.atY)
              ? 'x'
              : 'y'
            : null),
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
      // often than that: one render is a whole silent run of the song.
      if (row !== held.sounded && held.kind !== 'marquee' && held.kind !== 'stretch') {
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

      // A press that never became a drag is a **click**, and a click on a note
      // belongs to the bar: it selects that note alone, names the channel, asks
      // the inspector about it, and a second one goes to it in the source.
      // Committing a move of nowhere would only be an undo step that changes
      // nothing. Two exceptions — a click on empty grid is how a note is drawn
      // at all, and a press the wheel has resized has something to commit even
      // though the pointer never went anywhere.
      if (!held.moved && held.kind !== 'spawn' && held.length === null) {
        // A click on a loop's edge already did its whole job at the press: the
        // group is the selection, and collapsing it to the anchor would undo it.
        if (held.group) {
          drag.set(null);
          return;
        }

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
      // A group press has no one note the wheel could be sizing.
      if (!held || held.group) {
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

      // A delete is the one gesture allowed to span brackets: it splits into a
      // plan per frame, and the splices land as one commit — one undo step.
      // Frames are disjoint text, so the pieces cannot overlap.
      if (gesture.kind === 'delete') {
        const byFrame = new Map<number, number[]>();
        for (const index of gesture.items) {
          const frame = strip.items[index]?.frame ?? 0;
          byFrame.set(frame, [...(byFrame.get(frame) ?? []), index]);
        }

        const all: Edit[] = [];
        for (const [which, items] of byFrame) {
          const frame = strip.frames[which];
          const now = planGesture(strip, { kind: 'delete', items }, sources.editMode(), frame);
          const edits = write(strip, frame, now);
          if (!edits) {
            return; // One frame refused, so nothing lands anywhere.
          }

          all.push(...edits);
        }

        if (all.length > 0) {
          sinks.commit(all.sort((a, b) => a.span.start - b.span.start));
          selection.set(new Set<number>());
        }

        return;
      }

      const first = 'items' in gesture ? gesture.items[0] : undefined;
      const frame = strip.frames[first !== undefined ? (strip.items[first]?.frame ?? 0) : 0];
      const now = planGesture(strip, gesture, sources.editMode(), frame);
      const edits = write(strip, frame, now);
      if (edits && edits.length > 0) {
        sinks.commit(edits);
        selection.set(new Set<number>());
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

  function erase(index: number): void {
    const strip = sources.strip();
    if (!strip) {
      return;
    }

    const frame = strip.frames[strip.items[index]?.frame ?? 0];
    const now = planGesture(strip, { kind: 'delete', items: [index] }, sources.editMode(), frame);
    const edits = write(strip, frame, now);
    if (edits && edits.length > 0) {
      sinks.commit(edits);
    }
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
      if (item.instances.some((each) => each.tick + item.ticks > from && each.tick < to)) {
        inside.add(index);
      }
    });

    selection.set(inside);
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
