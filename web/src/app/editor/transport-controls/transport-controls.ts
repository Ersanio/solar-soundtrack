import { Component, inject } from '@angular/core';

import { Button } from '../../shared/button/button';
import { Checkbox } from '../../shared/checkbox/checkbox';
import { EditorStore } from '../../state/editor-store';
import { Playback } from '../../state/playback';

@Component({
  selector: 'amk-transport-controls',
  imports: [Button, Checkbox],
  templateUrl: './transport-controls.html',
  host: { class: 'border-edge flex items-center gap-2 border-r pr-3' },
})
export class TransportControls {
  protected readonly playback = inject(Playback);
  protected readonly store = inject(EditorStore);

  protected onVolume(event: Event): void {
    this.playback.volume.set(Number((event.target as HTMLInputElement).value));
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
