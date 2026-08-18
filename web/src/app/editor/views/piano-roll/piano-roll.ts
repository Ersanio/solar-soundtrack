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

import type { Span } from '@amk/core/types';
import type { WalkNote } from '@amk/spc/song-walk';
import { type CommandGlyph, CommandIcon } from '../../command-palette/command-icon';
import { glyphOf } from '../../command-palette/glyph-of';
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
import { ticksPerSecondAt } from '../../../state/song-clock';
import {
  type Lane,
  advanceTick,
  fitBarContent,
  gridLines,
  keyName,
  laneStack,
  noteLabel,
  pageStart,
  scrubOffset,
  scrubTick,
  tickWindow,
} from './roll-layout';

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

/** Height of the scrub bar: room for a pitch contour, little enough to stay chrome. */
const SCRUB_HEIGHT = 36;
/** Inset, so the top and bottom rows are not swallowed by the border. */
const SCRUB_PAD = 3;

const ZOOMS = [0.5, 1, 2, 4, 8] as const;
const ROW_HEIGHTS = [6, 9, 13] as const;

/**
 * Tailwind v4 scans source text, so a class name has to be a complete literal —
 * `fill-ch-${n}` generates no CSS at all and every note renders unpainted.
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

/** One note on the scrub bar's minimap. Every bar is the same colour. */
export interface ScrubBar {
  id: string;
  x: number;
  w: number;
  y: number;
  h: number;
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
  /** `C6` on a key, `@23` on a drum lane. `null` when the bar has no room. */
  label: { text: string; x: number; y: number; size: number } | null;
  /** As many as fit; the inspector is where the whole list is. */
  glyphs: readonly MarkGlyph[];
  note: WalkNote;
}

interface Settings {
  zoom: number;
  rowHeight: number;
  follow: boolean;
  /** Slide the music under a fixed playhead, rather than turning a page under it. */
  scrollNotes: boolean;
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
  scrollNotes?: unknown;
  allOctaves?: unknown;
  grid?: unknown;
  percussion?: unknown;
  percussionOpen?: unknown;
}

/**
 * The stored settings, field by field.
 *
 * Field by field and not a spread: a spread takes whatever is in storage on
 * trust, so a hand-edited `zoom: "big"` multiplies every mark's x into `NaN` and
 * blanks the roll, and `percussion: "yes"` would be handed to `new Set` as a
 * string of characters. The enumerated numbers are checked against their own
 * tables rather than by type, which is what makes them safe rather than merely
 * numeric.
 */
function readSettings(): Settings {
  const settings: Settings = {
    zoom: 2,
    rowHeight: 9,
    follow: true,
    scrollNotes: false,
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

  if (typeof stored.scrollNotes === 'boolean') {
    settings.scrollNotes = stored.scrollNotes;
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
  imports: [Button, Checkbox, CommandIcon, Toolbar],
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
  protected readonly scrollNotes = computed(() => this.settings().scrollNotes);
  protected readonly allOctaves = computed(() => this.settings().allOctaves);
  protected readonly grid = computed(() => this.settings().grid);

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

  /**
   * Whether the editor still shows the text that compiled.
   *
   * Everything joined back to the source takes this test — the tooltip's MML,
   * the held keys, a click, and the bars' glyphs. A boolean rather than the
   * comparison inline at each of them, so `marks` rebuilds when the answer
   * changes rather than on every keystroke that does not change it.
   */
  private readonly inSync = computed(() => this.editor.compiledText() === this.editor.source());

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

  /** Where each note was written, by the address the walk names it by. */
  private readonly written = computed(() => {
    const written = new Map<number, number>();
    for (const [address, entry] of this.editor.notesByAddress()) {
      written.set(address, entry.written);
    }

    return written;
  });

  /** One object per change of any input, rather than one per note. */
  private readonly placeContext = computed<PlaceContext>(() => ({
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

  /** Ticks across the roll at this zoom, which is what a page is measured in. */
  private readonly screenTicks = computed(() =>
    this.zoom() > 0 ? this.rollWidth() / this.zoom() : 0,
  );

  /** As far right as a scroll goes: the last tick, at {@link SCROLL_END_AT}. */
  private readonly maxPanTick = computed(() => {
    const pass = this.timeline()?.ticks ?? 0;
    return pass + (this.rollWidth() * (this.panLead() - SCROLL_END_AT)) / this.zoom();
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

  /** How often the readout is rewritten. Prose is read, not watched. */
  private static readonly READOUT_MS = 500;

  /**
   * The playhead as the readout states it, twice a second.
   *
   * The transform wants a tick every frame; a line of text does not. A count and
   * a ticks-per-second restated sixty times a second are a blur the eye cannot
   * read at all, so the readout takes the same clock slowly and the display
   * keeps the frame-rate one to itself.
   */
  private readonly slowTick = signal(0);
  private lastReadoutAt = 0;

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
      return this.shownTick();
    }

    return this.attached() ? this.playback.songTicks().ticks : this.parkedTick();
  });

  /** One frame of the display clock: read the driver, then hand it the step. */
  private advanceTo(frame: number): void {
    const anchor = this.playback.songTicks();
    const driver = this.playback.driver();
    const pass = this.timeline()?.ticks ?? 0;
    // How fast ticks are really going by, which is not what the tempo says. The
    // driver runs at most one tick per pass of its main loop, so a song that
    // asks for more than it can manage gets fewer — at `t254` on eight channels
    // about 231 of the 498 a second it wrote. Extrapolating at the tempo byte
    // would put the playhead most of a quarter note ahead of what is sounding;
    // `charttest` pins the difference.
    //
    // The tempo byte is still the fallback, for a song with no clock at all: it
    // is what the clock would predict anyway, minus the driver's shortfall.
    const clock = this.editor.clock();
    const rate = clock
      ? ticksPerSecondAt(clock, anchor.ticks)
      : driver && driver.tempo > 0
        ? // `DriverState.tempo` is `$51`, one higher than `t`.
          ticksPerSecond(driver.tempo - 1)
        : 0;

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

    if (frame - this.lastReadoutAt >= PianoRoll.READOUT_MS) {
      this.lastReadoutAt = frame;
      this.slowTick.set(this.shownTick());
    }
  }

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

  protected readonly scrubHeight = SCRUB_HEIGHT;

  /** Null until measured, so nothing renders against a zero-width box. */
  protected readonly scrubBox = computed(() => {
    const width = this.width();
    return width > 0 ? `0 0 ${width} ${SCRUB_HEIGHT}` : null;
  });

  /**
   * The whole song, drawn small.
   *
   * Built from the song, the lane stack and the pane's width, and deliberately
   * **not** from {@link playTick} — the bars are the song rather than a view of
   * it, so this rebuilds on a recompile, a percussion change or a resize, and
   * never on a frame. The moving parts of the bar are their own computeds below.
   *
   * Rows come from {@link rowOf}, the same function the roll's own marks ask, so
   * an instrument taken off the percussion lanes leaves the drum rows in both
   * pictures at once. Answering that question twice is how the two would drift.
   */
  protected readonly minimap = computed<ScrubBar[]>(() => {
    const song = this.timeline();
    const stack = this.stack();
    const width = this.rollWidth();
    const rows = stack.lanes.length;
    if (!song || song.ticks <= 0 || width <= 0 || rows <= 0) {
      return [];
    }

    const context = this.placeContext();
    const inner = SCRUB_HEIGHT - SCRUB_PAD * 2;
    const h = Math.max(1, inner / rows);

    // Keyed by the pixel a bar lands on and the row it lands in. Every bar is
    // one colour, so two notes sharing a pixel of a row are the same picture;
    // keeping the wider of them holds a long note's reach against a short one
    // starting alongside it. Never more bars than notes, and far fewer on a
    // dense song, which is what keeps the whole song inside the DOM.
    const cells = new Map<string, ScrubBar>();
    for (const note of song.notes) {
      const row = this.rowOf(note, stack, context);
      if (row < 0) {
        continue;
      }

      const x = KEY_WIDTH + scrubOffset(note.tick, song.ticks, width);
      const w = Math.max(1, scrubOffset(note.ticks, song.ticks, width));
      const key = `${Math.round(x)}:${row}`;
      const held = cells.get(key);
      if (held && held.w >= w) {
        continue;
      }

      cells.set(key, { id: key, x, w, y: SCRUB_PAD + (row / rows) * inner, h });
    }

    return [...cells.values()];
  });

  /** Where the playhead sits along the bar. */
  protected readonly scrubX = computed(() => {
    const song = this.timeline();
    return KEY_WIDTH + scrubOffset(this.playTick(), song?.ticks ?? 0, this.rollWidth());
  });

  /**
   * The slice of the song the roll is showing, as a box on the bar.
   *
   * Runs off both ends by design — a paged roll opens before tick 0 and the last
   * page reaches past the end — so the strip clips it rather than this clamping
   * it into something narrower than the pane it stands for.
   */
  protected readonly scrubWindow = computed(() => {
    const song = this.timeline();
    const width = this.rollWidth();
    if (!song || song.ticks <= 0 || width <= 0) {
      return null;
    }

    const from = (this.viewTick() / song.ticks) * width;
    const w = (this.screenTicks() / song.ticks) * width;
    return { x: KEY_WIDTH + from, w: Math.max(1, w) };
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
    const inForce = this.editor.commandsInForce();
    const marks: Mark[] = [];

    for (const note of song.notes) {
      if (note.tick > to || note.tick + note.ticks < from) {
        continue;
      }

      const row = this.rowOf(note, stack, context);
      if (row < 0) {
        continue;
      }

      const w = Math.max(1, note.ticks * zoom - NOTE_GAP);
      const h = Math.max(1, height - ROW_GAP * 2);
      const x = note.tick * zoom;
      const y = row * height + ROW_GAP;

      const acting = inForce(note).map((command) => ({
        command,
        entry: glyphOf(command),
      }));
      const drawable = acting.filter((each) => each.entry !== null);
      const name = this.headingOf(note, context);
      const content = fitBarContent(w, h, name, drawable.length);

      marks.push({
        id: `${note.address}:${note.tick}:${note.channel}`,
        x,
        w,
        gateW: Math.max(1, note.gateTicks * zoom - NOTE_GAP),
        y,
        h,
        fill: CHANNEL_FILL[note.channel],
        opacity: audible.get(note.channel) === false ? 0.12 : 1,
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
        note,
      });
    }

    return marks;
  });

  /**
   * What a note is called, which is the bar's name and the tooltip's heading.
   *
   * One helper for both, so a bar cannot say one thing and its own hover
   * another. Derived from where the mark actually sits: a bare `$D0` whose drum
   * the porter has taken off the lanes is drawn on a key, and calling it `@29`
   * would name a row it is not on.
   */
  private headingOf(note: WalkNote, context: PlaceContext, short = true): string {
    const place = placeOf(note, context);
    const key = keyOf(note, context);
    if (place === 'key' && key !== null) {
      return short ? noteLabel(key) : keyName(key);
    }

    return `@${note.state.instrument ?? 0}`;
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

        return key === null ? -1 : (stack.rowOfKey.get(key) ?? -1);
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
      const at = pitched ? keyOf(note, context) : null;
      rows.push(
        `@${instrument}${at === null ? '' : ` at ${keyName(at)}`}${place === 'drum' ? ' — a drum' : ''}${sample}`,
      );
    }

    // What the driver is handed, when that is not the pitch that was written.
    // `h` and the instrument's transposition are in the byte already; `$E4` and
    // `$FA $02` are added on the way to the DSP (`main.asm:439-442`). Said here
    // rather than drawn, so the row stays the note the source has.
    if (note.key !== null) {
      const written = context.written.get(note.address);
      const transposition: [number, string][] = [
        [written === undefined ? 0 : note.note - written, 'transposed'],
        [note.state.transpose, '$E4'],
        [note.state.tune, '$FA $02'],
      ];
      const applied = transposition.filter(([by]) => by !== 0);
      if (applied.length > 0) {
        const plays = keyName(note.key + note.state.transpose + note.state.tune);
        const by = applied.map(([n, what]) => `${what} ${n > 0 ? '+' : ''}${n}`).join(', ');
        rows.push(`plays as ${plays} — ${by}`);
      }
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

    const heading = this.headingOf(note, context, false);

    // A bar shows as many glyphs as it has room for, so the hover is where the
    // rest of them are named. The inspector lists them with their arguments.
    const acting = this.editor
      .commandsInForce()(note)
      .map((command) => glyphOf(command)?.label)
      .filter((label) => label !== undefined);
    if (acting.length > 0) {
      rows.push(`under ${acting.join(', ').toLowerCase()}`);
    }

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

    const span = this.editor.notesByAddress().get(note.address)?.span;
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
    return this.following() ? this.shownTick() : this.parkedTick();
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

  /**
   * The tick under a pointer on the scrub bar.
   *
   * Measured from the element the handler is on, so it stays right wherever the
   * pane is and however it is scrolled — and past either end it is the song's
   * own end, since a drag that leaves the bar is still asking for the last tick.
   */
  private scrubTickAt(event: PointerEvent): number {
    const box = (event.currentTarget as Element).getBoundingClientRect();
    return scrubTick(
      event.clientX - box.left - KEY_WIDTH,
      this.timeline()?.ticks ?? 0,
      Math.max(0, box.width - KEY_WIDTH),
    );
  }

  /**
   * Take the roll off the song and start scrubbing.
   *
   * The lead is read **once**, here, and held for the whole drag: it is where
   * the playhead sat when the gesture began, and re-reading it per move would
   * slide the music sideways under a pointer that had not moved.
   */
  protected onScrubDown(event: PointerEvent): void {
    const song = this.timeline();
    if (!song || song.ticks <= 0) {
      return;
    }

    event.preventDefault();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const lead = this.parkedLead();
    this.dragging.set(true);
    this.scrolling.set(true);
    this.panLead.set(lead);
    this.scrubTo(event);
  }

  protected onScrubMove(event: PointerEvent): void {
    if (this.dragging()) {
      this.scrubTo(event);
    }
  }

  protected onScrubUp(event: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }

    const target = event.currentTarget as Element;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }

    this.dragging.set(false);
    this.commitScroll();
  }

  /** One step of a drag: move the view, and preview the position. */
  private scrubTo(event: PointerEvent): void {
    this.panTick.set(this.scrubTickAt(event));
    this.playback.scrubTo(this.parkedTick());
  }

  /** The end of a scrub: the song jumps to where the roll was left. */
  private commitScroll(): void {
    const to = this.parkedTick();
    // Re-anchor the pages on the view the scroll is leaving, so the notes stay
    // exactly where the wheel put them. Before the seek can be refused, because
    // a scroll made while the transport was stopped is released by the effect
    // below rather than here, and it re-attaches to this same grid.
    this.pageOrigin.set(
      to - this.screenTicks() * this.panLead() + this.screenTicks() * PAGE_LEAD_IN,
    );
    if (!this.playback.canSeek()) {
      return;
    }

    this.shownTick.set(to);
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

  /**
   * Clicking a note selects it in the source, the way a diagnostic does.
   *
   * Suppressed whenever the editor has moved on from the text that compiled: a
   * span into a document that has changed underneath points at the wrong thing,
   * and the same test guards the highlights.
   */
  protected reveal(mark: Mark): void {
    this.select(mark, true);
  }

  /**
   * A single click asks about the note; a double click goes to it.
   *
   * The quiet form leaves the roll on screen, which is the whole point of
   * splitting them: the inspector sits in the pane beside this one and answers
   * from the caret, so moving the caret is enough and switching tabs would take
   * away the thing being asked about. {@link EditorStore.inspecting} carries the
   * one thing the caret cannot — which pass of a loop this bar is.
   */
  protected select(mark: Mark, show = false): void {
    if (!this.inSync()) {
      return;
    }

    const span = this.editor.notesByAddress().get(mark.note.address)?.span;
    if (span) {
      this.editor.inspecting.set({ address: mark.note.address, tick: mark.note.tick });
      this.editor.reveal.set({ span: { ...span }, show });
    }
  }

  /** A glyph is its own target: the command it stands for, not the note under it. */
  protected inspect(glyph: MarkGlyph, event: Event, show = false): void {
    // Without this the bar underneath answers as well, and the note would win.
    event.stopPropagation();
    if (this.inSync()) {
      this.editor.reveal.set({ span: { ...glyph.span }, show });
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

  /**
   * The tick the readout reports.
   *
   * Slow only while the song is carrying the playhead along. A parked or stopped
   * roll is not moving, so there is nothing to blur and the reading is exact —
   * and a scroll's own readout must answer the wheel rather than half a second
   * after it.
   */
  private readonly readoutTick = computed(() =>
    this.following() ? this.slowTick() : this.playTick(),
  );

  protected readonly readout = computed(() => {
    const song = this.timeline();
    if (!song) {
      return 'no song';
    }

    const driver = this.playback.driver();
    const tempo = driver && driver.tempo > 0 ? driver.tempo - 1 : 0;
    const tick = this.readoutTick();
    const parts = [`tick ${Math.round(tick).toLocaleString()} of ${song.ticks.toLocaleString()}`];
    if (tempo > 0) {
      // The rate the song is *getting*, which on a busy one is not the rate the
      // tempo byte asks for — the driver runs at most one tick per pass of its
      // main loop. Both are shown when they part company by enough to matter,
      // since "t254 · 231 ticks/s" on its own reads like a bug in the readout.
      const clock = this.editor.clock();
      const asked = ticksPerSecond(tempo);
      const got = clock ? ticksPerSecondAt(clock, tick) : asked;
      const rate =
        got > 0 && got < asked * 0.95
          ? `${got.toFixed(1)} of ${asked.toFixed(1)} ticks/s`
          : `${asked.toFixed(1)} ticks/s`;
      parts.push(`t${tempo} · ${rate}`);
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
