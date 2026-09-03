import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { NOTE_MIN } from '@amk/core/hardcoded-tables';
import {
  FIRST_CUSTOM_INSTRUMENT,
  FIRST_PERCUSSION_INSTRUMENT,
  NOISE_FLAG,
} from '@amk/spc/instruments';
import { elementSize } from '../../../shared/chart/element-size';
import { clamp } from '../../../util/math';
import { onChange } from '../../../util/on-change';
import { Audition } from '../../../state/audition';
import { DriverStore } from '../../../state/driver-store';
import { EditorRequests } from '../../../state/editor-requests';
import { EditorStore } from '../../../state/editor-store';
import { Mixer } from '../../../state/mixer';
import { Playback } from '../../../state/playback';
import { stopAll } from '../../../state/stop-all';
import { soleAudible } from '../../../state/transport-view';
import { PercussionPanel, percussionChips } from './percussion-panel/percussion-panel';
import { DEFAULT_PERCUSSION, type PlaceContext, rollShape } from './percussion';
import { rollCamera } from './roll-camera';
import { RollChannels } from './roll-channels/roll-channels';
import { RollGrid } from './roll-grid/roll-grid';
import { RollKeys } from './roll-keys/roll-keys';
import { RollLanes } from './roll-lanes/roll-lanes';
import type { EditMode } from './roll-edit';
import { RollEditLayer } from './roll-edit-layer/roll-edit-layer';
import { rollGestures } from './roll-gesture';
import { laneStack, tickAtX } from './roll-layout';
import { type Mark, heldRowsAt } from './roll-marks';
import { RollLoopLabels } from './roll-loops/roll-loop-labels';
import { RollLoops } from './roll-loops/roll-loops';
import { inspectable } from './roll-command-move';
import { RollCommandLane } from './roll-command-lane/roll-command-lane';
import { KEY_WIDTH, LANE_HEIGHT } from './roll-metrics';
import { CHANNEL_FILL, CHANNEL_STROKE } from '../../../util/channel-palette';
import { seedEdits } from './roll-seed';
import type { Strip } from './roll-strip';
import { RollNotes } from './roll-notes/roll-notes';
import { RollOverview } from './roll-overview/roll-overview';
import { RollScrub } from './roll-scrub/roll-scrub';
import {
  type Settings,
  type SnapName,
  clampLaneHeight,
  readSettings,
  resetPercussion,
  snapTicks,
  stepRowHeight,
  stepZoom,
  togglePercussion,
  writeSettings,
} from './roll-settings';
import { RollToolbar } from './roll-toolbar/roll-toolbar';
import { rollPictures } from './roll-pictures';
import { rollShortcut } from './roll-shortcuts';
import { rollTarget } from './roll-target';
import { rollView } from './roll-view';
import { RollTooltip } from './roll-tooltip/roll-tooltip';

/**
 * The song as music: a keyboard down the left, time running right, and all
 * eight channels in one roll.
 *
 * This holds the song's shape and the porter's settings, and hands what each
 * child draws to a component that draws one thing: the toolbar, the two bars
 * over the roll, the row stripes, the grid, the notes, the keys and the hover.
 * Four composables hold the rest — `roll-view.ts` the camera and the clock,
 * `roll-target.ts` what a gesture acts on, `roll-gesture.ts` the gesture itself
 * and `roll-pictures.ts` what is drawn. The flat `roll-*.ts` files beside them
 * are the arithmetic, Angular-free so that a harness can import it; the folders
 * beside them are the components.
 *
 * The bars are one job each. The overview is the song drawn small and moves the
 * **view**; the scrub bar is the roll's own timeline and moves the **song**.
 * Both are pointer reporters that emit an x and nothing else, because both
 * mappings need the camera.
 *
 * Two clocks drive it and keeping them apart is what makes it smooth. The mark
 * list is a `computed` over the transport's 10 Hz anchor, snapped to a whole
 * note, so the DOM rebuilds a couple of times per screen. The scroll is a
 * `computed` over the frame clock and is one `transform` — and it is a binding
 * *here*, above children that take no frame-rate input, so nothing beneath it
 * re-evaluates.
 */
@Component({
  selector: 'amk-piano-roll',
  imports: [
    PercussionPanel,
    RollChannels,
    RollCommandLane,
    RollEditLayer,
    RollGrid,
    RollKeys,
    RollLanes,
    RollLoopLabels,
    RollLoops,
    RollNotes,
    RollOverview,
    RollScrub,
    RollToolbar,
    RollTooltip,
  ],
  templateUrl: './piano-roll.html',
  host: {
    class: 'relative flex min-h-0 min-w-0 flex-col',
    // On the window rather than through a focusable element: these shortcuts
    // belong to the roll as a whole rather than to anything inside it. The
    // binding lives and dies with the roll, which `@case ('roll')` in
    // `editor-pane.html` destroys on a tab switch, so it is roll-only without a
    // check of its own.
    '(window:keydown)': 'onKey($event)',
  },
})
export class PianoRoll {
  private readonly editor = inject(EditorStore);
  private readonly drivers = inject(DriverStore);
  private readonly playback = inject(Playback);
  private readonly mixer = inject(Mixer);
  private readonly audition = inject(Audition);
  private readonly requests = inject(EditorRequests);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');
  private readonly size = elementSize(this.viewport);

  private readonly settings = signal<Settings>(readSettings());

  protected readonly zoom = computed(() => this.settings().zoom);
  protected readonly follow = computed(() => this.settings().follow);
  protected readonly scrollNotes = computed(() => this.settings().scrollNotes);
  protected readonly allOctaves = computed(() => this.settings().allOctaves);
  protected readonly beatsPerBar = computed(() => this.settings().beatsPerBar);
  protected readonly beatUnit = computed(() => this.settings().beatUnit);
  protected readonly percussionOpen = computed(() => this.settings().percussionOpen);
  protected readonly editChannel = computed(() => this.settings().editChannel);
  protected readonly snap = computed(() => this.settings().snap);
  protected readonly editMode = computed(() => this.settings().editMode);
  protected readonly snapTicks = computed(() =>
    snapTicks(this.settings().snap, this.beatsPerBar(), this.beatUnit()),
  );

  protected readonly timeline = computed(() => this.editor.timeline());

  /** The song's whole length, which the camera and both bars measure against. */
  protected readonly songTicks = computed(() => this.timeline()?.ticks ?? 0);

  /**
   * The driver's own note for each of `@21`-`@29`. Two uses, one map: it labels
   * a drum's lane, and it is the pitch a bare `$D0`-`$D8` falls back to when the
   * porter has taken that drum off the lanes.
   */
  private readonly drumNotes = computed(() => {
    const notes = new Map<number, number>();
    (this.drivers.instruments()?.percussion ?? []).forEach((entry, index) => {
      if (entry.note !== undefined) {
        notes.set(FIRST_PERCUSSION_INSTRUMENT + index, entry.note);
      }
    });

    return notes;
  });

  protected readonly percussion = computed(() => new Set(this.settings().percussion));

  /**
   * Which channels are heard, by index.
   *
   * One map for all three readers. `heldRows` recomputes on every frame of playback,
   * and building this inside it would rebuild eight entries sixty times a second
   * to answer a question that only changes when the mixer is touched.
   */
  private readonly audible = computed(
    () => new Map(this.mixer.channels().map((c) => [c.index, c.audible])),
  );

  /** The mixer's own state, for the chips to say what is muted and what is soloed. */
  protected readonly mixerChannels = this.mixer.channels;
  protected readonly silenced = this.mixer.silenced;

  /** Instrument numbers whose sample is noise, from the song's own entries. */
  private readonly noiseInstruments = computed(() => {
    const custom = this.timeline()?.customInstruments ?? [];
    const noisy = new Set<number>();
    custom.forEach((entry, index) => {
      if ((entry[0] & NOISE_FLAG) !== 0) {
        noisy.add(FIRST_CUSTOM_INSTRUMENT + index);
      }
    });

    return noisy;
  });

  /** Where each note was written, by the address the walk names it by. */
  private readonly written = computed(() => {
    const written = new Map<number, number>();
    for (const [address, entry] of this.editor.notesByAddress()) {
      written.set(address, entry.written);
    }

    return written;
  });

  /** One object per change of any input, rather than one per note. */
  protected readonly placeContext = computed<PlaceContext>(() => ({
    percussion: this.percussion(),
    noisy: this.noiseInstruments(),
    drumNotes: this.drumNotes(),
    written: this.written(),
  }));

  /** The rows the preference asks for, and the pitched range it leaves over. */
  private readonly shape = computed(() =>
    rollShape(this.timeline()?.notes ?? [], this.placeContext()),
  );

  protected readonly stack = computed(() => {
    const shape = this.shape();
    return laneStack({
      lowestKey: shape.lowestKey,
      highestKey: shape.highestKey,
      usedDrums: shape.usedDrums,
      usesNoise: shape.usesNoise,
      all: this.allOctaves(),
      drumNotes: this.drumNotes(),
    });
  });

  protected readonly lanes = computed(() => this.stack().lanes);

  /**
   * How tall a row is drawn.
   *
   * The toolbar's setting is a floor, not the answer. Fitting to the range the
   * song uses often leaves two octaves in a pane tall enough for six, and
   * twenty-four thin rows stranded at the top of an empty box is a worse
   * picture than twenty-four generous ones filling it — so the rows stretch to
   * take the height that is going. Past that the setting wins and the viewport
   * scrolls, which is what the control is for.
   */
  protected readonly rowHeight = computed(() => {
    const chosen = this.settings().rowHeight;
    const count = this.lanes().length;
    const available = this.size().height;
    return count > 0 && available > 0 ? Math.max(chosen, Math.floor(available / count)) : chosen;
  });

  protected readonly stackHeight = computed(() => this.lanes().length * this.rowHeight());
  protected readonly width = computed(() => this.size().width);
  protected readonly rollWidth = computed(() => Math.max(0, this.width() - KEY_WIDTH));

  /** Null until measured, so nothing renders against a zero-width box. */
  protected readonly viewBox = computed(() => {
    const width = this.width();
    return width > 0 ? `0 0 ${width} ${Math.max(1, this.stackHeight())}` : null;
  });

  protected readonly keyWidth = KEY_WIDTH;

  /** A label needs a row it can sit in without touching both edges. */
  protected readonly showLabels = computed(() => this.rowHeight() >= 11);
  protected readonly labelSize = computed(() => clamp(this.rowHeight() - 4, 7, 11));

  /**
   * The camera, the display clock and the geometry of the two bars over the
   * roll — see `roll-view.ts`. The Follow setting is written from there so that
   * coming off the song always parks the camera first.
   */
  protected readonly view = rollView(
    {
      zoom: this.zoom,
      follow: this.follow,
      scrollNotes: this.scrollNotes,
      songTicks: this.songTicks,
      width: this.width,
      rollWidth: this.rollWidth,
    },
    {
      writeFollow: (follow) => {
        this.settings.update((s) => ({ ...s, follow }));
      },
    },
  );

  // --- the command lane ----------------------------------------------------

  /** How tall the lane is drawn, which the seam above it sets. */
  protected readonly laneHeight = computed(() => this.settings().laneHeight);

  /** Null until measured, so nothing renders against a zero-width box. */
  protected readonly laneBox = computed(() => {
    const width = this.width();
    return width > 0 ? `0 0 ${width} ${this.laneHeight()}` : null;
  });

  protected readonly laneResizing = signal(false);

  /**
   * The height the lane was at when the drag started, with the pointer's y.
   *
   * Measured once: nothing can move the seam mid-gesture, and re-reading the
   * setting per `pointermove` would compound the rounding `clampLaneHeight` does
   * — a drag of half a pixel a frame would then never move it at all.
   */
  private laneGrab: { height: number; y: number } | null = null;

  /**
   * The seam above the lane, dragged upwards to make the lane taller.
   *
   * The same shape as the shell's own splitter (`app.ts`): the pointer is
   * captured so the drag survives leaving the one-pixel line, which it does at
   * once, and `pointermove` and `pointerup` are bound on the seam itself rather
   * than on the document, so there is nothing to unsubscribe.
   */
  protected onLaneGrab(event: PointerEvent): void {
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    this.laneGrab = { height: this.laneHeight(), y: event.clientY };
    this.laneResizing.set(true);
    event.preventDefault(); // Or the press starts a selection in the pane above.
  }

  protected onLaneResize(event: PointerEvent): void {
    if (!this.laneGrab) {
      return;
    }

    // Up is taller, the lane hanging below the seam.
    const height = this.laneGrab.height + (this.laneGrab.y - event.clientY);
    this.settings.update((s) => ({ ...s, laneHeight: clampLaneHeight(height) }));
  }

  protected onLaneRelease(): void {
    this.laneGrab = null;
    this.laneResizing.set(false);
  }

  /** A double click on the seam puts the lane back to the five rows it opens at. */
  protected resetLaneHeight(): void {
    this.settings.update((s) => ({ ...s, laneHeight: LANE_HEIGHT }));
  }

  /**
   * The command the inspector is answering about: the roll's selected command.
   *
   * Every route to it lands here, because they all move the caret — a glyph in
   * the lane, a chip on a bar, and a button in the note inspector all set
   * `EditorRequests.reveal`, and the caret is the one statement of what is being
   * inspected. So nothing here needs to know which of the three was used.
   *
   * Dismissed the way the inspector is dismissed, since what it stands for is
   * that panel: a ring that outlived it would be pointing at nothing.
   *
   * Held here rather than in each layer because three things read it — the lane
   * rings it, the bars ring it, and `onKey` deletes it and lets it go — and two
   * of those are drawn in the same gesture. One signal is what stops them
   * disagreeing.
   *
   * Only a command the roll draws (`inspectable`). A note is a `Command` too and
   * a click on a bar puts the caret on it, so the caret alone would hand `Delete`
   * the note itself — and an `o` or an `l` under the caret, which nothing rings.
   */
  protected readonly inspectedCommand = computed(() => {
    const command = this.editor.commandAtCaret();
    return command !== null &&
      inspectable(command) &&
      this.requests.dismissed() !== this.editor.caret()
      ? command
      : null;
  });

  // --- keyboard ------------------------------------------------------------

  /**
   * The rows sounding right now, from the timeline rather than the driver's
   * pointers.
   *
   * It is the only source that yields a pitch — the note map holds none — and
   * deriving the bar, the playhead and the lit key from one number is what stops
   * them disagreeing on screen. The honesty test is `playheadSpans`': if the
   * editor is not showing the text that is playing, light nothing.
   */
  protected readonly heldRows = computed<ReadonlySet<number>>(() => {
    const song = this.timeline();
    if (
      !song ||
      !this.playback.isPlaying() ||
      this.editor.compiledText() !== this.editor.source()
    ) {
      return new Set<number>();
    }

    return heldRowsAt({
      notes: song.notes,
      stack: this.stack(),
      context: this.placeContext(),
      tick: this.view.headTick(),
      audible: this.audible(),
    });
  });

  /** The row the last press asked for, whether or not it is still being heard. */
  private readonly pressedRow = signal<number | null>(null);

  /**
   * That row for as long as its note is on its way or sounding, and `null` the
   * moment it is not.
   *
   * `previewing` is the only thing that says how long a press lasts: a preview
   * carries no pitch back, and `playNote` hands out neither a length nor a
   * finish. It covers a sample and a region as well, which is why the row is
   * only ever set by a press that reached the worker.
   */
  protected readonly pressedKey = computed(() =>
    this.audition.previewing() ? this.pressedRow() : null,
  );

  /**
   * What the key column and the lane bands light: the song's rows, and the one
   * a press is playing. A press is a row sounding like any other.
   */
  protected readonly soundingRows = computed<ReadonlySet<number>>(() => {
    const rows = this.heldRows();
    const pressed = this.pressedKey();
    if (pressed === null) {
      return rows;
    }

    const all = new Set(rows);
    all.add(pressed);
    return all;
  });

  // --- editing -------------------------------------------------------------

  /**
   * The bar under the pointer. Read by the tooltip and by `roll-target.ts`,
   * which is why it sits above both rather than with the rest of the tooltip.
   */
  protected readonly hovered = signal<Mark | null>(null);

  /**
   * What a gesture acts on, and whether it may — see `roll-target.ts`. Named
   * here rather than there because picking a channel has to let go of a
   * selection, which is indices into a strip that file has never seen.
   */
  protected readonly target = rollTarget({
    hovered: this.hovered,
    editChannel: this.editChannel,
    timeline: this.timeline,
  });

  protected readonly gestures = rollGestures(
    {
      strip: this.target.strip,
      stack: this.stack,
      zoom: this.zoom,
      rowHeight: this.rowHeight,
      viewTick: this.view.viewTick,
      snap: this.snapTicks,
      editMode: this.editMode,
      lastLength: computed(() => this.settings().lastLength),
      targetAMKVersion: this.target.targetAMKVersion,
      songTargetProgram: this.target.songTargetProgram,
      playableTicks: this.target.playableTicks,
      introTicks: this.target.introTicks,
      channels: this.target.channelTails,
      inForce: this.target.inForceAt,
      source: this.editor.source,
    },
    {
      commit: (edits) => {
        this.requests.applyAll(edits);
      },
      rememberLength: (lastLength) => {
        this.settings.update((s) => (s.lastLength === lastLength ? s : { ...s, lastLength }));
      },
      audition: (note, drum, tick, ticks, slide) => {
        const channel = this.editChannel();
        // One render in flight: a note is heard by running the song silently up
        // to its tick, so a drag down the keyboard would otherwise queue one of
        // those per row and play them all long after the pointer stopped.
        if (channel !== null && !this.audition.notePending()) {
          this.audition.playNote({
            channel,
            tick,
            note: drum === null ? note : 0xd0 + (drum - FIRST_PERCUSSION_INSTRUMENT),
            ticks,
            slide,
            quiet: true,
          });
        }
      },
      auditionSpan: (tick, ticks) => {
        // No `notePending` gate: a press on a box or a marquee's release is one
        // deliberate question, and `Audition.stop` drops whatever the last one
        // was still rendering. The per-row drag sink above is the one that has
        // to queue.
        this.audition.playRegion({ tick, ticks });
      },
      pick: (channel) => this.selectEditChannel(channel),
      inspectLoop: (text, body) =>
        this.requests.inspectingLoop.set({ text: { ...text }, body: { ...body } }),
    },
  );

  /**
   * What the roll draws — see `roll-pictures.ts`. After the gestures, because
   * the loop boxes follow the one in flight.
   */
  protected readonly pictures = rollPictures({
    timeline: this.timeline,
    stack: this.stack,
    context: this.placeContext,
    audible: this.audible,
    zoom: this.zoom,
    rowHeight: this.rowHeight,
    rollWidth: this.rollWidth,
    songTicks: this.songTicks,
    windowTick: this.view.windowTick,
    beatsPerBar: this.beatsPerBar,
    beatUnit: this.beatUnit,
    editChannel: this.editChannel,
    strip: this.target.strip,
    gestures: this.gestures,
  });

  /** The channel's own colour, so a note being dragged stays the colour it is. */
  protected readonly editFill = computed(() => {
    const channel = this.target.editing();
    return channel === null ? CHANNEL_FILL[0] : CHANNEL_FILL[channel];
  });

  /** The same colour as an outline, which is what the ghost is drawn with. */
  protected readonly editStroke = computed(() => {
    const channel = this.target.editing();
    return channel === null ? CHANNEL_STROKE[0] : CHANNEL_STROKE[channel];
  });

  /**
   * Red while the gesture in flight cannot be committed.
   *
   * Both reasons, since either of them ends in a pointer-up that commits
   * nothing: an overlap the mode will not write, and a plan refused outright.
   */
  protected readonly blocked = computed(() => {
    const shown = this.gestures.preview();
    return shown !== null && (shown.clash.length > 0 || shown.refused !== null);
  });

  /**
   * Strip indices as the addresses the marks are keyed by.
   *
   * The one place the two namings meet: a strip item is known by its place in
   * the text and a mark by the address the walk gave it. An address is an ARAM
   * offset, so it names one note across the whole song.
   */
  private addressesOf(strip: Strip | null, indices: Iterable<number>): ReadonlySet<number> {
    const spans = new Set<number>();
    if (strip) {
      for (const index of indices) {
        spans.add(strip.items[index]?.address ?? -1);
      }
    }

    return spans;
  }

  /**
   * The selected notes as spans, which is what the bars are outlined by.
   *
   * Held across a recompile rather than emptied. There is no strip from the
   * moment the text changes until the compile lands, and the bars on screen for
   * the whole of that are the *last* compile's — so the addresses taken from
   * that compile outline exactly the bars being drawn, where an empty set takes
   * every outline off for a compile and puts it straight back, which is what a
   * commit from the inspector looked like.
   */
  protected readonly selectedSpans = linkedSignal<
    { strip: Strip | null; chosen: ReadonlySet<number> },
    ReadonlySet<number>
  >({
    source: () => ({ strip: this.target.strip(), chosen: this.gestures.selection() }),
    // Held only while there is something selected to hold it for: a selection
    // let go during a compile takes its outlines with it at once.
    computation: (now, previous) =>
      now.chosen.size === 0
        ? new Set<number>()
        : now.strip
          ? this.addressesOf(now.strip, now.chosen)
          : (previous?.value ?? new Set<number>()),
  });

  /** The selected strip indices in order, which the two readers below walk. */
  private readonly chosen = computed(() => [...this.gestures.selection()].sort((a, b) => a - b));

  /**
   * The run of text the selection covers, for the command palette in the
   * inspector to put a loop's brackets round.
   *
   * The stretch of text from the lowest selected unit to the highest, by offset
   * and not by index: a body's items are a frame of their own, appended after the
   * root's, so a whole `[ ]` selected with the notes round it has its last
   * *index* inside the body while the run's far end is the root note after it.
   * Whether that run may take a bracket is `wrapVerdict`'s to say — it widens
   * over a construct the run covers whole and refuses one the run cuts through,
   * `WRAP_SPLIT`, which is `REFUSE_SPLIT` by another route.
   */
  private readonly selectedRun = computed<{ start: number; end: number } | null>(() => {
    const items = this.target.strip()?.items;
    if (!items) {
      return null;
    }

    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    for (const index of this.chosen()) {
      const item = items[index];
      if (item) {
        start = Math.min(start, item.unitSpan.start);
        end = Math.max(end, item.unitSpan.end);
      }
    }

    return start <= end ? { start, end } : null;
  });

  /** The notes the preview has taken over, which the song's own bars leave out. */
  protected readonly movingSpans = computed(() =>
    this.addressesOf(this.target.strip(), this.gestures.moving()),
  );

  /**
   * Points the inspector at a note the selection holds, where it is not already
   * answering about one of them.
   *
   * A click on a bar does this for itself (`roll-notes.ts:select`); a marquee,
   * `Ctrl+A` and a press on a loop box's edge select without touching the caret,
   * and the palette that puts brackets round a selection is in the panel that
   * answers to it. Guarded on the inspected note being outside the selection so
   * that `Ctrl`+clicking a second bar is not thrown back to the first.
   */
  private askAboutSelection(strip: Strip | null, chosen: readonly number[]): void {
    const asked = this.requests.inspecting();
    if (!strip || chosen.length === 0 || this.editor.compiledText() !== this.editor.source()) {
      return;
    }

    const held = chosen.map((index) => strip.items[index]).filter((item) => item !== undefined);
    if (asked !== null) {
      const same = held.find((item) => item.address === asked.address);
      if (same) {
        // An edit can move a note without moving its bytes — a resize from the
        // left end changes where it starts, and the duration bytes on either
        // side of it can come out the same length — so the tick the question was
        // asked at names no pass of the note any more. Left alone, the ring for
        // "another pass of the note you asked about" is drawn on the note
        // itself, which has only the one. Re-pointed rather than re-asked: it is
        // the same note, and the caret is already on its text.
        if (!same.instances.some((each) => each.tick === asked.tick)) {
          this.requests.inspecting.set({
            address: asked.address,
            tick: same.instances[0]?.tick ?? 0,
          });
        }

        return;
      }
    }

    const note = held.find((item) => item.kind === 'note');
    const span = note && this.editor.notesByAddress().get(note.address)?.span;
    if (!note || !span) {
      return;
    }

    this.requests.inspecting.set({ address: note.address, tick: note.instances[0]?.tick ?? 0 });
    this.requests.reveal.set({ span: { ...span }, show: false });
  }

  // --- tooltip -------------------------------------------------------------

  protected readonly pointer = signal({ x: 0, y: 0, width: 0, height: 0 });

  /** The hovered mark, while there is still a song for it to have come from. */
  protected readonly tooltipFor = computed(() => (this.timeline() ? this.hovered() : null));

  // --- the problems list ---------------------------------------------------

  /** Anything the walk could not make sense of, said in words rather than colour. */
  protected readonly problems = computed(() => this.timeline()?.problems ?? []);

  // --- the percussion set --------------------------------------------------

  /** The panel's rows. Built here because the chosen set is what the lanes are built from. */
  protected readonly chips = computed(() =>
    percussionChips(this.timeline()?.usedInstruments ?? [], this.percussion(), this.drumNotes()),
  );

  /** Both sides are sorted, so this is a string compare. Mirrors the mixer's Reset. */
  protected readonly hasPercussionOverrides = computed(
    () => this.settings().percussion.join(',') !== DEFAULT_PERCUSSION.join(','),
  );

  // --- interaction ---------------------------------------------------------

  constructor() {
    // Sanctioned effect: mirroring state into localStorage, as `editor-pane.ts`
    // does for the selected tab.
    effect(() => writeSettings(this.settings()));

    // Sanctioned effect: carrying a press on the mixer's own buttons back to the
    // channel being edited. The mixer is a strip under the whole pane rather
    // than a child of the roll, so it has no call site here to do it at, the way
    // the picker's own chips do. On the transition, or every tab switch would
    // drag the edited channel back to a solo taken long ago. The mask is the
    // whole trigger — it changes only when M, S or Reset is pressed, so a
    // recompile cannot fire this.
    onChange(this.mixer.silenced, (silenced) => this.followMixer(silenced));

    // Sanctioned effect: a selection is a set of indices into the channel's
    // strip, so text the roll cannot account for leaves the outline on whatever
    // notes now sit at those indices. A batch that kept the notes adds none and
    // takes none away, so those indices still hold; a gesture of the roll's own
    // has left anchors saying where each of its notes went. Read here rather
    // than followed on its own, because the two are one decision — the count is
    // what says which kind of change is landing.
    let kept = untracked(this.requests.notesKept);
    onChange(this.editor.source, () => {
      const now = this.requests.notesKept();
      const keepsNotes = now !== kept;
      kept = now;
      this.gestures.sourceChanged(keepsNotes);
    });

    // Sanctioned effect: putting a carried selection back once the commit that
    // moved it has been compiled. On the strip and not on the source, because
    // the strip is what the indices are into and it is a compile behind — the
    // roll has none at all in between. Ahead of the mirror below, so the panels
    // are told about the selection the strip really has.
    onChange(this.target.strip, (strip) => {
      if (strip) {
        this.gestures.restoreSelection(strip);
      }
    });

    // Sanctioned effect: mirroring the selection into the mailbox, which is the
    // roll's imperative sink for everything the panels beside it answer from.
    // Two writes, because a selection has two things to say — the run a loop's
    // brackets would go round, and, where nothing selected is being inspected,
    // a note for the palette that writes them to open on. A marquee and
    // `Ctrl+A` move no caret of their own, and a panel answering the caret would
    // otherwise have nothing to show.
    effect(() => {
      const run = this.selectedRun();
      const strip = this.target.strip();
      const chosen = this.chosen();
      untracked(() => {
        this.requests.selectedRun.set(run);
        this.askAboutSelection(strip, chosen);
      });
    });

    // Sanctioned effect: putting the vertical scroller back where the roll was
    // left. There is nothing to scroll until the pane has been measured and the
    // stack laid out, so it waits for a render that has both, and happens once.
    let restored = false;
    effect(() => {
      if (restored || this.viewBox() === null || this.stackHeight() <= 0) {
        return;
      }

      restored = true;
      const top = rollCamera.topRow * untracked(() => this.rowHeight());
      afterNextRender(() => (this.viewport().nativeElement.scrollTop = top), {
        injector: this.injector,
      });
    });

    // Sanctioned effect: writing the first rest a song with no playable music
    // needs, when the roll is opened on one. It waits for a compile of the text
    // as it stands — the result lags the source by the typing debounce, and a
    // decision off a stale compile would read the wrong song — then decides
    // once and stands down, so undoing the seed is never fought and a song
    // failing for its own reasons is never written to (`roll-seed.ts`).
    let decided = false;
    effect(() => {
      const source = this.editor.source();
      const result = this.editor.result();
      if (decided || result === null || this.editor.compiledText() !== source) {
        return;
      }

      decided = true;
      untracked(() => {
        const edits = seedEdits(source, result, this.editor.tokens());
        if (edits) {
          this.requests.applyAll(edits);
        }
      });
    });

    // The selection goes with the roll — it is indices into a strip this
    // component owns — so what it published goes with it too.
    this.destroyRef.onDestroy(() => {
      this.requests.selectedRun.set(null);
      this.requests.inspectingLoop.set(null);
    });
  }

  protected setZoom(direction: number): void {
    this.settings.update((s) => ({ ...s, zoom: stepZoom(s.zoom, direction) }));
  }

  protected setRowHeight(direction: number): void {
    const next = stepRowHeight(this.rowHeight(), this.settings().rowHeight, direction);
    if (next !== undefined) {
      this.settings.update((s) => ({ ...s, rowHeight: next }));
    }
  }

  protected setScrollNotes(scrollNotes: boolean): void {
    this.settings.update((s) => ({ ...s, scrollNotes }));
  }

  protected setAllOctaves(allOctaves: boolean): void {
    this.settings.update((s) => ({ ...s, allOctaves }));
  }

  protected setBeatsPerBar(beatsPerBar: number): void {
    this.settings.update((s) => ({ ...s, beatsPerBar }));
  }

  protected setBeatUnit(beatUnit: number): void {
    this.settings.update((s) => ({ ...s, beatUnit }));
  }

  protected setSnap(snap: SnapName): void {
    this.settings.update((s) => ({ ...s, snap }));
  }

  protected setEditMode(editMode: EditMode): void {
    this.settings.update((s) => ({ ...s, editMode }));
  }

  protected setPercussionOpen(percussionOpen: boolean): void {
    this.settings.update((s) => ({ ...s, percussionOpen }));
  }

  /** Pressing the channel already being edited clears it, as the mixer's solo does. */
  protected setEditChannel(channel: number): void {
    if (this.editChannel() === channel) {
      this.clearEditChannel();
      return;
    }

    this.selectEditChannel(channel);
  }

  /** Editing nothing again: the selection goes with the channel it indexes into. */
  private clearEditChannel(): void {
    this.gestures.clearSelection();
    this.settings.update((s) => ({ ...s, editChannel: null }));
  }

  /**
   * A click on the roll names a channel rather than toggling one: the bar it
   * landed on is the answer, so a second note on the channel already being
   * edited must not clear it.
   *
   * Naming the channel already being edited does nothing at all, which is what
   * lets every gesture call it: a press names its own channel before it selects,
   * and clearing there would take away the note just clicked. The selection goes
   * with a channel that really changes, being a set of indices into one
   * channel's strip — carried across, it would outline whatever notes happen to
   * sit at those indices in the next one.
   */
  protected selectEditChannel(editChannel: number): void {
    if (this.editChannel() === editChannel) {
      return;
    }

    this.gestures.clearSelection();
    this.settings.update((s) => ({ ...s, editChannel }));
  }

  /**
   * What a press on the mixer means for the roll.
   *
   * Isolating a part is choosing one to work on, and a solo and muting every
   * other channel by hand are the same act — `soleAudible` is what makes them
   * the same answer. Otherwise a channel that has just gone quiet keeps its
   * place but loses its selection, because a muted channel takes no interaction.
   *
   * The two cannot deadlock against the refusal a silenced channel gets: the
   * channel handed over here is by definition the one still being heard.
   */
  private followMixer(silenced: number): void {
    const sole = soleAudible(this.mixer.channels());
    if (sole !== null) {
      this.selectEditChannel(sole);
      return;
    }

    const channel = this.editChannel();
    if (channel !== null && (silenced & (1 << channel)) !== 0) {
      this.gestures.clearSelection();
    }
  }

  /**
   * `Ctrl` on a chip isolates that channel instead of editing it, so a part can
   * be picked out and worked on without crossing the pane to the mixer.
   *
   * Refused for a channel the song does not write to, as the mixer refuses it by
   * giving those no buttons at all: soloing one silences everything, which would
   * leave the roll with nothing it is allowed to edit.
   */
  protected isolateChannel(channel: number): void {
    if (this.mixer.channels().some((state) => state.index === channel)) {
      this.mixer.toggleSolo(channel);
    }
  }

  protected togglePercussion(instrument: number): void {
    this.settings.update((s) => togglePercussion(s, instrument));
  }

  protected resetPercussion(): void {
    this.settings.update(resetPercussion);
  }

  // --- the pointer, and the keys ------------------------------------------

  /** The box gestures measure against: the `<svg>`, which scrolls with the notes. */
  private svgBox(event: PointerEvent | WheelEvent): DOMRect {
    return (event.currentTarget as Element).getBoundingClientRect();
  }

  /**
   * Where a middle-button pan took hold of the roll, or `null` for no pan.
   *
   * Both axes are recorded at the press and the move works out an absolute
   * offset from them, rather than adding a step per event: a drag that rounds
   * its way along a hundred moves leaves the music somewhere other than under
   * the pointer that carried it. A signal because the cursor reads it.
   */
  private readonly panning = signal<{
    x: number;
    y: number;
    fromTick: number;
    fromTop: number;
  } | null>(null);

  /** What the pointer looks like over the roll: a pan first, then the gesture's own. */
  protected readonly rollCursor = computed(() =>
    this.panning() ? 'grabbing' : this.gestures.cursor(),
  );

  protected onEditDown(event: PointerEvent): void {
    // The middle button pans and edits nothing, so it is taken before the
    // gesture layer and works with no channel picked. Preventing the default
    // here suppresses the compatibility `mousedown`, and with it the browser's
    // own autoscroll.
    if (event.button === 1) {
      event.preventDefault();
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
      this.view.setFollow(false);
      this.panning.set({
        x: event.clientX,
        y: event.clientY,
        fromTick: this.view.panTick(),
        fromTop: this.viewport().nativeElement.scrollTop,
      });
      return;
    }

    this.gestures.onPointerDown(event, this.svgBox(event));
  }

  protected onEditMove(event: PointerEvent): void {
    const pan = this.panning();
    if (pan) {
      const zoom = this.zoom();
      if (zoom > 0) {
        this.view.panTick.set(pan.fromTick - (event.clientX - pan.x) / zoom);
      }

      this.viewport().nativeElement.scrollTop = pan.fromTop - (event.clientY - pan.y);
      return;
    }

    this.gestures.onPointerMove(event, this.svgBox(event));
  }

  protected onEditUp(event: PointerEvent): void {
    if (this.panning()) {
      const target = event.currentTarget as Element;
      if (target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }

      this.panning.set(null);
      return;
    }

    this.gestures.onPointerUp(event);
  }

  /**
   * On the `<svg>` rather than on the scroller, which has its own leave for the
   * tooltip: a pointer inside the scroller but off the `<svg>` sends no move, so
   * the ghost would hang where it was last seen.
   */
  protected onEditLeave(): void {
    this.gestures.onPointerLeave();
  }

  /** The right button erases, so the browser's own menu would be in the way. */
  protected onContextMenu(event: Event): void {
    if (this.target.strip()) {
      event.preventDefault();
    }
  }

  /**
   * A note being drawn takes the wheel first; otherwise Ctrl zooms about the
   * pointer and Shift scrolls sideways. None of them seeks — the scrub bar is
   * the only thing that does, and a wheel that moved the song would be a seek
   * nothing on screen had asked for.
   */
  protected onWheel(event: WheelEvent): void {
    const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;

    // A wheel while a note is being drawn sizes it, which is the one thing the
    // pointer cannot say with the button already down. Ahead of the zoom and the
    // pan, so a press holding a note takes the whole wheel rather than half of it.
    if (this.gestures.stepLength(delta < 0 ? 1 : -1, event.altKey)) {
      event.preventDefault();
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const box = this.svgBox(event);
      const under = tickAtX(event.clientX - box.left, this.view.viewTick(), this.zoom());
      const before = this.view.viewTick();
      this.setZoom(delta < 0 ? 1 : -1);
      // Hold the tick that was under the pointer, so a zoom happens where the
      // eye is rather than dragging the music sideways under it. Only when the
      // roll is parked: a following roll is anchored on the playhead instead.
      if (!this.follow()) {
        const kept = under - (event.clientX - box.left - KEY_WIDTH) / this.zoom();
        this.view.panTick.update((tick) => tick + (kept - before));
      }

      return;
    }

    if (event.altKey) {
      event.preventDefault();
      const scroller = this.viewport().nativeElement;
      const before = this.rowHeight();
      // Which row the pointer is on, as a fraction, so the zoom happens where
      // the eye is rather than sliding the keyboard under it.
      const under =
        (scroller.scrollTop + event.clientY - scroller.getBoundingClientRect().top) / before;
      this.setRowHeight(delta < 0 ? 1 : -1);

      // After a render: the `<svg>` is still its old height when the handler
      // runs, so a `scrollTop` written now is clamped against a stack that has
      // not grown yet.
      afterNextRender(
        () => {
          const now = this.rowHeight();
          const box = scroller.getBoundingClientRect();
          scroller.scrollTop = under * now - (event.clientY - box.top);
        },
        { injector: this.injector },
      );
      return;
    }

    if (event.shiftKey) {
      event.preventDefault();
      // Panning takes the roll off the song, which is what the Follow switch
      // already means; ticking it again is how the porter comes back.
      this.view.setFollow(false);
      this.view.panTick.update((tick) => tick + delta / this.zoom());
    }
  }

  /**
   * The roll's shortcuts — see `roll-shortcuts.ts`, which is where they are
   * decided. What is here is the bag it decides them against.
   */
  protected onKey(event: KeyboardEvent): void {
    rollShortcut(event, {
      playing: () => this.playback.isPlaying(),
      previewing: () => this.audition.previewing(),
      canCompile: () => this.editor.canCompile(),
      toggleTransport: () => void this.playback.toggle(),
      stopSound: () => stopAll(this.playback, this.audition),
      source: () => this.editor.source(),
      inSync: () => this.editor.compiledText() === this.editor.source(),
      caret: () => this.editor.caret(),
      inspectedCommand: () => this.inspectedCommand(),
      applyEdit: (edit) => this.requests.applyAll(edit ? [edit] : null, null, true),
      dismiss: (caret) => this.requests.dismissed.set(caret),
      stopInspecting: () => {
        this.requests.inspecting.set(null);
        this.requests.inspectingLoop.set(null);
      },
      clearEditChannel: () => this.clearEditChannel(),
      history: (command) => this.requests.history.set(command),
      selection: () => this.gestures.selection(),
      clearSelection: () => this.gestures.clearSelection(),
      selectAll: () => this.gestures.selectAll(),
      run: (gesture) => this.gestures.run(gesture),
      editChannel: () => this.editChannel(),
      hasStrip: () => this.target.strip() !== null,
      snapTicks: () => this.snapTicks(),
      beatsPerBar: () => this.beatsPerBar(),
      beatUnit: () => this.beatUnit(),
    });
  }

  /** A key on the left column, sounded on the channel being edited. */
  protected onKeyPress(row: number): void {
    const channel = this.editChannel();
    const lane = this.lanes()[row];
    if (channel === null || !lane || this.audition.notePending()) {
      return;
    }

    const note =
      lane.kind === 'key'
        ? NOTE_MIN + lane.index
        : lane.kind === 'drum'
          ? 0xd0 + (lane.index - FIRST_PERCUSSION_INSTRUMENT)
          : null;
    if (note !== null) {
      // Not `quiet`: one press is one deliberate question, so a press that
      // sounds nothing is worth an answer. The drag sink is the per-row caller.
      this.audition.playNote({
        channel,
        tick: Math.max(0, Math.round(this.view.playTick())),
        note,
      });
      // A silenced channel and a note out of range are both refused before a
      // render is asked for, and `notePending` is set nowhere else, so it is
      // what tells a press that sounds from one that only said why it did not.
      this.pressedRow.set(this.audition.notePending() ? row : null);
    }
  }

  protected onMove(event: PointerEvent): void {
    const box = this.host.nativeElement.getBoundingClientRect();
    this.pointer.set({
      x: event.clientX - box.left,
      y: event.clientY - box.top,
      width: box.width,
      height: box.height,
    });

    if (!(event.target as Element | null)?.closest('.mark')) {
      this.leave();
    }
  }

  protected enter(mark: Mark): void {
    this.hovered.set(mark);
  }

  protected leave(): void {
    this.hovered.set(null);
  }

  /** The scroller's position, kept in rows so it survives a change of pane height. */
  protected onViewportScroll(): void {
    rollCamera.topRow = this.viewport().nativeElement.scrollTop / this.rowHeight();
  }
}
