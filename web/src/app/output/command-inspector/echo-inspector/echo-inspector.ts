import { Component, computed, inject, input } from '@angular/core';

import type { Command } from '@amk/tokens';
import { ticksLabel } from '@amk/tokens/commands/units';
import { tempoBefore } from '@amk/tokens/dialect';
import { BitToggles, VOICE_LABELS } from '../../../shared/bit-toggles/bit-toggles';
import { Slider } from '../../../shared/slider/slider';
import { EditorStore } from '../../../state/editor-store';
import { hex2 } from '../../../util/format';
import { byteArgs } from '../commands/byte-args';
import { EchoConfig } from '../echo-config/echo-config';

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

  protected readonly bytes = byteArgs(this.command);

  /** `$F0` has nothing to say beyond its own name. */
  protected readonly isEchoOff = computed(() => this.vcmd() === 0xf0);

  protected readonly isEf = computed(() => this.vcmd() === 0xef);
  protected readonly isF1 = computed(() => this.vcmd() === 0xf1);
  protected readonly isFade = computed(() => this.vcmd() === 0xf2);

  // --- $EF ------------------------------------------------------------------

  protected readonly maskLabel = computed(() => `$${hex2(this.bytes.at(0))}`);

  // --- $F2 ------------------------------------------------------------------

  /** The same ticks/note-length/seconds sentence every other duration gets. */
  protected readonly fadeLabel = computed(() =>
    ticksLabel(this.bytes.shownAt(0), tempoBefore(this.command(), this.store.tokens().commands)),
  );
}
