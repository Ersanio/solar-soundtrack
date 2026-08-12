import { Component, model } from '@angular/core';

/**
 * A labelled checkbox with two-way `checked` binding.
 *
 * The `<input>` lives inside the `<label>`, so the projected text is the
 * accessible name and clicking it toggles — no `for`/`id` pairing to keep in
 * sync across call sites.
 *
 * ```html
 * <amk-checkbox [(checked)]="library.optimize">Optimize samples</amk-checkbox>
 * ```
 */
@Component({
  selector: 'amk-checkbox',
  templateUrl: './checkbox.html',
})
export class Checkbox {
  readonly checked = model(false);

  protected toggle(event: Event): void {
    this.checked.set((event.target as HTMLInputElement).checked);
  }
}
