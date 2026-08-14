import { Component, inject } from '@angular/core';

import { Button } from '../../shared/button/button';
import { Playback } from '../../state/playback';

/**
 * Per-channel mute and solo for previewing parts in isolation.
 *
 * The song is not rebuilt: the mask goes to the running emulator, which takes
 * each muted voice's track volume in APU RAM and leaves the driver's own mute
 * register alone (`applyChannelMutes` in `@amk/spc/driver-state`, which says why
 * disabling a channel would make a busy song play faster).
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
