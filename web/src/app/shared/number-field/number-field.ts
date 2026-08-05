import { Component, input, output } from '@angular/core';

/**
 * A number input that commits a value only once it is one.
 *
 * The job is the guard: an `<input type="number">` reports `""` for a half-typed
 * `-`, for `1e`, and for a field the user has just cleared, and committing any
 * of those writes garbage into the document. So it emits on `change` and `blur`
 * rather than `input`, and only when the text parses — which also means one
 * undo step per edit rather than one per keystroke.
 *
 * The right control for anything that decides how the *rest* of a command is
 * read — an arpeggio's count, an `#am4` `$ED` sub-byte — where a slider would
 * drag the document through every destructive value between here and there.
 *
 * ```html
 * <amk-number-field label="Feedback" [value]="feedback()" [min]="-128" [max]="127"
 *                   (commit)="setFeedback($event)" />
 * ```
 */
@Component({
  selector: 'amk-number-field',
  template: `
    <label class="flex flex-col gap-0.5">
      <span class="flex items-baseline justify-between gap-2">
        <span class="text-ink-muted text-[11px]">{{ label() }}</span>
        @if (valueLabel(); as text) {
          <span class="text-ink font-mono text-[11px] tabular-nums">{{ text }}</span>
        }
      </span>
      <input
        type="number"
        class="bg-inset border-edge text-ink w-full rounded-sm border px-1.5 py-0.5 font-mono
               text-xs tabular-nums disabled:cursor-not-allowed disabled:opacity-40"
        [min]="min()"
        [max]="max()"
        [step]="step()"
        [disabled]="disabled()"
        [value]="value()"
        (change)="onCommit($event)"
      />
      @if (note(); as text) {
        <span class="text-ink-muted text-[11px] leading-snug">{{ text }}</span>
      }
    </label>
  `,
  host: { class: 'block' },
})
export class NumberField {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly min = input(0);
  readonly max = input(255);
  readonly step = input(1);
  readonly disabled = input(false);
  readonly valueLabel = input<string | null>(null);
  readonly note = input<string | null>(null);

  readonly commit = output<number>();

  protected onCommit(event: Event): void {
    const field = event.target as HTMLInputElement;
    const parsed = Number.parseFloat(field.value);
    if (Number.isNaN(parsed)) {
      // Put the standing value back, so the field never sits showing text that
      // does not describe the document.
      field.value = String(this.value());
      return;
    }

    const clamped = Math.min(
      this.max(),
      Math.max(this.min(), Math.round(parsed / this.step()) * this.step()),
    );
    if (clamped !== parsed) {
      field.value = String(clamped);
    }

    if (clamped !== this.value()) {
      this.commit.emit(clamped);
    }
  }
}
