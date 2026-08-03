import { Component, inject } from '@angular/core';

import { Button } from '../../shared/button/button';
import { Playback } from '../../state/playback';

/**
 * Per-channel mute and solo for previewing parts in isolation.
 *
 * The song is not rebuilt: the mask goes to the running emulator, which writes
 * the driver's own mute register in APU RAM (`applyChannelMutes` in
 * `spc/driver-state.ts`). A muted channel goes on being parsed and only loses
 * its sound, which is what keeps the song intact — tempo, echo settings and the
 * intro marker are all song-global but live in whichever channel the user typed
 * them in, so a channel that stops being read takes them with it.
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
