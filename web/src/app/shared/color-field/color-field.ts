import { Component, input, output } from '@angular/core';

/**
 * A colour swatch that opens the operating system's picker.
 *
 * `preview` and `commit` split the same way `NumberField`'s do, and for the same
 * reason: `<input type="color">` reports every step of a drag through the
 * picker on `input` and settles once on `change`. A listener showing the colour
 * wants the first; a listener writing it down wants the second.
 *
 * ```html
 * <amk-color-field label="Surface" value="#191919" [overridden]="true"
 *                  (preview)="show($event)" (commit)="set($event)" (cleared)="clear()" />
 * ```
 */
@Component({
  selector: 'amk-color-field',
  templateUrl: './color-field.html',
  host: { class: 'block' },
})
export class ColorField {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly disabled = input(false);

  /** Whether this colour has been moved off its default, which the reset offers to undo. */
  readonly overridden = input(false);

  readonly preview = output<string>();
  readonly commit = output<string>();
  readonly cleared = output<void>();

  protected onPreview(event: Event): void {
    this.preview.emit((event.target as HTMLInputElement).value);
  }

  protected onCommit(event: Event): void {
    this.commit.emit((event.target as HTMLInputElement).value);
  }
}
