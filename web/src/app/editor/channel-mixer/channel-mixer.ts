import { Component, computed, inject } from '@angular/core';

import { Button } from '../../shared/button/button';
import { Mixer } from '../../state/mixer';
import { CHANNEL_BG, CHANNEL_QUIET, CHANNEL_WASH } from '../../util/channel-palette';

/**
 * Shared by all eight strips, so a row differs from the next only in its wash.
 * One `sm` control tall, so the rack sits on the same 28px grid as the buttons
 * beside it; the plate and the toggles stretch to fill it.
 */
const STRIP_CLASS = 'border-edge flex h-8 items-stretch overflow-hidden rounded-md border';

/** Shared by all eight plates, the colour and the silencing coming after it. */
const PLATE_CLASS = 'border-edge flex w-6 items-center justify-center border-r font-mono text-xs';

/** Shared by M and S, the state's own colours coming after it. */
const TOGGLE_CLASS =
  'flex w-7 cursor-pointer items-center justify-center font-mono text-xs font-semibold transition-colors';

/** A toggle that is off: quiet, and lifted only by a hover it can take. */
const TOGGLE_OFF = 'text-ink-muted hover:not-disabled:text-ink';

/** M on a muted channel. */
const MUTE_ON = 'bg-danger/25 text-danger';

/**
 * `text-ink` over a channel's own colour, which is what the roll's bars label
 * themselves in (`fill-ink` in `roll-notes.html`): a digit on a plate and a name
 * on a bar are the same colour on the same eight grounds. The plate wears it
 * always; S wears it while the channel is soloed.
 */
const ON_CHANNEL = 'text-ink font-semibold';

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
 * matched to its buttons by colour rather than by reading a digit, and a solo
 * lights its S in that colour rather than in the accent, a mid blue that
 * disappears into channels 0 and 6. The digit stays, and so does the
 * strike-through over a silenced one: the eight hues do not clear the all-pairs
 * separation gate, so neither identity nor state is ever left to the colour
 * alone.
 */
@Component({
  selector: 'amk-channel-mixer',
  imports: [Button],
  templateUrl: './channel-mixer.html',
  host: { class: 'border-edge flex flex-wrap items-center gap-2 border-t px-3 py-1.5' },
})
export class ChannelMixer {
  protected readonly mixer = inject(Mixer);

  /** One view model rather than an array indexed per row from the template. */
  protected readonly rows = computed(() =>
    this.mixer.channels().map((channel) => ({
      ...channel,
      strip: `${STRIP_CLASS} ${CHANNEL_WASH[channel.index]}`,
      // A silenced channel dims plate and digit together, which holds the
      // relation to the roll's bars where dimming the digit alone would not.
      plate: `${PLATE_CLASS} ${CHANNEL_BG[channel.index]} ${ON_CHANNEL}${
        channel.audible ? '' : ` ${CHANNEL_QUIET}`
      }`,
      mute: `${TOGGLE_CLASS} disabled:cursor-not-allowed disabled:opacity-40 ${
        channel.muted ? MUTE_ON : TOGGLE_OFF
      }`,
      solo: `${TOGGLE_CLASS} ${
        channel.soloed ? `${CHANNEL_BG[channel.index]} ${ON_CHANNEL}` : TOGGLE_OFF
      }`,
    })),
  );
}
