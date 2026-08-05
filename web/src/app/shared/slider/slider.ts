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
        [min]="min()"
        [max]="max()"
        [step]="step()"
        [disabled]="disabled()"
        [value]="shown()"
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

  protected readonly display = computed(() => {
    const pending = this.pending();
    if (pending === null && this.valueLabel() !== null) {
      return this.valueLabel();
    }

    const value = this.shown();
    return this.signed() && value > 0 ? `+${value}` : String(value);
  });

  protected onInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
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
