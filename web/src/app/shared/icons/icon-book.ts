import { Component } from '@angular/core';

/**
 * The book glyph on the changelog trigger.
 *
 * ```html
 * <amk-icon-book />
 * ```
 */
@Component({
  selector: 'amk-icon-book',
  template: `
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path
        d="M2 2.5A1.5 1.5 0 0 1 3.5 1h9A1.5 1.5 0 0 1 14 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5
           1.5 0 0 1 2 13.5v-11zm1.5-.5a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h9a.5.5 0 0 0
           .5-.5v-11a.5.5 0 0 0-.5-.5h-9zM5 4.5A.5.5 0 0 1 5.5 4h5a.5.5 0 0 1 0 1h-5a.5.5 0 0
           1-.5-.5zm0 3A.5.5 0 0 1 5.5 7h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5zm0 3a.5.5 0 0 1
           .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5z"
      />
    </svg>
  `,
})
export class IconBook {}
