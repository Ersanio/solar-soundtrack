import { Component, input } from '@angular/core';

/**
 * A titled region with a sticky header and a scrolling body.
 *
 * Three projection slots: the default one is the body, `[panelHeading]` lands
 * on the left of the header and `[panelAside]` on the right — for things like
 * the compile status.
 *
 * `heading` is optional because a panel may name itself with something other
 * than a word: the editor pane projects its tab strip into `[panelHeading]`
 * and has no heading at all, since the selected tab already says what is
 * showing and "Editor" above it said nothing further.
 */
@Component({
  selector: 'amk-panel',
  templateUrl: './panel.html',
  host: { class: 'flex min-h-0 min-w-0 flex-col' },
})
export class Panel {
  readonly heading = input<string>();
}
