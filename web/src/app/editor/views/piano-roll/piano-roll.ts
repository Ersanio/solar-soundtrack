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

import type { WalkNote } from '@amk/spc/song-walk';
import { noteName, ticksPerSecond } from '@amk/tokens/commands/units';
import { noiseHz } from '@amk/spc/adsr';
import {
  FIRST_CUSTOM_INSTRUMENT,
  FIRST_PERCUSSION_INSTRUMENT,
  NOISE_FLAG,
} from '@amk/spc/instruments';
import {
  DEFAULT_PERCUSSION,
  type PlaceContext,
  keyOf,
  parsePercussion,
  placeOf,
  rollShape,
} from './percussion';
import { Button } from '../../../shared/button/button';
import { Checkbox } from '../../../shared/checkbox/checkbox';
import { Toolbar } from '../../../shared/toolbar/toolbar';
import { elementSize } from '../../../shared/chart/element-size';
import { frameClock } from '../../../shared/chart/frame-clock';
import { clamp } from '../../../util/math';
import { DriverStore } from '../../../state/driver-store';
import { EditorStore } from '../../../state/editor-store';
import { Playback } from '../../../state/playback';
import { type Lane, advanceTick, gridLines, laneStack, tickWindow } from './roll-layout';

/** Width of the key column. Wide enough for a drum's longest label, `@29 o4 c+`. */
const KEY_WIDTH = 76;
/** Where the playhead sits across the roll: a fifth in, so you see what is coming. */
const PLAYHEAD_AT = 0.2;
/** Gap between a note and its row's edges, so two rows never merge into a block. */
const ROW_GAP = 1;
/** The surface gap between two bars that meet, per the mark spec. */
const NOTE_GAP = 2;
/** How far the tooltip sits from the pointer, so the cursor never covers it. */
const TOOLTIP_GAP = 14;
/** How long the wheel must be quiet before a scroll becomes a seek. */
const SEEK_QUIET_MS = 200;
/**
 * Where the song's last tick sits once the scroll has run as far right as it
 * goes — a little past the playhead, so the end of the song can be read with
 * some room after it rather than pinned under the line.
 */
const SCROLL_END_AT = 0.1;

const ZOOMS = [0.5, 1, 2, 4, 8] as const;
const ROW_HEIGHTS = [6, 9, 13] as const;

/**
 * Tailwind v4 scans source text, so a class name has to be a complete literal —
 * `fill-ch-${n}` generates no CSS at all and every note renders unpainted.
 * `aram-bar.ts` learned this the same way.
 */
const CHANNEL_FILL: readonly string[] = [
  'fill-ch-0',
  'fill-ch-1',
  'fill-ch-2',
  'fill-ch-3',
  'fill-ch-4',
  'fill-ch-5',
  'fill-ch-6',
  'fill-ch-7',
];

const STORAGE_KEY = 'solar-soundtrack.pianoroll';

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
  note: WalkNote;
}

interface Settings {
  zoom: number;
  rowHeight: number;
  follow: boolean;
  allOctaves: boolean;
  grid: boolean;
  /** Instruments drawn on percussion lanes, ascending. */
  percussion: readonly number[];
  percussionOpen: boolean;
}

/** Every field `unknown`, because none of it is ours until it is checked. */
interface StoredSettings {
  zoom?: unknown;
  rowHeight?: unknown;
  follow?: unknown;
  allOctaves?: unknown;
  grid?: unknown;
  percussion?: unknown;
  percussionOpen?: unknown;
}

/**
 * The stored settings, field by field.
 *
 * Field by field and not a spread, which is what this used to be: a spread takes
 * whatever is in storage on trust, so a hand-edited `zoom: "big"` multiplies
 * every mark's x into `NaN` and blanks the roll, and `percussion: "yes"` would
 * be handed to `new Set` as a string of characters. The enumerated numbers are
 * checked against their own tables rather than by type, which is what makes
 * them safe rather than merely numeric.
 */
function readSettings(): Settings {
  const settings: Settings = {
    zoom: 2,
    rowHeight: 9,
    follow: true,
    allOctaves: false,
    grid: true,
    percussion: [...DEFAULT_PERCUSSION],
    percussionOpen: false,
  };

  let stored: StoredSettings | null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    stored = raw ? (JSON.parse(raw) as StoredSettings) : null;
  } catch {
    stored = null; // Unreadable or not ours; the defaults are fine.
  }

  if (!stored) {
    return settings;
  }

  if (ZOOMS.includes(stored.zoom as (typeof ZOOMS)[number])) {
    settings.zoom = stored.zoom as number;
  }

  if (ROW_HEIGHTS.includes(stored.rowHeight as (typeof ROW_HEIGHTS)[number])) {
    settings.rowHeight = stored.rowHeight as number;
  }

  if (typeof stored.follow === 'boolean') {
    settings.follow = stored.follow;
  }

  if (typeof stored.allOctaves === 'boolean') {
    settings.allOctaves = stored.allOctaves;
  }

  if (typeof stored.grid === 'boolean') {
    settings.grid = stored.grid;
  }

  if (typeof stored.percussionOpen === 'boolean') {
    settings.percussionOpen = stored.percussionOpen;
  }

  const percussion = parsePercussion(stored.percussion);
  if (percussion) {
    settings.percussion = percussion;
  }

  return settings;
}

/**
 * The song as music: a keyboard down the left, time running right, and all
 * eight channels in one roll.
 *
 * Two clocks drive it and keeping them apart is what makes it smooth. The mark
 * list is a `computed` over the transport's 10 Hz anchor, snapped to a whole
 * note, so the DOM rebuilds a couple of times per screen. The scroll is a
 * `computed` over the frame clock and is one `transform` — nothing beneath it
 * reads the frame clock, so nothing beneath it re-evaluates.
 */
@Component({
  selector: 'amk-piano-roll',
  imports: [Button, Checkbox, Toolbar],
  templateUrl: './piano-roll.html',
  host: { class: 'relative flex min-h-0 min-w-0 flex-col' },
})
export class PianoRoll {
  private readonly editor = inject(EditorStore);
  private readonly drivers = inject(DriverStore);
  protected readonly playback = inject(Playback);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');
  private readonly size = elementSize(this.viewport);

  private readonly settings = signal<Settings>(readSettings());

  protected readonly zoom = computed(() => this.settings().zoom);
  protected readonly follow = computed(() => this.settings().follow);
  protected readonly allOctaves = computed(() => this.settings().allOctaves);
  protected readonly grid = computed(() => this.settings().grid);

  /** Where the view is parked when it is not following the song. */
  private readonly panTick = signal(0);

  /** A scroll in progress: the roll is off the song until the wheel goes quiet. */
  private readonly scrolling = signal(false);
  private seekTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly timeline = computed(() => this.editor.timeline());

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

  /** One object per change of any input, rather than one per note. */
  private readonly placeContext = computed<PlaceContext>(() => ({
    percussion: this.percussion(),
    noisy: this.noiseInstruments(),
    drumNotes: this.drumNotes(),
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
  protected readonly playheadX = computed(() => KEY_WIDTH + this.rollWidth() * PLAYHEAD_AT);

  /** As far right as a scroll goes: the last tick, at {@link SCROLL_END_AT}. */
  private readonly maxPanTick = computed(() => {
    const pass = this.timeline()?.ticks ?? 0;
    return pass + (this.rollWidth() * (PLAYHEAD_AT - SCROLL_END_AT)) / this.zoom();
  });

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
    const pass = this.timeline()?.ticks ?? 0;
    return pass > 0 ? clamp(this.panTick(), 0, this.maxPanTick()) : Math.max(0, this.panTick());
  });

  // --- the clock -----------------------------------------------------------

  /** On the song: following it, and not taken off it by a scroll. */
  private readonly attached = computed(() => this.follow() && !this.scrolling());

  /** Only run a frame callback while something is actually moving. */
  private readonly running = computed(() => this.playback.isPlaying() && this.attached());
  private readonly frame = frameClock(this.running);

  /**
   * How far a smoothed tick may run past its anchor.
   *
   * The anchors land ten times a second, so a sixth of a second is already more
   * rope than a healthy stream needs. It matters when the stream stalls — a long
   * recompile, a throttled tab — where the roll drifts a fraction of a second
   * ahead and stops, rather than sailing away from the audio.
   */
  private static readonly MAX_EXTRAPOLATION = 0.15;

  /**
   * The playhead, in ticks, at frame rate.
   *
   * A signal rather than a `computed` because the clock carries its position
   * across frames — see `advanceTick`, which is where the reasoning and the
   * arithmetic both live.
   */
  private readonly shownTick = signal(0);
  private lastFrameAt = 0;

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
   * following the song, following a transport that has stopped — which is back
   * at the beginning, so the roll goes there too — and parked by hand, which
   * stays where it was put whatever the transport does.
   */
  protected readonly playTick = computed(() => {
    if (this.following()) {
      return this.shownTick();
    }

    return this.attached() ? 0 : this.parkedTick();
  });

  /** One frame of the display clock: read the driver, then hand it the step. */
  private advanceTo(frame: number): void {
    const anchor = this.playback.songTicks();
    const driver = this.playback.driver();
    const pass = this.timeline()?.ticks ?? 0;
    // `DriverState.tempo` is `$51`, which the driver holds one higher than `t`.
    const rate = driver && driver.tempo > 0 ? ticksPerSecond(driver.tempo - 1) : 0;

    const elapsed = this.lastFrameAt === 0 ? 0 : (frame - this.lastFrameAt) / 1000;
    this.lastFrameAt = frame;

    // Where the driver says the song is, carried the short way from the anchor
    // to now, and never past the end of the pass — the anchor is folded into one
    // pass, so running beyond it would draw the playhead off the end.
    const since = Math.max(0, (frame - anchor.at) / 1000);
    const reach = anchor.ticks + Math.min(since, PianoRoll.MAX_EXTRAPOLATION) * rate;

    this.shownTick.set(
      advanceTick({
        shown: this.shownTick(),
        target: pass > 0 ? clamp(reach, 0, pass) : Math.max(0, reach),
        rate,
        elapsed,
        pass,
      }),
    );
  }

  /**
   * The 10 Hz anchor the mark window is snapped around, so it moves rarely.
   *
   * Follows the same rule as {@link playTick} and must: the transform and the
   * marks are two halves of one picture, so a pause that moved one and not the
   * other would scroll to the paused position and find nothing drawn there.
   */
  private readonly windowTick = computed(() => {
    if (this.following()) {
      return this.playback.songTicks().ticks;
    }

    return this.attached() ? 0 : this.parkedTick();
  });

  protected readonly scroll = computed(() => {
    const x = KEY_WIDTH + this.rollWidth() * PLAYHEAD_AT - this.playTick() * this.zoom();
    return `translate(${x.toFixed(2)} 0)`;
  });

  // --- marks ---------------------------------------------------------------

  private readonly window = computed(() =>
    tickWindow(this.windowTick(), this.rollWidth(), this.zoom(), PLAYHEAD_AT),
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

  protected readonly marks = computed<Mark[]>(() => {
    const song = this.timeline();
    const stack = this.stack();
    const { from, to } = this.window();
    const zoom = this.zoom();
    const height = this.rowHeight();
    if (!song || zoom <= 0) {
      return [];
    }

    const audible = new Map(this.playback.channels().map((c) => [c.index, c.audible]));
    const context = this.placeContext();
    const marks: Mark[] = [];

    for (const note of song.notes) {
      if (note.tick > to || note.tick + note.ticks < from) {
        continue;
      }

      const row = this.rowOf(note, stack, context);
      if (row < 0) {
        continue;
      }

      marks.push({
        id: `${note.address}:${note.tick}:${note.channel}`,
        x: note.tick * zoom,
        w: Math.max(1, note.ticks * zoom - NOTE_GAP),
        gateW: Math.max(1, note.gateTicks * zoom - NOTE_GAP),
        y: row * height + ROW_GAP,
        h: Math.max(1, height - ROW_GAP * 2),
        fill: CHANNEL_FILL[note.channel],
        opacity: audible.get(note.channel) === false ? 0.12 : 1,
        note,
      });
    }

    return marks;
  });

  /**
   * Which row a note belongs on.
   *
   * The placement itself is `placeOf`, which the fitted range is built from too
   * — they were two implementations of the same precedence and had to agree, so
   * now they are one. This only turns its answer into a row.
   *
   * By instrument, not by note byte: every note played while a drum is loaded is
   * that drum being hit, so `@29 c d e` is three hits on one lane rather than
   * one drum and two notes scattered across the keyboard. The pitched ones only
   * look melodic because `parser.ts:2676` stops remapping after the first.
   */
  private rowOf(
    note: WalkNote,
    stack: ReturnType<typeof laneStack>,
    context: PlaceContext,
  ): number {
    switch (placeOf(note, context)) {
      case 'drum':
        return stack.rowOfDrum.get(note.state.instrument ?? -1) ?? -1;

      case 'noise':
        return stack.noiseRow;

      case 'key': {
        const key = keyOf(note, context);

        return key === null ? -1 : (stack.rowOfKey[key] ?? -1);
      }

      case 'none':
        return -1;
    }
  }

  protected readonly lines = computed(() => {
    if (!this.grid()) {
      return [];
    }

    const { from, to } = this.window();
    return gridLines(from, to, 48).map((line) => ({ ...line, x: line.tick * this.zoom() }));
  });

  protected readonly loopX = computed(() => {
    const loop = this.timeline()?.loopTick;
    return loop === null || loop === undefined || loop === 0 ? null : loop * this.zoom();
  });

  protected readonly endX = computed(() => {
    const song = this.timeline();
    return song && song.ticks > 0 ? song.ticks * this.zoom() : null;
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

    const tick = this.playTick();
    const stack = this.stack();
    const context = this.placeContext();
    const audible = new Map(this.playback.channels().map((c) => [c.index, c.audible]));
    const held = new Set<number>();

    for (const note of song.notes) {
      if (note.tick > tick) {
        break; // sorted by tick
      }

      if (tick < note.tick + note.gateTicks && audible.get(note.channel) !== false) {
        const row = this.rowOf(note, stack, context);
        if (row >= 0) {
          held.add(row);
        }
      }
    }

    return held;
  });

  // --- tooltip -------------------------------------------------------------

  protected readonly hovered = signal<Mark | null>(null);
  protected readonly pointer = signal({ x: 0, y: 0, width: 0, height: 0 });

  protected readonly tooltip = computed(() => {
    const mark = this.hovered();
    const song = this.timeline();
    if (!mark || !song) {
      return null;
    }

    const note = mark.note;
    const tempo = note.state.tempo;
    const rows: string[] = [];

    const context = this.placeContext();
    const place = placeOf(note, context);
    const instrument = note.state.instrument;

    if (instrument !== null) {
      // The driver's own table entry, stated whether or not the porter counts
      // this instrument as percussion — `@21` is the driver's drum playing its
      // sample either way, and that is a fact about the image, not a preference.
      const entry =
        instrument >= FIRST_PERCUSSION_INSTRUMENT && instrument < FIRST_CUSTOM_INSTRUMENT
          ? this.drivers.instruments()?.percussion[instrument - FIRST_PERCUSSION_INSTRUMENT]
          : undefined;
      const sample = entry ? `, sample $${(entry.srcn ?? 0).toString(16).padStart(2, '0')}` : '';

      // A drum written at a pitch of its own is the interesting case, and the
      // one its lane cannot show: `@29 c` and `@29 g` are one drum at two rates.
      const pitched = place === 'drum' && note.percussion === null;
      rows.push(
        `@${instrument}${pitched ? ` at ${noteName(note.note)}` : ''}${place === 'drum' ? ' — a drum' : ''}${sample}`,
      );
    }

    if (note.state.noise !== null) {
      rows.push(
        `noise — clock $${note.state.noise.toString(16)}, ${Math.round(noiseHz(note.state.noise))} Hz`,
      );
    }

    if (note.state.volume !== null) {
      rows.push(`v${note.state.volume}`);
    }

    if (note.state.quantization !== null) {
      rows.push(
        `q${note.state.quantization.toString(16).toUpperCase()} — sounds ${note.gateTicks} of ${note.ticks}`,
      );
    }

    if (tempo > 0) {
      rows.push(`t${tempo} — ${ticksPerSecond(tempo).toFixed(1)} ticks per second`);
    }

    // Derived from where the mark actually sits, so the two cannot contradict
    // each other: a bare `$D0` whose drum the porter has removed is drawn on a
    // key, and a heading reading `@29` would be pointing at the wrong row.
    const key = keyOf(note, context);
    const heading = place === 'key' && key !== null ? noteName(0x80 | key) : `@${instrument}`;

    const at = this.pointer();
    const leftward = at.x > at.width / 2;
    const upward = at.y > at.height / 2;

    return {
      heading: `${heading} · channel ${note.channel}`,
      length: `tick ${note.tick} · ${note.ticks} ticks`,
      rows,
      source: this.sourceOf(note),
      left: leftward ? null : at.x + TOOLTIP_GAP,
      right: leftward ? at.width - at.x + TOOLTIP_GAP : null,
      top: upward ? null : at.y + TOOLTIP_GAP,
      bottom: upward ? at.height - at.y + TOOLTIP_GAP : null,
    };
  });

  /** The MML the note came from, when the editor still shows the text that compiled. */
  private sourceOf(note: WalkNote): string | null {
    const text = this.editor.compiledText();
    if (text === null || text !== this.editor.source()) {
      return null;
    }

    const span = this.editor
      .result()
      ?.noteMap?.find((entry) => entry.address === note.address)?.span;
    return span ? text.slice(span.start, span.end) : null;
  }

  // --- interaction ---------------------------------------------------------

  constructor() {
    // Sanctioned effect: driving the display clock. The frame stamp is the only
    // thing tracked — everything the step reads is deliberately untracked, so
    // this runs once per frame and not once per anchor as well.
    effect(() => {
      const frame = this.frame();
      untracked(() => this.advanceTo(frame));
    });

    // Sanctioned effect: mirroring state into localStorage, as `editor-pane.ts`
    // does for the selected tab.
    effect(() => {
      const settings = this.settings();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch {
        /* Private browsing, or a full quota. The controls still work this session. */
      }
    });

    // Sanctioned effect: releasing a view a scroll had to hold on to. A scroll
    // made while the transport was stopped could not seek, so the roll stayed
    // where it was put; pressing play gives it a song to follow again. Guarded
    // on the timer so it cannot fire in the middle of a gesture.
    effect(() => {
      const idle = this.playback.isIdle();
      untracked(() => {
        if (!idle && this.seekTimer === undefined) {
          this.scrolling.set(false);
        }
      });
    });

    // A scroll can be one click away from a component that no longer exists —
    // the roll is rebuilt on every tab switch. Honour the gesture rather than
    // stranding the transport on a scrub nothing will commit.
    this.destroyRef.onDestroy(() => {
      if (this.seekTimer !== undefined) {
        this.commitScroll();
      }
    });
  }

  /**
   * Where the roll is right now, whether it is following the song or parked.
   *
   * What "stop following" has to start from, and the reason parking is done at
   * the two places that stop rather than in an effect watching the flag: an
   * effect runs after the handler, so a wheel event that turned following off
   * and panned in one go had its pan overwritten by the parking that followed
   * it — the first notch of every scroll was swallowed.
   */
  private currentTick(): number {
    return this.following() ? this.shownTick() : this.parkedTick();
  }

  protected setZoom(direction: number): void {
    const at = ZOOMS.indexOf(this.zoom() as (typeof ZOOMS)[number]);
    const next = clamp((at < 0 ? 2 : at) + direction, 0, ZOOMS.length - 1);
    this.settings.update((s) => ({ ...s, zoom: ZOOMS[next] }));
  }

  protected setRowHeight(direction: number): void {
    const at = ROW_HEIGHTS.indexOf(this.rowHeight() as (typeof ROW_HEIGHTS)[number]);
    const next = clamp((at < 0 ? 1 : at) + direction, 0, ROW_HEIGHTS.length - 1);
    this.settings.update((s) => ({ ...s, rowHeight: ROW_HEIGHTS[next] }));
  }

  protected setFollow(follow: boolean): void {
    if (!follow) {
      this.panTick.set(this.currentTick());
    }

    this.settings.update((s) => ({ ...s, follow }));
  }

  protected setAllOctaves(allOctaves: boolean): void {
    this.settings.update((s) => ({ ...s, allOctaves }));
  }

  protected setGrid(grid: boolean): void {
    this.settings.update((s) => ({ ...s, grid }));
  }

  protected setPercussionOpen(percussionOpen: boolean): void {
    this.settings.update((s) => ({ ...s, percussionOpen }));
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

  /** Scrolling the roll seeks the song.  */
  protected onWheel(event: WheelEvent): void {
    const along = event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0;
    if (along === 0) {
      return;
    }

    event.preventDefault();
    // Read where the roll is before it comes off the song, so the scroll starts
    // from what is on screen rather than from wherever it was last parked.
    const from = this.currentTick();
    this.scrolling.set(true);
    this.panTick.set(Math.max(0, from + along / this.zoom()));
    this.playback.scrubToTick(this.parkedTick());

    clearTimeout(this.seekTimer);
    this.seekTimer = setTimeout(() => this.commitScroll(), SEEK_QUIET_MS);
  }

  /** The end of a scroll: the song jumps to where the roll was left. */
  private commitScroll(): void {
    clearTimeout(this.seekTimer);
    this.seekTimer = undefined;

    const to = this.parkedTick();
    if (!this.playback.canSeek()) {
      return;
    }

    this.shownTick.set(to);
    this.scrolling.set(false);
    this.playback.seekTick(to);
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

  /**
   * Clicking a note selects it in the source, the way a diagnostic does.
   *
   * Suppressed whenever the editor has moved on from the text that compiled: a
   * span into a document that has changed underneath points at the wrong thing,
   * and the same test guards the highlights.
   */
  protected reveal(mark: Mark): void {
    if (this.editor.compiledText() !== this.editor.source()) {
      return;
    }

    const span = this.editor
      .result()
      ?.noteMap?.find((entry) => entry.address === mark.note.address)?.span;
    if (span) {
      this.editor.reveal.set({ ...span });
    }
  }

  /** The row's background behind the notes. */
  protected laneClass(lane: Lane): string {
    if (lane.kind !== 'key') {
      return 'fill-raised';
    }

    return lane.black ? 'fill-inset' : 'fill-surface';
  }

  /**
   * The key itself, which is a real keyboard: white keys pale, black keys dark,
   * and a lit one in the accent. The label is painted to suit — dark on a pale
   * key, pale on a dark one — so it stays readable in all three states.
   */
  protected keyClass(lane: Lane, held: boolean): string {
    if (held) {
      return 'fill-accent';
    }

    if (lane.kind !== 'key') {
      return 'fill-edge';
    }

    return lane.black ? 'fill-inset' : 'fill-ink';
  }

  protected keyTextClass(lane: Lane, held: boolean): string {
    if (held) {
      return 'fill-surface';
    }

    if (lane.kind !== 'key') {
      return 'fill-ink';
    }

    return lane.black ? 'fill-ink-muted' : 'fill-surface';
  }

  /** A label needs a row it can sit in without touching both edges. */
  protected readonly showLabels = computed(() => this.rowHeight() >= 11);
  protected readonly labelSize = computed(() => clamp(this.rowHeight() - 4, 7, 11));

  protected readonly readout = computed(() => {
    const song = this.timeline();
    if (!song) {
      return 'no song';
    }

    const driver = this.playback.driver();
    const tempo = driver && driver.tempo > 0 ? driver.tempo - 1 : 0;
    const parts = [
      `tick ${Math.round(this.playTick()).toLocaleString()} of ${song.ticks.toLocaleString()}`,
    ];
    if (tempo > 0) {
      parts.push(`t${tempo} · ${ticksPerSecond(tempo).toFixed(1)} ticks/s`);
    }

    parts.push(`${song.notes.length.toLocaleString()} notes`);
    return parts.join(' · ');
  });

  /** Anything the walk could not make sense of, said in words rather than colour. */
  protected readonly problems = computed(() => this.timeline()?.problems ?? []);

  // --- the percussion set --------------------------------------------------

  protected readonly percussionOpen = computed(() => this.settings().percussionOpen);

  /**
   * One chip per instrument the song plays, as a view model rather than methods
   * called per row — `web/README.md` on why.
   */
  protected readonly percussionChips = computed(() => {
    const chosen = this.percussion();
    const drums = this.drumNotes();
    return (this.timeline()?.usedInstruments ?? []).map((instrument) => {
      const sounds = drums.get(instrument);
      return {
        instrument,
        label: `@${instrument}`,
        on: chosen.has(instrument),
        title:
          sounds === undefined
            ? `Draw @${instrument} on a percussion lane instead of the keyboard`
            : `@${instrument} is one of the driver's own drums, and plays ${noteName(sounds)}`,
      };
    });
  });

  /** Both sides are sorted, so this is a string compare. Mirrors the mixer's Reset. */
  protected readonly hasPercussionOverrides = computed(
    () => this.settings().percussion.join(',') !== DEFAULT_PERCUSSION.join(','),
  );

  protected chipClass(on: boolean): string {
    return `cursor-pointer rounded px-2 py-0.5 font-mono text-xs transition-colors ${
      on ? 'bg-accent/20 text-accent font-semibold' : 'text-ink-muted hover:text-ink'
    }`;
  }
}
