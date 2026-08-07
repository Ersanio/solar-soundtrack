import { Component, input, output } from '@angular/core';

/**
 * A number input that commits a value only once it is one.
 *
 * The job is the guard: an `<input type="number">` reports `""` for a half-typed
 * `-`, for `1e`, and for a field the user has just cleared, and *committing* any
 * of those writes garbage into the document. So `commit` waits for `change` —
 * blur or Enter — and fires only when the text parses, which also means one undo
 * step per edit rather than one per keystroke.
 *
 * That guard was never a reason to stay silent, though, and `preview` is the
 * separation: it fires per keystroke for anything cheap and local, on the same
 * terms as the slider's. Nothing it reports is written, so a value typed on the
 * way to another costs a redrawn curve and nothing else.
 *
 * The right control for anything that decides how the *rest* of a command is
 * read — an arpeggio's count, an `#am4` `$ED` sub-byte — where a slider would
 * drag the document through every destructive value between here and there.
 *
 * ```html
 * <amk-number-field label="Feedback" [value]="feedback()" [min]="-128" [max]="127"
 *                   (preview)="showFeedback($event)" (commit)="setFeedback($event)" />
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
        (input)="onPreview($event)"
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

  readonly preview = output<number>();
  readonly commit = output<number>();

  /**
   * What the field is showing, per keystroke.
   *
   * Half-typed text is simply not reported — `""`, `-` and `1e` all parse to
   * `NaN` and the last previewed value stands, which is the reading a listener
   * wants anyway. The text is left exactly as typed: clamping is the commit
   * path's job, and rewriting the field under someone mid-number would move the
   * caret and fight them for the keyboard.
   */
  protected onPreview(event: Event): void {
    const parsed = Number.parseFloat((event.target as HTMLInputElement).value);
    if (!Number.isNaN(parsed)) {
      this.preview.emit(this.clamp(parsed));
    }
  }

  protected onCommit(event: Event): void {
    const field = event.target as HTMLInputElement;
    const parsed = Number.parseFloat(field.value);
    if (Number.isNaN(parsed)) {
      // Put the standing value back, so the field never sits showing text that
      // does not describe the document.
      field.value = String(this.value());
      this.preview.emit(this.value());
      return;
    }

    const clamped = this.clamp(parsed);
    if (clamped !== parsed) {
      field.value = String(clamped);
    }

    // Emitted even when nothing was committed, and that is the point: a field
    // typed to 50, put back to 40 and blurred writes nothing, so a listener
    // holding previewed values would keep showing 50 for a field that reads 40.
    // Preview says what the control shows; commit says what to write.
    this.preview.emit(clamped);

    if (clamped !== this.value()) {
      this.commit.emit(clamped);
    }
  }

  private clamp(value: number): number {
    return Math.min(
      this.max(),
      Math.max(this.min(), Math.round(value / this.step()) * this.step()),
    );
  }
}
