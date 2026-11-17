import { Component, booleanAttribute, computed, input } from '@angular/core';

export type ButtonVariant = 'default' | 'primary' | 'dark' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Everything a button or a toggle is before its size, variant and transition.
 * The two fade different properties — a toggle's glow is a shadow — and two
 * transition utilities on one element would leave the winner to the order
 * Tailwind emits them in.
 */
export const CONTROL_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-sm border leading-none ' +
  'whitespace-nowrap cursor-pointer disabled:cursor-not-allowed disabled:opacity-40';

/** Everything a button is before its size and variant. */
export const BUTTON_BASE = `${CONTROL_BASE} transition-colors`;

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
 * Raised plates, from `styles.css`, where a toggle is recessed. `primary` is
 * the plate with its face tinted toward `--color-control`, told from `default`
 * by that and its weight rather than by a hue of its own; `danger` is tinted
 * red, saying something the shape of a button cannot. `dark` is FL Studio's
 * transport: a plate the inset's grey, rimmed in the seam colour since an
 * inset rim would vanish into it, and labelled in the muted ink. `ghost` has
 * no plate until the pointer is over it, as FL Studio's window icons have none.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  default: 'plate text-ink',
  primary:
    'plate text-ink font-medium [--plate-face:color-mix(in_oklab,var(--color-raised)_70%,var(--color-control))]',
  dark: 'plate text-ink-muted hover:not-disabled:text-ink [--plate-face:var(--color-inset)] [--plate-rim:var(--color-edge)]',
  ghost:
    'border-transparent bg-transparent text-ink-muted hover:not-disabled:bg-ink/10 hover:not-disabled:text-ink',
  danger:
    'plate text-danger font-medium [--plate-face:color-mix(in_oklab,var(--color-raised)_75%,var(--color-danger))]',
};

/**
 * A button's whole class list, for an element that has to look like one and
 * cannot be one — a `<label>` that opens a file input, a palette entry whose
 * classes come from a view model.
 */
export function buttonClass(variant: ButtonVariant, size: ButtonSize, icon = false): string {
  const shape = icon ? BUTTON_ICON_SIZES[size] : BUTTON_SIZES[size];
  return `${BUTTON_BASE} ${shape} ${VARIANTS[variant]}`;
}

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

  protected readonly classes = computed(() =>
    buttonClass(this.variant(), this.size(), this.icon()),
  );
}
