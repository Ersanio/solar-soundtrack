import { NgTemplateOutlet } from '@angular/common';
import { Component, booleanAttribute, input, model } from '@angular/core';

import { IconChevronDown } from '../icons/icon-chevron-down';
import { IconChevronRight } from '../icons/icon-chevron-right';

/**
 * A titled region of a pane, optionally folding to its header.
 *
 * The header shares the toolbar's and the panel header's style, so a column of
 * these reads as one stack of rows. A collapsed section is still a row, which
 * is what lets a pinned section fold to its badge; its body is hidden rather
 * than removed, so children keep their state and a hex dump is not rebuilt per
 * toggle. `[sectionAside]` lands on the right of the header.
 *
 * ```html
 * <amk-section heading="Diagnostics" collapsible [(open)]="showDiagnostics">
 *   <span sectionAside>3</span>
 *   …
 * </amk-section>
 * ```
 */
@Component({
  selector: 'amk-section',
  imports: [NgTemplateOutlet, IconChevronDown, IconChevronRight],
  templateUrl: './section.html',
  host: { class: 'border-edge flex min-h-0 flex-col border-b' },
})
export class Section {
  readonly heading = input.required<string>();
  readonly collapsible = input(false, { transform: booleanAttribute });
  readonly open = model(true);
}
