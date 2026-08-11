import { Component, inject } from '@angular/core';

import { Button } from '../../shared/button/button';
import { Playback } from '../../state/playback';

/**
 * Per-channel mute and solo for previewing parts in isolation.
 *
 * The song is not rebuilt: the mask goes to the running emulator, which writes
 * the driver's own mute register in APU RAM (`applyChannelMutes` in
 * `@amk/spc/driver-state`).
 *
 * Toggling is immediate and costs no gap in playback.
 */
@Component({
  selector: 'amk-channel-mixer',
  imports: [Button],
  templateUrl: './channel-mixer.html',
  host: { class: 'border-edge flex flex-wrap items-center gap-2 border-t px-3 py-2' },
})
export class ChannelMixer {
  protected readonly playback = inject(Playback);
}
