import { Component, inject } from '@angular/core';

import { Button } from '../../shared/button/button';
import { Playback } from '../../state/playback';

/**
 * Per-channel mute and solo for previewing parts in isolation.
 *
 * These are not emulator controls: the vendored core exposes no way to silence
 * a voice, so `Playback` rebuilds the SPC with the channel's pointer blanked
 * and reloads at the current position (see `muteChannels` in `spc/export.ts`).
 * That costs a short gap on every toggle, which is why these are buttons rather
 * than faders — one deliberate press at a time.
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
