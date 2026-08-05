import { Component, computed, inject, input } from '@angular/core';

import { argEditable, spliceArg } from '@compiler/edits';
import type { Command } from '@compiler/tokens';
import { type FirTaps, toSigned } from '@spc/fir';
import { BitToggles } from '../../../shared/bit-toggles/bit-toggles';
import { Button } from '../../../shared/button/button';
import { Slider } from '../../../shared/slider/slider';
import { EditorStore } from '../../../state/editor-store';
import { builtInTaps } from '../../../util/echo-hazards';
import { hex2 } from '../../../util/format';
import { firOverriddenBefore } from '../fir-override';
import { FirGraph } from '../fir-graph/fir-graph';

/** LSB first, matching the readme's own "(76543210)". */
const VOICE_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7'];

/** AddmusicK ships exactly two, at `main.asm:3506-3510`. There is no third. */
const FILTERS = [
  { value: 0, name: '0 — SMW low-pass', note: 'the filter Super Mario World itself uses' },
  { value: 1, name: '1 — flat', note: 'passes the echo through unchanged' },
] as const;

/**
 * The echo commands, read out and set in the units they actually mean.
 *
 * `$EF` and `$F1` between them set six numbers that interact — which channels
 * echo, how loud, how far apart, how much comes back, and through which filter —
 * and none of them says what it is in the source. Delay is the one worth
 * translating hardest: `$F1`'s first argument is in 16 ms steps and also decides
 * how much ARAM the echo buffer eats, which is the number that makes a song stop
 * fitting.
 */
@Component({
  selector: 'amk-echo-inspector',
  imports: [BitToggles, Button, FirGraph, Slider],
  templateUrl: './echo-inspector.html',
  host: { class: 'flex flex-col gap-3' },
})
export class EchoInspector {
  private readonly store = inject(EditorStore);

  readonly command = input.required<Command>();

  protected readonly VOICE_LABELS = VOICE_LABELS;
  protected readonly FILTERS = FILTERS;

  protected readonly vcmd = computed(() => this.command().vcmd ?? 0);
  protected readonly args = computed(() => this.command().args.map((a) => a.value));

  /** `$F0` has nothing to say beyond its own name. */
  protected readonly isEchoOff = computed(() => this.vcmd() === 0xf0);

  protected readonly isEf = computed(() => this.vcmd() === 0xef);
  protected readonly isF1 = computed(() => this.vcmd() === 0xf1);
  protected readonly isFade = computed(() => this.vcmd() === 0xf2);

  // --- $EF ------------------------------------------------------------------

  protected readonly mask = computed(() => this.args()[0] ?? 0);
  protected readonly maskLabel = computed(() => `$${hex2(this.mask())}`);

  // --- $F1 ------------------------------------------------------------------

  protected readonly delay = computed(() => this.args()[0] ?? 0);

  /**
   * `main.asm:2606` masks the delay to four bits, so an out-of-range value wraps
   * in silence rather than erroring — worth saying, since nothing else in the
   * toolchain does.
   */
  protected readonly delayNote = computed(() => {
    const written = this.delay();
    const masked = written & 0x0f;
    if (written > 0x0f) {
      return `$${hex2(written)} is out of range; the driver masks it to $${hex2(masked)}`;
    }

    return `${masked * 16} ms — ${masked * 2} KiB of ARAM reserved for the buffer`;
  });

  protected readonly filter = computed(() => this.args()[2] ?? 0);

  protected readonly filterNote = computed(() =>
    this.filter() > 1 ? 'Only $00 and $01 exist; anything else reads past the table.' : null,
  );

  // --- shared ---------------------------------------------------------------

  /** Echo volumes and feedback are signed, and negative means phase-inverted. */
  protected signedOf(index: number): number {
    return toSigned(this.args()[index] ?? 0);
  }

  protected signedNote(index: number): string {
    const byte = this.args()[index] ?? 0;
    return `$${hex2(byte)}${byte >= 0x80 ? ' — negative, so phase-inverted' : ''}`;
  }

  protected readonly feedback = computed(() => (this.isF1() ? (this.args()[1] ?? 0) : 0));

  /**
   * The filter this command implies, so `$F1` shows the same picture the FIR
   * designer would. Shared with the runaway-echo diagnostic, so the graph here
   * and the verdict in the output pane are drawn from the same coefficients.
   */
  protected readonly taps = computed<FirTaps | null>(() =>
    this.isF1() ? builtInTaps(this.filter()) : null,
  );

  /**
   * A `$F5` earlier in this channel whose coefficients this command discards.
   * The same fact the FIR designer reports, seen from the other end.
   */
  protected readonly overrides = computed(() => {
    if (!this.isF1()) {
      return null;
    }

    const earlier = firOverriddenBefore(this.command(), this.store.tokens().commands);
    return earlier ? { line: earlier.span.line } : null;
  });

  // --- editing --------------------------------------------------------------

  protected editable(index: number): boolean {
    return argEditable(this.command(), index);
  }

  protected lockedBecause(index: number): string | null {
    const macro = this.command().args[index]?.replacement;
    return macro === undefined ? null : `comes from the "${macro}" replacement`;
  }

  /** Writes one argument back as `$XX`, leaving the rest of the run alone. */
  protected setArg(index: number, value: number): void {
    const byte = value < 0 ? value + 0x100 : value;
    this.store.apply(
      spliceArg(this.store.source(), this.command(), index, `$${hex2(byte & 0xff)}`),
    );
  }
}
