import { Component, inject, input } from '@angular/core';

import { Checkbox } from '../../../../shared/checkbox/checkbox';
import { SampleStore } from '../../../../state/sample-store';
import { Hex2Pipe } from '../../../../util/hex.pipe';
import { AuditionButton } from '../audition-button/audition-button';
import { SampleWave } from '../sample-wave/sample-wave';
import type { SlotRow } from '../sample-rows';

/**
 * One slot of an opened bank.
 *
 * An attribute on the `<li>` rather than an element of its own, so the list
 * stays a list: `divide-y` divides a `<ul>`'s own children, and a wrapper
 * element between them would take the rules with it.
 */
@Component({
  selector: 'li[amk-slot-row]',
  imports: [AuditionButton, Checkbox, Hex2Pipe, SampleWave],
  templateUrl: './slot-row.html',
  host: { class: 'flex items-center gap-3 py-1.5' },
})
export class SlotRowView {
  private readonly library = inject(SampleStore);

  readonly row = input.required<SlotRow>();

  protected onImportant(name: string, important: boolean): void {
    this.library.setImportant(name, important);
  }
}
