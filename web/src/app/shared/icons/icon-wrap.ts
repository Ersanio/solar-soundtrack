import { Component } from '@angular/core';

/**
 * The word-wrap glyph on the editor's wrap toggle.
 *
 * ```html
 * <amk-icon-wrap />
 * ```
 */
@Component({
  selector: 'amk-icon-wrap',
  template: `
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
      <path d="M2 4h12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
      <path
        d="M2 8h10a2 2 0 1 1 0 4h-2.7"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="m10.7 10.7-1.3 1.3 1.3 1.3"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path d="M2 12h4.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  `,
})
export class IconWrap {}
