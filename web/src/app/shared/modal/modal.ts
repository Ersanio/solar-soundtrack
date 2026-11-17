import { Component, type ElementRef, input, viewChild } from '@angular/core';

import { Button } from '../button/button';
import { IconClose } from '../icons/icon-close';

/**
 * A window over the app, which nothing behind it answers until it closes.
 *
 * A native `<dialog>` opened with `showModal()`, so the top layer, the inert
 * page and Escape are the browser's. The chrome is the popover's: a heading
 * and a close button, the default slot as the body, and `[modalFooter]` as a
 * row under it. A press on the backdrop closes it too.
 *
 * Opened and closed by method, from the press that asks, so no state has to be
 * mirrored into the element. The host is `display: contents`, so it takes no
 * gap where it sits in a flex row.
 *
 * ```html
 * <amk-modal #setup heading="Record">
 *   …
 *   <button amk-button modalFooter (click)="setup.close()">Cancel</button>
 * </amk-modal>
 * ```
 */
@Component({
  selector: 'amk-modal',
  imports: [Button, IconClose],
  templateUrl: './modal.html',
  host: { class: 'contents' },
})
export class Modal {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  readonly heading = input.required<string>();

  open(): void {
    const dialog = this.dialog().nativeElement;
    if (!dialog.open) {
      dialog.showModal();
    }
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  /** A press on the dialog itself rather than on anything in it is a press on the backdrop. */
  protected onClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.close();
    }
  }
}
