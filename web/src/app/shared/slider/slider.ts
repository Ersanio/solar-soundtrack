import { Component, computed, input, linkedSignal, output, signal } from '@angular/core';

import {
  mirror,
  readout,
  trackBounds,
  trackFraction,
  trackImage,
  trackPosition,
  valueAt,
} from './slider-track';

/**
 * A labelled range input that reports a drag and a commit separately.
 *
 * The separation is the whole component, and README.md has why: `preview` fires
 * continuously and is for anything cheap and local, `commit` fires once when the
 * gesture ends, and `pending` holds the dragged value in front of the bound one
 * until it does.
 *
 * ```html
 * <amk-slider label="Global volume" [value]="volume()" [max]="255"
 *             [valueLabel]="volumeLabel()" (commit)="setVolume($event)" />
 * ```
 */
@Component({
  selector: 'amk-slider',
  templateUrl: './slider.html',
  host: { class: 'block' },
})
export class Slider {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly min = input(0);
  readonly max = input(255);
  readonly step = input(1);
  readonly disabled = input(false);

  /**
   * The only values the slider may land on, in ascending order.
   *
   * For a scale that is not linear and not complete — `l`'s note denominators
   * are 1, 2, 3, 4, 6, 8, 12 … 192, and dragging through the 180 numbers between
   * 12 and 192 to find `l16` would be absurd. When set, the track runs over
   * *indices* into this list and `min`/`max` are ignored.
   *
   * A value that is not one of the stops still displays as itself; the thumb
   * sits on the nearest stop, and moving it commits a real one. Snapping the
   * document to the nearest stop on arrival would edit text nobody touched.
   */
  readonly stops = input<readonly number[] | null>(null);

  /**
   * Draws a sign on the readout, for a value whose zero is the middle rather
   * than the floor — echo volume, feedback, transpose, fine tune.
   *
   * An input rather than a second component: a centred slider differs from a
   * plain one in the readout and nothing else, and two components would drift.
   */
  readonly signed = input(false);

  /**
   * Where the filled part of the track starts.
   *
   * `'start'` is a level: none of it at the left, all of it at the right, and
   * the fill is how much you have. `'centre'` is a *balance* — pan, a signed
   * echo volume, a transpose — where the middle is the neutral value and the
   * fill says how far from it you are and in which direction. Filling those
   * from the left draws hard-left pan as "empty" and centre as "half on", which
   * is the reading a mixer spends its whole design not giving you.
   */
  readonly origin = input<'start' | 'centre'>('start');

  /**
   * Reverses the track, for a value that counts the opposite way to the control.
   *
   * AddmusicK's pan runs 0 at hard *right* to 20 at hard *left* (`main.asm:3486`),
   * so a plain slider moves the sound the other way from the thumb. Only the
   * control is reversed; the value written is untouched.
   */
  readonly invert = input(false);

  /** Marks under the ends of the track — `['L', 'R']` for a pan. */
  readonly ends = input<readonly [string, string] | null>(null);

  /**
   * Pre-formatted readout — "132.2 BPM", "80% of full". Falls back to the number.
   *
   * **Compute it from the previewed value, not the committed one.** It is shown
   * throughout a gesture, so a label derived from the document would sit there
   * describing the value you started from — which is exactly the number you are
   * dragging away from. Every caller feeds it a `dragPreview`, so it stays up
   * rather than hiding a live reading.
   */
  readonly valueLabel = input<string | null>(null);

  /** A sentence under the track, for the consequence the number does not state. */
  readonly note = input<string | null>(null);

  readonly preview = output<number>();
  readonly commit = output<number>();

  /**
   * The value being dragged, or `null` when no gesture is in flight.
   *
   * A `linkedSignal` keyed on the bound value so that arriving at a different
   * command — which reuses this component with a new input rather than building
   * a fresh one — cannot leave a stale drag in front of it.
   */
  private readonly pending = linkedSignal<number, number | null>({
    source: () => this.value(),
    computation: () => null,
  });

  /** Set while a pointer is down, so `blur` cannot commit a second time. */
  private readonly dragging = signal(false);

  protected readonly shown = computed(() => this.pending() ?? this.value());

  /** The track's own coordinate space: indices over the stops, or the plain range. */
  private readonly bounds = computed(() => trackBounds(this.stops(), this.min(), this.max()));

  protected readonly lowerBound = computed(() => this.bounds().low);
  protected readonly upperBound = computed(() => this.bounds().high);

  /** Where the thumb sits, before any mirroring. */
  private readonly position = computed(() => trackPosition(this.shown(), this.stops()));

  /** Where it physically sits — {@link position} reflected when `invert` is set. */
  protected readonly trackPosition = computed(() =>
    mirror(this.position(), this.bounds(), this.invert()),
  );

  protected readonly trackImage = computed(() =>
    trackImage(trackFraction(this.trackPosition(), this.bounds()), this.origin() === 'centre'),
  );

  protected readonly endLabels = computed(() => {
    const ends = this.ends();
    return ends ? { low: ends[0], high: ends[1] } : null;
  });

  protected readonly display = computed(() =>
    readout(this.shown(), this.valueLabel(), this.signed()),
  );

  protected onInput(event: Event): void {
    const raw = Number((event.target as HTMLInputElement).value);
    const value = valueAt(raw, this.stops(), this.bounds(), this.invert(), this.value());
    this.dragging.set(true);
    this.pending.set(value);
    this.preview.emit(value);
  }

  protected onCommit(): void {
    const value = this.pending();
    if (value === null || !this.dragging()) {
      return;
    }

    this.dragging.set(false);
    this.pending.set(null);
    if (value !== this.value()) {
      this.commit.emit(value);
    }
  }
}
