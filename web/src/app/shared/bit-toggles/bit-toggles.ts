import { Component, computed, input, output } from '@angular/core';

import { Toggle } from '../toggle/toggle';

/**
 * The eight DSP voices, LSB first — the labels every channel mask in the
 * language wants. Here rather than in each panel, since the order is the whole
 * point and two statements of it could disagree.
 */
export const VOICE_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7'];

/**
 * One lit plate per bit of a byte, LSB first, in fours as FL Studio groups its steps.
 *
 * LSB first because every bitmask in the language is indexed that way and says
 * so: `$EF`'s channel mask is documented as "which channels have echo, bitwise
 * (76543210)", and a row that ran the other way would put voice 0 where a reader
 * looking for voice 7 expects it.
 *
 * A `<fieldset>` with a `<legend>`, so the group is named once rather than
 * eight unrelated toggles, and a disabled fieldset disables every plate in it.
 *
 * ```html
 * <amk-bit-toggles legend="Channels" [value]="mask()" [labels]="voiceLabels"
 *                  (changed)="setMask($event)" />
 * ```
 */
@Component({
  selector: 'amk-bit-toggles',
  imports: [Toggle],
  templateUrl: './bit-toggles.html',
  host: { class: 'block' },
})
export class BitToggles {
  readonly legend = input.required<string>();
  readonly value = input.required<number>();
  /** One per bit, LSB first. Its length is how many bits are shown. */
  readonly labels = input.required<readonly string[]>();
  readonly disabled = input(false);
  readonly valueLabel = input<string>('');
  readonly note = input<string | null>(null);

  readonly changed = output<number>();

  /** The bits in runs of four, so a byte wraps between its nibbles rather than inside one. */
  protected readonly groups = computed(() => {
    const bits = this.labels().map((label, index) => ({
      index,
      label,
      on: (this.value() & (1 << index)) !== 0,
    }));
    const groups: (typeof bits)[] = [];
    for (let start = 0; start < bits.length; start += 4) {
      groups.push(bits.slice(start, start + 4));
    }

    return groups;
  });

  protected toggle(index: number): void {
    this.changed.emit(this.value() ^ (1 << index));
  }
}
