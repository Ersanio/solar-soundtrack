import { Component, computed, inject } from '@angular/core';

import { Button } from '../../shared/button/button';
import { Mixer } from '../../state/mixer';
import { CHANNEL_BG, CHANNEL_QUIET, CHANNEL_WASH } from '../../util/channel-palette';

/** Shared by all eight strips, so a row differs from the next only in its wash. */
const STRIP_CLASS = 'border-edge flex items-center overflow-hidden rounded-md border';

/** Shared by all eight plates, the colour and the silencing coming after it. */
const PLATE_CLASS = 'border-edge border-r px-1.5 py-0.5 font-mono text-xs';

/**
 * Per-channel mute and solo for previewing parts in isolation.
 *
 * The song is not rebuilt: the mask goes to the running emulator, which takes
 * each muted voice's track volume in APU RAM and leaves the driver's own mute
 * register alone (`applyChannelMutes` in `@amk/spc/driver-state`, which says why
 * disabling a channel would make a busy song play faster).
 *
 * Toggling is immediate and costs no gap in playback. It reaches the note
 * previewer too, which refuses to sound a channel these buttons have silenced.
 *
 * Each strip wears its channel's own colour, so a note seen in the roll is
 * matched to its buttons by colour rather than by reading a digit. The digit
 * stays, and so does the strike-through over a silenced one: the eight hues do
 * not clear the all-pairs separation gate, so neither identity nor state is ever
 * left to the colour alone.
 */
@Component({
  selector: 'amk-channel-mixer',
  imports: [Button],
  templateUrl: './channel-mixer.html',
  host: { class: 'border-edge flex flex-wrap items-center gap-2 border-t px-3 py-2' },
})
export class ChannelMixer {
  protected readonly mixer = inject(Mixer);

  /** One view model rather than an array indexed per row from the template. */
  protected readonly rows = computed(() =>
    this.mixer.channels().map((channel) => ({
      ...channel,
      strip: `${STRIP_CLASS} ${CHANNEL_WASH[channel.index]}`,
      // `text-ink` over the plate, which is what the roll's own bars label
      // themselves in (`fill-ink` in `roll-notes.html`) — a digit on a plate and
      // a name on a bar are the same colour on the same eight grounds. A
      // silenced channel dims plate and digit together, which holds that
      // relation where dimming the digit alone would not.
      plate: `${PLATE_CLASS} ${CHANNEL_BG[channel.index]} text-ink font-semibold${
        channel.audible ? '' : ` ${CHANNEL_QUIET}`
      }`,
    })),
  );
}
