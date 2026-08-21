/// <reference lib="webworker" />

/**
 * Runs {@link auditionNote} off the page.
 *
 * Its own worker rather than a second message type on `clock.worker.ts`, and its
 * own emulator: the clock measurement fires a second after typing stops, which is
 * exactly when someone is about to click, and an audition queued behind a whole
 * pass of emulation would arrive hundreds of milliseconds late.
 *
 * Neither this nor the core it holds is the one playing the song. That runs in an
 * `AudioWorkletProcessor` on the audio thread and is never addressed from here,
 * which is what lets a note be auditioned over a song without disturbing it.
 *
 * Superseded requests are not cancelled — the emulator cannot be interrupted
 * mid-render — so every reply carries the `token` it was asked with and the page
 * drops the ones it no longer wants.
 */

import { type NoteAuditionRequest, auditionNote } from '@amk/spc/note-audition';
import { coreFor } from './spc-core';

export interface NoteRequest extends NoteAuditionRequest {
  token: number;
  /** A complete `.spc` image, as `buildSpc` produces. */
  spc: Uint8Array;
  /** Where `spc.wasm` is served from, since a worker cannot read the page's. */
  wasmUrl: string;
}

export type NoteReply =
  | { token: number; ok: true; pcm: Int16Array; reachedTicks: number; heldTicks: number }
  | { token: number; ok: false; message: string };

addEventListener('message', (event: MessageEvent<NoteRequest>) => {
  const { token, spc, wasmUrl, ...request } = event.data;
  void coreFor(wasmUrl)
    .then((core) => {
      const { pcm, reachedTicks, heldTicks } = auditionNote(core, spc, request);
      // Transferred, not cloned: the PCM is a second of stereo and this end has
      // no further use for it. The SPC coming the other way is cloned, because
      // the page keeps its copy for the next audition.
      postMessage({ token, ok: true, pcm, reachedTicks, heldTicks } satisfies NoteReply, [
        pcm.buffer,
      ]);
    })
    .catch((error: unknown) => {
      postMessage({
        token,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      } satisfies NoteReply);
    });
});
