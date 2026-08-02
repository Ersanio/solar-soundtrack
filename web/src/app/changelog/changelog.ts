import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';

import { Button } from '../shared/button/button';
import { CHANGELOG } from './changelog-data';

/**
 * The top bar's changelog link and the panel it drops down.
 *
 * The first floating layer in the app, so it sets the pattern rather than
 * following one: a trigger carrying `aria-expanded`, a `role="dialog"` panel
 * under `@if`, and the three ways out a dropdown is expected to have — Escape,
 * a click outside, and a second click on the trigger.
 *
 * Not a native `<dialog>`: `showModal()` traps focus and dims the page, which is
 * more interruption than a "what changed" list warrants, and a non-modal
 * `<dialog>` gives none of Escape, backdrop or focus handling anyway.
 *
 * The entries themselves live in `changelog-data.ts`, which is the file to edit.
 */
@Component({
  selector: 'amk-changelog',
  imports: [Button],
  host: {
    class: 'relative',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
  },
  template: `
    <button
      #trigger
      type="button"
      class="text-ink-muted hover:text-ink flex cursor-pointer items-center gap-1.5 text-sm hover:underline"
      aria-haspopup="dialog"
      [attr.aria-expanded]="open()"
      (click)="toggle()"
      (keydown)="onKeydown($event)"
    >
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
        <path
          d="M2 2.5A1.5 1.5 0 0 1 3.5 1h9A1.5 1.5 0 0 1 14 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5
             1.5 0 0 1 2 13.5v-11zm1.5-.5a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h9a.5.5 0 0 0
             .5-.5v-11a.5.5 0 0 0-.5-.5h-9zM5 4.5A.5.5 0 0 1 5.5 4h5a.5.5 0 0 1 0 1h-5a.5.5 0 0
             1-.5-.5zm0 3A.5.5 0 0 1 5.5 7h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5zm0 3a.5.5 0 0 1
             .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5z"
        />
      </svg>
      changelog
    </button>

    @if (open()) {
      <div
        role="dialog"
        aria-label="Changelog"
        class="border-edge bg-raised text-ink absolute top-full right-0 z-20 mt-2 flex max-h-[70vh]
               w-80 max-w-[calc(100vw-2rem)] flex-col rounded-md border shadow-lg"
        (keydown)="onKeydown($event)"
      >
        <div
          class="border-edge bg-raised flex shrink-0 items-center justify-between gap-3 rounded-t-md border-b px-3 py-2"
        >
          <h2 class="text-ink-muted text-xs font-semibold tracking-wide uppercase">Changelog</h2>
          <button amk-button variant="ghost" aria-label="Close the changelog" (click)="dismiss()">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
              <path
                d="M3 3l10 10M13 3L3 13"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-auto px-3 py-2 text-sm">
          @for (entry of entries; track entry.date) {
            <h3
              class="text-ink-muted mt-3 text-xs font-semibold tracking-wide uppercase first:mt-0"
            >
              {{ entry.date }}
            </h3>
            <ul class="mt-1 list-disc space-y-1 pl-4">
              @for (item of entry.items; track item) {
                <li>{{ item }}</li>
              }
            </ul>
          }
        </div>
      </div>
    }
  `,
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
    if (!this.open()) return;
    if (this.host.nativeElement.contains(event.target as Node)) return;
    this.open.set(false);
  }
}
