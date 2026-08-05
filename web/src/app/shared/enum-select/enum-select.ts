import { Component, input, output } from '@angular/core';

/** One choice, named as the reader would say it rather than as the byte reads. */
export interface EnumOption {
  value: number;
  label: string;
}

/**
 * A native `<select>` over a named set of byte values.
 *
 * The right control wherever a byte picks a *mode* rather than sitting on a
 * scale — `$F1`'s filter, `$F4`'s sub-command, `#am4` `$ED`'s HFD sub-byte,
 * `$FB`'s trill/glissando forms. Two reasons it is never a slider: the values
 * are not ordered in any way a reader would recognise, and several of them
 * change how many of the bytes *after* the command belong to it, so dragging
 * through the range would reinterpret music as data on the way past.
 *
 * ```html
 * <amk-enum-select label="Filter" [value]="filter()" [options]="FILTERS"
 *                  (commit)="setFilter($event)" />
 * ```
 */
@Component({
  selector: 'amk-enum-select',
  template: `
    <label class="flex flex-col gap-0.5">
      <span class="text-ink-muted text-[11px]">{{ label() }}</span>
      <select
        class="bg-inset border-edge text-ink w-full rounded-sm border px-1.5 py-0.5 text-xs
               disabled:cursor-not-allowed disabled:opacity-40"
        [disabled]="disabled()"
        [value]="value()"
        (change)="onCommit($event)"
      >
        @for (option of options(); track option.value) {
          <option [value]="option.value" [selected]="option.value === value()">
            {{ option.label }}
          </option>
        }
        <!-- A byte nobody named is still a byte in the document, and hiding it
             would make the control show a value the source does not have. -->
        @if (!known()) {
          <option selected [value]="value()">{{ unknownLabel() }}</option>
        }
      </select>
      @if (note(); as text) {
        <span class="text-ink-muted text-[11px] leading-snug">{{ text }}</span>
      }
    </label>
  `,
  host: { class: 'block' },
})
export class EnumSelect {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly options = input.required<readonly EnumOption[]>();
  readonly disabled = input(false);
  readonly note = input<string | null>(null);
  readonly unknownLabel = input('(not a documented value)');

  readonly commit = output<number>();

  protected known(): boolean {
    return this.options().some((option) => option.value === this.value());
  }

  protected onCommit(event: Event): void {
    const next = Number((event.target as HTMLSelectElement).value);
    if (!Number.isNaN(next) && next !== this.value()) {
      this.commit.emit(next);
    }
  }
}
