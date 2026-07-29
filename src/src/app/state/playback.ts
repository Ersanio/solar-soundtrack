import { DestroyRef, Service, computed, effect, inject, signal, untracked } from '@angular/core';

import type { CompileResult } from '@core/types';
import { SpcPlayer } from '@spc/player';
import { SPC_SAMPLE_RATE } from '@spc/wasm-host';
import { errorMessage, formatTime } from '../util/format';
import { EditorStore } from './editor-store';

/** N-SPC songs have eight music channels. */
const CHANNELS = 8;
const ALL_CHANNELS = 0xff;

export interface ChannelState {
  index: number;
  /** The song actually writes to this channel. */
  used: boolean;
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
  readonly elapsed = signal(0);
  /** Percent, as the range input reports it. */
  readonly volume = signal(500);
  /** Reload the running song in place whenever it recompiles. */
  readonly live = signal(true);
  readonly loop = signal(false);

  /** Channels the user silenced, and channels they isolated, as bitmasks. */
  private readonly mutedMask = signal(0);
  private readonly soloedMask = signal(0);

  readonly isPlaying = computed(() => this.state() === 'playing');
  readonly isIdle = computed(() => this.state() === 'idle');
  readonly timeLabel = computed(() => formatTime(this.elapsed()));

  /** The compiler's play-length estimate, which is what the seek bar spans. */
  readonly duration = computed(() => this.editor.result()?.stats?.seconds ?? 0);
  readonly durationLabel = computed(() => formatTime(this.duration()));
  readonly canSeek = computed(() => !this.isIdle() && this.duration() > 0);

  /**
   * Soloing wins over muting, as it does on a mixer: with anything soloed, only
   * those channels are heard and the mute flags are held but not applied.
   */
  private readonly silenced = computed(() => {
    const soloed = this.soloedMask();
    return soloed ? ~soloed & ALL_CHANNELS : this.mutedMask();
  });

  readonly channels = computed<ChannelState[]>(() => {
    const sizes = this.editor.result()?.stats?.channelSizes ?? [];
    const muted = this.mutedMask();
    const soloed = this.soloedMask();
    const silenced = this.silenced();

    return Array.from({ length: CHANNELS }, (_, index) => {
      const bit = 1 << index;
      return {
        index,
        used: (sizes[index] ?? 0) > 0,
        muted: (muted & bit) !== 0,
        soloed: (soloed & bit) !== 0,
        audible: (silenced & bit) === 0,
      };
    });
  });

  readonly isSoloing = computed(() => this.soloedMask() !== 0);
  readonly hasChannelOverrides = computed(() => (this.mutedMask() | this.soloedMask()) !== 0);

  constructor() {
    effect(() => this.player.setVolume(this.volume() / 100));
    effect(() => this.player.setLoop(this.loop()));

    // Live reload: swap the running song for the newly compiled one and
    // fast-forward back to where it was, so editing does not restart playback.
    effect(() => {
      const result = this.editor.result();
      untracked(() => {
        if (this.live() && result?.ok) this.reload(result);
      });
    });

    // Muting is a property of the song data, not of the emulator: the SPC is
    // rebuilt with those channels blanked and reloaded where it left off. The
    // reload costs a short gap, which is why this is not tied to a slider.
    effect(() => {
      this.silenced();
      untracked(() => this.reload(this.editor.result()));
    });

    this.player.onPosition = (seconds) => this.elapsed.set(seconds);
    this.player.onEnded = () => {
      this.state.set('idle');
      this.elapsed.set(0);
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
    if (pcm.length === 0) return;

    try {
      this.auditionContext ??= new AudioContext();
      const context = this.auditionContext;

      const buffer = context.createBuffer(1, pcm.length, SPC_SAMPLE_RATE);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < pcm.length; index++) channel[index] = pcm[index] / 0x8000;

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
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Already finished; nothing to stop.
    }
  }

  private reload(result: CompileResult | null): void {
    if (this.state() !== 'playing' || !result?.ok) return;
    const spc = this.editor.assembleSpc(this.silenced());
    if (spc) this.player.play(spc, this.player.getTime());
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
      if (!this.player.isReady) await this.player.init();
    } catch (error) {
      this.editor.fail(errorMessage(error));
      return;
    }
    this.player.setVolume(this.volume() / 100);

    this.editor.compileNow();
    const spc = this.editor.assembleSpc(this.silenced());
    if (!spc) {
      this.editor.fail('cannot play: song has errors');
      return;
    }

    this.player.play(spc, 0);
    this.state.set('playing');
  }

  stop(): void {
    this.player.stop();
    this.state.set('idle');
    this.elapsed.set(0);
  }

  /**
   * Jumps to a point in the song. The emulator replays silently to get there,
   * so this is not instant on a long song.
   */
  seek(seconds: number): void {
    if (this.isIdle()) return;
    const target = Math.max(0, Math.min(seconds, this.duration()));
    this.elapsed.set(target);
    this.player.seek(target);
  }

  toggleMute(channel: number): void {
    this.mutedMask.update((mask) => mask ^ (1 << channel));
  }

  toggleSolo(channel: number): void {
    this.soloedMask.update((mask) => mask ^ (1 << channel));
  }

  /** Clears both masks, so the whole song is heard again. */
  clearChannels(): void {
    this.mutedMask.set(0);
    this.soloedMask.set(0);
  }
}
