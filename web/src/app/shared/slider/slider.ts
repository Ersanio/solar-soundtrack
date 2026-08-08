import { Component, computed, input, linkedSignal, output, signal } from '@angular/core';

import { clamp } from '../../util/math';

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
   * dragging away from. It used to be hidden mid-drag for that reason; every
   * caller now feeds it a `dragPreview`, so hiding it would only throw away the
   * live reading.
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

  protected readonly lowerBound = computed(() => (this.stops() ? 0 : this.min()));
  protected readonly upperBound = computed(() => {
    const stops = this.stops();
    return stops ? Math.max(0, stops.length - 1) : this.max();
  });

  /**
   * Where the thumb sits: the value itself, or its index among the stops.
   *
   * A value that is not a stop takes the nearest index, so the thumb is never
   * left somewhere the track cannot represent.
   */
  protected readonly position = computed(() => {
    const stops = this.stops();
    if (!stops) {
      return this.shown();
    }

    const value = this.shown();
    let best = 0;
    let error = Infinity;
    for (let i = 0; i < stops.length; i++) {
      const distance = Math.abs(stops[i] - value);
      if (distance < error) {
        error = distance;
        best = i;
      }
    }

    return best;
  });

  /**
   * {@link position} mirrored when {@link invert} is set — where the thumb
   * physically sits.
   *
   * Mirroring the coordinate rather than setting `direction: rtl`, which is the
   * other way to reverse a range input and is honoured inconsistently: Firefox
   * and WebKit disagree about whether it also flips the keyboard arrows. Doing
   * the arithmetic means every browser and every input method agrees, at the
   * cost of one line here and one in {@link onInput}.
   */
  protected readonly trackPosition = computed(() => this.mirror(this.position()));

  /** Its own inverse — the mirror of a mirror is the original. */
  private mirror(coordinate: number): number {
    return this.invert() ? this.lowerBound() + this.upperBound() - coordinate : coordinate;
  }

  /** The thumb's place along the track, 0–1, as drawn. */
  private readonly fraction = computed(() => {
    const span = this.upperBound() - this.lowerBound();
    return span === 0 ? 0 : (this.trackPosition() - this.lowerBound()) / span;
  });

  /**
   * The whole track, as one gradient on the input itself.
   *
   * Drawn here rather than through `::-webkit-slider-runnable-track` and
   * `::-moz-range-track`, which cannot be given the same declaration in one rule
   * — a browser drops a whole selector list it does not recognise, so styling
   * both means writing everything twice and keeping the copies in step. A
   * background on the element is one declaration every browser already agrees
   * about, and the vendor tracks are only made transparent so it shows through.
   *
   * The stripe *is* the input's content box — 6px of it, held there by 5px of
   * vertical padding — and the background is clipped to it. That is what rounds
   * the ends: `border-radius` clips a background at the content edge with the
   * radius reduced by the padding, so a pill on the 16px box arrives at the
   * stripe as exactly half its height. Sizing the stripe with `background-size`
   * instead paints the same pixels but leaves nothing to round them against.
   *
   * The centre tick is part of the same gradient rather than an element beside
   * it, so it cannot drift out of alignment with the fill it marks.
   */
  protected readonly trackImage = computed(() => {
    const track = 'var(--color-edge)';
    const fill = 'var(--color-accent)';
    const at = clamp(this.fraction() * 100, 0, 100);

    if (this.origin() !== 'centre') {
      return `linear-gradient(to right, ${fill} 0 ${at}%, ${track} ${at}% 100%)`;
    }

    const [from, to] = at < 50 ? [at, 50] : [50, at];

    // The detent is listed first, which in CSS puts it *over* the fill — and it
    // has to be, because the fill always reaches the centre by definition, so a
    // mark underneath it could never be seen at any value.
    return (
      `linear-gradient(to right, transparent 0 calc(50% - 1px),` +
      ` var(--color-ink-muted) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px) 100%),` +
      ` linear-gradient(to right, ${track} 0 ${from}%, ${fill} ${from}% ${to}%,` +
      ` ${track} ${to}% 100%)`
    );
  });

  protected readonly endLabels = computed(() => {
    const ends = this.ends();
    return ends ? { low: ends[0], high: ends[1] } : null;
  });

  protected readonly display = computed(() => {
    const label = this.valueLabel();
    if (label !== null) {
      return label;
    }

    const value = this.shown();
    return this.signed() && value > 0 ? `+${value}` : String(value);
  });

  protected onInput(event: Event): void {
    const raw = this.mirror(Number((event.target as HTMLInputElement).value));
    const stops = this.stops();
    const value = stops ? (stops[raw] ?? this.value()) : raw;
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
