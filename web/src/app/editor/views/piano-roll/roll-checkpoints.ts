import { type Signal, computed, effect, inject, untracked } from '@angular/core';

import { TICKS_PER_WHOLE } from '@amk/core/hardcoded-tables';
import { Audition } from '../../../state/audition';
import { EditorStore } from '../../../state/editor-store';
import { Mixer } from '../../../state/mixer';
import { Playback } from '../../../state/playback';
import type { RecordPhase } from './roll-record';

export interface CheckpointSources {
  /** The earliest tick a keyboard key could sound at now (`RollRecord.keyTick`). */
  keyTick: Signal<number | null>;
  /** The tick at the roll's left edge. */
  viewTick: Signal<number>;
  /** Where a press on the key column sounds, which is where the camera is. */
  playTick: Signal<number>;
  follow: Signal<boolean>;
  editChannel: Signal<number | null>;
  phase: Signal<RecordPhase>;
}

/** How far apart the checkpoints under a key are kept, in ticks. */
const CELL = 24;

/** The last cell boundary strictly before the tick a note asked for at `tick` is sounded on. */
const cellBefore = (tick: number): number =>
  Math.max(0, Math.ceil(Math.round(tick) / CELL) - 1) * CELL;

const sameTicks = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((tick, at) => tick === b[at]);

/**
 * Keeping the note previewer's worker ready where the roll will next ask it for a
 * note: anything on screen, the key column, and a keyboard's keys.
 *
 * A composable in `roll-record.ts`'s shape, and it must be called from an
 * injection context: it starts an effect. A note is heard by running the song up
 * to its tick (`Audition`), and a checkpoint is that run made before the click.
 *
 * Every click, drag and drawn note sounds at a tick on screen, so one checkpoint a
 * bar behind the left edge serves all of them for at most a screen of emulation;
 * a bar rather than a cell so that a note starting just off screen is served too,
 * and so that a scroll moves it once a bar. A key sounds where it is pressed, so
 * the key column's and the keyboard's are a cell behind it — and the next cell as
 * well while that is moving, so it is ready before the pointer gets there.
 */
export function rollCheckpoints(sources: CheckpointSources): void {
  const audition = inject(Audition);
  const editor = inject(EditorStore);
  const mixer = inject(Mixer);
  const playback = inject(Playback);

  const ticks = computed<readonly number[]>(
    () => {
      const wanted = new Set<number>();
      const playing = playback.isPlaying();
      const phase = sources.phase();

      wanted.add(
        Math.max(0, Math.ceil(sources.viewTick() / TICKS_PER_WHOLE) - 1) * TICKS_PER_WHOLE,
      );

      // The key column needs a channel to sound on, and is not played during a take.
      if (sources.editChannel() !== null && phase === 'idle') {
        const at = cellBefore(sources.playTick());
        wanted.add(at);
        if (playing && sources.follow()) {
          wanted.add(at + CELL);
        }
      }

      const key = sources.keyTick();
      if (key !== null) {
        const at = cellBefore(key);
        wanted.add(at);
        if (playing || phase === 'recording') {
          wanted.add(at + CELL);
        }
      }

      return [...wanted].sort((a, b) => a - b);
    },
    { equal: sameTicks },
  );

  // Sanctioned effect: keeping the worker's checkpoints where the notes will be,
  // which is an imperative sink. Per cell rather than per frame, and again for a
  // new compile or a new mixer mask, either of which is another song to have run
  // up to those ticks.
  effect(() => {
    const at = ticks();
    editor.result();
    mixer.silenced();
    untracked(() => audition.prepare(at));
  });
}
