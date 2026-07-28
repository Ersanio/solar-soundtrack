import { DestroyRef, Service, computed, effect, inject, signal, untracked } from '@angular/core';

import type { CompileResult } from '@core/types';
import { SpcPlayer } from '@spc/player';
import { errorMessage, formatTime } from '../util/format';
import { EditorStore } from './editor-store';

@Service()
export class Playback {
  private readonly editor = inject(EditorStore);
  private readonly player = new SpcPlayer();

  readonly state = signal<'idle' | 'playing' | 'paused'>('idle');
  readonly elapsed = signal(0);
  /** Percent, as the range input reports it. */
  readonly volume = signal(70);
  /** Reload the running song in place whenever it recompiles. */
  readonly live = signal(true);

  readonly isPlaying = computed(() => this.state() === 'playing');
  readonly isIdle = computed(() => this.state() === 'idle');
  readonly timeLabel = computed(() => formatTime(this.elapsed()));

  private frame: number | undefined;
  private lastWholeSecond = -1;

  constructor() {
    effect(() => this.player.setVolume(this.volume() / 100));

    // Live reload: swap the running song for the newly compiled one and
    // fast-forward back to where it was, so editing does not restart playback.
    // `play(spc, t)` re-emulates to `t` with output muted.
    effect(() => {
      const result = this.editor.result();
      untracked(() => this.reloadIfLive(result));
    });

    inject(DestroyRef).onDestroy(() => this.stopTicker());
  }

  private reloadIfLive(result: CompileResult | null): void {
    if (!this.live() || this.state() !== 'playing' || !result?.ok) return;
    const spc = this.editor.assembleSpc();
    if (spc) this.player.play(spc, this.player.getTime());
  }

  /** Play, pause or resume. The first press doubles as the audio unlock gesture. */
  async toggle(): Promise<void> {
    if (this.state() === 'playing') {
      this.player.pause();
      this.stopTicker();
      this.state.set('paused');
      return;
    }

    if (this.state() === 'paused') {
      this.player.resume();
      this.startTicker();
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
    const spc = this.editor.assembleSpc();
    if (!spc) {
      this.editor.fail('cannot play: song has errors');
      return;
    }

    this.player.play(spc, 0);
    this.startTicker();
    this.state.set('playing');
  }

  stop(): void {
    this.player.stop();
    this.stopTicker();
    this.state.set('idle');
    this.elapsed.set(0);
    this.lastWholeSecond = -1;
  }

  /**
   * Polls the AudioContext clock each frame but only writes the signal when the
   * displayed second changes — under zoneless change detection, writing every
   * frame would re-render the app 60 times a second to show the same text.
   */
  private startTicker(): void {
    if (this.frame !== undefined) return;
    const tick = (): void => {
      const now = this.player.getTime();
      const whole = Math.floor(now);
      if (whole !== this.lastWholeSecond) {
        this.lastWholeSecond = whole;
        this.elapsed.set(now);
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private stopTicker(): void {
    if (this.frame === undefined) return;
    cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }
}
