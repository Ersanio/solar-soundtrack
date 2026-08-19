import { Component, computed, inject, signal } from '@angular/core';

import { ARAM_SIZE } from '@amk/spc/layout';
import { Button } from '../../../shared/button/button';
import { Checkbox } from '../../../shared/checkbox/checkbox';
import { Toolbar } from '../../../shared/toolbar/toolbar';
import { EditorStore } from '../../../state/editor-store';
import { SampleStore } from '../../../state/sample-store';
import { SampleRowView } from './sample-row/sample-row';
import { type FileRow, fileRow } from './sample-rows';

/**
 * The sample library, as a file browser.
 *
 * Bundled files and uploads are shown in one list because that is how they
 * behave — a bundled name whose bytes have been replaced is still SRCN 4, and
 * pretending otherwise would hide the only thing that matters about it.
 *
 * What a row *is* belongs to `sample-row/`, which edits the library itself. What
 * stays here is the shape of the whole list: the upload, the ARAM figure, and
 * the two sets a row is judged against.
 */
@Component({
  selector: 'amk-sample-browser',
  imports: [Button, Checkbox, Toolbar, SampleRowView],
  templateUrl: './sample-browser.html',
  host: { class: 'flex min-h-0 min-w-0 flex-col' },
})
export class SampleBrowser {
  protected readonly library = inject(SampleStore);
  private readonly editor = inject(EditorStore);

  /** Names rejected on the last upload, shown until the next one. */
  protected readonly rejected = signal<string[]>([]);

  protected readonly freeBytes = computed(() => this.editor.budget()?.freeBytes ?? 0);
  protected readonly overflowing = computed(() => this.freeBytes() < 0);

  protected async onFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = ''; // allow re-picking the same file
    if (files.length === 0) {
      return;
    }

    this.rejected.set(await this.library.upload(files));
  }

  /** Bank rows the user has opened. Collapsed by default — 64 slots is a lot. */
  private readonly opened = signal<ReadonlySet<string>>(new Set());

  protected toggleOpen(name: string): void {
    const next = new Set(this.opened());
    if (!next.delete(name)) {
      next.add(name);
    }

    this.opened.set(next);
  }

  /**
   * Names the current song actually asked for, before optimisation emptied any.
   *
   * A sample the song never references cannot occupy ARAM however it is marked,
   * and `keep` on such a row would be a control with nothing to do — so rows say
   * which side of that line they are on.
   */
  private readonly requested = computed(
    () => new Set(this.editor.result()?.stats?.sampleNames ?? []),
  );

  /**
   * Names the song actually plays, as opposed to merely including.
   *
   * These three states are what make the ARAM figure legible: a sample the song
   * plays is loaded whatever else is true, one it only includes survives just
   * while `keep` is ticked, and one it never mentions costs nothing either way.
   */
  private readonly used = computed(
    () => new Set(this.editor.result()?.stats?.usedSampleNames ?? []),
  );

  protected readonly rows = computed<FileRow[]>(() => {
    const context = {
      requested: this.requested(),
      used: this.used(),
      opened: this.opened(),
      slotsOf: (name: string) => this.library.bankSlots(name),
    };

    return this.library.files().map((file) => fileRow(file, context));
  });

  protected readonly freeLabel = computed(() => {
    const free = this.freeBytes();
    if (free < 0) {
      return `over ARAM by ${(-free).toLocaleString()} B`;
    }

    return `${free.toLocaleString()} B free of ${ARAM_SIZE.toLocaleString()}`;
  });
}
