import { Component, ElementRef, inject, input, signal, viewChild } from '@angular/core';

import { Button, type ButtonVariant } from '../button/button';
import { IconChevronDown } from '../icons/icon-chevron-down';

/**
 * A labelled button that drops down a list of actions under it.
 *
 * `[menuTrigger]` is the trigger's content and the default slot its entries, each a
 * `<button amk-button variant="ghost" size="sm">`. A press on an entry closes the list, as
 * a press outside it and Escape do.
 *
 * ```html
 * <amk-menu title="…">
 *   <span menuTrigger>Export…</span>
 *   <button amk-button variant="ghost" size="sm" (click)="save()">Save</button>
 * </amk-menu>
 * ```
 */
@Component({
  selector: 'amk-menu',
  imports: [Button, IconChevronDown],
  host: {
    class: 'relative',
    // As `Popover`'s: the trigger alone carries the tooltip.
    '[attr.title]': 'null',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
  },
  templateUrl: './menu.html',
})
export class Menu {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<Button, ElementRef<HTMLButtonElement>>('trigger', {
    read: ElementRef,
  });

  readonly variant = input<ButtonVariant>('default');
  readonly disabled = input(false);
  readonly title = input<string | null>(null);

  protected readonly open = signal(false);

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.open()) {
      return;
    }

    event.preventDefault();
    this.open.set(false);
    this.trigger().nativeElement.focus();
  }

  /** An entry's own `click` runs first; this only closes the list after it. */
  protected onPanelClick(event: MouseEvent): void {
    if ((event.target as Element).closest('button')) {
      this.open.set(false);
    }
  }

  /** `pointerdown`, as `Popover` closes, so the list goes as the press lands. */
  protected onDocumentPointerDown(event: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }
}
