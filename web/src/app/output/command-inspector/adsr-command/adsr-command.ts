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
import { hex2 } from '../../../util/format';
import { AdsrGraph } from '../adsr-graph/adsr-graph';

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
  imports: [AdsrGraph],
  host: { class: 'block' },
  template: `
    @if (args().length < 2) {
      <p class="text-ink-muted text-xs leading-relaxed">
        Needs two arguments: either <code class="text-ink">$80</code> and a GAIN value, or an ADSR
        pair.
      </p>
    } @else {
      <div class="space-y-3">
        <table class="w-full border-collapse text-xs">
          <tbody>
            @for (row of rows(); track row.label) {
              <tr class="border-edge/60 border-t first:border-t-0">
                <td class="text-ink-muted py-1 pr-3 whitespace-nowrap">{{ row.label }}</td>
                <td class="py-1 font-mono tabular-nums">
                  {{ row.value }}
                  @if (row.note) {
                    <span class="text-ink-muted block font-sans text-[11px]">{{ row.note }}</span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>

        <div>
          <div class="text-ink-muted mb-1 text-[11px] tracking-wide uppercase">Envelope</div>
          <amk-adsr-graph [adsr1]="adsr1()" [adsr2]="adsr2()" [gain]="gain()" />
        </div>

        <p class="text-ink-muted text-xs leading-relaxed">
          This overrides the current instrument's own envelope until the next
          <code class="text-ink">&#64;</code> resets it.
        </p>
      </div>
    }
  `,
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
    const rows: { label: string; value: string; note?: string }[] = [];
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
    rows.push({ label: 'Attack', value: time(attackSeconds(envelope.attack)) });
    rows.push({
      label: 'Decay',
      value: time(decaySeconds(envelope.decay, envelope.sustain)),
      note: `to ${Math.round(sustainLevel(envelope.sustain) * 100)}% of full`,
    });
    rows.push({
      label: 'Release',
      value: Number.isFinite(release) ? time(release) : 'held indefinitely',
    });
    return rows;
  });
}

function time(value: number): string {
  if (!Number.isFinite(value)) return '∞';
  return value >= 1 ? `${value.toFixed(2)} s` : `${(value * 1000).toFixed(0)} ms`;
}
