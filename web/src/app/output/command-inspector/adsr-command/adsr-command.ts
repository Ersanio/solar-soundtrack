import { Component, computed, input } from '@angular/core';

import {
  attackSeconds,
  decaySeconds,
  decodeAdsr,
  decodeGain,
  gainModeName,
  releaseSeconds,
  sustainLevel,
} from '@spc/adsr';
import type { Command } from '@compiler/tokens';
import { duration, hex2 } from '../../../util/format';
import { AdsrGraph } from '../adsr-graph/adsr-graph';
import { type DetailRow, DetailTable } from '../../../shared/detail-table/detail-table';

/**
 * `$ED` — the envelope, set on a channel rather than baked into an instrument.
 *
 * Two arguments and two meanings, told apart by the first one's top bit:
 * `$ED $80 $yy` switches the voice to GAIN `$yy`, and anything below `$80` is an
 * ADSR pair (`hex_command_reference.html:446-467`). That is the same test the
 * instrument entry's ADSR1 byte answers, so this renders the same graph — the
 * arguments are just fed to it in the shape `$ED` supplies them.
 */
@Component({
  selector: 'amk-adsr-command',
  imports: [AdsrGraph, DetailTable],
  templateUrl: './adsr-command.html',
  host: { class: 'block' },
})
export class AdsrCommand {
  readonly command = input.required<Command>();

  protected readonly args = computed(() => this.command().args.map((a) => a.value));

  private readonly isGain = computed(() => (this.args()[0] & 0x80) !== 0);

  /**
   * Fed to the graph as an instrument's three bytes would be.
   *
   * In GAIN mode ADSR1 is forced clear so the graph takes the GAIN path, which
   * is exactly the decision the DSP makes from the same bit.
   */
  protected readonly adsr1 = computed(() => (this.isGain() ? 0 : this.args()[0] | 0x80));
  protected readonly adsr2 = computed(() => (this.isGain() ? 0 : this.args()[1]));
  protected readonly gain = computed(() => (this.isGain() ? this.args()[1] : 0));

  protected readonly rows = computed(() => {
    const rows: DetailRow[] = [];
    if (this.isGain()) {
      const gain = decodeGain(this.args()[1]);
      rows.push({ label: 'Mode', value: 'GAIN', note: `$${hex2(this.args()[0])} selects it` });
      rows.push(
        gain.mode === 'direct'
          ? {
              label: 'Level',
              value: `${Math.round((gain.level ?? 0) * 100)}% of full`,
              note: 'fixed',
            }
          : {
              label: 'Ramp',
              value: gainModeName(gain.mode),
              note:
                gain.rate === 0
                  ? 'a rate of 0 never advances, so the level holds'
                  : `rate $${hex2(gain.rate ?? 0)}`,
            },
      );
      return rows;
    }

    const envelope = decodeAdsr(this.args()[0] | 0x80, this.args()[1]);
    const release = releaseSeconds(envelope.release, envelope.sustain);
    rows.push({ label: 'Mode', value: 'ADSR' });
    rows.push({ label: 'Attack', value: duration(attackSeconds(envelope.attack)) });
    rows.push({
      label: 'Decay',
      value: duration(decaySeconds(envelope.decay, envelope.sustain)),
      note: `to ${Math.round(sustainLevel(envelope.sustain) * 100)}% of full`,
    });
    rows.push({
      label: 'Release',
      value: Number.isFinite(release) ? duration(release) : 'held indefinitely',
    });
    return rows;
  });
}
