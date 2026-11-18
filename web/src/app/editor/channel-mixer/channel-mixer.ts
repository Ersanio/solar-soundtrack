import { Component, computed, inject } from '@angular/core';

import { Button } from '../../shared/button/button';
import { Mixer } from '../../state/mixer';
import { CHANNEL_BG, CHANNEL_QUIET, CHANNEL_SCOPE, CHANNEL_WASH } from '../../util/channel-palette';

/**
 * Shared by all eight strips, so a row differs from the next only in its wash.
 * One `sm` control tall, so the rack sits on the same 28px grid as the buttons
 * beside it; the plate and the toggles stretch to fill it.
 */
const STRIP_CLASS = 'border-edge flex h-8 items-stretch overflow-hidden rounded-md border';

/** Shared by all eight plates, the colour and the silencing coming after it. */
const PLATE_CLASS = 'border-edge flex w-6 items-center justify-center border-r font-mono text-xs';

/** Shared by the light and S, the state's own colours coming after it. */
const TOGGLE_CLASS =
  'flex w-7 cursor-pointer items-center justify-center font-mono text-xs font-semibold transition-colors';

/** A toggle that is off: quiet, and lifted only by a hover it can take. */
const TOGGLE_OFF = 'text-ink-muted hover:not-disabled:text-ink';

/**
 * The cell holding a channel's light, which is lit while the channel is heard
 * and dark while it is silenced, as FL Studio's mute LEDs are — so a solo puts
 * out every light but its own, as it does there.
 */
const LIGHT_CELL = 'hover:not-disabled:bg-ink/10 disabled:cursor-not-allowed disabled:opacity-40';

/**
 * `--on-ch` over a channel's own colour, which is what the roll's bars label
 * themselves in (`fill-(--on-ch)` in `roll-notes.html`): a digit on a plate and
 * a name on a bar are the same colour on the same eight grounds. The plate wears
 * it always; S wears it while the channel is soloed. The scope class beside it
 * is what sets the ink.
 */
const ON_CHANNEL = 'text-(--on-ch) font-semibold';

/**
 * Per-channel mute and solo for previewing parts in isolation.
 *
 * The song is not rebuilt: the mask goes to the running emulator, which mutes
 * each voice inside its DSP and leaves the driver alone (`SpcCore.muteVoices`;
 * `packages/spc/CLAUDE.md` says why the driver's own registers are the wrong
 * place).
 *
 * Toggling is immediate and costs no gap in playback. It reaches the note
 * previewer too, which refuses to sound a channel these buttons have silenced.
 *
 * Each strip wears its channel's own colour, so a note seen in the roll is
 * matched to its buttons by colour rather than by reading a digit, and a solo
 * lights its S in that colour rather than in the accent, which would vanish into
 * whichever channel came nearest its hue. The digit stays, and so does the
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
      plate: `${PLATE_CLASS} ${CHANNEL_BG[channel.index]} ${CHANNEL_SCOPE[channel.index]} ${ON_CHANNEL}${
        channel.audible ? '' : ` ${CHANNEL_QUIET}`
      }`,
      mute: `${TOGGLE_CLASS} ${LIGHT_CELL}`,
      light: channel.audible ? 'led led-on' : 'led',
      solo: `${TOGGLE_CLASS} ${
        channel.soloed
          ? `${CHANNEL_BG[channel.index]} ${CHANNEL_SCOPE[channel.index]} ${ON_CHANNEL}`
          : TOGGLE_OFF
      }`,
    })),
  );
}
