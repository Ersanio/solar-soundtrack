import { Component, computed, inject, input, output } from '@angular/core';

import { CommandIcon } from '../../../command-palette/command-icon';
import { EditorRequests } from '../../../../state/editor-requests';
import { EditorStore } from '../../../../state/editor-store';
import type { Mark, MarkGlyph } from '../roll-marks';

/**
 * The notes themselves: a bar per note, its name, and a glyph per command in
 * force on it.
 *
 * Sits inside the scrolled group and takes no frame-rate input, which is what
 * keeps the bars out of the frame path — the transform above moves, and this is
 * left alone until the mark window turns over.
 *
 * It writes to `EditorStore` itself, as the command inspector's children do: a
 * click is a question about the note under it, and the note is what this holds.
 * The channel a click lands on goes up as an output instead, because the roll's
 * settings are the parent's.
 *
 * An attribute on a real `<g>`, and its template's elements carry the `svg:`
 * prefix — see `roll-lanes.ts`. The one exception is the glyph's own `<svg>`,
 * which needs no prefix because `svg` is one of the three element names that
 * carry a namespace implicitly.
 */
@Component({
  selector: 'g[amk-roll-notes]',
  imports: [CommandIcon],
  templateUrl: './roll-notes.html',
})
export class RollNotes {
  private readonly editor = inject(EditorStore);

  private readonly requests = inject(EditorRequests);

  readonly marks = input.required<readonly Mark[]>();

  /**
   * The addresses of the notes the porter has selected.
   *
   * By address rather than by index, because a mark is named by the address the
   * walk gave it and a strip item by its place in the text — the address is the
   * one both of them have.
   */
  readonly selected = input.required<ReadonlySet<number>>();

  /**
   * The notes the edit layer is drawing at the position a gesture is taking
   * them to. By address, as {@link selected} is.
   */
  readonly moving = input.required<ReadonlySet<number>>();

  /**
   * The bars to draw: the song's, less the ones the preview is already drawing.
   *
   * A note being dragged is drawn once, where it is going. The ring around a
   * selected note goes with it, being inside the same group.
   */
  protected readonly shown = computed(() =>
    this.marks().filter((mark) => !this.moving().has(mark.note.address)),
  );

  /** The hover, which the roll turns into a tooltip beside the pointer. */
  readonly entered = output<Mark>();

  /** The channel of the bar a click landed on, which the roll edits from then on. */
  readonly channelPicked = output<number>();

  /**
   * Whether the editor still shows the text that compiled.
   *
   * Everything joined back to the source takes this test. A boolean rather than
   * the comparison inline at each of them, so it is one answer rather than three.
   */
  private readonly inSync = computed(() => this.editor.compiledText() === this.editor.source());

  /**
   * A single click asks about the note; a double click goes to it.
   *
   * The quiet form leaves the roll on screen, which is the whole point of
   * splitting them: the inspector sits in the pane beside this one and answers
   * from the caret, so moving the caret is enough and switching tabs would take
   * away the thing being asked about. {@link EditorStore.inspecting} carries the
   * one thing the caret cannot — which pass of a loop this bar is.
   *
   * Suppressed whenever the editor has moved on from the text that compiled: a
   * span into a document that has changed underneath points at the wrong thing,
   * and the same test guards the highlights. The channel is not, since a
   * channel number cannot go stale the way a span does.
   */
  protected select(mark: Mark, show = false): void {
    this.channelPicked.emit(mark.note.channel);

    if (!this.inSync()) {
      return;
    }

    const span = this.editor.notesByAddress().get(mark.note.address)?.span;
    if (span) {
      this.requests.inspecting.set({ address: mark.note.address, tick: mark.note.tick });
      this.requests.reveal.set({ span: { ...span }, show });
    }
  }

  protected reveal(mark: Mark): void {
    this.select(mark, true);
  }

  /**
   * A glyph is its own target: the command it stands for, not the note under it.
   *
   * The channel is the one exception — a glyph is drawn on a bar, so it names
   * the same channel the bar does, and it has to say so itself because the
   * bar's own handler never runs for it.
   */
  protected inspect(mark: Mark, glyph: MarkGlyph, event: Event, show = false): void {
    // Without this the bar underneath answers as well, and the note would win.
    event.stopPropagation();
    this.channelPicked.emit(mark.note.channel);

    if (this.inSync()) {
      this.requests.reveal.set({ span: { ...glyph.span }, show });
    }
  }
}
