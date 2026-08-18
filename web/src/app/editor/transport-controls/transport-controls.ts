import { Component, computed, inject, signal } from '@angular/core';

import { Button } from '../../shared/button/button';
import { Checkbox } from '../../shared/checkbox/checkbox';
import { EditorStore } from '../../state/editor-store';
import { Playback } from '../../state/playback';

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
  protected readonly store = inject(EditorStore);
  protected readonly VOLUME_MAX = VOLUME_MAX;

  /** True while a pointer is down on the volume slider, or after a keyboard change until it blurs. */
  protected readonly volumeReadout = signal(false);

  /** The percentage under the volume thumb, or `null` when nothing is adjusting it. */
  protected readonly volumeBubble = computed(() => {
    if (!this.volumeReadout()) {
      return null;
    }

    const volume = this.playback.volume();
    const fraction = volume / VOLUME_MAX;

    // The thumb's centre: half a thumb in from the left, then its travel is the track less one thumb.
    return {
      left: `calc(${THUMB_WIDTH / 2}px + ${fraction} * (100% - ${THUMB_WIDTH}px))`,
      text: `${volume}%`,
    };
  });

  protected onVolume(event: Event): void {
    this.playback.volume.set(Number((event.target as HTMLInputElement).value));
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
