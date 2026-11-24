import { Component, computed, inject, input } from '@angular/core';

import { Button } from '../../../../shared/button/button';
import { Audition } from '../../../../state/audition';
import { EditorStore } from '../../../../state/editor-store';
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
  imports: [Button],
  template: `
    <button
      amk-button
      size="sm"
      class="shrink-0 font-mono"
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
  private readonly editor = inject(EditorStore);

  readonly name = input.required<string>();
  readonly disabled = input(false);

  protected readonly sounding = computed(() => this.audition.playing() === this.name());

  protected toggle(): void {
    const name = this.name();
    if (this.audition.playing() === name) {
      this.audition.stop();
      return;
    }

    const pcm = this.library.pcm(name, this.editor.stockGroup() === 'optimized');
    if (pcm) {
      this.audition.play(name, pcm);
    }
  }
}
