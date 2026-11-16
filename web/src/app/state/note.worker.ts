/// <reference lib="webworker" />

/**
 * Runs {@link auditionNote} and {@link auditionRegion} off the page.
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
 *
 * It keeps a few {@link AuditionCheckpoint}s of the song it was last asked about,
 * taken on a `prepare`: a note at a tick past one starts from it rather than from
 * the top of the song, which is what lets a key on a MIDI keyboard sound at once.
 */

import {
  type AuditionCheckpoint,
  type NoteAuditionRequest,
  type RegionAuditionRequest,
  auditionNote,
  auditionRegion,
  prepareCheckpoint,
} from '@amk/spc/note-audition';
import { coreFor } from './spc-core';

/** What every kind carries: the run's own token and what it is run against. */
interface AuditionHeader {
  token: number;
  /** A complete `.spc` image, as `buildSpc` produces. */
  spc: Uint8Array;
  /**
   * Which image `spc` is, counted by the page: a checkpoint is a frozen emulator
   * and says nothing about the song it holds, so this is what keeps one from
   * being resumed under another song.
   */
  song: number;
  /** Where `spc.wasm` is served from, since a worker cannot read the page's. */
  wasmUrl: string;
}

/**
 * A note, a stretch of the song, or a tick to be ready for. One worker for all
 * three, because they ask the same emulator.
 */
export type AuditionRequest =
  | (AuditionHeader & { kind: 'note'; note: NoteAuditionRequest })
  | (AuditionHeader & { kind: 'region'; region: RegionAuditionRequest })
  | (AuditionHeader & { kind: 'prepare'; atTicks: number; silenced: number });

export type NoteReply =
  | { token: number; ok: true; pcm: Int16Array; reachedTicks: number; heldTicks: number }
  | { token: number; ok: false; message: string };

/** Each is the whole emulator, 16 MiB of it, so only the newest few are kept. */
const MAX_CHECKPOINTS = 3;

let song = -1;
let checkpoints: AuditionCheckpoint[] = [];

/** The latest checkpoint a run to `target` under `silenced` passes through. */
function checkpointFor(
  target: number,
  silenced: number,
  inclusive: boolean,
): AuditionCheckpoint | null {
  let best: AuditionCheckpoint | null = null;
  for (const each of checkpoints) {
    const before = inclusive ? each.ticks <= target : each.ticks < target;
    if (each.silenced === silenced && before && (best === null || each.ticks > best.ticks)) {
      best = each;
    }
  }

  return best;
}

addEventListener('message', (event: MessageEvent<AuditionRequest>) => {
  const request = event.data;
  const { token, spc, wasmUrl } = request;
  void coreFor(wasmUrl)
    .then((core) => {
      if (request.song !== song) {
        song = request.song;
        checkpoints = [];
      }

      if (request.kind === 'prepare') {
        const target = Math.max(1, Math.floor(request.atTicks));
        const from = checkpointFor(target, request.silenced, true);
        if (from?.ticks !== target) {
          checkpoints.push(prepareCheckpoint(core, spc, request, from));
          checkpoints = checkpoints.slice(-MAX_CHECKPOINTS);
        }

        return;
      }

      const { pcm, reachedTicks, heldTicks } =
        request.kind === 'note'
          ? auditionNote(
              core,
              spc,
              request.note,
              checkpointFor(
                Math.max(1, Math.floor(request.note.atTicks)),
                (request.note.silenced ?? 0) & ~(1 << request.note.channel),
                false,
              ),
            )
          : auditionRegion(core, spc, request.region);
      // Transferred, not cloned: the PCM is a second of stereo and this end has
      // no further use for it. The SPC coming the other way is cloned, because
      // the page keeps its copy for the next audition.
      postMessage({ token, ok: true, pcm, reachedTicks, heldTicks } satisfies NoteReply, [
        pcm.buffer,
      ]);
    })
    .catch((error: unknown) => {
      if (request.kind === 'prepare') {
        return; // Nobody is waiting on one; the note it was for runs from the top.
      }

      postMessage({
        token,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      } satisfies NoteReply);
    });
});
