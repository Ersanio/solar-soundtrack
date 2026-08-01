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

  protected static readonly TOGGLE =
    'cursor-pointer px-1.5 py-0.5 font-mono text-xs transition-colors ' +
    'disabled:cursor-not-allowed';

  protected muteClass(active: boolean): string {
    return `${ChannelMixer.TOGGLE} ${
      active ? 'bg-danger/20 text-danger font-semibold' : 'text-ink-muted hover:not-disabled:text-ink'
    }`;
  }

  protected soloClass(active: boolean): string {
    return `${ChannelMixer.TOGGLE} ${
      active ? 'bg-accent/20 text-accent font-semibold' : 'text-ink-muted hover:not-disabled:text-ink'
    }`;
  }
}
