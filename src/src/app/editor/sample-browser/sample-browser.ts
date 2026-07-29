import { Component, computed, inject, signal } from '@angular/core';

import { ARAM_SIZE } from '@spc/layout';
import { Button } from '../../shared/button/button';
import { DriverStore } from '../../state/driver-store';
import { EditorStore } from '../../state/editor-store';
import { Playback } from '../../state/playback';
import { type SampleFile, SampleStore } from '../../state/sample-store';

/**
 * The sample library, as a file browser.
 *
 * Bundled files and uploads are shown in one list because that is how they
 * behave — a bundled name whose bytes have been replaced is still SRCN 4, and
 * pretending otherwise would hide the only thing that matters about it. What
 * differs is the escape hatch: bundled files revert, uploads delete.
 */
@Component({
  selector: 'amk-sample-browser',
  imports: [Button],
  templateUrl: './sample-browser.html',
  host: { class: 'flex min-h-0 min-w-0 flex-col' },
})
export class SampleBrowser {
  protected readonly library = inject(SampleStore);
  protected readonly playback = inject(Playback);
  protected readonly drivers = inject(DriverStore);
  private readonly editor = inject(EditorStore);

  /** Names rejected on the last upload, shown until the next one. */
  protected readonly rejected = signal<string[]>([]);

  protected readonly freeBytes = computed(() => this.editor.budget()?.freeBytes ?? 0);
  protected readonly overflowing = computed(() => this.freeBytes() < 0);

  /**
   * `@0`-`@29` are `$DA n` bytes the *driver* resolves against its own built-in
   * instrument table, so a driver built from a modified `InstrumentData.asm`
   * can map them to different samples than the bundled one does.
   */
  protected readonly customDriver = computed(() => this.drivers.isCustom());

  protected async onFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = ''; // allow re-picking the same file
    if (files.length === 0) return;
    this.rejected.set(await this.library.upload(files));
  }

  protected onAudition(file: SampleFile): void {
    if (this.playback.auditioning() === file.name) {
      this.playback.stopAudition();
      return;
    }
    const pcm = this.library.pcm(file.name);
    if (pcm) this.playback.audition(file.name, pcm);
  }

  /**
   * Turns the min/max envelope into a single closed SVG path, top edge left to
   * right and bottom edge back again, in a 0..1 by -1..1 viewBox.
   */
  protected waveform(file: SampleFile): string {
    const envelope = file.envelope;
    const buckets = envelope.length / 2;
    if (buckets === 0) return '';

    const step = 1 / buckets;
    let top = '';
    let bottom = '';
    for (let bucket = 0; bucket < buckets; bucket++) {
      const x = (bucket * step).toFixed(5);
      top += `${bucket === 0 ? 'M' : 'L'}${x},${(-envelope[bucket * 2 + 1]).toFixed(4)}`;
      bottom = `L${x},${(-envelope[bucket * 2]).toFixed(4)}${bottom}`;
    }
    return `${top}${bottom}Z`;
  }

  protected sizeLabel(file: SampleFile): string {
    return `${file.bytes.length.toLocaleString()} B`;
  }

  protected detailLabel(file: SampleFile): string {
    if (file.error) return file.error;
    const seconds = (file.frames / 32000).toFixed(2);
    const loop = file.loopOffset > 0 ? `loop @ ${file.loopOffset.toLocaleString()}` : 'no loop point';
    return `${file.blocks.toLocaleString()} blocks · ${seconds}s · ${loop}`;
  }

  protected freeLabel(): string {
    const free = this.freeBytes();
    if (free < 0) return `over ARAM by ${(-free).toLocaleString()} B`;
    return `${free.toLocaleString()} B free of ${ARAM_SIZE.toLocaleString()}`;
  }
}
