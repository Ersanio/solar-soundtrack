import { DestroyRef, Service, computed, effect, inject, signal, untracked } from '@angular/core';

import { type CompileResult, type NoteAddress, type Span, noteAddressAt } from '@amk/core/types';
import { SpcPlayer, type SongTiming } from '@amk/spc/player';
import type { DriverState } from '@amk/spc/driver-state';
import { SPC_SAMPLE_RATE } from '@amk/spc/wasm-host';
import { errorMessage, formatTime } from '../util/format';
import { EditorStore } from './editor-store';
import { secondsAtTick } from './song-clock';
import { clamp } from '../util/math';

/** N-SPC songs have eight music channels. */
const CHANNELS = 8;
const ALL_CHANNELS = 0b11111111;
/** In the note map, the loop/subroutine block counts as a ninth channel. */
const LOOP_BLOCK = 8;

const NO_SPANS: readonly Span[] = [];

export interface ChannelState {
  index: number;
  muted: boolean;
  soloed: boolean;
  /** Audible right now, once solo is taken into account. */
  audible: boolean;
}

@Service()
export class Playback {
  private readonly editor = inject(EditorStore);
  private readonly player = new SpcPlayer();

  readonly state = signal<'idle' | 'playing' | 'paused'>('idle');
  /**
   * The playhead in driver ticks, folded into one pass, and the moment it
   * arrived — refreshed about ten times a second.
   *
   * The only playhead there is. It was once shadowed by an `elapsed` in seconds,
   * kept in step by hand at five call sites, and seconds are the wrong thing to
   * hold: they can only be *derived* from a tick, through a clock that is a
   * prediction until the song has been measured. Holding ticks and converting
   * for the label means the transport never stores a number the song could
   * disagree with.
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
  /** Percent, as the range input reports it. */
  readonly volume = signal(300);
  /** Reload the running song in place whenever it recompiles. */
  readonly live = signal(true);
  readonly loop = signal(false);

  /** Channels the user silenced, as a bitmask. */
  private readonly mutedMask = signal(0);
  /**
   * The one channel the user isolated, or `null`. Solo is exclusive rather than
   * a mask: isolating a part means hearing that part, and two channels soloed at
   * once is just a mute of everything else wearing the wrong name.
   */
  private readonly soloedChannel = signal<number | null>(null);

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
   * not. A tempo fade costs the compiler its seconds and none of its ticks
   * (`parser.ts:1705`), so a length in seconds is a thing the transport can be
   * left without — as it once was, which is how these songs came to have a seek
   * bar that was greyed out.
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
   * With a channel soloed only that channel is heard, and nothing else applies:
   * engaging solo clears the mutes outright rather than holding them, so what
   * the buttons show is always what is being heard.
   */
  private readonly silenced = computed(() => {
    const soloed = this.soloedChannel();
    return soloed === null ? this.mutedMask() : ~(1 << soloed) & ALL_CHANNELS;
  });

  /**
   * Only the channels the song actually writes to. A channel with no data has
   * nothing to mute, so it gets no controls at all and they appear as the song
   * grows into them. The state behind them is untouched by this: a channel that
   * goes empty keeps its mute or solo and resumes it if the channel comes back,
   * and `clearChannels()` reaches it either way.
   */
  readonly channels = computed<ChannelState[]>(() => {
    const sizes = this.editor.result()?.stats?.channelSizes ?? [];
    const muted = this.mutedMask();
    const soloed = this.soloedChannel();
    const silenced = this.silenced();

    return Array.from({ length: CHANNELS }, (_, index) => index)
      .filter((index) => (sizes[index] ?? 0) > 0)
      .map((index) => {
        const bit = 1 << index;
        return {
          index,
          muted: (muted & bit) !== 0,
          soloed: soloed === index,
          audible: (silenced & bit) === 0,
        };
      });
  });

  readonly isSoloing = computed(() => this.soloedChannel() !== null);
  readonly hasChannelOverrides = computed(() => this.mutedMask() !== 0 || this.isSoloing());

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

      const silenced = this.silenced();
      const spans: Span[] = [];
      for (let voice = 0; voice < CHANNELS; voice++) {
        const pointer = driver.trackPointers[voice];
        if (pointer === 0 || (silenced & (1 << voice)) !== 0) {
          continue;
        }

        const entry = noteAddressAt(loaded.map, pointer);
        if (entry && (entry.channel === voice || entry.channel === LOOP_BLOCK)) {
          spans.push(entry.span);
        }
      }

      return spans
        .sort((a, b) => a.start - b.start || a.end - b.end)
        .filter(
          (span, n, all) =>
            n === 0 || span.start !== all[n - 1].start || span.end !== all[n - 1].end,
        );
    },
    {
      equal: (a, b) =>
        a.length === b.length &&
        a.every((span, n) => span.start === b[n].start && span.end === b[n].end),
    },
  );

  constructor() {
    effect(() => this.player.setVolume(this.volume() / 100));
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
    effect(() => this.player.setMute(this.silenced()));

    this.player.onPosition = (songTicks) =>
      this.songTicks.set({ ticks: songTicks, at: performance.now() });

    this.player.onDriverState = (state) => this.driver.set(state);
    this.player.onEnded = () => {
      this.state.set('idle');
      this.songTicks.set({ ticks: 0, at: performance.now() });
      this.scrubbing.set(null);
      this.driver.set(null);
      this.loaded.set(null);
    };

    this.player.onError = (error) => {
      this.state.set('idle');
      this.editor.fail(errorMessage(error));
    };

    inject(DestroyRef).onDestroy(() => {
      void this.player.dispose();
      this.stopAudition();
      void this.auditionContext?.close();
      this.auditionContext = null;
    });
  }

  // --- sample audition ------------------------------------------------------

  /**
   * A context of its own, separate from the player's.
   *
   * Auditioning a sample needs nothing the player provides — no worklet, no
   * wasm, no emulator — and making it wait on `player.init()` would mean
   * downloading and compiling the SPC core just to hear a 65-byte square wave.
   */
  private auditionContext: AudioContext | null = null;
  private auditionSource: AudioBufferSourceNode | null = null;

  /** The sample currently being auditioned, for the UI to show. */
  readonly auditioning = signal<string | null>(null);

  /**
   * Plays decoded sample PCM at the DSP's native rate.
   *
   * This is the sample *as stored*: no instrument tuning, no pitch, no envelope.
   * A sample that sounds an octave off here can still be correct in a song — the
   * `$F3`/`@` tuning is what decides pitch at playback.
   */
  audition(name: string, pcm: Int16Array): void {
    this.stopAudition();
    if (pcm.length === 0) {
      return;
    }

    try {
      this.auditionContext ??= new AudioContext();
      const context = this.auditionContext;

      const buffer = context.createBuffer(1, pcm.length, SPC_SAMPLE_RATE);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < pcm.length; index++) {
        channel[index] = pcm[index] / 0x8000;
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        if (this.auditionSource === source) {
          this.auditionSource = null;
          this.auditioning.set(null);
        }
      };

      source.start();

      this.auditionSource = source;
      this.auditioning.set(name);
      void context.resume();
    } catch (error) {
      this.editor.fail(errorMessage(error));
    }
  }

  stopAudition(): void {
    const source = this.auditionSource;
    this.auditionSource = null;
    this.auditioning.set(null);
    if (!source) {
      return;
    }

    source.onended = null;
    try {
      source.stop();
    } catch {
      // Already finished; nothing to stop.
    }
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
   * and not only at its edges — where the two-piece intro/loop interpolation
   * this replaced was exact at the boundaries and drifting in between.
   *
   * The fallback keeps that old split, for a song the walk could not read.
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

    if (stats.introTicks > 0 && songTicks < stats.introTicks) {
      return (songTicks / stats.introTicks) * played.introSeconds;
    }

    if (stats.loopTicks <= 0) {
      return played.introSeconds;
    }

    return (
      played.introSeconds + ((songTicks - stats.introTicks) / stats.loopTicks) * played.mainSeconds
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

    this.player.setVolume(this.volume() / 100);

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

  /** Ignored while a channel is soloed, where the mute buttons are disabled. */
  toggleMute(channel: number): void {
    if (this.isSoloing()) {
      return;
    }

    this.mutedMask.update((mask) => mask ^ (1 << channel));
  }

  /**
   * Moves the solo to `channel`, or lifts it if that channel already has it.
   * Taking a solo discards the mutes, so lifting it again leaves the whole song
   * audible rather than restoring a mute the buttons stopped showing.
   */
  toggleSolo(channel: number): void {
    const soloed = this.soloedChannel() === channel ? null : channel;
    this.soloedChannel.set(soloed);
    if (soloed !== null) {
      this.mutedMask.set(0);
    }
  }

  /** Drops every mute and any solo, so the whole song is heard again. */
  clearChannels(): void {
    this.mutedMask.set(0);
    this.soloedChannel.set(null);
  }
}
