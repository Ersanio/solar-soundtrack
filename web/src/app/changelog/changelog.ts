import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';

import { Button } from '../shared/button/button';
import { IconBook } from '../shared/icons/icon-book';
import { IconClose } from '../shared/icons/icon-close';
import { CHANGELOG } from './changelog-data';

/**
 * The top bar's changelog link and the panel it drops down.
 * The entries themselves live in `changelog-data.ts`, which is the file to edit.
 */
@Component({
  selector: 'amk-changelog',
  imports: [Button, IconBook, IconClose],
  host: {
    class: 'relative',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
  },
  templateUrl: './changelog.html',
})
export class Changelog {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  protected readonly entries = CHANGELOG;
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
