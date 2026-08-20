import { Component, computed, input } from '@angular/core';

import { ticksLabel } from '@amk/tokens/commands/units';
import { PLOT } from '../../../shared/chart/plot';

/** Ticks of flat line drawn after the bend, so it does not end at the edge. */
const TAIL_TICKS = 8;

/** The plot's default half-height, so the axis means the same thing every time. */
const SEMITONES_PER_OCTAVE = 12;

/**
 * A pitch slide, as a shape: hold, then ramp, then hold.
 *
 * `$DD` slides from the note playing to a named one; `$EB` bends every later
 * note *away* from itself by a number of semitones and `$EC` bends *into* it
 * from there. All three are the same picture with the ends swapped, which is
 * what {@link from} and {@link to} express — in semitones relative to the note,
 * so `$DD` converts before it gets here and the other two do not.
 */
@Component({
  selector: 'amk-bend-graph',
  templateUrl: './bend-graph.html',
  host: { class: 'block' },
})
export class BendGraph {
  /** Ticks before the slide begins. */
  readonly delay = input.required<number>();
  /** Ticks the slide takes. */
  readonly duration = input.required<number>();
  /** Semitones relative to the written note where the slide starts. */
  readonly from = input.required<number>();
  /** Semitones relative to the written note where it ends. */
  readonly to = input.required<number>();
  readonly tempo = input<number | null>(null);

  protected readonly plot = PLOT;

  private readonly span = computed(() =>
    Math.max(1, this.delay() + Math.max(this.duration(), 1) + TAIL_TICKS),
  );

  /**
   * Semitones from the written note to the top of the plot.
   *
   * Fixed at an octave, and stepped up by whole octaves only when a bend
   * genuinely goes further, so the written note stays on the centre line and the
   * ramp moves against it — the only way the height means anything. Scaling to
   * whichever end is further out would draw one semitone and two octaves as the
   * identical shape.
   */
  private readonly reach = computed(() => {
    const furthest = Math.max(Math.abs(this.from()), Math.abs(this.to()));
    return Math.max(
      SEMITONES_PER_OCTAVE,
      Math.ceil(furthest / SEMITONES_PER_OCTAVE) * SEMITONES_PER_OCTAVE,
    );
  });

  private y(semitones: number): number {
    const half = PLOT.h / 2 - 6;
    return PLOT.h / 2 - (semitones / this.reach()) * half;
  }

  private x(tick: number): number {
    return (tick / this.span()) * PLOT.w;
  }

  protected readonly centreY = PLOT.h / 2;

  protected readonly delayX = computed(() => this.x(this.delay()));

  protected readonly path = computed(() => {
    const startY = this.y(this.from());
    const endY = this.y(this.to());
    const bendStart = this.x(this.delay());
    const bendEnd = this.x(this.delay() + Math.max(this.duration(), 1));

    // Hold at the starting pitch, ramp linearly, hold at the target. The driver
    // steps the slide once per tick, which at this scale is a straight line.
    return (
      `M0 ${startY.toFixed(1)}` +
      `L${bendStart.toFixed(1)} ${startY.toFixed(1)}` +
      `L${bendEnd.toFixed(1)} ${endY.toFixed(1)}` +
      `L${PLOT.w} ${endY.toFixed(1)}`
    );
  });

  protected readonly durationLabel = computed(() =>
    this.duration() === 0 ? 'instant' : `over ${ticksLabel(this.duration(), this.tempo())}`,
  );

  protected readonly axisLabel = computed(() => {
    const reach = this.reach();
    return reach === SEMITONES_PER_OCTAVE ? 'an octave' : `${reach / SEMITONES_PER_OCTAVE} octaves`;
  });

  protected readonly reachLabel = computed(() => {
    const semitones = this.to() - this.from();
    if (semitones === 0) {
      return 'no change';
    }

    return `${semitones > 0 ? '+' : ''}${semitones} semitone${Math.abs(semitones) === 1 ? '' : 's'}`;
  });
}
