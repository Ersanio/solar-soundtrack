import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { NOTE_MIN, TICKS_PER_WHOLE } from '@amk/core/hardcoded-tables';
import {
  FIRST_CUSTOM_INSTRUMENT,
  FIRST_PERCUSSION_INSTRUMENT,
  NOISE_FLAG,
} from '@amk/spc/instruments';
import { elementSize } from '../../../shared/chart/element-size';
import { clamp } from '../../../util/math';
import { Audition } from '../../../state/audition';
import { DriverStore } from '../../../state/driver-store';
import { EditorRequests } from '../../../state/editor-requests';
import { EditorStore } from '../../../state/editor-store';
import { Mixer } from '../../../state/mixer';
import { Playback } from '../../../state/playback';
import { PercussionPanel, percussionChips } from './percussion-panel/percussion-panel';
import { DEFAULT_PERCUSSION, type PlaceContext, rollShape } from './percussion';
import {
  PAGE_LEAD_IN,
  PAGE_STEP,
  PAGE_TURN_AT,
  PLAYHEAD_AT,
  SCROLL_END_AT,
  rollCamera,
} from './roll-camera';
import { RollChannels } from './roll-channels/roll-channels';
import { rollClock } from './roll-clock';
import { RollGrid } from './roll-grid/roll-grid';
import { RollKeys } from './roll-keys/roll-keys';
import { RollLanes } from './roll-lanes/roll-lanes';
import type { EditMode, Gesture } from './roll-edit';
import { RollEditLayer } from './roll-edit-layer/roll-edit-layer';
import { rollGestures } from './roll-gesture';
import {
  gridLines,
  laneStack,
  pageStart,
  scrubOffset,
  tickAtX,
  tickWindow,
  xAtTick,
} from './roll-layout';
import { type Mark, buildMarks, buildMinimap, heldRowsAt } from './roll-marks';
import { CHANNEL_FILL, KEY_WIDTH, SCRUB_HEIGHT } from './roll-metrics';
import { type Strip, channelStrip, isStrip } from './roll-strip';
import { RollNotes } from './roll-notes/roll-notes';
import { RollScrub } from './roll-scrub/roll-scrub';
import {
  type Settings,
  type SnapName,
  readSettings,
  snapTicks,
  stepRowHeight,
  stepZoom,
  writeSettings,
} from './roll-settings';
import { RollToolbar } from './roll-toolbar/roll-toolbar';
import { RollTooltip } from './roll-tooltip/roll-tooltip';

/**
 * The song as music: a keyboard down the left, time running right, and all
 * eight channels in one roll.
 *
 * This holds the song's shape, the camera and the clock, and hands each of them
 * to a component that draws one thing: the toolbar, the scrub bar, the row
 * stripes, the grid, the notes, the keys and the hover. The four `roll-*.ts`
 * files beside it are the arithmetic, Angular-free, the way `roll-layout.ts` and
 * `percussion.ts` already were.
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
    RollEditLayer,
    RollGrid,
    RollKeys,
    RollLanes,
    RollNotes,
    RollScrub,
    RollToolbar,
    RollTooltip,
  ],
  templateUrl: './piano-roll.html',
  host: {
    class: 'relative flex min-h-0 min-w-0 flex-col',
    // On the window rather than through a focusable element: this project ships
    // no `tabindex` and no `role`, and a shortcut that only works while a
    // channel is being edited needs neither. See `web/README.md`.
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

  /**
   * The camera, which outlives the component — see `roll-camera.ts`. Aliased so
   * that reading and moving it stays an ordinary signal read and an ordinary set.
   */
  private readonly panTick = rollCamera.panTick;
  private readonly panLead = rollCamera.panLead;
  private readonly pageOrigin = rollCamera.pageOrigin;

  /** A scrub in progress: the roll is off the song until the drag ends. */
  private readonly scrolling = signal(false);

  /** A pointer is down on the scrub bar. */
  private readonly dragging = signal(false);

  protected readonly timeline = computed(() => this.editor.timeline());

  /** The song's whole length, which the camera and the scrub bar both measure against. */
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
   * One map for both readers. `heldRows` recomputes on every frame of playback,
   * and building this inside it would rebuild eight entries sixty times a second
   * to answer a question that only changes when the mixer is touched.
   */
  private readonly audible = computed(
    () => new Map(this.mixer.channels().map((c) => [c.index, c.audible])),
  );

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

  // --- the camera ----------------------------------------------------------

  /** Ticks across the roll at this zoom, which is what a page is measured in. */
  private readonly screenTicks = computed(() =>
    this.zoom() > 0 ? this.rollWidth() / this.zoom() : 0,
  );

  /** As far right as a scroll goes: the last tick, at {@link SCROLL_END_AT}. */
  private readonly maxPanTick = computed(
    () => this.songTicks() + (this.rollWidth() * (this.panLead() - SCROLL_END_AT)) / this.zoom(),
  );

  /**
   * Where a parked view actually sits, held inside the song.
   *
   * Clamped on the way out rather than on the way in, because the range moves:
   * a zoom or a resize changes what the end of the song is worth in ticks, and a
   * position written before either would be left outside it. An unknown song —
   * nothing compiled, or a failed compile — has no end to hold against, so it
   * keeps the floor alone and pans freely.
   */
  private readonly parkedTick = computed(() => {
    const pass = this.songTicks();
    return pass > 0 ? clamp(this.panTick(), 0, this.maxPanTick()) : Math.max(0, this.panTick());
  });

  // --- the clock -----------------------------------------------------------

  /** On the song: following it, and not taken off it by a scroll. */
  private readonly attached = computed(() => this.follow() && !this.scrolling());

  /**
   * Only run a frame callback while something is actually moving.
   *
   * Which is any playing song, parked or not: a parked roll holds the music
   * still and the playhead goes on crossing it, so the line still needs a frame
   * clock — and costs less than a following one, whose transform moves too.
   */
  private readonly running = computed(() => this.playback.isPlaying());

  /** The tempo as `t` writes it — `DriverState.tempo` is `$51`, one higher. */
  private readonly tempo = computed(() => {
    const driver = this.playback.driver();
    return driver && driver.tempo > 0 ? driver.tempo - 1 : 0;
  });

  private readonly playhead = rollClock({
    running: this.running,
    anchor: this.playback.songTicks,
    clock: this.editor.clock,
    tempo: this.tempo,
    pass: this.songTicks,
  });

  /**
   * Whether the roll is showing the song's position rather than a parked one.
   *
   * Idle and not playing are different things. A pause leaves the song where it
   * is and resumes from there, so the roll stays there too; only a stop puts it
   * back at the beginning, which is what the transport's own readout does. This
   * is deliberately not `isPlaying()`, which would count a pause as "gone" and
   * throw the view back to tick 0.
   */
  private readonly following = computed(() => !this.playback.isIdle() && this.attached());

  /**
   * Where the song is, which is what the playhead marks — parked or not.
   *
   * Deliberately free of {@link attached}: coming off the song stops the *view*
   * following it, and a line that stopped as well would leave nothing in the
   * roll saying where the music had got to. Parked, this runs on past the pane
   * and the clip takes it from there.
   *
   * A scrub is the exception, and reads the drag rather than the song, because
   * `scrubTo` previews a seek without moving the transport (`playback.ts`) — so
   * the tick the drag is asking for is the roll's own parked one.
   *
   * The last case asks the transport rather than assuming the beginning. A stop
   * does put it back to tick 0 and the line follows it there, but a scrub made
   * while the song is stopped seeks without starting it, and a roll that read a
   * stopped transport as tick 0 would throw that scrub away the moment it was
   * released — the bar would move, the song would not, and nothing would say why.
   */
  private readonly headTick = computed(() => {
    if (this.scrolling()) {
      return this.parkedTick();
    }

    return this.playback.isIdle() ? this.playback.songTicks().ticks : this.playhead.tick();
  });

  /**
   * Where the camera is: on the song while it is following it, and wherever it
   * was parked otherwise.
   *
   * The other half of {@link headTick}, and the reason the two are separate.
   * Everything about what is *drawn* — the transform, the mark window, the
   * readout — is this one; the playhead alone is the other.
   */
  protected readonly playTick = computed(() =>
    this.attached() ? this.headTick() : this.parkedTick(),
  );

  /**
   * The 10 Hz anchor the mark window is snapped around, so it moves rarely.
   *
   * Follows the same rule as {@link playTick} and must: the transform and the
   * marks are two halves of one picture, so a pause that moved one and not the
   * other would scroll to the paused position and find nothing drawn there.
   */
  private readonly windowTick = computed(() =>
    this.attached() ? this.playback.songTicks().ticks : this.parkedTick(),
  );

  /**
   * Where the camera holds the playhead, as a fraction of the roll's width.
   *
   * The whole difference between the two view modes. Scrolling the notes pins
   * the playhead and slides the music under it, so the fraction is fixed at
   * {@link PLAYHEAD_AT}; paging, the default, holds the music still and lets the
   * playhead cross the pane, so the fraction is how far into the current page it
   * has got. Parked, it is whatever it was when the view came off the song.
   *
   * The camera's alone, and not where the line is drawn: parked, the camera
   * stands still and the song goes on without it. {@link playheadX} is the line.
   */
  private readonly lead = computed(() => {
    if (this.scrollNotes()) {
      return PLAYHEAD_AT;
    }

    if (!this.attached()) {
      return this.panLead();
    }

    const screen = this.screenTicks();
    if (screen <= 0) {
      return PLAYHEAD_AT;
    }

    const from = pageStart(this.playTick(), screen, PAGE_TURN_AT, PAGE_STEP, this.pageOrigin());
    return clamp((this.playTick() - from) / screen, 0, 1);
  });

  /** The tick at the roll's left edge, which is the camera. */
  protected readonly viewTick = computed(() => this.playTick() - this.screenTicks() * this.lead());

  /**
   * The song's own tick, in the camera's coordinates. One rule for all three
   * views: a following roll puts it at {@link lead} across the pane by
   * construction, since that is where the camera was built around it, and a
   * parked one lets it cross the music and leave — the clip is what hides it.
   */
  protected readonly playheadX = computed(() =>
    xAtTick(this.headTick(), this.viewTick(), this.zoom()),
  );

  protected readonly scroll = computed(() => {
    const x = KEY_WIDTH - this.viewTick() * this.zoom();
    return `translate(${x.toFixed(2)} 0)`;
  });

  // --- the scrub bar -------------------------------------------------------

  /** Null until measured, so nothing renders against a zero-width box. */
  protected readonly scrubBox = computed(() => {
    const width = this.width();
    return width > 0 ? `0 0 ${width} ${SCRUB_HEIGHT}` : null;
  });

  /**
   * The whole song, drawn small — and deliberately not from {@link playTick}, so
   * it rebuilds on a recompile, a percussion change or a resize and never on a
   * frame. Its rows come from the same `rowOf` the marks ask.
   */
  protected readonly minimap = computed(() =>
    buildMinimap({
      notes: this.timeline()?.notes ?? [],
      stack: this.stack(),
      context: this.placeContext(),
      ticks: this.songTicks(),
      width: this.rollWidth(),
    }),
  );

  /**
   * Where the playhead sits along the bar — the song's tick, as the roll's own
   * line is. The two are one playhead drawn twice, and the box beside this one
   * is what says where the view is.
   */
  protected readonly scrubX = computed(
    () => KEY_WIDTH + scrubOffset(this.headTick(), this.songTicks(), this.rollWidth()),
  );

  /**
   * The slice of the song the roll is showing, as a box on the bar.
   *
   * Runs off both ends by design — a paged roll opens before tick 0 and the last
   * page reaches past the end — so the strip clips it rather than this clamping
   * it into something narrower than the pane it stands for.
   */
  protected readonly scrubWindow = computed(() => {
    const ticks = this.songTicks();
    const width = this.rollWidth();
    if (ticks <= 0 || width <= 0) {
      return null;
    }

    const from = (this.viewTick() / ticks) * width;
    const w = (this.screenTicks() / ticks) * width;
    return { x: KEY_WIDTH + from, w: Math.max(1, w) };
  });

  // --- marks ---------------------------------------------------------------

  private readonly window = computed(() =>
    tickWindow(this.windowTick(), this.rollWidth(), this.zoom(), PLAYHEAD_AT),
  );

  protected readonly marks = computed(() => {
    const { from, to } = this.window();
    return buildMarks({
      notes: this.timeline()?.notes ?? [],
      stack: this.stack(),
      context: this.placeContext(),
      from,
      to,
      zoom: this.zoom(),
      rowHeight: this.rowHeight(),
      audible: this.audible(),
      inForce: this.editor.commandsInForce(),
    });
  });

  protected readonly lines = computed(() => {
    const beats = this.beatsPerBar();
    if (beats === 0) {
      return []; // No grid asked for.
    }

    const { from, to } = this.window();
    const beatTicks = TICKS_PER_WHOLE / this.beatUnit();
    return gridLines(from, to, beatTicks, beats).map((line) => ({
      ...line,
      x: line.tick * this.zoom(),
    }));
  });

  protected readonly loopX = computed(() => {
    const loop = this.timeline()?.loopTick;
    return loop === null || loop === undefined || loop === 0 ? null : loop * this.zoom();
  });

  protected readonly endX = computed(() => {
    const ticks = this.songTicks();
    return ticks > 0 ? ticks * this.zoom() : null;
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
      tick: this.headTick(),
      audible: this.audible(),
    });
  });

  // --- editing -------------------------------------------------------------

  /**
   * The channel being edited, as a sequence the roll can splice — or the reason
   * it cannot be one.
   *
   * Everything span-based takes the same staleness test: a span into a document
   * that has moved points at the wrong thing. Here it is the difference between
   * an edit and a corruption, so it is the first check rather than the last.
   */
  private readonly stripOutcome = computed(() => {
    const channel = this.editChannel();
    const result = this.editor.result();
    const timeline = this.timeline();
    if (
      channel === null ||
      !result?.ok ||
      !timeline ||
      this.editor.compiledText() !== this.editor.source()
    ) {
      return null;
    }

    return channelStrip({
      source: this.editor.source(),
      channel,
      noteMap: result.noteMap ?? [],
      timeline,
      index: this.editor.tokens(),
      tempoRatio: result.stats?.tempoRatio ?? 1,
    });
  });

  protected readonly strip = computed<Strip | null>(() => {
    const outcome = this.stripOutcome();
    return outcome && isStrip(outcome) ? outcome : null;
  });

  /** Why the picked channel cannot be edited, for the toolbar to say. */
  protected readonly editRefusal = computed(() => {
    const outcome = this.stripOutcome();
    return outcome && !isStrip(outcome) ? outcome.refused : null;
  });

  private readonly targetAMKVersion = computed(
    () => this.editor.result()?.stats?.targetAMKVersion ?? 4,
  );

  protected readonly gestures = rollGestures(
    {
      strip: this.strip,
      stack: this.stack,
      zoom: this.zoom,
      rowHeight: this.rowHeight,
      viewTick: this.viewTick,
      snap: this.snapTicks,
      editMode: this.editMode,
      lastLength: computed(() => this.settings().lastLength),
      targetAMKVersion: this.targetAMKVersion,
      source: this.editor.source,
    },
    {
      commit: (edits) => {
        this.requests.applyAll(edits);
      },
      rememberLength: (lastLength) => {
        this.settings.update((s) => (s.lastLength === lastLength ? s : { ...s, lastLength }));
      },
      audition: (note, drum, tick) => {
        const channel = this.editChannel();
        // One render in flight: a note is heard by running the song silently up
        // to its tick, so a drag down the keyboard would otherwise queue one of
        // those per row and play them all long after the pointer stopped.
        if (channel !== null && !this.audition.notePending()) {
          this.audition.playNote({
            channel,
            tick,
            note: drum === null ? note : 0xd0 + (drum - FIRST_PERCUSSION_INSTRUMENT),
            ticks: this.settings().lastLength,
            quiet: true,
          });
        }
      },
      pick: (channel) => this.selectEditChannel(channel),
    },
  );

  /** The channel's own colour, so a note being dragged stays the colour it is. */
  protected readonly editFill = computed(() => {
    const channel = this.editChannel();
    return channel === null ? CHANNEL_FILL[0] : CHANNEL_FILL[channel];
  });

  /** Red while the gesture in flight cannot be committed. */
  protected readonly blocked = computed(() => (this.gestures.preview()?.clash.length ?? 0) > 0);

  /** The selected notes as spans, which is what the bars are outlined by. */
  protected readonly selectedSpans = computed(() => {
    const strip = this.strip();
    const chosen = this.gestures.selection();
    const spans = new Set<number>();
    if (strip) {
      for (const index of chosen) {
        spans.add(strip.items[index]?.address ?? -1);
      }
    }

    return spans;
  });

  // --- tooltip -------------------------------------------------------------

  protected readonly hovered = signal<Mark | null>(null);
  protected readonly pointer = signal({ x: 0, y: 0, width: 0, height: 0 });

  /** The hovered mark, while there is still a song for it to have come from. */
  protected readonly tooltipFor = computed(() => (this.timeline() ? this.hovered() : null));

  // --- the readout ---------------------------------------------------------

  /**
   * The tick the readout reports.
   *
   * Slow only while the song is carrying the playhead along. A parked or stopped
   * roll is not moving, so there is nothing to blur and the reading is exact —
   * and a scroll's own readout must answer the wheel rather than half a second
   * after it.
   */
  protected readonly readoutTick = computed(() =>
    this.following() ? this.playhead.slowTick() : this.playTick(),
  );

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

    // Sanctioned effect: releasing a view a scroll had to hold on to. A scroll
    // made while the transport was stopped could not seek, so the roll stayed
    // where it was put; pressing play gives it a song to follow again. Guarded
    // on the timer so it cannot fire in the middle of a gesture.
    //
    // It follows the transition and not the state: what re-measures the pages is
    // a stop, and a roll built while the transport is already stopped has seen
    // none — so the first run only records the state it came in on, leaving the
    // camera it was rebuilt from alone.
    let wasIdle = untracked(() => this.playback.isIdle());
    effect(() => {
      const idle = this.playback.isIdle();
      untracked(() => {
        if (idle === wasIdle) {
          return;
        }

        wasIdle = idle;

        if (!idle && !this.dragging()) {
          this.scrolling.set(false);
          return;
        }

        // A stop is back to the beginning, so the pages are measured from it
        // again — a grid still anchored on some earlier scroll would draw the
        // song's first tick at whatever offset that anchor gave it.
        if (idle && !this.dragging()) {
          this.pageOrigin.set(0);
        }
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

    // A drag can be one pointer-down away from a component that no longer
    // exists — the roll is rebuilt on every tab switch, and a captured pointer
    // never reports its release. Honour the gesture rather than stranding the
    // transport on a scrub nothing will commit.
    this.destroyRef.onDestroy(() => {
      if (this.dragging()) {
        this.commitScroll();
      }
    });
  }

  /**
   * Where the roll is right now, whether it is following the song or parked.
   *
   * What "stop following" has to start from, and the reason parking is done at
   * the two places that stop rather than in an effect watching the flag: an
   * effect runs after the handler, so it would overwrite the position a scrub
   * set in the same gesture that took the roll off the song.
   */
  private currentTick(): number {
    return this.following() ? this.playhead.tick() : this.parkedTick();
  }

  /**
   * The lead a view coming off the song keeps, so the picture does not move.
   *
   * Held off both edges: a parked view needs room after the last tick for the
   * end-of-song marker, which is the distance {@link maxPanTick} measures.
   */
  private parkedLead(): number {
    return clamp(this.lead(), Math.max(SCROLL_END_AT, PAGE_LEAD_IN), PAGE_TURN_AT);
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

  protected setFollow(follow: boolean): void {
    if (!follow) {
      const tick = this.currentTick();
      this.panLead.set(this.parkedLead());
      this.panTick.set(tick);
    }

    this.settings.update((s) => ({ ...s, follow }));
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
    this.settings.update((s) => ({
      ...s,
      editChannel: s.editChannel === channel ? null : channel,
    }));
  }

  /**
   * A click on the roll names a channel rather than toggling one: the bar it
   * landed on is the answer, so a second note on the channel already being
   * edited must not clear it.
   */
  protected selectEditChannel(editChannel: number): void {
    this.settings.update((s) => ({ ...s, editChannel }));
  }

  /** Kept sorted, so comparing against the default is a string compare. */
  protected togglePercussion(instrument: number): void {
    this.settings.update((s) => {
      const next = new Set(s.percussion);
      if (!next.delete(instrument)) {
        next.add(instrument);
      }

      return { ...s, percussion: [...next].sort((a, b) => a - b) };
    });
  }

  protected resetPercussion(): void {
    this.settings.update((s) => ({ ...s, percussion: [...DEFAULT_PERCUSSION] }));
  }

  /**
   * Take the roll off the song and start scrubbing.
   *
   * The lead is read **once**, here, and held for the whole drag: it is where
   * the playhead sat when the gesture began, and re-reading it per move would
   * slide the music sideways under a pointer that had not moved.
   */
  protected onScrubStart(): void {
    const lead = this.parkedLead();
    this.dragging.set(true);
    this.scrolling.set(true);
    this.panLead.set(lead);
  }

  /** One step of a drag: move the view, and preview the position. */
  protected onScrubTo(tick: number): void {
    this.panTick.set(tick);
    this.playback.scrubTo(this.parkedTick());
  }

  protected onScrubEnd(): void {
    this.dragging.set(false);
    this.commitScroll();
  }

  /** The end of a scrub: the song jumps to where the roll was left. */
  private commitScroll(): void {
    const to = this.parkedTick();
    // Re-anchor the pages on the view the scroll is leaving, so the notes stay
    // exactly where the wheel put them. Before the seek can be refused, because
    // a scroll made while the transport was stopped is released by the effect
    // in the constructor rather than here, and it re-attaches to this same grid.
    this.pageOrigin.set(
      to - this.screenTicks() * this.panLead() + this.screenTicks() * PAGE_LEAD_IN,
    );
    if (!this.playback.canSeek()) {
      return;
    }

    this.playhead.jumpTo(to);
    this.scrolling.set(false);
    this.playback.seek(to);
  }

  // --- the pointer, and the keys ------------------------------------------

  /** The box gestures measure against: the `<svg>`, which scrolls with the notes. */
  private svgBox(event: PointerEvent | WheelEvent): DOMRect {
    return (event.currentTarget as Element).getBoundingClientRect();
  }

  protected onEditDown(event: PointerEvent): void {
    this.gestures.onPointerDown(event, this.svgBox(event));
  }

  protected onEditMove(event: PointerEvent): void {
    this.gestures.onPointerMove(event, this.svgBox(event));
  }

  protected onEditUp(event: PointerEvent): void {
    this.gestures.onPointerUp(event);
  }

  /** The right button erases, so the browser's own menu would be in the way. */
  protected onContextMenu(event: Event): void {
    if (this.strip()) {
      event.preventDefault();
    }
  }

  /**
   * Ctrl zooms about the pointer, Shift scrolls sideways. Neither seeks — the
   * scrub bar is the only thing that does, and a wheel that moved the song
   * would be a seek nothing on screen had asked for.
   */
  protected onWheel(event: WheelEvent): void {
    const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const box = this.svgBox(event);
      const under = tickAtX(event.clientX - box.left, this.viewTick(), this.zoom());
      const before = this.viewTick();
      this.setZoom(delta < 0 ? 1 : -1);
      // Hold the tick that was under the pointer, so a zoom happens where the
      // eye is rather than dragging the music sideways under it. Only when the
      // roll is parked: a following roll is anchored on the playhead instead.
      if (!this.follow()) {
        const kept = under - (event.clientX - box.left - KEY_WIDTH) / this.zoom();
        this.panTick.update((tick) => tick + (kept - before));
      }

      return;
    }

    if (event.shiftKey) {
      event.preventDefault();
      // Panning takes the roll off the song, which is what the Follow switch
      // already means; ticking it again is how the porter comes back.
      this.setFollow(false);
      this.panTick.update((tick) => tick + delta / this.zoom());
    }
  }

  /**
   * The roll's shortcuts, while a channel is being edited.
   *
   * Ignored while the text has focus, so `Ctrl+A` in the source still selects
   * the source. Everything here goes through the same {@link Gesture} the
   * pointer uses, so a nudge and a drag commit the same way.
   */
  protected onKey(event: KeyboardEvent): void {
    const strip = this.strip();
    const target = event.target as HTMLElement | null;
    if (
      !strip ||
      target?.closest('input, textarea, select, .cm-editor') !== null ||
      event.isComposing
    ) {
      return;
    }

    const chosen = [...this.gestures.selection()];
    const run = (gesture: Gesture): void => {
      event.preventDefault();
      this.gestures.run(gesture);
    };

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.gestures.selectAll();
      return;
    }

    if (event.key === 'Escape') {
      this.gestures.clearSelection();
      return;
    }

    if (chosen.length === 0) {
      return;
    }

    switch (event.key) {
      case 'Delete':
      case 'Backspace':
        run({ kind: 'delete', items: chosen });
        return;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const step = Math.max(1, this.snapTicks()) * (event.key === 'ArrowRight' ? 1 : -1);
        run({ kind: 'move', items: chosen, deltaTicks: step, deltaKeys: 0, copy: false });
        return;
      }

      case 'ArrowUp':
      case 'ArrowDown': {
        const semitones = (event.shiftKey ? 12 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
        run({ kind: 'move', items: chosen, deltaTicks: 0, deltaKeys: semitones, copy: false });
        return;
      }

      default:
        break;
    }

    const key = event.key.toLowerCase();
    if (event.altKey && key === 'q') {
      run({ kind: 'quantize', items: chosen, snap: Math.max(1, this.snapTicks()) });
    } else if (event.altKey && key === 'l') {
      run({ kind: 'legato', items: chosen });
    } else if ((event.ctrlKey || event.metaKey) && key === 'j') {
      run({ kind: 'glue', items: chosen });
    } else if ((event.ctrlKey || event.metaKey) && key === 'b') {
      const bar = Math.max(1, this.snapTicks() * Math.max(1, this.beatsPerBar()));
      run({ kind: 'move', items: chosen, deltaTicks: bar, deltaKeys: 0, copy: true });
    }
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
        tick: Math.max(0, Math.round(this.playTick())),
        note,
      });
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
