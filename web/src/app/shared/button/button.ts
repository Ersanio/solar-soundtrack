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

  /**
   * `primary` is told from `default` by weight and lightness rather than by
   * hue: the plate is a step up from `inset`, the border a step up from `edge`,
   * and the label is full ink where the default's is not. `--color-control` is
   * neutral, so the emphasis has to come from those three rather than from a
   * colour, and `danger` keeps its hue because it is saying something the shape
   * of a button cannot.
   */
  private static readonly VARIANTS: Record<ButtonVariant, string> = {
    default: 'border-edge bg-inset text-ink hover:not-disabled:border-control',
    primary:
      'border-control/60 bg-control/15 text-ink font-medium hover:not-disabled:bg-control/25',
    ghost: 'border-transparent bg-transparent text-ink-muted hover:not-disabled:text-ink',
    danger: 'border-danger/60 bg-danger/15 text-danger font-medium hover:not-disabled:bg-danger/25',
  };

  protected readonly classes = computed(() => `${Button.BASE} ${Button.VARIANTS[this.variant()]}`);
}
