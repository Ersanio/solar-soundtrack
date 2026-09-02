import { Component, computed, inject, input, output } from '@angular/core';

import type { Command } from '@amk/tokens';
import { CommandIcon } from '../../../command-palette/command-icon';
import { EditorRequests } from '../../../../state/editor-requests';
import { EditorStore } from '../../../../state/editor-store';
import type { ShiftBoundaries } from '../roll-edit';
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
   * The command the inspector is answering about, which every chip standing for
   * it is rung with — the one the lane rings, so a click on a chip lights the
   * chip that was clicked and not only a glyph somewhere else on screen.
   *
   * Every bar it acts on, inherited chips included: one written command is one
   * command wherever it acts, which is the reading the lane takes for
   * `[[ v100 v200 ]]2`. Compared by identity, `MarkGlyph.command` says why.
   */
  readonly inspected = input.required<Command | null>();

  /**
   * The edited body's pass ends per voice while a loop gesture is held, or
   * `null`. What the buckets below are dealt over — fixed for the gesture, so
   * the dealing happens at its start rather than on every pointer move.
   */
  readonly boundaries = input.required<ShiftBoundaries | null>();

  /**
   * Pixels one boundary crossing slides a mark — the held body-length change
   * at the roll's zoom. The one input that moves per pointer move, and it
   * reaches the DOM as a transform per bucket rather than a rebuild.
   */
  readonly shift = input.required<number>();

  /**
   * The bars to draw: the song's, less the ones the preview is already drawing.
   *
   * A note being dragged is drawn once, where it is going. The ring around a
   * selected note goes with it, being inside the same group.
   */
  protected readonly shown = computed(() =>
    this.marks().filter((mark) => !this.moving().has(mark.note.address)),
  );

  /**
   * {@link shown}, dealt by how far a held body-length edit slides each mark:
   * bucket k holds the marks with k of the body's passes wholly before them,
   * which move by k times the change. Everything between two pass starts is
   * outside the edited body — its own bars are stood aside and preview-drawn —
   * so a per-bucket translate is exact, not approximate. One bucket, unmoved,
   * while no loop gesture is held.
   */
  protected readonly buckets = computed<{ k: number; marks: Mark[] }[]>(() => {
    const bounds = this.boundaries();
    const marks = this.shown();
    if (bounds === null) {
      return [{ k: 0, marks: [...marks] }];
    }

    const dealt = new Map<number, Mark[]>();
    for (const mark of marks) {
      const ends = bounds.get(mark.note.channel) ?? [];
      let k = 0;
      while (k < ends.length && ends[k] <= mark.note.tick) {
        k++;
      }

      const bucket = dealt.get(k);
      if (bucket) {
        bucket.push(mark);
      } else {
        dealt.set(k, [mark]);
      }
    }

    return [...dealt.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, list]) => ({ k, marks: list }));
  });

  /**
   * The instance the inspector is describing, which is the one pass of a looped
   * note the porter actually clicked. Its ring stays solid; the siblings that
   * ring with it — every other pass of the same address — step back, so "these
   * change together" and "this is the one you took hold of" are both said. With
   * nothing inspected no instance can claim to be the one, and every ring is
   * solid.
   */
  protected readonly asked = this.requests.inspecting;

  /** The hover, which the roll turns into a tooltip beside the pointer. */
  readonly entered = output<Mark>();

  /** The channel of the bar a click landed on, which the roll edits from then on. */
  readonly channelPicked = output<number>();

  /**
   * A command was picked on a bar, so the roll should let go of its notes.
   *
   * An output for the reason {@link channelPicked} is one: the selection is a
   * set of indices into the roll's own strip, which this does not have.
   */
  readonly commandPicked = output<void>();

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
   * The bar it is drawn on still speaks — a glyph names the same channel the bar
   * does, and the bar's note is the occurrence the inspector describes, so a
   * value committed from the panel replays the note the glyph stands on. Both
   * have to be said here because the bar's own handler never runs for a glyph.
   *
   * What it does **not** leave behind is a selection. The press underneath has
   * already outlined the bar, and a note outlined beside a command that has just
   * been picked is two subjects at once, with `Delete` meaning one of them and
   * nothing on screen saying which. `inspecting` is not the same thing and stays:
   * it is which occurrence is being described, not what a gesture would act on.
   *
   * On the `click`, which is the whole reason a drag off a glyph still works: the
   * press is never taken here, so it reaches the roll's own gesture layer, and a
   * press that passes the slop is captured there and raises no `click` at all.
   *
   * The overflow mark runs none of this. It stands for a list rather than a
   * command, so it has no span to reveal and no handler; the click it does not
   * stop reaches the bar, which selects that note and answers with the whole
   * list — which is the one place a glyph plate leaves a note selected.
   */
  protected inspect(mark: Mark, glyph: MarkGlyph, event: Event, show = false): void {
    // Without this the bar underneath answers as well, and the note would win.
    event.stopPropagation();
    this.channelPicked.emit(mark.note.channel);

    if (this.inSync()) {
      this.requests.inspecting.set({ address: mark.note.address, tick: mark.note.tick });
      this.commandPicked.emit();
      this.requests.reveal.set({ span: { ...glyph.command.span }, show });
    }
  }
}
