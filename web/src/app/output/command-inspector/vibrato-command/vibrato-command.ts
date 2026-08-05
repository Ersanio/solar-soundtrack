import { Component, computed, inject, input } from '@angular/core';

import { argEditable, argumentText, spliceArg } from '@compiler/edits';
import type { Command } from '@compiler/tokens';
import { Slider } from '../../../shared/slider/slider';
import { EditorStore } from '../../../state/editor-store';
import { tempoBefore } from '../../../util/dialect';
import { ticksLabel } from '../commands/units';
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
 * accumulator every tick (`main.asm:3166-3169`), so bigger is faster and it is
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
   * `p` with two arguments has no delay — `parser.ts:2049` writes `$DE $00` — so
   * the same position means the rate there and a delay in every other form. That
   * shift is `p`'s own doing; the panel's job is to not repeat it.
   */
  private readonly hasDelay = computed(
    () => this.command().vcmd !== undefined || this.args().length >= 3,
  );

  protected readonly delayIndex = computed(() => (this.hasDelay() ? 0 : -1));
  protected readonly rateIndex = computed(() => (this.hasDelay() ? 1 : 0));
  protected readonly depthIndex = computed(() => (this.hasDelay() ? 2 : 1));

  protected readonly delay = computed(() => (this.hasDelay() ? (this.args()[0] ?? 0) : 0));
  protected readonly rate = computed(() => this.args()[this.rateIndex()] ?? 0);
  protected readonly depth = computed(() => this.args()[this.depthIndex()] ?? 0);

  protected readonly tempo = computed(() =>
    tempoBefore(this.command(), this.store.tokens().commands),
  );

  protected readonly delayLabel = computed(() => ticksLabel(this.delay(), this.tempo()));

  protected readonly rateNote = computed(() =>
    this.rate() === 0
      ? 'a rate of 0 never advances, so nothing wobbles'
      : `higher is faster — one cycle every ${Math.round(256 / this.rate())} ticks`,
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
    const macro = index >= 0 ? this.command().args[index]?.replacement : undefined;
    return macro === undefined ? null : `comes from the "${macro}" replacement`;
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
