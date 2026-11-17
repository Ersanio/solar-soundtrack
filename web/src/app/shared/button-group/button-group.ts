import { Component, booleanAttribute, computed, input } from '@angular/core';

const BASE =
  'inline-flex shrink-0 items-stretch [&>button]:relative [&>button]:rounded-none [&>button+button]:-ml-px [&>button:focus-visible]:z-10';

/** The outer corners: a control's own small radius, or fully round, as FL's transport ends. */
const SQUARE = '[&>button:first-child]:rounded-l-sm [&>button:last-child]:rounded-r-sm';
const PILL = '[&>button:first-child]:rounded-l-full [&>button:last-child]:rounded-r-full';

/**
 * Buttons that belong together in one housing, as FL Studio joins Play and Stop.
 *
 * The plates keep their own rims and overlap by one pixel, so the seam between
 * two is a single dark line; only the outer corners stay rounded, and `pill`
 * rounds them fully. A focused plate is lifted over its neighbours so its ring
 * is not painted under them.
 *
 * ```html
 * <amk-button-group pill>
 *   <button amk-button variant="dark" icon …><amk-icon-play /></button>
 *   <button amk-button variant="dark" icon …><amk-icon-stop /></button>
 * </amk-button-group>
 * ```
 */
@Component({
  selector: 'amk-button-group',
  template: '<ng-content />',
  host: { '[class]': 'classes()' },
})
export class ButtonGroup {
  readonly pill = input(false, { transform: booleanAttribute });

  protected readonly classes = computed(() => `${BASE} ${this.pill() ? PILL : SQUARE}`);
}
