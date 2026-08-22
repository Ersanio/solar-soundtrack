import { DestroyRef, Service, computed, effect, inject, signal, untracked } from '@angular/core';

import type { CompileResult, NoteAddress, Span } from '@amk/core/types';
import { SpcPlayer, type SongTiming } from '@amk/spc/player';
import type { DriverState } from '@amk/spc/driver-state';
import { errorMessage, formatTime } from '../util/format';
import { EditorStore } from './editor-store';
import { Mixer } from './mixer';
import { secondsAtTick } from './song-clock';
import { estimatedSecondsAt, soundingSpans } from './transport-view';
import { clamp } from '../util/math';

const NO_SPANS: readonly Span[] = [];

@Service()
export class Playback {
  private readonly editor = inject(EditorStore);
  private readonly mixer = inject(Mixer);
  private readonly player = new SpcPlayer();

  readonly state = signal<'idle' | 'playing' | 'paused'>('idle');
  /**
   * The playhead in driver ticks, folded into one pass, and the moment it
   * arrived — refreshed about ten times a second.
   *
   * The only playhead there is, and it is in ticks: seconds can only be
   * *derived* from a tick, through a clock that is a prediction until the song
   * has been measured, so holding ticks and converting for the label means the
   * transport never stores a number the song could disagree with.
   *
   * `at` is here because ten updates a second is not enough to scroll anything
   * smoothly: a view drawing at frame rate interpolates between two of these and
   * re-anchors on each new one, which needs to know how long ago the anchor was.
   * One object rather than two signals, so the pair cannot be read half-updated.
   */
  readonly songTicks = signal<{ ticks: number; at: number }>({ ticks: 0, at: 0 });
  /**
   * What the driver is doing right now — where each voice is reading its music
   * data, and the tempo in force — refreshed about ten times a second.
   *
   * Read straight out of the emulator rather than inferred, so a view built on
   * it follows the song itself. `null` while nothing is playing.
   */
  readonly driver = signal<DriverState | null>(null);
  /** Reload the running song in place whenever it recompiles. */
  readonly live = signal(true);
  readonly loop = signal(false);

  /** Where the seek bar is being dragged to, in ticks, while the drag goes on. */
  private readonly scrubbing = signal<number | null>(null);

  /**
   * The note map and source text of the song the player is actually holding —
   * snapshotted when an SPC is handed over, because the editor may compile any
   * number of songs while an older one goes on playing.
   */
  private readonly loaded = signal<{ map: readonly NoteAddress[]; text: string } | null>(null);

  readonly isPlaying = computed(() => this.state() === 'playing');
  readonly isIdle = computed(() => this.state() === 'idle');

  /**
   * The playhead in ticks as the transport should show it: the drag target while
   * the user is scrubbing, and the song's own position the rest of the time.
   *
   * The distinction is what keeps a drag smooth. The playhead is pushed from the
   * audio thread ten times a second, and a seek bar bound straight to it has its
   * value rewritten from under the pointer on every update — the thumb snaps
   * between the cursor and the song until the button comes back up.
   */
  readonly position = computed(() => this.scrubbing() ?? this.songTicks().ticks);
  readonly timeLabel = computed(() => formatTime(this.secondsAt(this.position())));

  /**
   * One pass through the song in ticks — intro plus a single trip round the loop
   * — which is what the seek bar spans and where the emulator fades out.
   *
   * From `stats` rather than from a clock, and this is the figure the transport
   * is built on: ticks are known for every song that compiles, where seconds are
   * not — a tempo fade costs the compiler its seconds and none of its ticks
   * (`parser.ts:1705`).
   */
  readonly durationTicks = computed(() => {
    const stats = this.editor.result()?.stats;
    return stats ? stats.introTicks + stats.loopTicks : 0;
  });

  /**
   * The same pass in seconds, for the readout beside the bar and for sizing the
   * fade — the two things that are genuinely wall-clock.
   *
   * The clock first, and `stats.playback` only when there is no walk to read.
   * Neither AddmusicK figure will do: `tagSeconds` is the ID666 field and counts
   * the loop twice, and the estimate both are built from is a few percent fast
   * before the driver's dropped ticks are even considered.
   *
   * A song with a declared `#length` is timed by the clock too, not by what was
   * declared: `#length` is an ID666 field, and `buildSpc` still writes it into
   * the tag from `stats.tagSeconds` untouched.
   */
  private readonly durationSeconds = computed(() => this.secondsAt(this.durationTicks()));
  readonly durationLabel = computed(() => formatTime(this.durationSeconds()));

  /**
   * A length to seek within is the whole requirement — a stopped song can be
   * seeked too, and the position that leaves is where the next press of play
   * picks the song up. Anything the transport can show, it can be moved to.
   *
   * Gated on ticks and not on seconds, deliberately: a song whose seconds cannot
   * be worked out is still a song with a position in it.
   */
  readonly canSeek = computed(() => this.durationTicks() > 0);

  /**
   * How long the tail past the end runs before playback stops.
   *
   * The file's own ID666 fade is ten seconds, which suits a listening app and
   * not an editor: on a four-second song that is ten seconds of the loop coming
   * round again underneath a fade, long after the transport has reached the end.
   * Sizing it to the song keeps the tail musical, and the bounds stop a jingle
   * or a ten-minute piece from getting a silly one.
   *
   * One of the two places seconds are the right unit rather than a leak: the
   * driver has stopped reading music data by then, so there are no more ticks to
   * count and the fade has to run on the wall clock.
   */
  private readonly fadeSeconds = computed(() => {
    const total = this.durationSeconds();
    return total > 0 ? clamp(total / 8, 1, 3) : 0;
  });

  /**
   * The source spans being sounded right now, one per audible voice — the
   * playhead the editor decorates. Follows the driver's own read pointers
   * rather than any clock, so loops, tempo changes and dropped ticks cost it
   * nothing.
   *
   * Empty unless the editor shows exactly the text that is playing: while an
   * edit is mid-debounce, after editing with live reload off, or on a failed
   * compile, a highlight would point into the wrong document, so there is
   * none. The comparison is by reference in the common case, since `edit()`
   * commits the same string instance `source` holds.
   *
   * A voice's pointer resolving into another voice's region is a mid-update
   * artefact of reading ARAM between driver writes; those are dropped rather
   * than shown. The custom `equal` keeps the 10 Hz stream quiescent whenever
   * nothing has moved.
   */
  readonly playheadSpans = computed<readonly Span[]>(
    () => {
      const loaded = this.loaded();
      const driver = this.driver();
      if (!loaded || !driver || loaded.text !== this.editor.source()) {
        return NO_SPANS;
      }

      return soundingSpans(loaded.map, driver.trackPointers, this.mixer.silenced());
    },
    {
      equal: (a, b) =>
        a.length === b.length &&
        a.every((span, n) => span.start === b[n].start && span.end === b[n].end),
    },
  );

  constructor() {
    effect(() => this.player.setVolume(this.mixer.volume() / 100));
    effect(() => this.player.setLoop(this.loop()));

    // Live reload: swap the running song for the newly compiled one and
    // fast-forward back to where it was, so editing does not restart playback.
    effect(() => {
      const result = this.editor.result();
      untracked(() => {
        if (this.live() && result?.ok) {
          this.reload(result);
        }
      });
    });

    // Muting is a gate on the driver, not a property of the song data: the mask
    // goes straight to APU RAM and every channel goes on being played, so
    // nothing is rebuilt and playback does not break stride.
    effect(() => this.player.setMute(this.mixer.silenced()));

    this.player.onPosition = (songTicks) =>
      this.songTicks.set({ ticks: songTicks, at: performance.now() });

    this.player.onDriverState = (state) => this.driver.set(state);
    this.player.onEnded = () => this.rest();

    this.player.onError = (error) => {
      this.state.set('idle');
      this.editor.fail(errorMessage(error));
    };

    inject(DestroyRef).onDestroy(() => void this.player.dispose());
  }

  /**
   * What the player should be told about the song, over what the file says.
   *
   * `undefined` rather than 0 for an unguessable length: that leaves the ID666
   * tag in charge, which is the only thing left to go on.
   */
  private timing(): SongTiming {
    const stats = this.editor.result()?.stats;
    return {
      introTicks: stats?.introTicks ?? 0,
      loopTicks: stats?.loopTicks ?? 0,
      fadeSeconds: this.durationSeconds() > 0 ? this.fadeSeconds() : undefined,
      songLoops: stats?.loops ?? true,
    };
  }

  /**
   * Turns a tick position into the second it falls on, for the transport to show.
   *
   * The playhead itself is counted off the driver and is exact; this only puts a
   * clock face on it. The clock's segment table follows every tempo the song
   * sets, a fade included, so the readout is right in the middle of a section
   * and not only at its edges. The fallback is a two-piece intro/loop
   * interpolation, exact only at the boundaries, for a song the walk could not
   * read.
   */
  private secondsAt(songTicks: number): number {
    const clock = this.editor.clock();
    if (clock) {
      return secondsAtTick(clock, songTicks);
    }

    const stats = this.editor.result()?.stats;
    const played = stats?.playback;
    if (!stats || !played) {
      return 0;
    }

    return estimatedSecondsAt(
      {
        introTicks: stats.introTicks,
        loopTicks: stats.loopTicks,
        introSeconds: played.introSeconds,
        mainSeconds: played.mainSeconds,
      },
      songTicks,
    );
  }

  private reload(result: CompileResult | null): void {
    if (this.state() !== 'playing' || !result?.ok) {
      return;
    }

    const spc = this.editor.assembleSpc();
    // Resume inside the song rather than at the raw clock, so reloading after a
    // long looping session does not re-emulate every pass to get back. The
    // playhead is already folded into one pass and already in ticks, so nothing
    // is converted and nothing is lost.
    if (spc) {
      this.player.play(spc, this.player.getSongTicks(), this.timing());
      this.loaded.set(this.captureLoaded());
    }
  }

  /** What {@link loaded} should hold for the compilation just handed to the player. */
  private captureLoaded(): { map: readonly NoteAddress[]; text: string } | null {
    const map = this.editor.result()?.noteMap;
    const text = this.editor.compiledText();
    return map && text !== null ? { map, text } : null;
  }

  /** Play, pause or resume. The first press doubles as the audio unlock gesture. */
  async toggle(): Promise<void> {
    if (this.state() === 'playing') {
      this.player.pause();
      this.state.set('paused');
      return;
    }

    if (this.state() === 'paused') {
      this.player.resume();
      this.state.set('playing');
      return;
    }

    try {
      if (!this.player.isReady) {
        await this.player.init();
      }
    } catch (error) {
      this.editor.fail(errorMessage(error));
      return;
    }

    this.player.setVolume(this.mixer.volume() / 100);

    this.editor.compileNow();
    const spc = this.editor.assembleSpc();
    if (!spc) {
      this.editor.fail('cannot play: song has errors');
      return;
    }

    // Wherever the transport was left, which is the start unless it was seeked
    // while stopped. Clamped because the compile just above may have shortened
    // the song out from under a position set against the previous one.
    this.player.play(spc, clamp(this.songTicks().ticks, 0, this.durationTicks()), this.timing());
    this.loaded.set(this.captureLoaded());
    this.state.set('playing');
  }

  stop(): void {
    this.player.stop();
    this.rest();
  }

  /**
   * Back to the beginning with nothing loaded — what a stop and a song running
   * out both leave behind.
   *
   * One statement of it because the two have to agree: the roll and the source
   * view read `driver` and `loaded` to decide what to light, and a reset that
   * cleared one of them and not the other would leave a stopped song still
   * showing its last sounding note.
   */
  private rest(): void {
    this.state.set('idle');
    this.songTicks.set({ ticks: 0, at: performance.now() });
    this.scrubbing.set(null);
    this.driver.set(null);
    this.loaded.set(null);
  }

  /**
   * Follows the seek bar without moving the song, in driver ticks.
   *
   * Seeking on every drag event would queue a re-emulation per pixel, since the
   * emulator has no snapshot to jump to; this only moves what is displayed, and
   * {@link commitScrub} does the work once the drag ends.
   */
  scrubTo(songTicks: number): void {
    if (!this.canSeek()) {
      return;
    }

    this.scrubbing.set(clamp(songTicks, 0, this.durationTicks()));
  }

  /**
   * Ends a drag, jumping to wherever it left the thumb.
   *
   * Idempotent, and called from both `change` and `pointerup`, because neither
   * alone is enough: a drag that ends on the value it started from fires no
   * `change` in every browser, which would leave the transport parked on a
   * position the song has since played past. Whichever event arrives first
   * commits; the other finds nothing to do.
   */
  commitScrub(): void {
    const target = this.scrubbing();
    if (target !== null) {
      this.seek(target);
    }
  }

  /**
   * Jumps to a tick in the song. The emulator replays silently to get there, so
   * this is not instant on a long song.
   *
   * Ticks are what moves the song, from the transport and the roll alike: the
   * emulator counts its own and stops on the one it was given, where a request
   * in seconds could only be converted through a clock and would land wherever
   * the clock was wrong.
   *
   * Stopped is a position like any other: there is no emulator to move, so the
   * transport simply stands at the new point and {@link toggle} starts the song
   * from it. Without that, the only thing a stopped song could be seeked to is
   * the beginning it was already at.
   *
   * Ends the scrub ahead of its own gate: a recompile can take the song's length
   * away mid-gesture, and a scrub left standing would freeze the readout on a
   * position the song has played past.
   */
  seek(songTicks: number): void {
    this.scrubbing.set(null);
    if (!this.canSeek()) {
      return;
    }

    const target = clamp(songTicks, 0, this.durationTicks());
    // The anchor moves before the emulator does, because the worklet
    // replays the song from the top to get here and posts nothing until it
    // arrives — nothing at all while paused, where it renders no audio — so a
    // view anchored on the old reading goes on drawing the playhead where the
    // song no longer is. `player.seek` bumps its epoch, so the readings still in
    // flight are dropped rather than overwriting this.
    this.songTicks.set({ ticks: target, at: performance.now() });
    if (!this.isIdle()) {
      this.player.seek(target);
    }
  }
}
