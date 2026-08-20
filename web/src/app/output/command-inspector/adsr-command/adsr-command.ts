import { Component, computed, inject, input } from '@angular/core';

import { argsRewritable, commandRewritable, spliceArgs, spliceCommand } from '@amk/tokens/edits';
import type { Command } from '@amk/tokens';
import { commandLockedBecause } from '../commands/context';
import { EditorRequests } from '../../../state/editor-requests';
import { EditorStore } from '../../../state/editor-store';
import { hex2 } from '../../../util/format';
import { type EnvelopeValue, EnvelopeTuner } from '../envelope-tuner/envelope-tuner';

/**
 * `$ED` — the envelope, set on a channel rather than baked into an instrument.
 *
 * Two arguments and two meanings, told apart by the first one's top bit:
 * `$ED $80 $yy` switches the voice to GAIN `$yy`, and anything below `$80` is an
 * ADSR pair (`hex_command_reference.html:446-467`). That is the same test the
 * instrument entry's ADSR1 byte answers, so this hands both to the same tuner —
 * the arguments are just mapped into the shape it expects.
 *
 * The mapping is the whole of this component. `$ED` writes ADSR1 *without* its
 * top bit and signals GAIN by putting `$80` in the first argument instead, where
 * an `#instruments` entry writes all three bytes and lets the top bit decide. So
 * a mode switch here rewrites both arguments, not one.
 */
@Component({
  selector: 'amk-adsr-command',
  imports: [EnvelopeTuner],
  templateUrl: './adsr-command.html',
  host: { class: 'block' },
})
export class AdsrCommand {
  private readonly store = inject(EditorStore);

  private readonly requests = inject(EditorRequests);

  readonly command = input.required<Command>();

  protected readonly args = computed(() => this.command().args.map((a) => a.value));

  private readonly isGain = computed(() => (this.args()[0] & 0x80) !== 0);

  /**
   * The three bytes as the tuner reads them.
   *
   * In GAIN mode ADSR1's top bit is cleared so the tuner takes the GAIN path,
   * which is exactly the decision the DSP makes from the same bit.
   */
  protected readonly value = computed<EnvelopeValue>(() => {
    const [first = 0, second = 0] = this.args();
    return this.isGain()
      ? { adsr1: 0, adsr2: 0, gain: second }
      : { adsr1: first | 0x80, adsr2: second, gain: 0 };
  });

  protected readonly editable = computed(() => argsRewritable(this.command()));

  protected readonly lockedBecause = computed(() =>
    this.editable() || commandRewritable(this.command())
      ? null
      : commandLockedBecause(this.command()),
  );

  /** Writes the two arguments back, in `$ED`'s own encoding of the mode. */
  protected apply(next: EnvelopeValue): void {
    const gain = (next.adsr1 & 0x80) === 0;
    const first = gain ? 0x80 : next.adsr1 & 0x7f;
    const second = gain ? next.gain : next.adsr2;

    const command = this.command();
    const source = this.store.source();

    // A half-written `$ED` has fewer argument spans than there are bytes to
    // write, so there is nowhere to splice the missing one.
    if (!command.complete) {
      this.requests.apply(spliceCommand(source, command, `$ED $${hex2(first)} $${hex2(second)}`));
      return;
    }

    // In GAIN mode the first argument is only a marker — *any* byte with the top
    // bit set selects GAIN, so `$8F` and `$80` behave identically. Rewriting one
    // to the other while somebody drags the GAIN rate would change a byte they
    // did not ask about, so it is left alone unless the mode itself flipped.
    const [wasFirst, wasSecond] = this.args();
    const keepFirst = gain && this.isGain();

    this.requests.apply(
      spliceArgs(source, command, [
        keepFirst || first === wasFirst ? null : `$${hex2(first)}`,
        second === wasSecond ? null : `$${hex2(second)}`,
      ]),
    );
  }
}
