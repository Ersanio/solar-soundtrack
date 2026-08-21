/// <reference lib="webworker" />

/**
 * Runs {@link measureClock} off the page.
 *
 * Emulating a whole pass costs about 90 ms for a half-minute song and several
 * hundred for a long one. On the main thread that is a stutter every time the
 * editor recompiles; on the audio thread it is a dropout. So it happens here,
 * and the answer arrives as a message whenever it is ready.
 *
 * Superseded requests are not cancelled — a run is short and there is no way to
 * interrupt the emulator mid-render — so every reply carries the `token` it was
 * asked with and the page ignores the ones it no longer wants.
 */

import { type Measurement, measureClock } from './measure-clock';
import { coreFor } from './spc-core';

export interface MeasureRequest {
  token: number;
  /** A complete `.spc` image, as `buildSpc` produces. */
  spc: Uint8Array;
  /** Where one pass ends: the intro plus a single trip round the loop. */
  passTicks: number;
  /** Where `spc.wasm` is served from, since a worker cannot read the page's. */
  wasmUrl: string;
}

export type MeasureReply =
  ({ token: number; ok: true } & Measurement) | { token: number; ok: false; message: string };

addEventListener('message', (event: MessageEvent<MeasureRequest>) => {
  const { token, spc, passTicks, wasmUrl } = event.data;
  void coreFor(wasmUrl)
    .then((emulator) => {
      const measured = measureClock(emulator, spc, passTicks);
      postMessage({ token, ok: true, ...measured } satisfies MeasureReply);
    })
    .catch((error: unknown) => {
      // A failed measurement is not a failed compile: the page keeps the
      // predicted clock and says nothing. Reported so it can be told from a
      // reply that never came.
      postMessage({
        token,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      } satisfies MeasureReply);
    });
});
