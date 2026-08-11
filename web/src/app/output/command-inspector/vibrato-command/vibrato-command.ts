import { Component, computed, inject, input } from '@angular/core';

import { argEditable, argumentText, spliceArg } from '@amk/tokens/edits';
import type { Command } from '@amk/tokens';
import { argLockedBecause } from '../commands/context';
import { Slider } from '../../../shared/slider/slider';
import { EditorStore } from '../../../state/editor-store';
import { tempoBefore } from '@amk/tokens/dialect';
import { dragPreview } from '../commands/preview';
import { ticksLabel } from '@amk/tokens/commands/units';
import { VibratoGraph } from '../vibrato-graph/vibrato-graph';

/**
 * `$DE` vibrato, `$E5` tremolo and the `p` command that compiles to `$DE`.
 *
 * The three numbers interact in a way no list of them conveys — a rate of 8 and
 * a depth of 4 is a shimmer, a rate of 8 and a depth of 64 is a siren — so this
 * is the picture, with the controls under it.
 *
 * `p` is the reason the rate is labelled as one. Its own documentation calls the
 * value "the rate (speed)" while `$DE`'s calls it a "Duration" and links it to
 * the note-length table; the driver settles it by adding the byte to a phase
 * accumulator every tick (`main.asm:3321-3324`), so bigger is faster and it is
 * not a duration at all.
 */
@Component({
  selector: 'amk-vibrato-command',
  imports: [Slider, VibratoGraph],
  templateUrl: './vibrato-command.html',
  host: { class: 'flex flex-col gap-3' },
})
export class VibratoCommand {
  private readonly store = inject(EditorStore);

  readonly command = input.required<Command>();

  protected readonly args = computed(() => this.command().args.map((a) => a.value));

  /** `$E5` is the same shape over volume rather than pitch. */
  protected readonly isTremolo = computed(() => this.command().vcmd === 0xe5);
  protected readonly axis = computed(() => (this.isTremolo() ? 'volume' : 'pitch'));

  /**
   * Which argument is which.
   *
   * `p` with two arguments has no delay — `parseVibrato` writes `$DE $00` — so
   * the same position means the rate there and a delay in every other form. That
   * shift is `p`'s own doing; the panel's job is to not repeat it.
   */
  private readonly hasDelay = computed(
    () => this.command().vcmd !== undefined || this.args().length >= 3,
  );

  protected readonly delayIndex = computed(() => (this.hasDelay() ? 0 : -1));
  protected readonly rateIndex = computed(() => (this.hasDelay() ? 1 : 0));
  protected readonly depthIndex = computed(() => (this.hasDelay() ? 2 : 1));

  /**
   * Dropped whenever the command is re-scanned, which a commit guarantees — so
   * the graph follows the pointer and then goes back to reading the document.
   *
   * Only the graph and the readouts see it. The sliders keep reading the
   * *document*, because `amk-slider` tracks its own drag internally and compares
   * against the value bound to it to decide whether a gesture changed anything —
   * feed the preview back in and the slider concludes nothing moved and never
   * commits.
   */
  private readonly drag = dragPreview(this.command);

  protected readonly delay = computed(() => (this.hasDelay() ? (this.args()[0] ?? 0) : 0));
  protected readonly rate = computed(() => this.args()[this.rateIndex()] ?? 0);
  protected readonly depth = computed(() => this.args()[this.depthIndex()] ?? 0);

  /** The same three as the drag is showing them, for the graph and the labels. */
  protected readonly shownDelay = computed(() =>
    this.hasDelay() ? this.drag.at(0, this.delay()) : 0,
  );
  protected readonly shownRate = computed(() => this.drag.at(this.rateIndex(), this.rate()));
  protected readonly shownDepth = computed(() => this.drag.at(this.depthIndex(), this.depth()));

  protected preview(index: number, value: number): void {
    this.drag.set(index, value);
  }

  protected readonly tempo = computed(() =>
    tempoBefore(this.command(), this.store.tokens().commands),
  );

  protected readonly delayLabel = computed(() => ticksLabel(this.shownDelay(), this.tempo()));

  protected readonly rateNote = computed(() =>
    this.shownRate() === 0
      ? 'a rate of 0 never advances, so nothing wobbles'
      : `higher is faster — one cycle every ${Math.round(256 / this.shownRate())} ticks`,
  );

  protected readonly formNote = computed(() =>
    this.hasDelay()
      ? null
      : 'Written with two arguments, so there is no delay. Add a third and the first becomes one.',
  );

  protected editable(index: number): boolean {
    return index >= 0 && argEditable(this.command(), index);
  }

  protected lockedBecause(index: number): string | null {
    return argLockedBecause(this.command(), index);
  }

  protected setArg(index: number, value: number): void {
    if (index < 0) {
      return;
    }

    this.store.apply(
      spliceArg(this.store.source(), this.command(), index, argumentText(this.command(), value)),
    );
  }
}
