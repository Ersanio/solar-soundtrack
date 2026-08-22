import { Component, computed, input, output } from '@angular/core';

import { CHANNELS, type ChannelState } from '../../../../state/transport-view';
import { KEY_WIDTH, OVERVIEW_HEIGHT } from '../roll-metrics';

/**
 * Shared by all eight, so the difference between them is only the on/off half.
 *
 * It carries no background of its own: two `bg-` utilities on one element are
 * settled by the order Tailwind emits them in rather than by the order they are
 * written, so each half brings its own.
 */
const TOGGLE_CLASS =
  'flex cursor-pointer items-center justify-center rounded-[3px] font-mono text-[10px] leading-none transition-colors';

const ON_CLASS = 'bg-accent/20 text-accent font-semibold';
const OFF_CLASS = 'bg-inset text-ink-muted hover:text-ink';

/** Isolated: a ring, the fill being what says a channel is being edited. */
const SOLO_CLASS = 'ring-accent ring-1 ring-inset';

/** Not being heard, struck through as the mixer strikes its own channel number. */
const QUIET_CLASS = 'line-through';

/**
 * What a chip is for, in the order a press finds out: the click, then the state
 * that explains why the notes may be inert, then the other press it takes.
 */
function chipTitle(
  channel: number,
  on: boolean,
  soloed: boolean,
  quiet: boolean,
  song: boolean,
): string {
  const edit = on ? `Stop editing channel ${channel}` : `Edit channel ${channel}`;
  const heard = quiet ? ' — not being heard' : '';
  const solo = !song ? '' : soloed ? ' — Ctrl+click to stop soloing' : ' — Ctrl+click to solo';
  return `${edit}${heard}${solo}`;
}

/**
 * Which channel the roll is editing, in the corner above the key column.
 *
 * The corner is the one part of the overview bar's strip that draws nothing — the
 * bar's own contents start at {@link KEY_WIDTH} — and it is directly above the
 * keys, which is where a channel picker belongs. The plate fills it, so a press
 * beside the toggles is inert rather than reaching the bar behind it.
 *
 * A fixed eight rather than the mixer's `channels()`, which drops the channels a
 * song does not write to: a channel with no notes yet is exactly the one an
 * editor needs to be able to select. Those rows are still taken, for what they
 * say about the eight — which are muted, which is soloed, and which the song
 * writes to at all.
 *
 * It emits the channel that was pressed, on the output the modifier chose, and
 * nothing more. Whether that press selects, clears or isolates is the parent's,
 * as the overview bar's drag is.
 */
@Component({
  selector: 'amk-roll-channels',
  templateUrl: './roll-channels.html',
  host: {
    class: 'bg-raised absolute top-0 left-0 grid grid-cols-4 grid-rows-2 gap-px p-0.5',
    '[style.width.px]': 'keyWidth',
    '[style.height.px]': 'barHeight',
  },
})
export class RollChannels {
  /** The channel being edited, or null when none is. */
  readonly selected = input.required<number | null>();

  /** The mixer's rows: which channel is soloed, and which the song writes to. */
  readonly channels = input.required<readonly ChannelState[]>();

  /**
   * What is not being heard, as a mask.
   *
   * The mask rather than the rows, which drop the channels the song does not
   * write to: a solo silences those as surely as the rest, and a chip that
   * looked live for one would be offering an edit the roll goes on to refuse.
   */
  readonly silenced = input.required<number>();

  readonly picked = output<number>();
  readonly isolated = output<number>();

  protected readonly keyWidth = KEY_WIDTH;
  protected readonly barHeight = OVERVIEW_HEIGHT;

  /** One view model rather than a class method called per button. */
  protected readonly toggles = computed(() => {
    const selected = this.selected();
    const silenced = this.silenced();
    const soloed = this.channels().find((state) => state.soloed)?.index ?? null;
    const song = new Set(this.channels().map((state) => state.index));

    return Array.from({ length: CHANNELS }, (_, channel) => {
      const on = channel === selected;
      const solo = channel === soloed;
      const quiet = (silenced & (1 << channel)) !== 0;
      return {
        channel,
        title: chipTitle(channel, on, solo, quiet, song.has(channel)),
        class: `${TOGGLE_CLASS} ${on ? ON_CLASS : OFF_CLASS}${solo ? ` ${SOLO_CLASS}` : ''}${
          quiet ? ` ${QUIET_CLASS}` : ''
        }`,
      };
    });
  });

  /** `Ctrl` isolates rather than edits, which is the mixer's `S` in the FL idiom. */
  protected press(channel: number, event: MouseEvent): void {
    if (event.ctrlKey || event.metaKey) {
      this.isolated.emit(channel);
      return;
    }

    this.picked.emit(channel);
  }
}
