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
 * It keeps the {@link AuditionCheckpoint}s the page last asked for with a
 * `prepare`, of the song it was last asked about: a note at a tick past one starts
 * from it rather than from the top of the song, which is what lets a click in the
 * roll, a key on its key column and a key on a keyboard sound at once. Prepares
 * are made one per task, the lowest first, so a note waits behind at most one.
 */

import {
  type AuditionCheckpoint,
  type NoteAuditionRequest,
  type RegionAuditionRequest,
  auditionNote,
  auditionRegion,
  prepareCheckpoint,
} from '@amk/spc/note-audition';
import type { SpcCore } from '@amk/spc/wasm-host';
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
 * A note, a stretch of the song, or the ticks to be ready for. One worker for all
 * three, because they ask the same emulator.
 *
 * A `prepare` names every tick the page wants a checkpoint at, not one more: what
 * it leaves out is let go.
 */
export type AuditionRequest =
  | (AuditionHeader & { kind: 'note'; note: NoteAuditionRequest })
  | (AuditionHeader & { kind: 'region'; region: RegionAuditionRequest })
  | (AuditionHeader & { kind: 'prepare'; atTicks: readonly number[]; silenced: number });

export type NoteReply =
  | { token: number; ok: true; pcm: Int16Array; reachedTicks: number; heldTicks: number }
  | { token: number; ok: false; message: string };

/** Each is the whole emulator, 16 MiB of it, so only a few are kept. */
const MAX_CHECKPOINTS = 4;

/** A checkpoint, under the tick it was asked for — short of it where the song ended first. */
interface Kept {
  asked: number;
  checkpoint: AuditionCheckpoint;
}

/** What the last `prepare` asked for, kept until every tick of it has a checkpoint. */
interface Wanted {
  spc: Uint8Array;
  song: number;
  silenced: number;
  ticks: readonly number[];
}

let song = -1;
let kept: Kept[] = [];
let wanted: Wanted | null = null;
let core: SpcCore | null = null;
let scheduled = false;

/** The latest checkpoint a run to `target` under `silenced` passes through. */
function checkpointFor(
  target: number,
  silenced: number,
  inclusive: boolean,
): AuditionCheckpoint | null {
  let best: AuditionCheckpoint | null = null;
  for (const { checkpoint } of kept) {
    const before = inclusive ? checkpoint.ticks <= target : checkpoint.ticks < target;
    if (
      checkpoint.silenced === silenced &&
      before &&
      (best === null || checkpoint.ticks > best.ticks)
    ) {
      best = checkpoint;
    }
  }

  return best;
}

const isWanted = (entry: Kept, want: Wanted): boolean =>
  entry.checkpoint.silenced === want.silenced && want.ticks.includes(entry.asked);

/**
 * Makes the lowest checkpoint still wanted, then comes back for the next.
 *
 * A timer rather than a loop, so a note asked for meanwhile is answered between
 * two of them, and so a burst of prepares is one run to wherever the last one
 * pointed. Lowest first, because each then runs on from the one before it.
 */
function step(): void {
  scheduled = false;
  const want = wanted;
  if (!want || !core || want.song !== song) {
    return;
  }

  const missing = want.ticks.find(
    (tick) => !kept.some((entry) => entry.asked === tick && isWanted(entry, want)),
  );
  if (missing === undefined) {
    // Everything asked for is here, so nothing else is needed to run on from.
    kept = kept.filter((entry) => isWanted(entry, want));
    wanted = null;
    return;
  }

  // Unwanted ones are kept as long as the budget allows, being the nearest
  // place to run on from when what is wanted has only just moved. The budget
  // full means one of them is still here, the wanted set being held to it.
  const from = checkpointFor(missing, want.silenced, true);
  while (kept.length >= MAX_CHECKPOINTS) {
    const spare = kept.findIndex((entry) => entry.checkpoint !== from && !isWanted(entry, want));
    kept.splice(spare >= 0 ? spare : kept.findIndex((entry) => !isWanted(entry, want)), 1);
  }

  try {
    const checkpoint = prepareCheckpoint(
      core,
      want.spc,
      { atTicks: missing, silenced: want.silenced },
      from,
    );
    kept.push({ asked: missing, checkpoint });
  } catch {
    // Nobody is waiting on one; the note it was for runs from the top.
    wanted = null;
    return;
  }

  schedule();
}

function schedule(): void {
  if (!scheduled) {
    scheduled = true;
    setTimeout(step, 0);
  }
}

addEventListener('message', (event: MessageEvent<AuditionRequest>) => {
  const request = event.data;
  const { token, spc, wasmUrl } = request;
  void coreFor(wasmUrl)
    .then((ready) => {
      core = ready;
      if (request.song !== song) {
        song = request.song;
        kept = [];
      }

      if (request.kind === 'prepare') {
        // Held to the budget, or making the last would evict one already made.
        const ticks = [...new Set(request.atTicks.map((tick) => Math.max(1, Math.floor(tick))))];
        wanted = {
          spc,
          song: request.song,
          silenced: request.silenced,
          ticks: ticks.sort((a, b) => a - b).slice(0, MAX_CHECKPOINTS),
        };
        schedule();
        return;
      }

      const { pcm, reachedTicks, heldTicks } =
        request.kind === 'note'
          ? auditionNote(
              ready,
              spc,
              request.note,
              checkpointFor(
                Math.max(1, Math.floor(request.note.atTicks)),
                (request.note.silenced ?? 0) & ~(1 << request.note.channel),
                false,
              ),
            )
          : auditionRegion(ready, spc, request.region);
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
