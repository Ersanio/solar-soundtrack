import { Component, booleanAttribute, computed, input } from '@angular/core';

import { BUTTON_BASE, BUTTON_ICON_SIZES, BUTTON_SIZES, type ButtonSize } from '../button/button';

const ON = 'border-control/60 bg-control/20 text-ink font-medium';
const OFF =
  'border-edge bg-transparent text-ink-muted hover:not-disabled:text-ink hover:not-disabled:border-control';

/**
 * A two-state button whose lit plate is the state.
 *
 * Loop, Live and Follow on the transport, the editor's word wrap and the
 * palette's category chips are all one of these. The plate says which state
 * it is in and nothing else does — the project ships no ARIA, so there is no
 * `aria-pressed`. There is no output either: what a press means is the
 * caller's business, so it binds `(click)` itself.
 *
 * ```html
 * <button amk-toggle [pressed]="loop()" (click)="loop.set(!loop())">Loop</button>
 * <button amk-toggle icon [pressed]="wrap()" title="Word wrap" (click)="toggleWrap()">
 *   <amk-icon-wrap />
 * </button>
 * ```
 */
@Component({
  selector: 'button[amk-toggle]',
  template: '<ng-content />',
  host: {
    '[attr.type]': '"button"',
    '[class]': 'classes()',
  },
})
export class Toggle {
  readonly pressed = input.required<boolean>();
  readonly size = input<ButtonSize>('sm');
  /** A square, icon-only toggle: the label is a glyph and the `title` says what it does. */
  readonly icon = input(false, { transform: booleanAttribute });

  protected readonly classes = computed(() => {
    const size = this.size();
    const shape = this.icon() ? BUTTON_ICON_SIZES[size] : BUTTON_SIZES[size];
    return `${BUTTON_BASE} ${shape} ${this.pressed() ? ON : OFF}`;
  });
}
