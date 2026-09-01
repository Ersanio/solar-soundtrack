import { Component, computed, inject, signal } from '@angular/core';

import { Audition } from '../../state/audition';
import { Button } from '../../shared/button/button';
import { Checkbox } from '../../shared/checkbox/checkbox';
import { EditorStore } from '../../state/editor-store';
import { Mixer } from '../../state/mixer';
import { Playback } from '../../state/playback';
import { stopAll } from '../../state/stop-all';

/** The volume slider's ceiling, in percent. */
const VOLUME_MAX = 500;

/** The browser's default range thumb, in px — Chromium's is 16, Firefox's 1em is within a couple. */
const THUMB_WIDTH = 16;

@Component({
  selector: 'amk-transport-controls',
  imports: [Button, Checkbox],
  templateUrl: './transport-controls.html',
  host: { class: 'border-edge flex items-center gap-2 border-r pr-3' },
})
export class TransportControls {
  protected readonly playback = inject(Playback);
  protected readonly mixer = inject(Mixer);
  protected readonly store = inject(EditorStore);
  private readonly audition = inject(Audition);
  protected readonly VOLUME_MAX = VOLUME_MAX;

  /**
   * Anything there is to stop: the song, or a note or selection being previewed.
   *
   * The two are asked separately because they are separate — the previewer has
   * its own AudioContext and neither interrupts the other of its own accord — so
   * this button is where they meet, as the volume slider is for the level.
   */
  protected readonly canStop = computed(
    () => !this.playback.isIdle() || this.audition.previewing(),
  );

  /** True while a pointer is down on the volume slider, or after a keyboard change until it blurs. */
  protected readonly volumeReadout = signal(false);

  /** The percentage under the volume thumb, or `null` when nothing is adjusting it. */
  protected readonly volumeBubble = computed(() => {
    if (!this.volumeReadout()) {
      return null;
    }

    const volume = this.mixer.volume();
    const fraction = volume / VOLUME_MAX;

    // The thumb's centre: half a thumb in from the left, then its travel is the track less one thumb.
    return {
      left: `calc(${THUMB_WIDTH / 2}px + ${fraction} * (100% - ${THUMB_WIDTH}px))`,
      text: `${volume}%`,
    };
  });

  /** Stops whichever of the two is going, and both where both are — the roll's `Space` too. */
  protected stop(): void {
    stopAll(this.playback, this.audition);
  }

  protected onVolume(event: Event): void {
    this.mixer.volume.set(Number((event.target as HTMLInputElement).value));
    this.volumeReadout.set(true);
  }

  /**
   * Dragging: move the readout with the pointer, but leave the song alone.
   *
   * The bar is denominated in driver ticks, like everything else that follows
   * the music — the m:ss beside it is the label {@link Playback.timeLabel}
   * derives, not the value being dragged.
   */
  protected onScrub(event: Event): void {
    this.playback.scrubTo(Number((event.target as HTMLInputElement).value));
  }
}
