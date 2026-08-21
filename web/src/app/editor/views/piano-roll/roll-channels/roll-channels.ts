import { Component, computed, input, output } from '@angular/core';

import { CHANNELS } from '../../../../state/transport-view';
import { KEY_WIDTH, SCRUB_HEIGHT } from '../roll-metrics';

/**
 * Shared by all eight, so the difference between them is only the on/off half.
 *
 * It carries no background of its own: two `bg-` utilities on one element are
 * settled by the order Tailwind emits them in rather than by the order they are
 * written, so each half brings its own.
 */
const TOGGLE_CLASS =
  'flex cursor-pointer items-center justify-center rounded-[3px] font-mono text-[10px] leading-none transition-colors';

/**
 * Which channel the roll is editing, in the corner above the key column.
 *
 * The corner is the one part of the scrub bar's strip that draws nothing — the
 * bar's own contents start at {@link KEY_WIDTH} — and it is directly above the
 * keys, which is where a channel picker belongs. The plate fills it, so a press
 * beside the toggles is inert rather than reaching the bar behind it.
 *
 * A fixed eight rather than the mixer's `channels()`, which drops the channels a
 * song does not write to: a channel with no notes yet is exactly the one an
 * editor needs to be able to select.
 *
 * It emits the channel that was pressed and nothing more. Whether that press
 * selects or clears is the parent's, as the scrub bar's drag is.
 */
@Component({
  selector: 'amk-roll-channels',
  templateUrl: './roll-channels.html',
  host: {
    class: 'bg-raised absolute top-0 left-0 grid grid-cols-4 grid-rows-2 gap-px p-0.5',
    '[style.width.px]': 'keyWidth',
    '[style.height.px]': 'scrubHeight',
  },
})
export class RollChannels {
  /** The channel being edited, or null when none is. */
  readonly selected = input.required<number | null>();

  readonly picked = output<number>();

  protected readonly keyWidth = KEY_WIDTH;
  protected readonly scrubHeight = SCRUB_HEIGHT;

  /** One view model rather than a class method called per button. */
  protected readonly toggles = computed(() => {
    const selected = this.selected();
    return Array.from({ length: CHANNELS }, (_, channel) => {
      const on = channel === selected;
      return {
        channel,
        title: on ? `Stop editing channel ${channel}` : `Edit channel ${channel}`,
        class: `${TOGGLE_CLASS} ${
          on ? 'bg-accent/20 text-accent font-semibold' : 'bg-inset text-ink-muted hover:text-ink'
        }`,
      };
    });
  });
}
