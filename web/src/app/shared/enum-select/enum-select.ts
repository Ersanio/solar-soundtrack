import { Component, input, output } from '@angular/core';

/** Declared beside the descriptors that produce it; re-exported so callers of
    this component import one name from one place. */
export type { EnumOption } from '@amk/tokens/commands/param';
import type { EnumOption } from '@amk/tokens/commands/param';

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
  templateUrl: './enum-select.html',
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
