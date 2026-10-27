import { Component, inject, input } from '@angular/core';

import type { Span } from '@amk/core/types';
import { type CommandGlyph, CommandIcon } from '../../../editor/command-palette/command-icon';
import { EditorRequests } from '../../../state/editor-requests';

/**
 * A command drawn as the palette draws it, which goes to that command in the
 * source: the note inspector's commands in force, and what a remote call runs.
 *
 * A click asks the inspector about the command; a double click goes to it. The
 * quiet form on a click, because these panels sit **beside** the roll: bringing
 * the source forward would take away the note the question was asked about —
 * the difference `Reveal.show` exists for, and the same pair a bar's own glyphs
 * and the lane's answer to. The selection still goes through the document either
 * way, the caret being the one statement of what is being inspected.
 */
@Component({
  selector: 'amk-command-chip',
  imports: [CommandIcon],
  template: `
    <button
      type="button"
      class="border-edge bg-inset text-ink hover:border-control flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
      [title]="blurb()"
      (click)="reveal(false)"
      (dblclick)="reveal(true)"
    >
      <svg amk-glyph width="14" height="14" [name]="icon()"></svg>
      {{ label() }}
    </button>
  `,
  host: { class: 'contents' },
})
export class CommandChip {
  private readonly requests = inject(EditorRequests);

  readonly icon = input.required<CommandGlyph>();

  readonly label = input.required<string>();

  readonly blurb = input.required<string>();

  readonly span = input.required<Span>();

  protected reveal(show: boolean): void {
    this.requests.reveal.set({ span: { ...this.span() }, show });
  }
}
