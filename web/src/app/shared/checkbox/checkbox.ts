import { Component, model } from '@angular/core';

/**
 * A labelled checkbox with two-way `checked` binding.
 *
 * The `<input>` lives inside the `<label>`, so the projected text is the
 * accessible name and clicking it toggles — no `for`/`id` pairing to keep in
 * sync across call sites.
 *
 * ```html
 * <amk-checkbox [(checked)]="store.autoCompile">Compile as I type</amk-checkbox>
 * ```
 */
@Component({
  selector: 'amk-checkbox',
  template: `
    <label class="flex cursor-pointer items-center gap-1.5 select-none">
      <input
        type="checkbox"
        class="accent-accent size-3.5 cursor-pointer"
        [checked]="checked()"
        (change)="toggle($event)"
      />
      <span class="text-ink-muted"><ng-content /></span>
    </label>
  `,
})
export class Checkbox {
  readonly checked = model(false);

  protected toggle(event: Event): void {
    this.checked.set((event.target as HTMLInputElement).checked);
  }
}
