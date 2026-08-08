import { Component, computed, input } from '@angular/core';

import { ticksLabel } from '@amk/tokens/commands/units';
import { PLOT } from '../../../shared/chart/plot';

/** Drawn in a fixed coordinate space and stretched to fit, as the other graphs are. */

/**
 * Ticks the plot covers.
 *
 * Enough to show several cycles of a middling rate without the fast ones turning
 * into a solid block. A tick is the driver's own unit here — the phase advances
 * once per tick — so the axis is honest in a way a seconds axis would not be
 * before the song has set a tempo.
 */
const SPAN_TICKS = 96;

/** Samples along the plot. One per viewBox unit is finer than the eye or the DOM needs. */
const STEPS = 160;

/**
 * The depth that fills the plot.
 */
const FULL_DEPTH = 0xff;

/**
 * What a vibrato or tremolo setting looks like, as a shape.
 *
 * Three numbers that no readout makes vivid: how long before it starts, how fast
 * it wobbles, how far. The driver's own waveform is a triangle, not a sine — it
 * doubles the 8-bit phase and folds the sign (`main.asm:3170-3178`) — so this
 * draws a triangle, because drawing a sine would be prettier and wrong.
 *
 * Shared between `$DE`, `p` and `$E5`. The only difference for tremolo is what
 * the y-axis means, which is why {@link axis} is an input rather than three
 * copies of this file.
 */
@Component({
  selector: 'amk-vibrato-graph',
  templateUrl: './vibrato-graph.html',
  host: { class: 'block' },
})
export class VibratoGraph {
  /** Ticks before the wobble starts. */
  readonly delay = input.required<number>();
  /** Phase added per tick — bigger is faster (`main.asm:3166-3169`). */
  readonly rate = input.required<number>();
  /** Peak offset, as the driver's `$A1+x` / `$B1+x`. */
  readonly depth = input.required<number>();
  /** The tempo in force, for the axis label. `null` says ticks only. */
  readonly tempo = input<number | null>(null);
  /** What the vertical axis means — "pitch" for vibrato, "volume" for tremolo. */
  readonly axis = input('pitch');

  protected readonly plot = PLOT;

  /** Where the delay ends, in viewBox units, for the shaded run before the wobble. */
  protected readonly delayX = computed(() =>
    Math.min(PLOT.w, (Math.min(this.delay(), SPAN_TICKS) / SPAN_TICKS) * PLOT.w),
  );

  protected readonly centreY = PLOT.h / 2;

  /**
   * The wave, in viewBox units.
   *
   * Phase is an 8-bit accumulator advanced by `rate` each tick, so a rate of `r`
   * completes a cycle every `256 / r` ticks — that relationship is the whole
   * reason a rate of 1 looks almost flat here and 64 looks frantic. Depth is
   * scaled against {@link FULL_DEPTH} rather than normalised to whatever it
   * happens to be, so raising it makes the picture taller; a plot that always
   * filled its box would show every setting as the same wave.
   */
  protected readonly path = computed(() => {
    const rate = this.rate();
    const depth = this.depth();
    const delay = this.delay();

    let d = '';
    for (let i = 0; i <= STEPS; i++) {
      const tick = (i / STEPS) * SPAN_TICKS;
      const x = (i / STEPS) * PLOT.w;

      // Before the delay elapses the offset is zero — the note plays flat.
      let offset = 0;
      if (tick >= delay && rate > 0) {
        const phase = ((tick - delay) * rate) % 256;
        // main.asm:3170-3178 — double the phase, fold the top half back down.
        const folded = phase < 128 ? phase : 255 - phase;
        offset = (folded / 128) * 2 - 1;
      }

      const scaled = Math.min(1, depth / FULL_DEPTH);
      const y = this.centreY - offset * scaled * (PLOT.h / 2 - 4);
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }

    return d;
  });

  /** `256 / rate` ticks to a cycle, said in the units the rest of the panel uses. */
  protected readonly cycleLabel = computed(() => {
    const rate = this.rate();
    if (rate <= 0) {
      return 'no wobble — a rate of 0 never advances';
    }

    const ticks = Math.round(256 / rate);
    return `a cycle every ${ticksLabel(ticks, this.tempo())}`;
  });

  protected readonly spanLabel = `${SPAN_TICKS} ticks`;

  protected readonly description = computed(
    () =>
      `Vibrato shape: ${this.delay()} ticks of delay, then the ${this.axis()} wobbles by ${this.depth()} of 255, ${this.cycleLabel()}.`,
  );
}
