/** Plays the song on a worker for the Song Inspector, and holds what it heard. */

import { DestroyRef, Service, computed, effect, inject, signal, untracked } from '@angular/core';

import type { CompileResult } from '@amk/core/types';
import type { AnalyseReply, AnalyseRequest } from './analysis.worker';
import type { SongAnalysis } from './analysis/song-analysis';
import { EditorStore } from './editor-store';
import { Mixer } from './mixer';

/**
 * How long a song has to hold still before it is analysed again: as long as the clock
 * measurement waits (`clock-measurer.ts`), for the same reason — a pass of emulation thrown away
 * on every keystroke.
 */
const COMPILE_IDLE_MS = 1000;
/** A mute is a click rather than typing, so the wait after one is short. */
const MUTE_IDLE_MS = 300;

/**
 * The Song Inspector's analysis, kept current while the inspector is open.
 *
 * Off the spine as `ClockMeasurer` is, and built the same way: a worker, an idle timer and a
 * token. It runs only while something {@link watch}es — the inspector is the one view that reads
 * it, and a pass of emulation per compile is not worth paying while it is closed. The analysis is
 * **replaced, never cleared**: a stale one is drawn dimmed while the next is worked out, rather
 * than the charts going blank on every keystroke.
 */
@Service()
export class SongAnalyzer {
  private readonly editor = inject(EditorStore);
  private readonly mixer = inject(Mixer);

  private readonly latest = signal<SongAnalysis | null>(null);
  readonly analysis = this.latest.asReadonly();
  /** A run is under way, and how far through the pass it has got, 0 to 1. */
  readonly running = signal(false);
  readonly progress = signal(0);

  /** What the standing analysis was made from. */
  private readonly madeFrom = signal<{ result: CompileResult; mask: number } | null>(null);
  /** The standing analysis is of a different compile or a different mute than the one in front. */
  readonly stale = computed(() => {
    const made = this.madeFrom();
    return made?.result !== this.editor.result() || made.mask !== this.mixer.silenced();
  });

  private readonly watchers = signal(0);
  private worker: Worker | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private token = 0;
  private asked: { result: CompileResult; mask: number } | null = null;

  constructor() {
    // Sanctioned effect: driving the worker, an imperative sink.
    effect(() => {
      const watched = this.watchers() > 0;
      const result = this.editor.result();
      const mask = this.mixer.silenced();
      untracked(() => this.schedule(watched, result, mask));
    });

    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      this.worker?.terminate();
      this.worker = null;
    });
  }

  /** Keeps the analysis current until the function it returns is called. */
  watch(): () => void {
    this.watchers.update((count) => count + 1);
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.watchers.update((count) => count - 1);
      }
    };
  }

  private schedule(watched: boolean, result: CompileResult | null, mask: number): void {
    clearTimeout(this.timer);
    const passTicks = result?.stats ? result.stats.introTicks + result.stats.loopTicks : 0;
    if (!watched || !result?.ok || passTicks <= 0 || typeof Worker === 'undefined') {
      return;
    }

    const made = this.asked ?? this.madeFrom();
    if (made?.result === result && made.mask === mask) {
      return;
    }

    // Nothing to show yet is worth no wait at all; a new compile waits out the typing.
    const delay =
      this.latest() === null ? 0 : made?.result === result ? MUTE_IDLE_MS : COMPILE_IDLE_MS;
    this.timer = setTimeout(() => this.analyse(result, passTicks, mask), delay);
  }

  private analyse(result: CompileResult, passTicks: number, mask: number): void {
    const spc = this.editor.assembleSpc();
    if (!spc || this.editor.result() !== result) {
      return;
    }

    try {
      this.worker ??= this.startWorker();
      this.token++;
      this.asked = { result, mask };
      this.running.set(true);
      this.progress.set(0);
      this.worker.postMessage({
        token: this.token,
        spc,
        passTicks,
        mask,
        // Resolved here for the reason `ClockMeasurer` gives.
        wasmUrl: new URL('player/spc.wasm', document.baseURI).href,
      } satisfies AnalyseRequest);
    } catch {
      this.worker = null;
      this.asked = null;
      this.running.set(false);
    }
  }

  private startWorker(): Worker {
    const worker = new Worker(new URL('./analysis.worker', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<AnalyseReply>) => {
      const reply = event.data;
      if (reply.token !== this.token) {
        return;
      }

      if (reply.type === 'progress') {
        this.progress.set(reply.fraction);
        return;
      }

      const asked = this.asked;
      this.asked = null;
      this.running.set(false);
      if (reply.type === 'done' && asked) {
        this.latest.set(reply.analysis);
        this.madeFrom.set(asked);
      }

      // A newer compile or mask may have arrived while this one ran.
      this.schedule(this.watchers() > 0, this.editor.result(), this.mixer.silenced());
    };

    worker.onerror = () => {
      this.worker?.terminate();
      this.worker = null;
      this.asked = null;
      this.running.set(false);
    };

    return worker;
  }
}
