import { type Signal, computed, inject } from '@angular/core';

import { TICKS_PER_WHOLE } from '@amk/core/hardcoded-tables';
import type { SongTimeline } from '@amk/spc/song-walk';
import { EditorStore } from '../../../state/editor-store';
import { PLAYHEAD_AT } from './roll-camera';
import { type CommandLane, laneWindow, packCommandLane } from './roll-command-layout';
import type { LaneStack } from './roll-layout';
import { gridLines, tickWindow } from './roll-layout';
import {
  type LoopLabel,
  type LoopRegionBox,
  type Mark,
  type MinimapBar,
  buildLoopLabels,
  buildLoopRegions,
  buildMarks,
  buildMinimap,
  followLoopRegions,
} from './roll-marks';
import type { PlaceContext } from './percussion';
import type { RollGestures } from './roll-gesture';
import type { TimeMark } from './roll-scrub/roll-scrub';
import { type Strip, constructFor } from './roll-strip';

export interface PictureSources {
  /** The walk, which every picture here is a reading of. */
  timeline: Signal<SongTimeline | null>;
  /** The lanes the marks are placed on, and how a note is placed on them. */
  stack: Signal<LaneStack>;
  context: Signal<PlaceContext>;
  /** Which channels can be heard, so a muted one is drawn behind or not at all. */
  audible: Signal<Map<number, boolean>>;
  /** The roll's geometry. */
  zoom: Signal<number>;
  rowHeight: Signal<number>;
  rollWidth: Signal<number>;
  songTicks: Signal<number>;
  /** The 10 Hz anchor the window is snapped around. */
  windowTick: Signal<number>;
  /** The porter's grid: beats in a bar over the note value that gets the beat. */
  beatsPerBar: Signal<number>;
  beatUnit: Signal<number>;
  /** The channel really picked, which is the only one a loop label is drawn for. */
  editChannel: Signal<number | null>;
  /** That channel as a strip, for reading a loop's own label off its text. */
  strip: Signal<Strip | null>;
  /** The gesture in flight, which the loop boxes follow. */
  gestures: RollGestures;
}

export interface RollPictures {
  /** The whole song drawn small, for the overview bar. */
  minimap: Signal<readonly MinimapBar[]>;
  /** The command lane, sliced to the window. */
  laneView: Signal<CommandLane>;
  /** The note bars on screen. */
  marks: Signal<readonly Mark[]>;
  /** The loop boxes, as the gesture in flight is leaving them. */
  shownLoopRegions: Signal<readonly LoopRegionBox[]>;
  /** The name a selected loop group's boxes carry. */
  loopLabels: Signal<readonly LoopLabel[]>;
  /** The porter's grid, drawn by the roll and numbered by the scrub bar. */
  lines: Signal<TimeMark[]>;
  /** Where the song loops back to, and where it ends, in the roll's own x. */
  loopX: Signal<number | null>;
  endX: Signal<number | null>;
}

/**
 * What the roll draws, as against what it is looking at.
 *
 * Every member is a `computed` and there are no sinks: a picture is a reading of
 * the compile and of where the camera is, and it changes nothing. They are
 * together because they share the **mark window** — one `tickWindow` snapped
 * outward to a whole note, so the DOM rebuilds about twice a screen rather than
 * once a frame — and a second one taken anywhere else would draw a different
 * span from the transform that scrolls it.
 *
 * It takes `rollGestures` as a source and so must be called **after** it: the
 * loop boxes follow the gesture in flight, which is what keeps a box round the
 * notes it is drawn round while they are being carried.
 */
export function rollPictures(sources: PictureSources): RollPictures {
  const editor = inject(EditorStore);

  /**
   * The whole song, drawn small — and deliberately not from the playhead, so
   * it rebuilds on a recompile, a percussion change, a mute or a resize and never
   * on a frame. Its rows come from the same `rowOf` the marks ask and its colours
   * from the same `CHANNEL_FILL`.
   */
  const minimap = computed(() =>
    buildMinimap({
      notes: sources.timeline()?.notes ?? [],
      stack: sources.stack(),
      context: sources.context(),
      ticks: sources.songTicks(),
      width: sources.rollWidth(),
      audible: sources.audible(),
    }),
  );

  /**
   * The whole song's commands, packed into rows — deliberately not windowed.
   *
   * Rows are dealt over the whole song so they hold still as the roll scrolls,
   * and this rebuilds on a recompile, a zoom or a mute and never on a frame. The
   * window is taken off it below, which is a slice rather than a second pack.
   */
  const commandLane = computed(() =>
    packCommandLane({
      events: editor.commandTimeline(),
      text: editor.source(),
      zoom: sources.zoom(),
      audible: sources.audible(),
      active: sources.editChannel(),
      songTicks: sources.songTicks(),
    }),
  );

  const window = computed(() =>
    tickWindow(sources.windowTick(), sources.rollWidth(), sources.zoom(), PLAYHEAD_AT),
  );

  const laneView = computed(() => {
    const { from, to } = window();
    return laneWindow(commandLane(), from, to, sources.zoom());
  });

  const marks = computed(() => {
    const { from, to } = window();
    return buildMarks({
      notes: sources.timeline()?.notes ?? [],
      stack: sources.stack(),
      context: sources.context(),
      from,
      to,
      zoom: sources.zoom(),
      rowHeight: sources.rowHeight(),
      audible: sources.audible(),
      inForce: editor.commandsInForce(),
    });
  });

  /**
   * The addresses the command map names. What tells a loop recall from its
   * declaration: a `]n`'s own `$E9` is the one dispatch `recordCommand` drops.
   */
  const mappedCommands = computed(
    () => new Set((editor.result()?.commandMap ?? []).map((entry) => entry.address)),
  );

  /** The loop structure behind the bars, on the mark window's own cadence. */
  const loopRegions = computed(() => {
    const { from, to } = window();
    const timeline = sources.timeline();
    return buildLoopRegions({
      loops: timeline?.loops ?? [],
      notes: timeline?.notes ?? [],
      stack: sources.stack(),
      context: sources.context(),
      from,
      to,
      zoom: sources.zoom(),
      rowHeight: sources.rowHeight(),
      ticks: timeline?.ticks ?? 0,
      audible: sources.audible(),
      mapped: mappedCommands(),
    });
  });

  /**
   * The boxes as the gesture in flight is leaving them: round where the notes
   * are going rather than where they were.
   *
   * A second pass over {@link loopRegions} rather than a rebuild — the walk over
   * every loop, pass and note is on the mark window's cadence and a pointer move
   * must not re-run it — and it hands back the very list it was given while
   * nothing is held.
   */
  const shownLoopRegions = computed(() =>
    followLoopRegions({
      regions: loopRegions(),
      rows: sources.gestures.bodyRows(),
      boundaries: sources.gestures.shiftBoundaries(),
      delta: sources.gestures.shiftDelta(),
      passes: sources.gestures.passShifts(),
      zoom: sources.zoom(),
      rowHeight: sources.rowHeight(),
    }),
  );

  /**
   * The name a selected loop group's boxes carry, over the bars rather than
   * under them — a second pass over {@link shownLoopRegions}, so a selection
   * changing does not rebuild the whole song's boxes, and a label travels with
   * the box it is written in the corner of.
   *
   * Off `editChannel` and not the roll's `editing`: a label appearing because the
   * pointer wandered over another channel's bar would be saying something about
   * the hover rather than about the selection.
   */
  const loopLabels = computed(() => {
    const channel = sources.editChannel();
    const strip = sources.strip();
    if (channel === null || !strip) {
      return [];
    }

    return buildLoopLabels({
      regions: shownLoopRegions(),
      channel,
      selected: sources.gestures.selectedBodies(),
      labelAt: (body, tick) => {
        const at = constructFor(strip, body, tick);
        return at < 0 ? null : (strip.items[at].loop?.label ?? null);
      },
    });
  });

  /**
   * The porter's grid, drawn by the roll and numbered by the scrub bar.
   *
   * One list for both, so a bar's number cannot land at an x its own rule is not
   * at. The number is the count of whole bars before it, from 1 at tick 0 — a
   * strong line is a bar's first beat by construction (`gridLines`), so the
   * division is exact and the rounding is only for the float.
   */
  const lines = computed((): TimeMark[] => {
    const beats = sources.beatsPerBar();
    if (beats === 0) {
      return []; // No grid asked for.
    }

    const { from, to } = window();
    const beatTicks = TICKS_PER_WHOLE / sources.beatUnit();
    const barTicks = beatTicks * beats;
    return gridLines(from, to, beatTicks, beats).map((line) => ({
      ...line,
      x: line.tick * sources.zoom(),
      bar: line.strong ? Math.round(line.tick / barTicks) + 1 : null,
    }));
  });

  const loopX = computed(() => {
    const loop = sources.timeline()?.loopTick;
    return loop === null || loop === undefined || loop === 0 ? null : loop * sources.zoom();
  });

  const endX = computed(() => {
    const ticks = sources.songTicks();
    return ticks > 0 ? ticks * sources.zoom() : null;
  });

  return { minimap, laneView, marks, shownLoopRegions, loopLabels, lines, loopX, endX };
}
