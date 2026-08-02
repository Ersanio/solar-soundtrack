import { Component, computed, input } from '@angular/core';

import { noiseHz } from '@spc/adsr';
import type { Command } from '@compiler/tokens';

/**
 * The single-letter commands, said in the units they mean.
 *
 * Tempo is the one that earns this view: `t54` is a number nobody can hear, and
 * about 132 BPM is one everybody can.
 */
@Component({
  selector: 'amk-letter-command',
  host: { class: 'block' },
  template: `
    @if (readout(); as lines) {
      <table class="w-full border-collapse text-xs">
        <tbody>
          @for (row of lines; track row.label) {
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
    } @else {
      <p class="text-ink-muted text-xs">
        No argument given, so this uses whatever is currently in effect.
      </p>
    }
  `,
})
export class LetterCommand {
  readonly command = input.required<Command>();

  protected readonly readout = computed<{ label: string; value: string; note?: string }[] | null>(
    () => {
      const command = this.command();
      const args = command.args.map((a) => a.value);
      if (args.length === 0 || args[0] < 0) return null;
      const first = args[0];

      switch (command.kind.toLowerCase()) {
        case 't':
          return [
            { label: 'Tempo', value: String(first) },
            {
              label: 'Roughly',
              value: `${bpm(first).toFixed(1)} BPM`,
              // parser.ts:144-149 — the driver plays at most one tick per pass
              // of its main loop, so a busy song drops ticks and no formula
              // over tempo can be exact. `#halvetempo` and `#option
              // dividetempo` move it further.
              note: 'estimated; the driver drops ticks when it is busy',
            },
          ];

        case 'v':
          return [
            { label: 'Volume', value: `${first} of 255` },
            { label: 'Of full', value: `${((first / 255) * 100).toFixed(0)}%` },
          ];

        case 'w':
          return [
            { label: 'Global volume', value: `${first} of 255` },
            { label: 'Of full', value: `${((first / 255) * 100).toFixed(0)}%` },
          ];

        case 'y':
          return [
            { label: 'Pan', value: String(first) },
            {
              label: 'Position',
              // AddmusicK's pan runs 0 (hard right) to 20 (hard left), 10 centre.
              value:
                first === 10
                  ? 'centre'
                  : first < 10
                    ? `right ${10 - first}/10`
                    : `left ${first - 10}/10`,
            },
          ];

        case 'o':
          return [{ label: 'Octave', value: String(first) }];

        case 'l':
          return [
            { label: 'Default length', value: `1/${first}` },
            { label: 'In ticks', value: ticksFor(first) },
          ];

        case 'h':
          return [{ label: 'Transpose', value: `${first > 0 ? '+' : ''}${first} semitones` }];

        case 'q':
          return [
            {
              label: 'Quantization',
              value: `$${first.toString(16).toUpperCase().padStart(2, '0')}`,
            },
          ];

        case 'n':
          return [
            {
              label: 'Noise clock',
              value: `$${first.toString(16).toUpperCase().padStart(2, '0')} of $1F`,
            },
            {
              label: 'Frequency',
              value: first === 0 ? 'silent' : `${Math.round(noiseHz(first)).toLocaleString()} Hz`,
              // One DSP register drives every voice's noise (`main.asm:2552`
              // ModifyNoise), so this is not a per-channel setting even though it
              // is written on a channel.
              note: 'shared by every channel — a later n retunes this one too',
            },
            {
              label: 'Replaces',
              value: 'the instrument’s sample',
              note: 'cancelled by the next instrument change',
            },
          ];

        case '*':
          return [{ label: 'Calls loop', value: String(first) }];

        case '[':
          return [{ label: 'Repeats', value: `${first} times` }];

        default:
          return [{ label: 'Value', value: String(first) }];
      }
    },
  );
}

/**
 * Beats per minute for an AddmusicK tempo byte.
 *
 * Uses the same arithmetic as `parser.ts:151-153`: a tick is
 * `256 / (500 × (tempo + 1))` seconds, and a quarter note is 48 of them out of
 * the 192 in a whole note.
 */
function bpm(tempo: number): number {
  const tickSeconds = 256 / (500 * (tempo + 1));
  return 60 / (48 * tickSeconds);
}

/** 192 ticks to a whole note, so `l8` is 24 — when it divides evenly. */
function ticksFor(denominator: number): string {
  if (denominator <= 0) return '—';
  const ticks = 192 / denominator;
  return Number.isInteger(ticks) ? String(ticks) : `${ticks.toFixed(2)} (rounded by the compiler)`;
}
