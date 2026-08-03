import { Component } from '@angular/core';

/**
 * The "×" glyph used by every dismiss/close button.
 *
 * ```html
 * <amk-icon-close />
 * ```
 */
@Component({
  selector: 'amk-icon-close',
  template: `
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path
        d="M3 3l10 10M13 3L3 13"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  `,
})
export class IconClose {}
