import { DestroyRef, type Signal, effect, inject, signal } from '@angular/core';

/**
 * The animation frame timestamp, as a signal, while `active` is true.
 *
 * The sibling of `element-size.ts`: both wrap a browser callback that fires
 * outside Angular entirely, and under zoneless change detection writing the
 * signal is what schedules the re-render.
 *
 * This exists because the transport's telemetry arrives ten times a second and
 * a scroll needs a position every frame. Reading this in a `computed` that
 * interpolates between two of `Playback.songTicks`'s anchors gives one position
 * per frame at whatever rate the display actually runs — 60, 120 or 240 — which
 * a fixed feed rate cannot do: 60 Hz of data on a 144 Hz screen repeats frames
 * in an uneven 2-3-2-3 pattern, and that reads as judder.
 *
 * `active` must be false whenever nothing is moving. A frame callback that runs
 * while the tab shows something else is pure waste, and the loop is started and
 * cancelled as it changes.
 *
 * Call from an injection context:
 *
 * ```ts
 * private readonly frame = frameClock(computed(() => this.playback.isPlaying()));
 * ```
 */
export function frameClock(active: Signal<boolean>): Signal<number> {
  const now = signal(0);
  let handle = 0;

  // Sanctioned effect: driving a DOM callback, which is what effects are for.
  effect(() => {
    cancelAnimationFrame(handle);
    if (!active()) {
      return;
    }

    const tick = (stamp: number): void => {
      now.set(stamp);
      handle = requestAnimationFrame(tick);
    };

    handle = requestAnimationFrame(tick);
  });

  inject(DestroyRef).onDestroy(() => cancelAnimationFrame(handle));

  return now.asReadonly();
}
