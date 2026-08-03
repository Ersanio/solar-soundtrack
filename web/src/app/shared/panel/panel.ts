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
  templateUrl: './panel.html',
  host: { class: 'flex min-h-0 min-w-0 flex-col' },
})
export class Panel {
  readonly heading = input.required<string>();
}
