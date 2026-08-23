import { DestroyRef, Service, inject, signal } from '@angular/core';

import type { Diagnostic, Span } from '@amk/core/types';
import type { MeasureReply, MeasureRequest } from './clock.worker';
import { type Measurement, tempoShortfall } from './measure-clock';

/**
 * How long the song has to hold still before its clock is measured.
 *
 * Longer than the typing debounce because measuring is a whole pass of
 * emulation — tens to hundreds of milliseconds of a worker core — and every
 * keystroke would throw the answer away. A second of quiet is far less than it
 * takes to reach for the transport, so the measured length is there before it is
 * read.
 */
const MEASURE_IDLE_MS = 1000;

/**
 * Past this, the driver is not playing the song that was written and the porter
 * should be told. 1.10 rather than something tighter because eight busy channels
 * drop about 0.8% at an ordinary tempo and a few percent is ordinary; this is
 * for the songs that are out by a third or a half.
 */
const TEMPO_SHORTFALL_LIMIT = 1.1;

/**
 * `AMK0503` — the driver cannot run the song as fast as it is written.
 *
 * The only diagnostic that had to be *played* to find out. The driver handles at
 * most one music tick per pass of its main loop, so a song asking for more ticks
 * a second than it can manage simply gets fewer: at `t254` on eight channels
 * around 230 of the 498 it asked for. That is not an editor artefact — a SNES
 * does the same, which is why AddmusicK's readme warns about high tempos — so
 * the song a porter ships plays at a tempo they did not write.
 *
 * `AMK05xx` is the band for diagnostics `Music.cpp` does not produce at all, and
 * `severe` puts it with the echo hazards and `AMK0502` within it: it compiles
 * cleanly and then misbehaves on playback. Silent for the few percent
 * an ordinary busy song loses — see {@link TEMPO_SHORTFALL_LIMIT} — and compared
 * from the first tick, so the pause `$FA $04` puts at the top of a song with
 * echo is not read as a rate; `tempoShortfall` says so.
 *
 * A free function so a harness can reach the threshold and the wording, neither
 * of which `walktest` can see from `tempoShortfall` alone.
 */
export function tempoDiagnostic(measured: Measurement | null, span: Span): Diagnostic[] {
  if (!measured) {
    return [];
  }

  const shortfall = tempoShortfall(measured);
  if (shortfall === null || shortfall < TEMPO_SHORTFALL_LIMIT) {
    return [];
  }

  const percent = Math.round((1 - 1 / shortfall) * 100);
  return [
    {
      severity: 'severe',
      code: 'AMK0503',
      message:
        `The driver cannot keep up with this song's tempo: it plays about ${percent}% slower than written. ` +
        `Lower the tempo, or give the busiest channels less to do.`,
      span,
    },
  ];
}

/**
 * Watching the emulator to find out how fast the song really runs.
 *
 * `measure-clock.ts` holds the arithmetic and says why no formula can replace
 * it; this is the machinery around that — a worker, an idle timer and a token,
 * none of which the compile pipeline wants to know about.
 *
 * It is handed a way to assemble the song rather than reaching for one, because
 * building an SPC needs the resolved sample set and that belongs to the store.
 * Which keeps the dependency one-way: the store drives this, and this answers.
 */
@Service()
export class ClockMeasurer {
  /**
   * The last thing the emulator observed about this song.
   *
   * **Replaced, never cleared.** A measurement takes about a second to come
   * back, so clearing it on every recompile would leave a song unmeasured for as
   * long as anyone kept typing, with `AMK0503` and the transport's length
   * flicking on every pause.
   *
   * What it measures is how far the driver falls behind the tempo the song asked
   * for, and that is a property of the song's *texture* — how many channels are
   * live and what each tick costs them. A keystroke does not change it. So the
   * honest thing to hold between measurements is the last answer, not no answer.
   */
  private readonly latest = signal<Measurement | null>(null);
  readonly measured = this.latest.asReadonly();

  private worker: Worker | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private token = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      this.worker?.terminate();
      this.worker = null;
    });
  }

  /**
   * Asks for the song's real clock, once typing has settled.
   *
   * Re-armed on every compile and never cancelled into nothing: a song that will
   * not play has no pass to measure, so no request goes out, but whatever was
   * measured last stays standing until something better arrives. See
   * {@link measured} for why that is the honest answer rather than a stale one.
   */
  schedule(compiled: boolean, passTicks: number, assemble: () => Uint8Array | null): void {
    clearTimeout(this.timer);
    if (!compiled || passTicks <= 0 || typeof Worker === 'undefined') {
      return;
    }

    this.timer = setTimeout(() => this.measure(passTicks, assemble), MEASURE_IDLE_MS);
  }

  private measure(passTicks: number, assemble: () => Uint8Array | null): void {
    const spc = assemble();
    if (!spc) {
      return;
    }

    try {
      this.worker ??= this.startWorker();
      this.token++;
      this.worker.postMessage({
        token: this.token,
        spc,
        passTicks,
        // Resolved here, not in the worker: a relative fetch there would resolve
        // against the worker's own bundled URL rather than the app's base href,
        // which is `/<repo>/` on Pages.
        wasmUrl: new URL('player/spc.wasm', document.baseURI).href,
      } satisfies MeasureRequest);
    } catch {
      // No worker, or it refused the message. The prediction stands; a song that
      // cannot be measured is not a song that cannot be played.
      this.worker = null;
    }
  }

  private startWorker(): Worker {
    const worker = new Worker(new URL('./clock.worker', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<MeasureReply>) => {
      const reply = event.data;
      // Superseded while it ran: a run cannot be cancelled, so late answers are
      // dropped here rather than fought over.
      if (reply.token !== this.token || !reply.ok) {
        return;
      }

      this.latest.set(reply);
    };

    worker.onerror = () => {
      this.worker?.terminate();
      this.worker = null;
    };

    return worker;
  }
}
