import type { Audition } from './audition';
import type { Playback } from './playback';

/**
 * Stops whatever is sounding: the song, and a note or selection being
 * previewed. The two are stopped separately because they are separate — the
 * previewer has its own AudioContext and neither interrupts the other of its
 * own accord — so the Stop button and the roll's `Space` both come here rather
 * than each stopping one of them.
 *
 * The transport half is guarded: `Playback.stop` rests the song at tick 0, so a
 * stop with it already idle would throw away a position seeked to while
 * stopped, which is where the next press of play picks the song up.
 */
export function stopAll(playback: Playback, audition: Audition): void {
  if (!playback.isIdle()) {
    playback.stop();
  }

  audition.stop();
}
