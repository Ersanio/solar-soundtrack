import { Component, computed, input } from '@angular/core';

import type { Command } from '@compiler/tokens';
import { hex2 } from '../../../util/format';

/**
 * The most arguments worth tabulating. `$FB $7F` already carries 130, and an
 * `#am4` `$ED $82` upload carries a 16-bit count of data bytes — a table that
 * long says nothing a row count cannot.
 */
const MAX_ROWS = 16;

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
  templateUrl: './generic-command.html',
  host: { class: 'block' },
})
export class GenericCommand {
  readonly command = input.required<Command>();

  protected readonly omitted = computed(() => Math.max(0, this.command().args.length - MAX_ROWS));

  protected readonly rows = computed(() =>
    this.command()
      .args.slice(0, MAX_ROWS)
      .map((arg, index) => ({
        index,
        hex: `$${hex2(arg.value & 0xff)}`,
        decimal: arg.value,
        // Shown alongside the unsigned reading rather than instead of it: some
        // arguments are signed (pan, feedback, FIR taps) and some are not, and
        // which is which is per-command knowledge this view does not have.
        signed: arg.value >= 0x80 ? arg.value - 0x100 : arg.value,
        binary: (arg.value & 0xff).toString(2).padStart(8, '0'),
      })),
  );
}
