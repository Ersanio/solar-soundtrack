import { Component, computed, inject, input } from '@angular/core';

import { Audition } from '../../../../state/audition';
import { SampleStore } from '../../../../state/sample-store';

/**
 * Play one sample, or stop the one that is playing.
 *
 * A file's row and a bank slot's row want the same button and the same rule —
 * pressing the sample that is already sounding stops it — and a slot is
 * resolvable by name exactly as a file is, so one component serves both.
 *
 * It reaches for the PCM itself rather than being handed it: decoding every row
 * of a library to fill in a button nobody has pressed is the work this avoids.
 */
@Component({
  selector: 'amk-audition-button',
  template: `
    <button
      type="button"
      class="border-edge bg-inset text-ink-muted hover:text-ink hover:border-control shrink-0 cursor-pointer rounded border px-2 py-1 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-40"
      [disabled]="disabled()"
      (click)="toggle()"
    >
      {{ sounding() ? '■' : '▶' }}
    </button>
  `,
  host: { class: 'contents' },
})
export class AuditionButton {
  private readonly audition = inject(Audition);
  private readonly library = inject(SampleStore);

  readonly name = input.required<string>();
  readonly disabled = input(false);

  protected readonly sounding = computed(() => this.audition.playing() === this.name());

  protected toggle(): void {
    const name = this.name();
    if (this.audition.playing() === name) {
      this.audition.stop();
      return;
    }

    const pcm = this.library.pcm(name);
    if (pcm) {
      this.audition.play(name, pcm);
    }
  }
}
