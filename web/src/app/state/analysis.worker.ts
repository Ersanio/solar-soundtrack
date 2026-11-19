/// <reference lib="webworker" />

/**
 * Runs {@link analyseSong} off the page.
 *
 * A pass costs about a hundredth of its own length — a second and a half for a three-minute song —
 * which is a freeze on the main thread and a dropout on the audio thread. Like `clock.worker.ts`,
 * a run is never cancelled; every message carries the `token` it was asked with and the page drops
 * the ones it no longer wants.
 */

import { type SongAnalysis, analyseSong, analysisBuffers } from './analysis/song-analysis';
import { coreFor } from './spc-core';

export interface AnalyseRequest {
  token: number;
  /** A complete `.spc` image, as `buildSpc` produces. */
  spc: Uint8Array;
  /** Where one pass ends: the intro plus a single trip round the loop. */
  passTicks: number;
  /** The voices the mixer silences, muted in the DSP as the transport mutes them. */
  mask: number;
  /** Where `spc.wasm` is served from, since a worker cannot read the page's. */
  wasmUrl: string;
}

export type AnalyseReply =
  | { token: number; type: 'progress'; fraction: number }
  | { token: number; type: 'done'; analysis: SongAnalysis }
  | { token: number; type: 'failed'; message: string };

addEventListener('message', (event: MessageEvent<AnalyseRequest>) => {
  const { token, spc, passTicks, mask, wasmUrl } = event.data;
  void coreFor(wasmUrl)
    .then((emulator) => {
      const analysis = analyseSong(emulator, spc, passTicks, mask, (fraction) =>
        postMessage({ token, type: 'progress', fraction } satisfies AnalyseReply),
      );
      postMessage(
        { token, type: 'done', analysis } satisfies AnalyseReply,
        analysisBuffers(analysis),
      );
    })
    .catch((error: unknown) => {
      postMessage({
        token,
        type: 'failed',
        message: error instanceof Error ? error.message : String(error),
      } satisfies AnalyseReply);
    });
});
