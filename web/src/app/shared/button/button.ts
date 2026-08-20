import { Component, computed, input } from '@angular/core';

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';

/**
 * Styling for a real `<button>`, applied by attribute.
 *
 * Deliberately not a wrapper element: keeping the host a native button means
 * `disabled`, `type`, focus order, form semantics and screen-reader behaviour
 * are the platform's rather than something re-implemented here.
 *
 * ```html
 * <button amk-button variant="primary" (click)="run()">Compile</button>
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

  private static readonly BASE =
    'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm ' +
    'whitespace-nowrap transition-colors cursor-pointer ' +
    'disabled:cursor-not-allowed disabled:opacity-40';

  private static readonly VARIANTS: Record<ButtonVariant, string> = {
    default: 'border-edge bg-inset text-ink hover:not-disabled:border-accent',
    primary:
      'border-accent/60 bg-accent/15 text-accent font-medium hover:not-disabled:bg-accent/25',
    ghost: 'border-transparent bg-transparent text-ink-muted hover:not-disabled:text-ink',
    danger: 'border-danger/60 bg-danger/15 text-danger font-medium hover:not-disabled:bg-danger/25',
  };

  protected readonly classes = computed(() => `${Button.BASE} ${Button.VARIANTS[this.variant()]}`);
}
