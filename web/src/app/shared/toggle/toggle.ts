import { Component, booleanAttribute, computed, input } from '@angular/core';

import { BUTTON_BASE, BUTTON_ICON_SIZES, BUTTON_SIZES, type ButtonSize } from '../button/button';

type ToggleVariant = 'default' | 'segment';

const ON = 'border-control/60 bg-control/20 text-ink font-medium';
const OFF =
  'border-edge bg-transparent text-ink-muted hover:not-disabled:text-ink hover:not-disabled:border-control';

/**
 * A segment has no border of its own: it sits in a recessed track, and the one
 * that is selected is raised back to the level of the chrome around the track.
 */
const SEGMENT_BASE =
  'inline-flex h-6 cursor-pointer items-center justify-center gap-1.5 rounded px-2 text-xs leading-none whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40';
const SEGMENT_ON = 'bg-raised text-ink font-medium shadow-sm';
const SEGMENT_OFF = 'text-ink-muted hover:not-disabled:text-ink';

/**
 * A two-state button whose lit plate is the state.
 *
 * Loop, Hot Reload and Follow on the transport and the editor's word wrap are all
 * one of these. The plate says which state it is in and nothing else does. There
 * is no output either: what a press means is the caller's business, so it binds
 * `(click)` itself.
 *
 * The `segment` variant is for a set of which exactly one is selected — the
 * palettes' categories — and it is told from a plain toggle on purpose: a
 * filter that picks which buttons are shown must not look like the buttons it
 * shows. Segments go in a track the caller draws:
 *
 * ```html
 * <div class="bg-inset inline-flex gap-0.5 rounded-md p-0.5">
 *   <button amk-toggle variant="segment" [pressed]="filter() === 'all'" …>All</button>
 * </div>
 * ```
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
  readonly variant = input<ToggleVariant>('default');

  protected readonly classes = computed(() => {
    if (this.variant() === 'segment') {
      return `${SEGMENT_BASE} ${this.pressed() ? SEGMENT_ON : SEGMENT_OFF}`;
    }

    const size = this.size();
    const shape = this.icon() ? BUTTON_ICON_SIZES[size] : BUTTON_SIZES[size];
    return `${BUTTON_BASE} ${shape} ${this.pressed() ? ON : OFF}`;
  });
}
