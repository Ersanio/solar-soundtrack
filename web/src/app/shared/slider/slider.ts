import { Component, computed, input, linkedSignal, output, signal } from '@angular/core';

/**
 * A labelled range input that reports a drag and a commit separately.
 *
 * The separation is the whole component. Everything that edits MML writes back
 * through `EditorStore.replace`, which recompiles — so a control that committed
 * on every `input` event would push a recompile through the 150 ms typing
 * debounce once per frame of a drag, and the commit's own recompile would then
 * feed a new value back down and yank the thumb out from under the pointer.
 *
 * So: `preview` fires continuously and is for anything cheap and local (a graph
 * redrawing, a readout counting), `commit` fires once when the gesture ends, and
 * `pending` holds the dragged value in front of the bound one until it does.
 * That contract lived as a comment on the transport's seek bar and had to be
 * re-derived by every panel that wanted a slider; it lives here now.
 *
 * `value` is an `input`, not a `model`: a commit is a gesture, not a change, and
 * a two-way binding cannot express "the source of truth updates when I let go".
 *
 * ```html
 * <amk-slider label="Global volume" [value]="volume()" [max]="255"
 *             [valueLabel]="volumeLabel()" (commit)="setVolume($event)" />
 * ```
 */
@Component({
  selector: 'amk-slider',
  template: `
    <label class="flex flex-col gap-0.5">
      <span class="flex items-baseline justify-between gap-2">
        <span class="text-ink-muted text-[11px]">{{ label() }}</span>
        <span class="text-ink font-mono text-[11px] tabular-nums">{{ display() }}</span>
      </span>
      <input
        type="range"
        class="accent-accent w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        [min]="lowerBound()"
        [max]="upperBound()"
        [step]="step()"
        [disabled]="disabled()"
        [value]="position()"
        (input)="onInput($event)"
        (change)="onCommit()"
        (pointerup)="onCommit()"
        (pointercancel)="onCommit()"
        (blur)="onCommit()"
      />
      @if (note(); as text) {
        <span class="text-ink-muted text-[11px] leading-snug">{{ text }}</span>
      }
    </label>
  `,
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

  /** Pre-formatted readout — "132.2 BPM", "80% of full". Falls back to the number. */
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

  protected readonly display = computed(() => {
    const pending = this.pending();
    if (pending === null && this.valueLabel() !== null) {
      return this.valueLabel();
    }

    const value = this.shown();
    return this.signed() && value > 0 ? `+${value}` : String(value);
  });

  protected onInput(event: Event): void {
    const raw = Number((event.target as HTMLInputElement).value);
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
