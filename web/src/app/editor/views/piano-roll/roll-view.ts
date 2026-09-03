import {
  DestroyRef,
  type Signal,
  type WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';

import { EditorStore } from '../../../state/editor-store';
import { Playback } from '../../../state/playback';
import { clamp } from '../../../util/math';
import { onChange } from '../../../util/on-change';
import {
  PAGE_LEAD_IN,
  PAGE_STEP,
  PAGE_TURN_AT,
  PLAYHEAD_AT,
  PULL_PANES_PER_SEC,
  SCROLL_END_AT,
  rollCamera,
} from './roll-camera';
import { rollClock } from './roll-clock';
import {
  edgeUrgency,
  overviewOffset,
  overviewTick,
  pageStart,
  tickAtX,
  xAtTick,
} from './roll-layout';
import { KEY_WIDTH, OVERVIEW_HEIGHT, SCRUB_HEIGHT } from './roll-metrics';

export interface ViewSources {
  /** Pixels per tick. */
  zoom: Signal<number>;
  /** Whether the view follows the song. */
  follow: Signal<boolean>;
  /** On, a followed roll pins the playhead and slides the music under it. */
  scrollNotes: Signal<boolean>;
  /** The song's whole length in ticks. `0` for a song with no end to hold against. */
  songTicks: Signal<number>;
  /** The pane's width, and the part of it the notes are drawn in. */
  width: Signal<number>;
  rollWidth: Signal<number>;
}

export interface ViewSinks {
  /**
   * Write the Follow setting, and nothing else.
   *
   * The parking half is {@link RollView.setFollow}, which is the only mutator
   * anything outside this file may call: two mutators named for one flag is how
   * a later caller skips the park.
   */
  writeFollow(follow: boolean): void;
}

export interface RollView {
  /** Where the view is parked when it is not following the song. */
  panTick: WritableSignal<number>;
  /** A pointer is down on one of the two bars. */
  dragging: Signal<boolean>;
  /** The tick at the roll's left edge, which is the camera. */
  viewTick: Signal<number>;
  /** The 10 Hz anchor the mark window is snapped around. */
  windowTick: Signal<number>;
  /** Where the playhead is drawn, in ticks — the scrub's preview included. */
  headTick: Signal<number>;
  /** Where the camera is, in ticks. */
  playTick: Signal<number>;
  /** The song's own tick, in the camera's coordinates. */
  playheadX: Signal<number>;
  /** The roll's `transform`, at frame rate. */
  scroll: Signal<string>;
  /** The overview bar's `viewBox`, or `null` until the pane is measured. */
  overviewBox: Signal<string | null>;
  /** The playhead along the overview bar. */
  overviewX: Signal<number>;
  /** The slice of the song the roll is showing, as a box on the overview bar. */
  overviewWindow: Signal<{ x: number; w: number } | null>;
  /** The scrub bar's `viewBox`, or `null` until the pane is measured. */
  scrubBox: Signal<string | null>;
  /** Take the roll off the song, or put it back — parking the camera as it goes. */
  setFollow(follow: boolean): void;
  onPanStart(offset: number): void;
  onPanTo(offset: number): void;
  onPanEnd(): void;
  onScrubStart(offset: number): void;
  onScrubTo(offset: number): void;
  onScrubEnd(): void;
}

/**
 * Where the roll is looking, and the two drags that move it.
 *
 * The camera, the display clock and the geometry of the bars over the roll are
 * one subject: every one of them is the same question — which ticks are on
 * screen, and where the song has got to within them — and the two bars are
 * pointer reporters that emit an x, so both mappings need the camera to mean
 * anything at all.
 *
 * A composable in `roll-clock.ts`'s shape, and it **must be called from an
 * injection context** for the same reason: it starts an effect, a frame
 * callback and a `requestAnimationFrame` pull, and takes `DestroyRef` to stop
 * them. It injects `Playback` and `EditorStore` rather than taking a dozen of
 * their signals as sources, as `commands/byte-args.ts` injects `EditorStore`;
 * what stays in the source bag is the roll's own numbers, which the component
 * owns and this file cannot reach.
 */
export function rollView(sources: ViewSources, sinks: ViewSinks): RollView {
  const playback = inject(Playback);
  const editor = inject(EditorStore);

  /**
   * The camera, which outlives the component — see `roll-camera.ts`. Aliased so
   * that reading and moving it stays an ordinary signal read and an ordinary set.
   */
  const panTick = rollCamera.panTick;
  const panLead = rollCamera.panLead;
  const pageOrigin = rollCamera.pageOrigin;

  /**
   * The tick a scrub is asking for, or null when none is.
   *
   * A seek is previewed rather than made per move — the emulator has no snapshot
   * to jump to, so one seek per pixel is one silent replay per pixel — and this
   * is where the roll shows the preview. The camera does not read it: see
   * {@link playTick}.
   */
  const seeking = signal<number | null>(null);

  /** A pointer is down on one of the two bars. */
  const dragging = signal(false);

  // --- the camera ----------------------------------------------------------

  /** Ticks across the roll at this zoom, which is what a page is measured in. */
  const screenTicks = computed(() =>
    sources.zoom() > 0 ? sources.rollWidth() / sources.zoom() : 0,
  );

  /** As far right as a scroll goes: the last tick, at {@link SCROLL_END_AT}. */
  const maxPanTick = computed(
    () =>
      sources.songTicks() + (sources.rollWidth() * (panLead() - SCROLL_END_AT)) / sources.zoom(),
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
  const parkedTick = computed(() => {
    const pass = sources.songTicks();
    return pass > 0 ? clamp(panTick(), 0, maxPanTick()) : Math.max(0, panTick());
  });

  // --- the clock -----------------------------------------------------------

  /**
   * Only run a frame callback while something is actually moving.
   *
   * Which is any playing song, parked or not: a parked roll holds the music
   * still and the playhead goes on crossing it, so the line still needs a frame
   * clock — and costs less than a following one, whose transform moves too.
   */
  const running = computed(() => playback.isPlaying());

  /** The tempo as `t` writes it — `DriverState.tempo` is `$51`, one higher. */
  const tempo = computed(() => {
    const driver = playback.driver();
    return driver && driver.tempo > 0 ? driver.tempo - 1 : 0;
  });

  const playhead = rollClock({
    running,
    anchor: playback.songTicks,
    clock: editor.clock,
    tempo,
    pass: sources.songTicks,
  });

  /**
   * Where the song itself is, parked or not.
   *
   * Deliberately free of `follow`: coming off the song stops the *view*
   * following it, and a line that stopped as well would leave nothing in the
   * roll saying where the music had got to. Parked, this runs on past the pane
   * and the clip takes it from there.
   *
   * It asks the transport when idle rather than assuming the beginning. A stop
   * does put it back to tick 0 and the line follows it there, but a scrub made
   * while the song is stopped seeks without starting it, and a roll that read a
   * stopped transport as tick 0 would throw that scrub away the moment it was
   * released — the marker would move, the song would not, and nothing would say
   * why.
   */
  const songHead = computed(() =>
    playback.isIdle() ? playback.songTicks().ticks : playhead.tick(),
  );

  /**
   * Where the playhead is drawn: the song's own tick, or the one a scrub is
   * asking for while it is asking.
   *
   * `scrubTo` previews a seek without moving the transport (`playback.ts`), so
   * during a drag the song is still where it was and the marker is where the
   * pointer is. That difference is the whole reason a preview is worth showing.
   */
  const headTick = computed(() => seeking() ?? songHead());

  /**
   * Where the camera is: on the song while it is following it, and wherever it
   * was parked otherwise.
   *
   * The other half of {@link headTick}, and the reason the two are separate.
   * Everything about what is *drawn* — the transform, the mark window, the
   * readout — is this one; the playhead alone is the other.
   *
   * It reads {@link songHead} rather than {@link headTick}, so a scrub's preview
   * moves the marker and not the view: a camera that chased the preview would
   * slide the music sideways under the pointer and put the marker back at
   * {@link lead} the moment it was grabbed.
   */
  const playTick = computed(() => (sources.follow() ? songHead() : parkedTick()));

  /**
   * The 10 Hz anchor the mark window is snapped around, so it moves rarely.
   *
   * Follows the same rule as {@link playTick} and must: the transform and the
   * marks are two halves of one picture, so a pause that moved one and not the
   * other would scroll to the paused position and find nothing drawn there.
   */
  const windowTick = computed(() => (sources.follow() ? playback.songTicks().ticks : parkedTick()));

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
  const lead = computed(() => {
    if (sources.scrollNotes()) {
      return PLAYHEAD_AT;
    }

    if (!sources.follow()) {
      return panLead();
    }

    const screen = screenTicks();
    if (screen <= 0) {
      return PLAYHEAD_AT;
    }

    const from = pageStart(playTick(), screen, PAGE_TURN_AT, PAGE_STEP, pageOrigin());
    return clamp((playTick() - from) / screen, 0, 1);
  });

  /** The tick at the roll's left edge, which is the camera. */
  const viewTick = computed(() => playTick() - screenTicks() * lead());

  /**
   * The song's own tick, in the camera's coordinates. One rule for all three
   * views: a following roll puts it at {@link lead} across the pane by
   * construction, since that is where the camera was built around it, and a
   * parked one lets it cross the music and leave — the clip is what hides it.
   */
  const playheadX = computed(() => xAtTick(headTick(), viewTick(), sources.zoom()));

  const scroll = computed(() => {
    const x = KEY_WIDTH - viewTick() * sources.zoom();
    return `translate(${x.toFixed(2)} 0)`;
  });

  // --- the overview bar ----------------------------------------------------

  /** Null until measured, so nothing renders against a zero-width box. */
  const overviewBox = computed(() => {
    const width = sources.width();
    return width > 0 ? `0 0 ${width} ${OVERVIEW_HEIGHT}` : null;
  });

  /**
   * Where the playhead sits along the bar — the song's tick, as the roll's own
   * line is. The three are one playhead drawn three times, and the box beside
   * this one is what says where the view is.
   */
  const overviewX = computed(
    () => KEY_WIDTH + overviewOffset(headTick(), sources.songTicks(), sources.rollWidth()),
  );

  /**
   * The slice of the song the roll is showing, as a box on the bar. The bar's
   * own thumb: a press inside it is a grab, and a press outside it a jump.
   *
   * Runs off both ends by design — a paged roll opens before tick 0 and the last
   * page reaches past the end — so the strip clips it rather than this clamping
   * it into something narrower than the pane it stands for.
   */
  const overviewWindow = computed(() => {
    const ticks = sources.songTicks();
    const width = sources.rollWidth();
    if (ticks <= 0 || width <= 0) {
      return null;
    }

    const from = (viewTick() / ticks) * width;
    const w = (screenTicks() / ticks) * width;
    return { x: KEY_WIDTH + from, w: Math.max(1, w) };
  });

  // --- the scrub bar -------------------------------------------------------

  /** Null until measured, so nothing renders against a zero-width box. */
  const scrubBox = computed(() => {
    const width = sources.width();
    return width > 0 ? `0 0 ${width} ${SCRUB_HEIGHT}` : null;
  });

  /**
   * The lead a view coming off the song keeps, so the picture does not move.
   *
   * Held off both edges: a parked view needs room after the last tick for the
   * end-of-song marker, which is the distance {@link maxPanTick} measures.
   */
  const parkedLead = (): number =>
    clamp(lead(), Math.max(SCROLL_END_AT, PAGE_LEAD_IN), PAGE_TURN_AT);

  /**
   * Coming off the song parks the camera where the camera already is.
   *
   * {@link playTick} and not the song's own tick: a transport stopped part-way
   * through is showing that position while it is followed, and parking on the
   * tick the camera was last *left* at would drop the view somewhere the porter
   * had not been since. Done here rather than in an effect watching the flag,
   * because an effect runs after the handler and would overwrite a position set
   * in the same gesture that took the roll off the song.
   */
  const setFollow = (follow: boolean): void => {
    if (!follow) {
      const tick = playTick();
      panLead.set(parkedLead());
      panTick.set(tick);
    }

    sinks.writeFollow(follow);
  };

  // --- the overview bar's drag ---------------------------------------------

  /**
   * Where in the window box it was grabbed, in the bar's own pixels.
   *
   * A scrollbar's thumb stays under the pointer, so what a move sets is the
   * box's left edge rather than the tick under the pointer — held from the
   * press, or the drag would jolt the moment it began.
   */
  let grabOffset = 0;

  /** One step of a drag: the box's left edge follows the pointer, and the view with it. */
  const onPanTo = (offset: number): void => {
    const left = overviewTick(
      offset - grabOffset - KEY_WIDTH,
      sources.songTicks(),
      sources.rollWidth(),
    );
    // The inverse of `viewTick`, which is where the camera holds the playhead
    // less the music before it.
    panTick.set(left + screenTicks() * panLead());
  };

  /**
   * Take the roll off the song, and decide what the press grabbed.
   *
   * Panning takes the roll off the song, which is what the Follow switch already
   * means, so it goes through {@link setFollow} the way a `Shift`+wheel pan does
   * rather than parking behind the switch's back. The lead that leaves is read
   * **once**, there, and held for the whole drag: re-reading it per move would
   * slide the music sideways under a pointer that had not moved.
   *
   * A press outside the box centres it on the pointer first, which is the jump
   * half of a scrollbar; the drag then carries on from the middle of the box.
   *
   * The box is measured **before** the park, against the one the porter pressed
   * on: parking holds the lead off both edges, so a view sitting past
   * {@link PAGE_TURN_AT} moves a little as it comes off the song, and the first
   * move puts the box back where it was grabbed rather than where the park left
   * it.
   */
  const onPanStart = (offset: number): void => {
    const box = overviewWindow();
    const inside = box !== null && offset >= box.x && offset <= box.x + box.w;
    grabOffset = box === null ? 0 : inside ? offset - box.x : box.w / 2;

    dragging.set(true);
    setFollow(false);
    onPanTo(offset);
  };

  /**
   * Re-anchor the pages on the view a scroll is leaving, so the notes stay
   * exactly where they were put: a grid still measured from some earlier
   * position would turn over at an offset this view knows nothing about.
   */
  const anchorPages = (): void => {
    const to = parkedTick();
    pageOrigin.set(to - screenTicks() * panLead() + screenTicks() * PAGE_LEAD_IN);
  };

  const onPanEnd = (): void => {
    dragging.set(false);
    anchorPages();
  };

  // --- the scrub bar's drag ------------------------------------------------

  /** The pull's frame callback, where it left the pointer, and when it last ran. */
  let pull: number | null = null;
  let pullFrom = 0;
  let pullAt = 0;

  /**
   * Where a pointer on the scrub bar is asking the song to go. Previewed, not made.
   *
   * The offset is held inside the bar before the tick is read off it, so a drag
   * that has run off the end asks for the last tick it can see rather than for
   * one it cannot: the marker stays against the edge, in view, while the pull
   * brings the music to it — where a marker off the pane would leave a scroll
   * happening with nothing on screen to say what it was reaching for.
   */
  const seekTo = (offset: number): void => {
    const onBar = clamp(offset, KEY_WIDTH, sources.width());
    const tick = clamp(tickAtX(onBar, viewTick(), sources.zoom()), 0, sources.songTicks());
    seeking.set(tick);
    playback.scrubTo(tick);
  };

  /** The end of a scrub: the song jumps to where the marker was left. */
  const commitSeek = (): void => {
    const to = seeking();
    seeking.set(null);
    if (to === null || !playback.canSeek()) {
      return;
    }

    playhead.jumpTo(to);
    playback.seek(to);
  };

  const stopPull = (): void => {
    if (pull !== null) {
      cancelAnimationFrame(pull);
      pull = null;
    }
  };

  /**
   * Start, or aim, the frame callback that pulls the view along.
   *
   * A drag can only ask for a tick that is on screen, so a seek across a long
   * song has to be able to take the view with it. A frame callback rather than
   * something the moves drive, because a pointer held off the end is not moving
   * and is exactly when the pull is wanted.
   *
   * It goes through {@link setFollow} rather than parking behind the switch, as
   * {@link onPanStart} does: the roll has come off the song and the toolbar is
   * where that is said. Once per pull, not per frame, or every frame would read
   * the lead back off a camera the last frame had already moved.
   */
  const startPull = (offset: number): void => {
    pullFrom = offset;
    if (pull !== null) {
      return;
    }

    setFollow(false);
    pullAt = performance.now();
    const step = (now: number): void => {
      pull = requestAnimationFrame(step);
      // Capped, so a tab that comes back after a minute away does not arrive a
      // minute further into the song.
      const seconds = Math.min((now - pullAt) / 1000, 0.1);
      pullAt = now;
      const panes = edgeUrgency(pullFrom, sources.width()) * PULL_PANES_PER_SEC * seconds;
      panTick.update((tick) => tick + (panes * sources.rollWidth()) / sources.zoom());
      // After the camera, and off the pointer's own unmoved x: the tick under it
      // is a different one now, which is what makes the drag reach.
      seekTo(pullFrom);
    };

    pull = requestAnimationFrame(step);
  };

  /** One step of a drag: preview the seek, and pull the view if it has run off the end. */
  const onScrubTo = (offset: number): void => {
    seekTo(offset);
    if (edgeUrgency(offset, sources.width()) === 0) {
      stopPull();
      return;
    }

    startPull(offset);
  };

  const onScrubStart = (offset: number): void => {
    dragging.set(true);
    onScrubTo(offset);
  };

  const onScrubEnd = (): void => {
    dragging.set(false);
    stopPull();
    commitSeek();
  };

  // Sanctioned effect: re-measuring the pages on a stop. A stop is back to the
  // beginning, so the grid is measured from it again — one still anchored on
  // some earlier scroll would draw the song's first tick at whatever offset
  // that anchor gave it. Guarded on the drag so it cannot fire in the middle
  // of a gesture. On the transition, so a roll rebuilt while the transport is
  // already stopped leaves the camera it came back to alone.
  onChange(playback.isIdle, (idle) => {
    if (idle && !dragging()) {
      pageOrigin.set(0);
    }
  });

  // A drag can be one pointer-down away from a component that no longer
  // exists — the roll is rebuilt on every tab switch, and a captured pointer
  // never reports its release. Honour the gesture rather than stranding the
  // transport on a preview nothing will commit.
  inject(DestroyRef).onDestroy(() => {
    stopPull();
    if (dragging()) {
      anchorPages();
      commitSeek();
    }
  });

  return {
    panTick,
    dragging: dragging.asReadonly(),
    viewTick,
    windowTick,
    headTick,
    playTick,
    playheadX,
    scroll,
    overviewBox,
    overviewX,
    overviewWindow,
    scrubBox,
    setFollow,
    onPanStart,
    onPanTo,
    onPanEnd,
    onScrubStart,
    onScrubTo,
    onScrubEnd,
  };
}
