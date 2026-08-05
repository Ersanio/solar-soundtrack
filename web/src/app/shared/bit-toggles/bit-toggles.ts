import { Component, computed, input, output } from '@angular/core';

/**
 * One checkbox per bit of a byte, LSB first.
 *
 * LSB first because every bitmask in the language is indexed that way and says
 * so: `$EF`'s channel mask is documented as "which channels have echo, bitwise
 * (76543210)", and a row that ran the other way would put voice 0 where a reader
 * looking for voice 7 expects it.
 *
 * A `<fieldset>` with a `<legend>` rather than a row of labelled boxes, so the
 * group has a name a screen reader announces once instead of eight unrelated
 * checkboxes. Raw inputs rather than `amk-checkbox`, whose two-way `checked`
 * cannot express a bit derived from a byte the parent owns.
 *
 * ```html
 * <amk-bit-toggles legend="Channels" [value]="mask()" [labels]="voiceLabels"
 *                  (changed)="setMask($event)" />
 * ```
 */
@Component({
  selector: 'amk-bit-toggles',
  template: `
    <fieldset [disabled]="disabled()">
      <legend class="flex w-full items-baseline justify-between gap-2 pb-1">
        <span class="text-ink-muted text-[11px]">{{ legend() }}</span>
        <span class="text-ink font-mono text-[11px] tabular-nums">{{ valueLabel() }}</span>
      </legend>
      <div class="grid grid-cols-4 gap-x-2 gap-y-0.5">
        @for (bit of bits(); track bit.index) {
          <label class="flex cursor-pointer items-center gap-1 select-none">
            <input
              type="checkbox"
              class="accent-accent size-3 cursor-pointer disabled:cursor-not-allowed"
              [checked]="bit.on"
              (change)="toggle(bit.index)"
            />
            <span class="text-ink-muted font-mono text-[11px]">{{ bit.label }}</span>
          </label>
        }
      </div>
      @if (note(); as text) {
        <p class="text-ink-muted pt-1 text-[11px] leading-snug">{{ text }}</p>
      }
    </fieldset>
  `,
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
