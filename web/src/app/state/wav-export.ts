/** Renders the whole song to a `.wav` on a worker, and downloads it. */

import { DestroyRef, Service, inject, signal } from '@angular/core';

import { spcFilename } from '@amk/spc/export';
import { downloadBlob } from '../util/format';
import { EditorStore } from './editor-store';
import type { RenderReply, RenderRequest } from './render.worker';

/**
 * The top bar's Export .wav: the intro, the loop twice and a fade, unmuted, as the `.spc` is.
 * One render at a time; the worker is kept for the next.
 */
@Service()
export class WavExport {
  private readonly editor = inject(EditorStore);

  /** A render is under way, and how far it has got, 0 to 1. */
  readonly running = signal(false);
  readonly progress = signal(0);

  private worker: Worker | null = null;
  private token = 0;
  private filename = '';

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.worker?.terminate();
      this.worker = null;
    });
  }

  /** Compiles first, as the other exports do, so a pending edit is in the file. */
  export(): void {
    if (this.running()) {
      return;
    }

    this.editor.compileNow();
    const result = this.editor.result();
    const spc = this.editor.assembleSpc();
    const stats = result?.stats;
    if (!spc || !stats) {
      this.editor.fail(
        $localize`:@@status.cannot-export-song-has-errors:status.cannot-export-song-has-errors`,
      );
      return;
    }

    try {
      this.worker ??= this.startWorker();
    } catch (error) {
      this.editor.fail(error instanceof Error ? error.message : String(error));
      return;
    }

    this.token++;
    this.filename = spcFilename(stats.tags).replace(/\.spc$/, '.wav');
    this.running.set(true);
    this.report(0);
    this.worker.postMessage(
      {
        token: this.token,
        spc,
        loops: stats.loops,
        introTicks: stats.introTicks,
        loopTicks: stats.loopTicks,
        // Resolved here for the reason `ClockMeasurer` gives.
        wasmUrl: new URL('player/spc.wasm', document.baseURI).href,
      } satisfies RenderRequest,
      [spc.buffer],
    );
  }

  private report(fraction: number): void {
    this.progress.set(fraction);
    const percent = Math.round(fraction * 100);
    this.editor.working(
      $localize`:@@status.rendering-wav:status.rendering-wav ${percent}:percent:`,
    );
  }

  private startWorker(): Worker {
    const worker = new Worker(new URL('./render.worker', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<RenderReply>) => {
      const reply = event.data;
      if (reply.token !== this.token) {
        return;
      }

      if (reply.type === 'progress') {
        this.report(reply.fraction);
        return;
      }

      this.running.set(false);
      if (reply.type === 'failed') {
        this.editor.fail(reply.message);
        return;
      }

      downloadBlob(this.filename, reply.wav);
      this.editor.succeed(
        $localize`:@@status.wav-written-bytes:status.wav-written-bytes ${reply.wav.length.toLocaleString()}:count:`,
      );
    };

    worker.onerror = () => {
      this.running.set(false);
      this.worker?.terminate();
      this.worker = null;
      this.editor.fail($localize`:@@status.wav-render-failed:status.wav-render-failed`);
    };

    return worker;
  }
}
