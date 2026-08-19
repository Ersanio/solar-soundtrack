import { Component, computed, inject, input } from '@angular/core';

import { toSigned } from '@amk/spc/fir';
import type { Command } from '@amk/tokens';
import { ticksLabel } from '@amk/tokens/commands/units';
import { tempoBefore } from '@amk/tokens/dialect';
import { argEditable, spliceArg } from '@amk/tokens/edits';
import { BitToggles } from '../../../shared/bit-toggles/bit-toggles';
import { Slider } from '../../../shared/slider/slider';
import { EditorStore } from '../../../state/editor-store';
import { hex2 } from '../../../util/format';
import { argLockedBecause } from '../commands/context';
import { dragPreview, shownArgs } from '../commands/preview';
import { EchoConfig } from '../echo-config/echo-config';

/** LSB first, matching the readme's own "(76543210)". */
const VOICE_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7'];

/**
 * The echo commands, read out and set in the units they actually mean.
 *
 * Four commands, and this draws three of them: `$F0` has nothing to say beyond
 * its own name, and `$EF` and `$F2` are one control apart — a pair of signed
 * stereo volumes, set outright or faded to. `$F1` is the one with arithmetic of
 * its own, so it is `echo-config/`.
 */
@Component({
  selector: 'amk-echo-inspector',
  imports: [BitToggles, EchoConfig, Slider],
  templateUrl: './echo-inspector.html',
  host: { class: 'flex flex-col gap-3' },
})
export class EchoInspector {
  private readonly store = inject(EditorStore);

  readonly command = input.required<Command>();

  protected readonly VOICE_LABELS = VOICE_LABELS;

  protected readonly vcmd = computed(() => this.command().vcmd ?? 0);

  /**
   * What the document says. The sliders bind to these; only the readouts use
   * {@link shown}. Binding the preview back into a slider makes it conclude the
   * gesture changed nothing, and nothing is ever written.
   */
  private readonly args = computed(() => this.command().args.map((a) => a.value));

  private readonly drag = dragPreview(this.command);

  /** The arguments as the controls are showing them. */
  private readonly shown = computed(() => shownArgs(this.command(), this.drag));

  protected preview(index: number, value: number): void {
    this.drag.set(index, value < 0 ? value + 0x100 : value);
  }

  /** `$F0` has nothing to say beyond its own name. */
  protected readonly isEchoOff = computed(() => this.vcmd() === 0xf0);

  protected readonly isEf = computed(() => this.vcmd() === 0xef);
  protected readonly isF1 = computed(() => this.vcmd() === 0xf1);
  protected readonly isFade = computed(() => this.vcmd() === 0xf2);

  // --- $EF ------------------------------------------------------------------

  protected readonly mask = computed(() => this.args()[0] ?? 0);
  protected readonly maskLabel = computed(() => `$${hex2(this.mask())}`);

  // --- $F2 ------------------------------------------------------------------

  protected readonly fadeTicks = computed(() => this.args()[0] ?? 0);

  /** The same ticks/note-length/seconds sentence every other duration gets. */
  protected readonly fadeLabel = computed(() =>
    ticksLabel(this.shown()[0] ?? 0, tempoBefore(this.command(), this.store.tokens().commands)),
  );

  // --- shared ---------------------------------------------------------------

  /** A slider's position, from the document. */
  protected signedOf(index: number): number {
    return toSigned(this.args()[index] ?? 0);
  }

  /** Its readout, from whatever is being dragged. */
  protected signedNote(index: number): string {
    const byte = this.shown()[index] ?? 0;
    return `$${hex2(byte)}${byte >= 0x80 ? ' — negative, so phase-inverted' : ''}`;
  }

  protected editable(index: number): boolean {
    return argEditable(this.command(), index);
  }

  protected lockedBecause(index: number): string | null {
    return argLockedBecause(this.command(), index);
  }

  /** Writes one argument back as `$XX`, leaving the rest of the run alone. */
  protected setArg(index: number, value: number): void {
    const byte = value < 0 ? value + 0x100 : value;
    this.store.apply(
      spliceArg(this.store.source(), this.command(), index, `$${hex2(byte & 0xff)}`),
    );
  }
}
