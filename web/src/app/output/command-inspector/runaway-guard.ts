import { type Signal, effect, inject, linkedSignal, untracked } from '@angular/core';

import type { Command } from '@amk/tokens';
import { EditorStore } from '../../state/editor-store';
import { Playback } from '../../state/playback';

/** Which command the verdict is about, and what the verdict is. */
interface Reading {
  start: number;
  runaway: boolean;
}

/**
 * Stops the song when an edit turns the echo into one that builds on itself.
 *
 * The echo's FIR sits inside its own feedback loop, so repeat *k* comes back at
 * `(EFB/128 · |H(f)|)^k` — past 1 that grows without bound for as long as the
 * song plays, through whatever the listener happens to be wearing. `SST0500`
 * and `SST0501` report it in the output pane, but a diagnostic is written from
 * the *document*, and both controls that cause one are sliders: the noise
 * arrives while the pointer is still moving, several seconds before anything is
 * written for a diagnostic to describe. So the panels judge what they are
 * showing and stop the player themselves.
 *
 * Shared by the two commands that can do it — `$F5`'s coefficients and `$F1`'s
 * feedback — because two copies of an ear-protection interlock is one more than
 * can be allowed to drift.
 *
 * **Only the transition acts.** Opening the inspector on a filter that is
 * already bad is not an edit, and pressing play again with the warning still up
 * is a decision the listener is entitled to make; stopping either would be a
 * control that cannot be overruled. `start` is what tells arriving at a command
 * apart from editing one — moving the caret between two `$F5`s reuses the
 * component with a new input rather than building a fresh one.
 *
 * A `linkedSignal` rather than fields mutated inside the effect: the previous
 * reading then lives in the signal graph, derived in one place, instead of in
 * instance state whose answer depends on how many times the effect has run.
 *
 * Call from an injection context — a field initialiser or a constructor.
 */
export function stopWhenRunaway(
  command: Signal<Command>,
  runaway: Signal<boolean>,
  what: string,
): void {
  const playback = inject(Playback);
  const store = inject(EditorStore);

  const reading = linkedSignal<Reading, Reading & { became: boolean }>({
    source: () => ({ start: command().span.start, runaway: runaway() }),
    computation: (next, previous) => ({
      ...next,
      became: next.runaway && previous?.value.start === next.start && !previous.value.runaway,
    }),
  });

  effect(() => {
    if (!reading().became) {
      return;
    }

    untracked(() => {
      // A paused song is not audible, and resuming one is as deliberate an act
      // as pressing play.
      if (!playback.isPlaying()) {
        return;
      }

      playback.stop();
      store.fail(
        `playback automatically stopped to protect your ears and speakers due to a runaway ${what}`,
      );
    });
  });
}
