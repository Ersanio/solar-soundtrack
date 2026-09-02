import { Component } from '@angular/core';

/**
 * The controls strip a view puts above its own body.
 *
 * One of these belongs to each tab of the editor pane rather than to the pane
 * itself, which is the whole reason it exists: word wrap is meaningless in the
 * sample library, and a piano roll's zoom and snap are meaningless in the
 * source. A shared header could only ever show one view's controls to all of
 * them.
 *
 * Groups of controls are separated with `<span class="bg-edge h-5 w-px shrink-0"></span>`.
 * The strip wraps: a half-width pane at 1024px is about 510px, where the
 * roll's controls need two rows.
 *
 * ```html
 * <amk-toolbar>
 *   <button …></button>
 *   <span class="bg-edge h-5 w-px shrink-0"></span>
 *   <span class="ml-auto">…</span>
 * </amk-toolbar>
 * ```
 */
@Component({
  selector: 'amk-toolbar',
  template: '<ng-content />',
  host: {
    class: 'border-edge bg-raised flex shrink-0 flex-wrap items-center gap-2 border-b px-2 py-1',
  },
})
export class Toolbar {}
