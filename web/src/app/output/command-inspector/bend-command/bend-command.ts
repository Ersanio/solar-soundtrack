import { Component, computed, inject, input } from '@angular/core';

import { argEditable, argumentText, spliceArg } from '@compiler/edits';
import type { Command } from '@compiler/tokens';
import { Slider } from '../../../shared/slider/slider';
import { EditorStore } from '../../../state/editor-store';
import { tempoBefore } from '../../../util/dialect';
import { BendGraph } from '../bend-graph/bend-graph';
import { toSigned } from '../commands/param';
import { noteName, ticksLabel } from '../commands/units';
import { NotePicker } from '../note-picker/note-picker';

/**
 * `$DD` pitch bend and `$EB`/`$EC` pitch envelope — a delay, a slide and a target.
 *
 * One component for the three because they are one picture with the ends
 * swapped: `$DD` slides the note playing *to* a named note, `$EB` bends every
 * later note away from itself by a number of semitones, and `$EC` bends into it
 * from there. Which is which is two lines below rather than three files.
 *
 * `$DD`'s target is an absolute note byte, so it gets the note picker; the other
 * two are signed semitone offsets and get a centred slider.
 */
@Component({
  selector: 'amk-bend-command',
  imports: [BendGraph, NotePicker, Slider],
  templateUrl: './bend-command.html',
  host: { class: 'flex flex-col gap-3' },
})
export class BendCommand {
  private readonly store = inject(EditorStore);

  readonly command = input.required<Command>();

  protected readonly args = computed(() => this.command().args.map((a) => a.value));
  protected readonly vcmd = computed(() => this.command().vcmd ?? 0);

  /** `$DD` names a note; `$EB`/`$EC` name a distance from one. */
  protected readonly isPitchBend = computed(() => this.vcmd() === 0xdd);

  protected readonly delay = computed(() => this.args()[0] ?? 0);
  protected readonly duration = computed(() => this.args()[1] ?? 0);
  protected readonly target = computed(() => this.args()[2] ?? 0);

  protected readonly tempo = computed(() =>
    tempoBefore(this.command(), this.store.tokens().commands),
  );

  protected readonly delayLabel = computed(() => ticksLabel(this.delay(), this.tempo()));
  protected readonly durationLabel = computed(() => ticksLabel(this.duration(), this.tempo()));

  protected readonly noteLabel = computed(() => noteName(this.target()));

  protected readonly semitones = computed(() => toSigned(this.target()));

  /**
   * Where the slide starts and ends, in semitones from the written note.
   *
   * `$DD` starts at the note playing — which is zero on this axis — and ends at
   * an absolute byte the graph cannot place against it, since it does not know
   * what note is sounding. So the picture is drawn as the interval it would be
   * from `o4 c`, which is honest about the *shape* and says as much beneath.
   * `$EC` is the only one that runs the other way.
   */
  protected readonly from = computed(() => {
    if (this.isPitchBend()) {
      return 0;
    }

    return this.vcmd() === 0xec ? this.semitones() : 0;
  });

  protected readonly to = computed(() => {
    if (this.isPitchBend()) {
      return this.target() - 0xa4; // relative to o4 c, the graph's stand-in
    }

    return this.vcmd() === 0xec ? 0 : this.semitones();
  });

  protected readonly note = computed(() =>
    this.isPitchBend()
      ? 'The slide starts from whatever note is playing; the shape above is drawn against o4 c as a stand-in.'
      : this.vcmd() === 0xec
        ? 'Every later note starts this far away and arrives at its written pitch.'
        : 'Every later note starts at its written pitch and departs by this much.',
  );

  protected editable(index: number): boolean {
    return argEditable(this.command(), index);
  }

  protected lockedBecause(index: number): string | null {
    const macro = this.command().args[index]?.replacement;
    return macro === undefined ? null : `comes from the "${macro}" replacement`;
  }

  protected setArg(index: number, value: number): void {
    const byte = value < 0 ? value + 0x100 : value;
    this.store.apply(
      spliceArg(this.store.source(), this.command(), index, argumentText(this.command(), byte)),
    );
  }
}
