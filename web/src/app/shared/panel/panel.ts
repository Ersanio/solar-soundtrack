import { Component, input } from '@angular/core';

/**
 * A titled region with a sticky header and a scrolling body.
 *
 * Three projection slots: the default one is the body, `[panelHeadingAside]`
 * lands immediately after the heading text — for controls that are a setting
 * on the panel itself, such as the editor's word-wrap toggle — and
 * `[panelAside]` lands on the right of the header, for things like the caret
 * readout and the compile status.
 */
@Component({
  selector: 'amk-panel',
  templateUrl: './panel.html',
  host: { class: 'flex min-h-0 min-w-0 flex-col' },
})
export class Panel {
  readonly heading = input.required<string>();
}
