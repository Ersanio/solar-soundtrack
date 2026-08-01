import { Component, computed, input } from '@angular/core';

import type { Command } from '@compiler/tokens';

/**
 * The fallback view: any command the inspector has nothing special to say
 * about, shown as its name and its arguments in the three bases that matter.
 *
 * Cheap to provide — `VCMD_NAMES` and `HEX_LENGTHS` already existed and were
 * used by nothing — and it means every hex command in the language becomes
 * self-documenting rather than only the handful with bespoke views.
 */
@Component({
  selector: 'amk-generic-command',
  host: { class: 'block' },
  template: `
    @if (command().args.length === 0) {
      <p class="text-ink-muted text-xs">This command takes no arguments.</p>
    } @else {
      <table class="w-full border-collapse text-xs">
        <thead>
          <tr class="text-ink-muted text-[11px] tracking-wide uppercase">
            <th scope="col" class="py-1 text-left font-semibold">Arg</th>
            <th scope="col" class="py-1 text-right font-semibold">Hex</th>
            <th scope="col" class="py-1 text-right font-semibold">Dec</th>
            <th scope="col" class="py-1 text-right font-semibold">Signed</th>
            <th scope="col" class="py-1 text-right font-semibold">Binary</th>
          </tr>
        </thead>
        <tbody class="font-mono tabular-nums">
          @for (row of rows(); track row.index) {
            <tr class="border-edge/60 border-t">
              <td class="text-ink-muted py-1">{{ row.index }}</td>
              <td class="py-1 text-right">{{ row.hex }}</td>
              <td class="py-1 text-right">{{ row.decimal }}</td>
              <td class="py-1 text-right" [class.text-ink-muted]="row.signed === row.decimal">
                {{ row.signed }}
              </td>
              <td class="text-ink-muted py-1 text-right">{{ row.binary }}</td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
})
export class GenericCommand {
  readonly command = input.required<Command>();

  protected readonly rows = computed(() =>
    this.command().args.map((arg, index) => ({
      index,
      hex: `$${(arg.value & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
      decimal: arg.value,
      // Shown alongside the unsigned reading rather than instead of it: some
      // arguments are signed (pan, feedback, FIR taps) and some are not, and
      // which is which is per-command knowledge this view does not have.
      signed: arg.value >= 0x80 ? arg.value - 0x100 : arg.value,
      binary: (arg.value & 0xff).toString(2).padStart(8, '0'),
    })),
  );
}
