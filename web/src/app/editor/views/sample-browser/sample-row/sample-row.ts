import { Component, inject, input, output } from '@angular/core';

import { Button } from '../../../../shared/button/button';
import { Checkbox } from '../../../../shared/checkbox/checkbox';
import { SampleStore } from '../../../../state/sample-store';
import { AuditionButton } from '../audition-button/audition-button';
import { SampleWave } from '../sample-wave/sample-wave';
import { SlotRowView } from '../slot-row/slot-row';
import type { FileRow } from '../sample-rows';

/**
 * One entry of the library: a `.brr` sample, or a `.bnk` bank and its slots.
 *
 * Bundled files and uploads draw the same because they behave the same — a
 * bundled name whose bytes have been replaced is still SRCN 4. What differs is
 * the escape hatch, and that is the one thing this branches on: bundled files
 * revert, uploads delete.
 *
 * An attribute on the `<li>`, so the browser's `<ul>` keeps dividing its rows.
 * Opening a bank is the parent's business — the open set outlives any one row —
 * so that leaves as an output while the library edits are taken here.
 */
@Component({
  selector: 'li[amk-sample-row]',
  imports: [AuditionButton, Button, Checkbox, SampleWave, SlotRowView],
  templateUrl: './sample-row.html',
  host: { class: 'hover:bg-raised block px-3 py-2' },
})
export class SampleRowView {
  private readonly library = inject(SampleStore);

  readonly row = input.required<FileRow>();
  /** Its position in the list, which is a plain sample's SRCN. */
  readonly index = input.required<number>();

  /** Open or close this bank. The set of open banks belongs to the browser. */
  readonly toggled = output<string>();

  protected onImportant(name: string, important: boolean): void {
    this.library.setImportant(name, important);
  }

  protected revert(name: string): void {
    this.library.revert(name);
  }

  protected remove(name: string): void {
    this.library.remove(name);
  }
}
