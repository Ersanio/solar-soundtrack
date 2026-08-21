import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { TICKS_PER_WHOLE } from '@amk/core/hardcoded-tables';
import {
  FIRST_CUSTOM_INSTRUMENT,
  FIRST_PERCUSSION_INSTRUMENT,
  NOISE_FLAG,
} from '@amk/spc/instruments';
import { elementSize } from '../../../shared/chart/element-size';
import { clamp } from '../../../util/math';
import { DriverStore } from '../../../state/driver-store';
import { EditorStore } from '../../../state/editor-store';
import { Playback } from '../../../state/playback';
import { PercussionPanel, percussionChips } from './percussion-panel/percussion-panel';
import { DEFAULT_PERCUSSION, type PlaceContext, rollShape } from './percussion';
import { RollChannels } from './roll-channels/roll-channels';
import { rollClock } from './roll-clock';
import { RollGrid } from './roll-grid/roll-grid';
import { RollKeys } from './roll-keys/roll-keys';
import { RollLanes } from './roll-lanes/roll-lanes';
import { gridLines, laneStack, pageStart, scrubOffset, tickWindow } from './roll-layout';
import { type Mark, buildMarks, buildMinimap, heldRowsAt } from './roll-marks';
import { KEY_WIDTH, SCRUB_HEIGHT } from './roll-metrics';
import { RollNotes } from './roll-notes/roll-notes';
import { RollScrub } from './roll-scrub/roll-scrub';
import {
  type Settings,
  readSettings,
  stepRowHeight,
  stepZoom,
  writeSettings,
} from './roll-settings';
import { RollToolbar } from './roll-toolbar/roll-toolbar';
import { RollTooltip } from './roll-tooltip/roll-tooltip';

/** Where the playhead sits across the roll: a fifth in, so you see what is coming. */
const PLAYHEAD_AT = 0.2;
/**
 * Where the song's last tick sits once the scroll has run as far right as it
 * goes — a little past the playhead, so the end of the song can be read with
 * some room after it rather than pinned under the line.
 */
const SCROLL_END_AT = 0.1;
/** How far across the pane a paged playhead runs before the roll turns over. */
const PAGE_TURN_AT = 0.9;
/**
 * How much of a pane a turn moves.
 *
 * Less than {@link PAGE_TURN_AT}, so the playhead lands a tenth in rather than
 * hard against the key column: the bar that has just played stays on screen,
 * which is what makes the new page read as a continuation of the old one.
 */
const PAGE_STEP = 0.8;
/** The margin a turn leaves, and so the one every page opens on. */
const PAGE_LEAD_IN = PAGE_TURN_AT - PAGE_STEP;

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
    RollGrid,
    RollKeys,
    RollLanes,
    RollNotes,
    RollScrub,
    RollToolbar,
    RollTooltip,
  ],
  templateUrl: './piano-roll.html',
  host: { class: 'relative flex min-h-0 min-w-0 flex-col' },
})
export class PianoRoll {
  private readonly editor = inject(EditorStore);
  private readonly drivers = inject(DriverStore);
  private readonly playback = inject(Playback);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
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

  /** Where the view is parked when it is not following the song. */
  private readonly panTick = signal(0);

  /**
   * How far across the pane the playhead sits while the view is parked.
   *
   * A paged playhead is anywhere between the lead-in and the turn, and coming
   * off the song must not move the music under it: parking keeps the fraction
   * the playhead had, so the picture stays where the eye left it. A roll that
   * scrolls its notes has only one answer, which is {@link PLAYHEAD_AT}.
   */
  private readonly panLead = signal(PLAYHEAD_AT);

  /**
   * The tick the page grid is measured from, which a scroll moves.
   *
   * Zero is the song's own start, and a song nobody has scrolled keeps it: the
   * first page opens on the lead-in and every turn falls a stride after the last.
   * A scroll re-anchors it on the view it leaves behind, so returning to the song
   * carries on from what is on screen rather than from where the seeked tick
   * happens to sit in a grid measured from the beginning.
   */
  private readonly pageOrigin = signal(0);

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
    () => new Map(this.playback.channels().map((c) => [c.index, c.audible])),
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

  /** Only run a frame callback while something is actually moving. */
  private readonly running = computed(() => this.playback.isPlaying() && this.attached());

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
   * Three cases, and the middle one is the reason this is not a one-liner:
   * following the song, following a transport that is not running, and parked by
   * hand — which stays where it was put whatever the transport does.
   *
   * The middle one asks the transport rather than assuming the beginning. A stop
   * does put it back to tick 0 and the roll follows it there, but a scrub made
   * while the song is stopped seeks without starting it, and a roll that read a
   * stopped transport as tick 0 would throw that scrub away the moment it was
   * released — the bar would move, the song would not, and nothing would say why.
   */
  protected readonly playTick = computed(() => {
    if (this.following()) {
      return this.playhead.tick();
    }

    return this.attached() ? this.playback.songTicks().ticks : this.parkedTick();
  });

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
   * How far across the roll the playhead sits, as a fraction of its width.
   *
   * The whole difference between the two view modes. Scrolling the notes pins
   * the playhead and slides the music under it, so the fraction is fixed at
   * {@link PLAYHEAD_AT}; paging, the default, holds the music still and lets the
   * playhead cross the pane, so the fraction is how far into the current page it
   * has got. Parked, it is whatever it was when the view came off the song.
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
  private readonly viewTick = computed(() => this.playTick() - this.screenTicks() * this.lead());

  protected readonly playheadX = computed(() => KEY_WIDTH + this.rollWidth() * this.lead());

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

  /** Where the playhead sits along the bar. */
  protected readonly scrubX = computed(
    () => KEY_WIDTH + scrubOffset(this.playTick(), this.songTicks(), this.rollWidth()),
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
      tick: this.playTick(),
      audible: this.audible(),
    });
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
    effect(() => {
      const idle = this.playback.isIdle();
      untracked(() => {
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
}
