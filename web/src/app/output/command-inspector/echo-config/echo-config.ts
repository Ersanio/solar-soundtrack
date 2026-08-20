import { Component, computed, inject, input } from '@angular/core';

import { type FirTaps, echoStability } from '@amk/spc/fir';
import type { Command } from '@amk/tokens';
import { builtInTaps } from '@amk/tokens/echo-hazards';
import { firOverriddenBefore } from '@amk/tokens/fir-override';
import { Button } from '../../../shared/button/button';
import { Slider } from '../../../shared/slider/slider';
import { EditorStore } from '../../../state/editor-store';
import { hex2 } from '../../../util/format';
import { byteArgs } from '../commands/byte-args';
import { FirGraph } from '../fir-graph/fir-graph';
import { stopWhenRunaway } from '../runaway-guard';

/** AddmusicK ships exactly two, at `main.asm:3506-3510`. There is no third. */
const FILTERS = [
  { value: 0, name: '0 — SMW low-pass', note: 'the filter Super Mario World itself uses' },
  { value: 1, name: '1 — flat', note: 'passes the echo through unchanged' },
] as const;

/**
 * `$F1`: how far apart the echo is, how much comes back, and through which
 * filter.
 *
 * Its own component because it is the only echo command that is more than a set
 * of numbers. Delay is an ARAM allocation as much as a setting — 2 KiB a step,
 * and the number that makes a song stop fitting; feedback and the filter decide
 * together whether the echo fades or builds on itself, which is a judgement the
 * FIR designer makes too and which has to be made the same way in both places.
 */
@Component({
  selector: 'amk-echo-config',
  imports: [Button, FirGraph, Slider],
  templateUrl: './echo-config.html',
  host: { class: 'flex flex-col gap-3' },
})
export class EchoConfig {
  private readonly store = inject(EditorStore);

  readonly command = input.required<Command>();

  protected readonly FILTERS = FILTERS;

  protected readonly bytes = byteArgs(this.command);

  protected readonly filter = computed(() => this.bytes.at(2));

  /**
   * The delay is an ARAM allocation as much as a setting, and the number that
   * decides whether the song still fits is the bar in the output pane, not the
   * sentence under this slider. So the dragged value goes to the store too —
   * which clears it itself once a compile has seen the real one.
   */
  protected previewDelay(value: number): void {
    this.bytes.preview(0, value);
    this.store.echoDelayPreview.set(value & 0x0f);
  }

  /**
   * `main.asm:2606` masks the delay to four bits, so an out-of-range value wraps
   * in silence rather than erroring — worth saying, since nothing else in the
   * toolchain does.
   */
  protected readonly delayNote = computed(() => {
    const written = this.bytes.shownAt(0);
    const masked = written & 0x0f;
    if (written > 0x0f) {
      return `$${hex2(written)} is out of range; the driver masks it to $${hex2(masked)}`;
    }

    return `${masked * 16} ms — ${masked * 2} KiB of ARAM reserved for the buffer`;
  });

  protected readonly filterNote = computed(() =>
    this.filter() > 1 ? 'Only $00 and $01 exist; anything else reads past the table.' : null,
  );

  /**
   * Feeds the FIR graph's repeat curves, so dragging the feedback shows the echo
   * building up or dying away as you move rather than after you let go.
   */
  protected readonly feedback = computed(() => this.bytes.shownAt(1));

  /**
   * The filter this command implies, so it shows the same picture the FIR
   * designer would. Shared with the runaway-echo diagnostic, so the graph here
   * and the verdict in the output pane are drawn from the same coefficients.
   */
  protected readonly taps = computed<FirTaps | null>(() => builtInTaps(this.filter()));

  /**
   * Whether the feedback under the pointer makes the echo build on itself.
   *
   * `$F1` reloads one of the driver's two built-in tables, so the filter it
   * selects *is* the filter — an earlier `$F5` is overridden by the time this
   * runs. Judged with the same `echoStability` and the same operands
   * `echo-hazards.ts` uses for `AMK0501`, so the panel and the output pane can
   * never disagree about whether a setting is safe.
   */
  private readonly stability = computed(() => {
    const taps = this.taps();
    return taps === null ? null : echoStability(taps, this.feedback());
  });

  private readonly runaway = computed(() => this.stability()?.runaway === true);

  /** The same sentence the FIR designer prints, said while the slider moves. */
  protected readonly runawayNote = computed(() => {
    const stability = this.stability();
    if (!stability?.runaway) {
      return null;
    }

    return (
      `This feedback and filter ${this.filter()} give a loop gain of ` +
      `${stability.loopGain.toFixed(2)} — the echo will grow instead of fade. Lower the feedback` +
      `${this.filter() === 0 ? ', or select filter 1' : ''}.`
    );
  });

  constructor() {
    // The feedback is a slider and the player keeps running through a drag, so
    // the runaway arrives while the pointer is still moving — several seconds
    // before a commit could produce the AMK0501 that describes it.
    stopWhenRunaway(this.command, this.runaway, 'echo');
  }

  /**
   * A `$F5` earlier in this channel whose coefficients this command discards.
   * The same fact the FIR designer reports, seen from the other end.
   */
  protected readonly overrides = computed(() => {
    const earlier = firOverriddenBefore(this.command(), this.store.tokens().commands);
    return earlier ? { line: earlier.span.line } : null;
  });
}
