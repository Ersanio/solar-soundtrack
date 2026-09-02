import { Component, computed, input, output } from '@angular/core';

/**
 * The eight DSP voices, LSB first — the labels every channel mask in the
 * language wants. Here rather than in each panel, since the order is the whole
 * point and two statements of it could disagree.
 */
export const VOICE_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7'];

/**
 * One checkbox per bit of a byte, LSB first.
 *
 * LSB first because every bitmask in the language is indexed that way and says
 * so: `$EF`'s channel mask is documented as "which channels have echo, bitwise
 * (76543210)", and a row that ran the other way would put voice 0 where a reader
 * looking for voice 7 expects it.
 *
 * A `<fieldset>` with a `<legend>` rather than a row of labelled boxes, so the
 * group is named once instead of eight unrelated checkboxes. Raw inputs rather
 * than `amk-checkbox`, whose two-way `checked` cannot express a bit derived from
 * a byte the parent owns.
 *
 * ```html
 * <amk-bit-toggles legend="Channels" [value]="mask()" [labels]="voiceLabels"
 *                  (changed)="setMask($event)" />
 * ```
 */
@Component({
  selector: 'amk-bit-toggles',
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

  protected readonly bits = computed(() =>
    this.labels().map((label, index) => ({
      index,
      label,
      on: (this.value() & (1 << index)) !== 0,
    })),
  );

  protected toggle(index: number): void {
    this.changed.emit(this.value() ^ (1 << index));
  }
}
