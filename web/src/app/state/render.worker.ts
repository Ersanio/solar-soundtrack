/// <reference lib="webworker" />

/**
 * Runs {@link renderSong} off the page, and hands back the `.wav`.
 *
 * Rendering a song costs a few hundredths of its own length — a freeze on the main thread and a
 * dropout on the audio thread — so it runs here, as the analysis does, with every message
 * carrying the `token` it was asked with.
 */

import { encodeWav, renderSong } from '@amk/spc/render';
import { coreFor } from './spc-core';

export interface RenderRequest {
  token: number;
  /** A complete `.spc` image, as `buildSpc` produces. */
  spc: Uint8Array;
  loops: boolean;
  introTicks: number;
  loopTicks: number;
  /** Where `spc.wasm` is served from, since a worker cannot read the page's. */
  wasmUrl: string;
}

export type RenderReply =
  | { token: number; type: 'progress'; fraction: number }
  | { token: number; type: 'done'; wav: Uint8Array }
  | { token: number; type: 'failed'; message: string };

addEventListener('message', (event: MessageEvent<RenderRequest>) => {
  const { token, spc, loops, introTicks, loopTicks, wasmUrl } = event.data;
  void coreFor(wasmUrl)
    .then((emulator) => {
      const pcm = renderSong(emulator, spc, { loops, introTicks, loopTicks }, (fraction) =>
        postMessage({ token, type: 'progress', fraction } satisfies RenderReply),
      );
      const wav = encodeWav(pcm);
      postMessage({ token, type: 'done', wav } satisfies RenderReply, [wav.buffer]);
    })
    .catch((error: unknown) => {
      postMessage({
        token,
        type: 'failed',
        message: error instanceof Error ? error.message : String(error),
      } satisfies RenderReply);
    });
});
