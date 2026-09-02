import { Component, ElementRef, inject, input, signal, viewChild } from '@angular/core';

import { Button } from '../button/button';
import { IconClose } from '../icons/icon-close';

/**
 * An icon trigger and the panel it drops down under it.
 *
 * Three projection slots: `[popoverIcon]` is the glyph on the trigger, the
 * default slot is the panel's scrolling body, and `[popoverFooter]` is a row
 * under the body that hides itself when nothing is projected into it.
 *
 * Projected content is instantiated eagerly even though the panel is under
 * `@if`: projection creates the nodes at the consumer's site and the `@if`
 * only decides whether they are attached. That is fine for its consumers,
 * which project a static list and one `computed`.
 *
 * ```html
 * <amk-popover heading="Changelog" title="What changed">
 *   <amk-icon-book popoverIcon />
 *   …
 *   <button amk-button popoverFooter>Reset all</button>
 * </amk-popover>
 * ```
 */
@Component({
  selector: 'amk-popover',
  imports: [Button, IconClose],
  host: {
    class: 'relative',
    // A static `title="…"` on the element lands on the host as well as on the
    // input, and there it is a tooltip over the whole panel. The trigger alone
    // carries it.
    '[attr.title]': 'null',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
  },
  templateUrl: './popover.html',
})
export class Popover {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  /** The panel's heading. */
  readonly heading = input.required<string>();
  /** The trigger's tooltip. */
  readonly title = input.required<string>();

  protected readonly open = signal(false);

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  /** Closing from inside the panel, so focus has to go somewhere deliberate. */
  protected dismiss(): void {
    this.open.set(false);
    this.trigger().nativeElement.focus();
  }

  protected onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        break;
      default:
        return;
    }

    event.preventDefault();
    this.dismiss();
  }

  /**
   * `pointerdown` rather than `click`, so the panel closes as the press lands
   * rather than on release. The trigger is inside the host, so its own press is
   * left to `toggle()` — closing here first would let the click reopen it.
   */
  protected onDocumentPointerDown(event: PointerEvent): void {
    if (!this.open()) {
      return;
    }

    if (this.host.nativeElement.contains(event.target as Node)) {
      return;
    }

    this.open.set(false);
  }
}
