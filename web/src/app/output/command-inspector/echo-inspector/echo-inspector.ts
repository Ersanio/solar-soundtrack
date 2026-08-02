import { Component, computed, inject, input } from '@angular/core';

import type { Command } from '@compiler/tokens';
import { hex2 } from '../../../util/format';
import { FIR_PRESETS, type FirTaps, toSigned } from '@spc/fir';
import { EditorStore } from '../../../state/editor-store';
import { firOverriddenBefore } from '../fir-override';
import { FirGraph } from '../fir-graph/fir-graph';
import { type DetailRow, DetailTable } from '../../../shared/detail-table/detail-table';

/**
 * The echo commands, read out in the units they actually mean.
 *
 * `$EF` and `$F1` between them set six numbers that interact — which channels
 * echo, how loud, how far apart, how much comes back, and through which filter
 * — and none of them says what it is in the source. Delay in particular is the
 * one worth translating: `$F1`'s first argument is in 16 ms steps and also
 * decides how much ARAM the echo buffer eats.
 */
@Component({
  selector: 'amk-echo-inspector',
  imports: [FirGraph, DetailTable],
  templateUrl: './echo-inspector.html',
  host: { class: 'flex flex-col gap-3' },
})
export class EchoInspector {
  private readonly store = inject(EditorStore);

  readonly command = input.required<Command>();

  protected readonly vcmd = computed(() => this.command().vcmd ?? 0);
  protected readonly args = computed(() => this.command().args.map((a) => a.value));

  /**
   * Rows of "what this argument means", per command.
   *
   * `$F1`'s delay is masked to four bits by the driver (`main.asm:2606`), so an
   * out-of-range value wraps silently rather than erroring — worth saying, since
   * nothing else in the toolchain does.
   */
  protected readonly rows = computed<DetailRow[]>(() => {
    const args = this.args();
    switch (this.vcmd()) {
      case 0xef:
        return [
          { label: 'Channels', value: channelList(args[0] ?? 0) },
          { label: 'Volume L', value: signedLabel(args[1]) },
          { label: 'Volume R', value: signedLabel(args[2]) },
        ];
      case 0xf1: {
        const delay = args[0] ?? 0;
        const masked = delay & 0x0f;
        return [
          {
            label: 'Delay',
            value: `${masked * 16} ms`,
            note:
              delay > 0x0f
                ? `$${hex2(delay)} is out of range; the driver masks it to $${hex2(masked)}`
                : `${masked * 2} KiB of ARAM reserved for the buffer`,
          },
          { label: 'Feedback', value: signedLabel(args[1]) },
          {
            label: 'Filter',
            value: filterName(args[2] ?? 0),
            note:
              (args[2] ?? 0) > 1
                ? 'Only $00 and $01 exist; anything else reads past the table'
                : undefined,
          },
        ];
      }
      case 0xf2:
        return [
          { label: 'Over', value: `${args[0] ?? 0} ticks` },
          { label: 'To volume L', value: signedLabel(args[1]) },
          { label: 'To volume R', value: signedLabel(args[2]) },
        ];
      default:
        return [];
    }
  });

  /**
   * The filter this command implies, so `$F1` shows the same picture the FIR
   * designer would. `$00` and `$01` select AddmusicK's two built-ins; a `$F5`
   * earlier in the song is what a later `$F1` would be overriding.
   */
  protected readonly taps = computed<FirTaps | null>(() => {
    if (this.vcmd() !== 0xf1) return null;
    const which = this.args()[2] ?? 0;
    // main.asm:3507 — filter 0 is SMW's low-pass, filter 1 is flat.
    const preset = FIR_PRESETS.find((p) => p.name === (which === 0 ? 'Classic' : 'Flat'));
    return preset?.taps ?? null;
  });

  protected readonly feedback = computed(() => (this.vcmd() === 0xf1 ? (this.args()[1] ?? 0) : 0));

  /** `$F0` has nothing to say beyond its own name. */
  protected readonly isEchoOff = computed(() => this.vcmd() === 0xf0);

  /**
   * A `$F5` earlier in this channel whose coefficients this command discards.
   * The same fact the FIR designer reports, seen from the other end.
   */
  protected readonly overrides = computed(() => {
    if (this.vcmd() !== 0xf1) return null;
    const earlier = firOverriddenBefore(this.command(), this.store.tokens().commands);
    return earlier ? { line: earlier.span.line } : null;
  });
}

/** Echo volumes and feedback are signed, and negative means phase-inverted. */
function signedLabel(value: number | undefined): string {
  if (value === undefined) return '—';
  const signed = toSigned(value);
  return `${signed} ($${hex2(value)})`;
}

function filterName(which: number): string {
  if (which === 0) return '0 — SMW low-pass';
  if (which === 1) return '1 — flat';
  return `${which} — out of range`;
}

/** `$EF`'s first argument is a bitmask, one bit per voice. */
function channelList(mask: number): string {
  const on: number[] = [];
  for (let voice = 0; voice < 8; voice++) if (mask & (1 << voice)) on.push(voice);
  if (on.length === 0) return 'none';
  if (on.length === 8) return 'all';
  return on.join(', ');
}
