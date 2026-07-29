import { Component, input } from '@angular/core';

/**
 * A titled region with a sticky header and a scrolling body.
 *
 * Two projection slots: the default one is the body, and `[panelAside]` lands
 * on the right of the header — used for the caret readout and the compile
 * status, which belong beside the heading rather than in the scrolling content.
 */
@Component({
  selector: 'amk-panel',
  host: { class: 'flex min-h-0 min-w-0 flex-col' },
  template: `
    <div
      class="border-edge bg-raised flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2"
    >
      <h2 class="text-ink-muted text-xs font-semibold tracking-wide uppercase">{{ heading() }}</h2>
      <ng-content select="[panelAside]" />
    </div>
    <div class="min-h-0 flex-1">
      <ng-content />
    </div>
  `,
})
export class Panel {
  readonly heading = input.required<string>();
}
