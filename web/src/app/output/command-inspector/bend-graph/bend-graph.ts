import { Component, computed, input } from '@angular/core';

import { ticksLabel } from '../commands/units';

const VIEW_W = 320;
const VIEW_H = 120;

/** Ticks of flat line drawn after the bend, so it does not end at the edge. */
const TAIL_TICKS = 8;

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

  protected readonly VIEW_W = VIEW_W;
  protected readonly VIEW_H = VIEW_H;
  protected readonly VIEW_BOX = `0 0 ${VIEW_W} ${VIEW_H}`;

  private readonly span = computed(() =>
    Math.max(1, this.delay() + Math.max(this.duration(), 1) + TAIL_TICKS),
  );

  /**
   * Semitones per viewBox unit.
   *
   * Scaled to whichever end is further from the note, with a floor of one
   * semitone so a one-semitone bend does not fill the plot and read as an
   * octave. Symmetric about the written note, so an upward and a downward bend
   * of the same size are mirror images rather than differently scaled.
   */
  private readonly reach = computed(() => Math.max(1, Math.abs(this.from()), Math.abs(this.to())));

  private y(semitones: number): number {
    const half = VIEW_H / 2 - 6;
    return VIEW_H / 2 - (semitones / this.reach()) * half;
  }

  private x(tick: number): number {
    return (tick / this.span()) * VIEW_W;
  }

  protected readonly centreY = VIEW_H / 2;

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
      `L${VIEW_W} ${endY.toFixed(1)}`
    );
  });

  protected readonly durationLabel = computed(() =>
    this.duration() === 0 ? 'instant' : `over ${ticksLabel(this.duration(), this.tempo())}`,
  );

  protected readonly reachLabel = computed(() => {
    const semitones = this.to() - this.from();
    if (semitones === 0) {
      return 'no change';
    }

    return `${semitones > 0 ? '+' : ''}${semitones} semitone${Math.abs(semitones) === 1 ? '' : 's'}`;
  });

  protected readonly description = computed(
    () =>
      `Pitch bend: ${this.delay()} ticks of delay, then ${this.reachLabel()} ${this.durationLabel()}.`,
  );
}
