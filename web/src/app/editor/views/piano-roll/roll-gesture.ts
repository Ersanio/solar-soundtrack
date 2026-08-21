import { type Signal, computed, signal } from '@angular/core';

import { NOTE_MIN } from '@amk/core/hardcoded-tables';
import { octaveFor, spellDuration, spellNote } from '@amk/core/mml-text';
import type { Edit } from '@amk/tokens/edits';
import type { LaneStack } from './roll-layout';
import { snapDuration, snapTick, stepDrawLength, tickAtX } from './roll-layout';
import { type Preview, buildPreview, rowOfPlaced } from './roll-marks';
import { KEY_WIDTH, NOTE_GAP } from './roll-metrics';
import {
  type EditContext,
  type EditMode,
  type Gesture,
  type PlacedNote,
  type Plan,
  committable,
  planEdits,
  planGesture,
} from './roll-edit';
import { type Strip, type StripItem } from './roll-strip';

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
 * two twelve-pixel zones on a sixteen-pixel bar would leave no way to move it.
 */
const EDGE_PX = 12;

/** Pointer movement below this is a click, not a drag. */
const SLOP_PX = 3;

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
  /** What an overlap does: refuse the gesture, or shift the notes in the way. */
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
  source: Signal<string>;
}

export interface GestureSinks {
  /** Commit a gesture. One call, one undo step. */
  commit: (edits: readonly Edit[]) => void;
  /** Remember the length the porter last drew or resized to. */
  rememberLength: (ticks: number) => void;
  /** Sound a note as written, at the tick and for the length it is being put on. */
  audition: (written: number, drum: number | null, tick: number, ticks: number) => void;
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
  /** The row last auditioned, so a drag sounds once per row rather than per pixel. */
  sounded: number;
  /** The pixel the press landed on, for the slop test. */
  atX: number;
  atY: number;
  /** `Alt` is down: tick precision, for this gesture only. */
  fine: boolean;
  /** The length a drawn note takes, once the wheel has said; `null` follows the setting. */
  length: number | null;
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
  /** The marquee box, in song coordinates. */
  marquee: Signal<{ x: number; y: number; w: number; h: number } | null>;
  /** The length readout that follows a stretch, as the volume slider's does. */
  bubble: Signal<{ text: string; x: number; y: number } | null>;
  /** What the pointer should look like where it is. */
  cursor: Signal<string>;
  /** True while a gesture is in flight, so the hover tooltip stands aside. */
  busy: Signal<boolean>;

  onPointerDown(event: PointerEvent, box: DOMRect): void;
  onPointerMove(event: PointerEvent, box: DOMRect): void;
  onPointerUp(event: PointerEvent): void;
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

/** Which strip item is under a tick and a row, or -1. */
function itemAt(strip: Strip, stack: LaneStack, tick: number, row: number): number {
  for (let index = 0; index < strip.items.length; index++) {
    const item = strip.items[index];
    if (item.kind !== 'note' || tick < item.startTick || tick >= item.startTick + item.ticks) {
      continue;
    }

    if (rowOfItem(item, stack) === row) {
      return index;
    }
  }

  return -1;
}

function rowOfItem(item: StripItem, stack: LaneStack): number {
  return rowOfPlaced({ written: item.written, drum: item.drum?.args[0]?.value ?? null }, stack);
}

export function rollGestures(sources: GestureSources, sinks: GestureSinks): RollGestures {
  const selection = signal<ReadonlySet<number>>(new Set<number>());
  const drag = signal<Drag | null>(null);

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
    // setting: a position lands on the tick under the pointer, and a length on
    // the tick count itself rather than the nearest note value.
    const fine = held.fine;

    if (held.kind === 'spawn') {
      // The new note follows the pointer, which is what "in the dragged state"
      // means: press, and it is already there; drag, and it goes where you drag.
      const pitch = pitchOfRow(stack, held.row);
      if (!pitch) {
        return null;
      }

      return {
        kind: 'spawn',
        startTick: Math.max(0, fine ? Math.round(held.tick) : snapTick(held.tick, snap)),
        ticks: held.length ?? sources.lastLength(),
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
      // duration and the porter is choosing one.
      const end = item.startTick + item.ticks;
      const wanted = held.edge === 'end' ? held.tick - item.startTick : end - held.tick;
      const length = fine
        ? Math.max(1, Math.round(wanted))
        : snapDuration(Math.max(1, Math.round(wanted)));
      return {
        kind: 'stretch',
        items,
        edge: held.edge,
        deltaTicks: held.edge === 'end' ? length - item.ticks : item.ticks - length,
      };
    }

    const wanted = item.startTick + (held.tick - held.fromTick);
    const startTick = fine ? Math.round(wanted) : snapTick(wanted, snap);
    return {
      kind: 'move',
      items,
      deltaTicks: startTick - item.startTick,
      deltaKeys: keysBetween(stack, held.fromRow, held.row),
      copy: held.copy,
    };
  });

  const plan = computed<Plan | null>(() => {
    const strip = sources.strip();
    const gesture = gestureNow();
    return strip && gesture ? planGesture(strip, gesture, sources.editMode()) : null;
  });

  /**
   * The plan as far as the porter is concerned: nothing until a press has
   * actually become a drag.
   *
   * A press on a note that turns out to be a click would otherwise flash a bar
   * over the note it is standing on. Drawing is the exception, and has to be:
   * "in the dragged state" means the new note is there from the press.
   */
  const shownPlan = computed<Plan | null>(() => {
    const held = drag();
    return held && (held.moved || held.kind === 'spawn') ? plan() : null;
  });

  const preview = computed<Preview | null>(() => {
    const held = shownPlan();
    return held
      ? buildPreview({
          plan: held,
          stack: sources.stack(),
          zoom: sources.zoom(),
          rowHeight: sources.rowHeight(),
          rows: sources.stack().lanes.length,
        })
      : null;
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

  const bubble = computed(() => {
    const held = drag();
    const now = shownPlan();
    if (!held || !now || now.touched.length === 0) {
      return null;
    }

    const note = now.touched[0];
    const version = sources.targetAMKVersion();
    const label =
      held.kind === 'move'
        ? `tick ${note.startTick}`
        : `${lengthLabel(note, version, now.touched.length === 1)} · ${note.ticks} ticks`;
    return {
      text: label,
      x: (note.startTick + note.ticks / 2) * sources.zoom(),
      y: rowOfPlaced(note, sources.stack()) * sources.rowHeight(),
    };
  });

  const cursor = signal('default');

  /** True once a gesture is really under way, so the hover tooltip stands aside. */
  const busy = computed(() => shownPlan() !== null);

  /** Where a pointer is, in the song's own terms. */
  const at = (event: PointerEvent, box: DOMRect): { tick: number; row: number } => {
    const tick = tickAtX(event.clientX - box.left, sources.viewTick(), sources.zoom());
    const row = Math.floor((event.clientY - box.top) / sources.rowHeight());
    return { tick, row };
  };

  const soundRow = (row: number, tick: number): void => {
    const pitch = pitchOfRow(sources.stack(), row);
    if (pitch) {
      const ticks = drag()?.length ?? sources.lastLength();
      sinks.audition(pitch.written, pitch.drum, Math.max(0, Math.round(tick)), ticks);
    }
  };

  const finish = (): void => {
    const strip = sources.strip();
    const now = plan();
    const held = drag();
    drag.set(null);
    if (!strip || !now || !held) {
      return;
    }

    if (!committable(now)) {
      return;
    }

    const edits = planEdits(
      {
        source: sources.source(),
        strip,
        targetAMKVersion: sources.targetAMKVersion(),
        songTargetProgram: sources.songTargetProgram(),
        playableTicks: sources.playableTicks(),
        introTicks: sources.introTicks(),
      } satisfies EditContext,
      now,
    );

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
    marquee,
    bubble,
    cursor: cursor.asReadonly(),
    busy,

    onPointerDown(event: PointerEvent, box: DOMRect): void {
      const strip = sources.strip();
      if (!strip || event.button > 2) {
        return;
      }

      const { tick, row } = at(event, box);
      if (event.clientX - box.left < KEY_WIDTH || row < 0 || row >= sources.stack().lanes.length) {
        return;
      }

      const index = itemAt(strip, sources.stack(), tick, row);

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
          sounded: -1,
          fine: event.altKey,
          length: null,
          atX: event.clientX,
          atY: event.clientY,
        });
        if (index >= 0) {
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

        // Ctrl on empty grid is the marquee; a plain press draws a note.
        const kind = event.ctrlKey || event.metaKey ? 'marquee' : 'spawn';
        if (kind === 'spawn') {
          soundRow(row, tick);
        }

        drag.set({
          kind,
          fromTick: tick,
          fromRow: row,
          tick,
          row,
          edge: 'end',
          item: -1,
          moved: false,
          copy: false,
          sounded: row,
          fine: event.altKey,
          length: null,
          atX: event.clientX,
          atY: event.clientY,
        });
        return;
      }

      const item = strip.items[index];
      sinks.pick(strip.channel);
      if (event.shiftKey) {
        this.toggle(index);
        return;
      }

      // A plain press selects the bar it landed on, so one click outlines one
      // note. A press on a note already in the selection leaves the set alone,
      // so a group still drags as a group; the pointer-up collapses it to the
      // one note if the press turns out to be a click.
      if (!selection().has(index)) {
        selection.set(new Set([index]));
      }

      const zoom = sources.zoom();
      const { left, right, zone } = edgesOf(item, tick, zoom);
      const edge = left <= zone ? 'start' : right <= zone ? 'end' : null;
      soundRow(row, item.startTick);

      drag.set({
        kind: edge ? 'stretch' : 'move',
        fromTick: tick,
        fromRow: row,
        tick,
        row,
        edge: edge ?? 'end',
        item: index,
        moved: false,
        copy: event.ctrlKey || event.metaKey,
        sounded: row,
        fine: event.altKey,
        length: null,
        atX: event.clientX,
        atY: event.clientY,
      });
    },

    onPointerMove(event: PointerEvent, box: DOMRect): void {
      const strip = sources.strip();
      const { tick, row } = at(event, box);
      const held = drag();

      if (!held) {
        // Nothing is being dragged, so the cursor is the only thing to update.
        cursor.set(
          hoverCursor(strip, sources.stack(), sources.zoom(), tick, row, event.clientX - box.left),
        );
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

      const next: Drag = { ...held, tick, row, moved, fine: event.altKey };
      if (held.kind === 'erase') {
        drag.set(next);
        const index = strip ? itemAt(strip, sources.stack(), tick, row) : -1;
        if (index >= 0) {
          erase(index);
        }

        return;
      }

      // A drag sounds the note again each time it changes row, and never more
      // often than that: one render is a whole silent run of the song.
      if (row !== held.sounded && held.kind !== 'marquee' && held.kind !== 'stretch') {
        next.sounded = row;
        soundRow(row, tick);
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
      // nothing. Drawing is the exception — a click on empty grid is how a note
      // is drawn at all.
      if (!held.moved && held.kind !== 'spawn') {
        selection.set(new Set([held.item]));
        drag.set(null);
        return;
      }

      finish();
    },

    stepLength(direction: number, fine: boolean): boolean {
      const held = drag();
      if (held?.kind !== 'spawn') {
        return false;
      }

      // `fine` is the wheel's own `Alt` rather than `held.fine`, which is only
      // refreshed by a pointer move — and it is not written back, so sizing a
      // note by ticks leaves the start it was pressed on where the porter put it.
      const now = held.length ?? sources.lastLength();
      const next = fine ? Math.max(1, now + direction) : stepDrawLength(now, direction);

      // No audition. A note is sounded on the press and on each change of row,
      // and one of those is a whole silent run of the song; one per notch of the
      // wheel would be a queue of them arriving long after the wheel stopped.
      drag.set({ ...held, length: next });
      return true;
    },

    run(gesture: Gesture): void {
      const strip = sources.strip();
      if (!strip) {
        return;
      }

      const now = planGesture(strip, gesture, sources.editMode());
      if (!committable(now)) {
        return;
      }

      const edits = planEdits(
        {
          source: sources.source(),
          strip,
          targetAMKVersion: sources.targetAMKVersion(),
          songTargetProgram: sources.songTargetProgram(),
          playableTicks: sources.playableTicks(),
          introTicks: sources.introTicks(),
        },
        now,
      );
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
        if (item.kind === 'note') {
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

    const now = planGesture(strip, { kind: 'delete', items: [index] }, sources.editMode());
    const edits = planEdits(
      {
        source: sources.source(),
        strip,
        targetAMKVersion: sources.targetAMKVersion(),
        songTargetProgram: sources.songTargetProgram(),
        playableTicks: sources.playableTicks(),
        introTicks: sources.introTicks(),
      },
      now,
    );
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

      if (item.startTick + item.ticks > from && item.startTick < to) {
        inside.add(index);
      }
    });

    selection.set(inside);
  }
}

/** What the pointer should look like where it is, which is what says a stretch exists. */
function hoverCursor(
  strip: Strip | null,
  stack: LaneStack,
  zoom: number,
  tick: number,
  row: number,
  offsetX: number,
): string {
  if (!strip || offsetX < KEY_WIDTH || row < 0) {
    return 'default';
  }

  const index = itemAt(strip, stack, tick, row);
  if (index < 0) {
    return 'crosshair';
  }

  const { left, right, zone } = edgesOf(strip.items[index], tick, zoom);
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
