import { Component, booleanAttribute, computed, input } from '@angular/core';

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Everything a button is before its size and variant; `Toggle` builds on it too. */
export const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-md border leading-none ' +
  'whitespace-nowrap transition-colors cursor-pointer ' +
  'disabled:cursor-not-allowed disabled:opacity-40';

/** Heights rather than padding, so every control lands on a 28/32/36px grid. */
export const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-8 px-3 text-sm',
  lg: 'h-9 px-3 text-sm',
};

/** A square of the same height, for a button holding one glyph and no label. */
export const BUTTON_ICON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 w-7 px-0',
  md: 'h-8 w-8 px-0',
  lg: 'h-9 w-9 px-0',
};

/**
 * Styling for a real `<button>`, applied by attribute.
 *
 * Deliberately not a wrapper element: keeping the host a native button means
 * `disabled`, `type`, focus order, form semantics and screen-reader behaviour
 * are the platform's rather than something re-implemented here.
 *
 * ```html
 * <button amk-button variant="primary" (click)="run()">Compile</button>
 * <button amk-button variant="ghost" size="sm" icon title="Close" (click)="dismiss()">
 *   <amk-icon-close />
 * </button>
 * ```
 */
@Component({
  selector: 'button[amk-button]',
  template: '<ng-content />',
  host: {
    '[attr.type]': '"button"',
    '[class]': 'classes()',
  },
})
export class Button {
  readonly variant = input<ButtonVariant>('default');
  readonly size = input<ButtonSize>('md');
  /** A square, icon-only button: the label is a glyph and the `title` says what it does. */
  readonly icon = input(false, { transform: booleanAttribute });

  /**
   * `--color-control` is a blue-grey a step lighter than the chrome, so a
   * `primary` plate is told from `default` by weight and a 15% tint of it
   * rather than by a hue of its own. `danger` keeps its hue because it says
   * something the shape of a button cannot.
   */
  private static readonly VARIANTS: Record<ButtonVariant, string> = {
    default: 'border-edge bg-inset text-ink hover:not-disabled:border-control',
    primary:
      'border-control/60 bg-control/15 text-ink font-medium hover:not-disabled:bg-control/25',
    ghost: 'border-transparent bg-transparent text-ink-muted hover:not-disabled:text-ink',
    danger: 'border-danger/60 bg-danger/15 text-danger font-medium hover:not-disabled:bg-danger/25',
  };

  protected readonly classes = computed(() => {
    const size = this.size();
    const shape = this.icon() ? BUTTON_ICON_SIZES[size] : BUTTON_SIZES[size];
    return `${BUTTON_BASE} ${shape} ${Button.VARIANTS[this.variant()]}`;
  });
}
