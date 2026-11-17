import { Component, computed, input, output, signal } from '@angular/core';

/**
 * A colour swatch that opens the operating system's picker, and a field beside
 * it that takes the same colour typed as hex.
 *
 * `preview` and `commit` split the same way `NumberField`'s do, and for the same
 * reason: `<input type="color">` reports every step of a drag through the
 * picker on `input` and settles once on `change`. A listener showing the colour
 * wants the first; a listener writing it down wants the second. The hex field
 * keeps the split: a complete six-digit colour previews as it is typed, and
 * leaving the field or pressing Enter commits it.
 *
 * ```html
 * <amk-color-field label="Surface" value="#1e272e" [overridden]="true"
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

  /**
   * What is typed in the hex field, or null while it is not being edited.
   *
   * The field shows this rather than {@link value} while it is set, because a
   * preview changes `value` mid-edit, and writing that back into the field
   * would move the caret and spell the porter's text over.
   */
  protected readonly draft = signal<string | null>(null);

  /** Whether the text being typed is not yet a colour, which the field's rim says. */
  protected readonly invalid = computed(() => {
    const draft = this.draft();
    return draft !== null && parseHex(draft) === null;
  });

  /** The colour the field held when it was focused, which leaving it unchanged keeps. */
  private before = '';

  /** Whether this edit has shown a colour that may have to be taken back. */
  private previewed = false;

  protected onPreview(event: Event): void {
    this.preview.emit((event.target as HTMLInputElement).value);
  }

  protected onCommit(event: Event): void {
    this.commit.emit((event.target as HTMLInputElement).value);
  }

  protected onHexFocus(): void {
    this.before = this.value();
    this.previewed = false;
  }

  /**
   * Previews only a full six digits: three are a colour too, but they are also
   * the first half of six, and showing `#344` on the way to `#34444e` would
   * flash the whole app through a colour nobody asked for.
   */
  protected onHexInput(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.draft.set(text);

    const colour = parseHex(text);
    if (colour !== null && /^#?[0-9a-f]{6}$/i.test(text.trim())) {
      this.preview.emit(colour);
      this.previewed = true;
    }
  }

  /** Takes a colour that parses and differs from where the field started; puts anything else back. */
  protected onHexLeave(): void {
    const draft = this.draft();
    if (draft === null) {
      return;
    }

    this.draft.set(null);
    const colour = parseHex(draft);
    if (colour !== null && colour !== this.before.toLowerCase()) {
      this.commit.emit(colour);
    } else if (this.previewed) {
      this.preview.emit(this.before);
    }
  }

  /** The first Escape gives up the edit; with nothing typed, it reaches the popover and closes it. */
  protected onHexEscape(event: Event): void {
    if (this.draft() === null) {
      return;
    }

    event.stopPropagation();
    if (this.previewed) {
      this.preview.emit(this.before);
      this.previewed = false;
    }

    this.draft.set(null);
  }

  protected blur(event: Event): void {
    (event.target as HTMLInputElement).blur();
  }
}

/**
 * A typed colour as `<input type="color">` spells one — `#` and six lowercase
 * digits — or null. Takes three digits or six, with or without the `#`.
 */
function parseHex(text: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!match) {
    return null;
  }

  const digits = match[1].toLowerCase();
  return digits.length === 3
    ? `#${[...digits].map((digit) => digit + digit).join('')}`
    : `#${digits}`;
}
