import { Component, computed, inject, input } from '@angular/core';

import { argEditable, spliceArg } from '@amk/tokens/edits';
import {
  NOTE_DURATIONS,
  NSPC_VELOCITY_OFFSET,
  TICKS_PER_WHOLE,
  VELOCITY_VALUES,
} from '@amk/core/hardcoded-tables';
import type { Command } from '@amk/tokens';
import { argLockedBecause } from '../commands/context';
import { Slider } from '../../../shared/slider/slider';
import { EditorStore } from '../../../state/editor-store';
import { velocityTableAt } from '@amk/tokens/dialect';
import { hex2 } from '../../../util/format';
import { dragPreview } from '../commands/preview';

/**
 * `q` — the one command whose readme entry is wrong, in both halves.
 *
 * The readme says the first digit is "how long of a delay there is between each
 * note" and the second "controls the volume". Neither is what the driver does.
 *
 * `main.asm:2365-2379` masks the high nibble to three bits, indexes
 * `NoteDurations`, and multiplies the note's own duration by the result before
 * taking the high byte — so it is a **gate time in 256ths of the note**, and the
 * "delay" is trailing silence proportional to how long the note is rather than a
 * fixed count. `aram_map.html:667` states it outright: "quantization, which is
 * in 256ths of a note".
 *
 * The low nibble indexes `VelocityValues`, which is two tables of sixteen and
 * neither of them linear — so it is an index, not a volume, and *which* table
 * depends on the song. That is why this view exists rather than a descriptor
 * row: telling the two nibbles apart needs a control each, and naming the table
 * needs to look at the `#option` directives above the caret.
 */
@Component({
  selector: 'amk-quantization-command',
  imports: [Slider],
  templateUrl: './quantization-command.html',
  host: { class: 'flex flex-col gap-3' },
})
export class QuantizationCommand {
  private readonly store = inject(EditorStore);

  readonly command = input.required<Command>();

  protected readonly byte = computed(() => this.command().args[0]?.value ?? 0);
  protected readonly written = computed(() => this.command().args.length > 0);

  /** Masked to three bits, exactly as the driver does before indexing. */
  protected readonly gateIndex = computed(() => (this.byte() >> 4) & 0x07);
  protected readonly velocityIndex = computed(() => this.byte() & 0x0f);

  /**
   * The two nibbles as the sliders are showing them.
   *
   * Every readout below reads these rather than the committed pair, so the
   * percentage, the example and the out-of-range warning all answer for the
   * value under the pointer. The sliders themselves keep binding to the
   * committed nibbles — `amk-slider` compares against the value bound to it to
   * decide whether a gesture changed anything, and a preview fed back in reads
   * as a no-op that never writes.
   *
   * Keyed by nibble rather than by argument index: both halves are the same
   * byte, and a drag on one must leave the other reading the document.
   */
  private readonly drag = dragPreview(this.command);

  protected readonly shownGate = computed(() => this.drag.at('gate', this.gateIndex()));
  protected readonly shownVelocity = computed(() => this.drag.at('velocity', this.velocityIndex()));

  protected preview(nibble: 'gate' | 'velocity', value: number): void {
    this.drag.set(nibble, value);
  }

  protected readonly table = computed(() =>
    velocityTableAt(this.command(), this.store.tokens().tokens, this.store.source()),
  );

  private readonly tableName = computed(() => (this.table() === 'smw' ? 'SMW' : 'N-SPC'));

  private readonly gateByte = computed(() => NOTE_DURATIONS[this.shownGate()]);

  private readonly velocityByte = computed(
    () =>
      VELOCITY_VALUES[this.shownVelocity() + (this.table() === 'nspc' ? NSPC_VELOCITY_OFFSET : 0)],
  );

  protected readonly gateLabel = computed(
    () => `${Math.round((this.gateByte() / 256) * 100)}% of the note`,
  );

  protected readonly gateNote = computed(
    () => `$${hex2(this.gateByte())} of $FF — the rest of the note is silence`,
  );

  protected readonly velocityLabel = computed(() => `$${hex2(this.velocityByte())}`);

  protected readonly velocityNote = computed(
    () =>
      `${Math.round((this.velocityByte() / 0xff) * 100)}% of full, from the ${this.tableName()} table`,
  );

  /**
   * What the setting comes to for a note of the length in effect.
   *
   * The gate is a fraction, so it says nothing on its own; against a real length
   * it becomes "sounds for 23 of 24 ticks", which is the sentence somebody
   * tuning staccato actually wants. The driver's own arithmetic, minimum of one
   * tick included (`main.asm:2445-2449`).
   */
  protected readonly example = computed(() => {
    const ticks = TICKS_PER_WHOLE / 8;
    const sounding = Math.max(1, (ticks * this.gateByte()) >> 8);
    return `at l8 (${ticks} ticks) a note sounds for ${sounding}, then ${ticks - sounding} of silence`;
  });

  /**
   * `parser.ts`'s `parseQuantization` — `q00` is an error, so the gate never
   * reaches index 0 alone.
   *
   * Read off the dragged nibbles, so the warning arrives while there is still
   * time to not let go.
   */
  protected readonly outOfRange = computed(() => {
    const value = (this.shownGate() << 4) | this.shownVelocity();
    return value < 1 || value > 0x7f
      ? `q must be between $01 and $7F; $${hex2(value)} is an error at compile time`
      : null;
  });

  protected readonly editable = computed(() => argEditable(this.command(), 0));

  protected readonly lockedBecause = computed(() => argLockedBecause(this.command(), 0));

  // --- editing ---------------------------------------------------------------

  protected setGate(index: number): void {
    this.write((index << 4) | this.velocityIndex());
  }

  protected setVelocity(index: number): void {
    this.write((this.gateIndex() << 4) | index);
  }

  /** `q`'s argument is read with `getHex` (`parser.ts`'s `parseQuantization`), so it is written bare. */
  private write(value: number): void {
    this.store.apply(spliceArg(this.store.source(), this.command(), 0, hex2(value)));
  }
}
