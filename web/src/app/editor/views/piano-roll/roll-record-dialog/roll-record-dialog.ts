import { Component, computed, inject, input, output, viewChild } from '@angular/core';

import { Button } from '../../../../shared/button/button';
import { Modal } from '../../../../shared/modal/modal';
import { Toggle } from '../../../../shared/toggle/toggle';
import { Audition } from '../../../../state/audition';
import { CHANNELS } from '../../../../state/transport-view';
import { CHANNEL_BG, CHANNEL_SCOPE } from '../../../../util/channel-palette';

/**
 * A chord channel's chip: the channel's own colour as its only background, as
 * the corner picker's chips are, with the ring and the dim saying whether a
 * chord may land on it.
 */
const CHIP_CLASS =
  'flex h-5 w-5 cursor-pointer items-center justify-center rounded-[3px] font-mono text-[10px] leading-none font-semibold text-(--on-ch) transition disabled:cursor-default';
const CHIP_ON = 'ring-(--on-ch) ring-2 ring-inset';
const CHIP_OFF = 'opacity-40 hover:not-disabled:opacity-70';

/**
 * What Record asks before it arms: the song under the take, the key sounds and the chord's channels.
 *
 * Each setting applies as it is pressed; Arm only arms. Opened from the
 * roll's toolbar while nothing is being recorded, so nothing here is held
 * during a take.
 */
@Component({
  selector: 'amk-roll-record-dialog',
  imports: [Button, Modal, Toggle],
  templateUrl: './roll-record-dialog.html',
  host: { class: 'contents' },
})
export class RollRecordDialog {
  private readonly audition = inject(Audition);

  private readonly modal = viewChild.required(Modal);

  protected readonly text = {
    heading: $localize`:@@roll.record.dialog.heading:roll.record.dialog.heading`,
  };

  readonly keySounds = input.required<boolean>();
  readonly playSong = input.required<boolean>();
  /** The channel being edited, which a take is always recorded on. */
  readonly editChannel = input.required<number | null>();
  /** Every channel a take is spread over, the edited one included. */
  readonly recordChannels = input.required<readonly number[]>();

  readonly keySoundsChange = output<boolean>();
  readonly playSongChange = output<boolean>();
  readonly chordChannelToggle = output<number>();
  readonly arm = output();

  /**
   * One chip per channel a chord can spread over. The edited channel's is lit
   * and takes no press, a take always being recorded on it.
   */
  protected readonly chordChips = computed(() => {
    const edited = this.editChannel();
    const chosen = new Set(this.recordChannels());
    return Array.from({ length: CHANNELS }, (_, channel) => {
      const fixed = channel === edited;
      const on = chosen.has(channel);
      return {
        channel,
        fixed,
        title: fixed
          ? $localize`:@@roll.record.chord.edited:roll.record.chord.edited ${channel}:channel:`
          : on
            ? $localize`:@@roll.record.chord.remove:roll.record.chord.remove ${channel}:channel:`
            : $localize`:@@roll.record.chord.add:roll.record.chord.add ${channel}:channel:`,
        class: `${CHIP_CLASS} ${CHANNEL_BG[channel]} ${CHANNEL_SCOPE[channel]} ${on ? CHIP_ON : CHIP_OFF}`,
      };
    });
  });

  open(): void {
    this.modal().open();
  }

  protected close(): void {
    this.modal().close();
  }

  /** The press opens the previewer's audio too, so the first key is not spent on it. */
  protected confirm(): void {
    this.audition.warm();
    this.modal().close();
    this.arm.emit();
  }
}
