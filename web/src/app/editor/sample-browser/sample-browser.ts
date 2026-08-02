import { Component, computed, inject, signal } from '@angular/core';

import { ARAM_SIZE } from '@spc/layout';
import { Button } from '../../shared/button/button';
import { Checkbox } from '../../shared/checkbox/checkbox';
import { DriverStore } from '../../state/driver-store';
import { EditorStore } from '../../state/editor-store';
import { Playback } from '../../state/playback';
import { type SampleFile, type SampleSlot, SampleStore } from '../../state/sample-store';
import { Hex2Pipe } from '../../util/hex.pipe';

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
  imports: [Button, Checkbox, Hex2Pipe],
  templateUrl: './sample-browser.html',
  host: { class: 'flex min-h-0 min-w-0 flex-col' },
})
export class SampleBrowser {
  protected readonly library = inject(SampleStore);
  protected readonly playback = inject(Playback);
  protected readonly drivers = inject(DriverStore);
  protected readonly editor = inject(EditorStore);

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

  /** Bank rows the user has opened. Collapsed by default — 64 slots is a lot. */
  private readonly opened = signal<ReadonlySet<string>>(new Set());

  protected isOpen(name: string): boolean {
    return this.opened().has(name);
  }

  protected toggleOpen(name: string): void {
    const next = new Set(this.opened());
    if (!next.delete(name)) next.add(name);
    this.opened.set(next);
  }

  /**
   * Slots of an open bank, blanks omitted.
   *
   * A real bank is mostly empty — showing all 64 buries the handful that matter.
   * Each row still displays its own slot index, so the SRCNs stay readable.
   */
  protected slots(name: string): SampleSlot[] {
    return this.library.bankSlots(name).filter((slot) => !slot.empty);
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

  protected isRequested(name: string): boolean {
    return this.requested().has(name);
  }

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

  protected isUsed(name: string): boolean {
    return this.used().has(name);
  }

  protected onAudition(name: string): void {
    if (this.playback.auditioning() === name) {
      this.playback.stopAudition();
      return;
    }
    const pcm = this.library.pcm(name);
    if (pcm) this.playback.audition(name, pcm);
  }

  protected onImportant(name: string, important: boolean): void {
    this.library.setImportant(name, important);
  }

  /**
   * Turns the min/max envelope into a single closed SVG path, top edge left to
   * right and bottom edge back again, in a 0..1 by -1..1 viewBox.
   */
  protected waveform(file: SampleFile | SampleSlot): string {
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

  protected slotSizeLabel(slot: SampleSlot): string {
    return `${slot.bytes.toLocaleString()} B`;
  }

  protected detailLabel(file: SampleFile | SampleSlot): string {
    if ('error' in file && file.error) return file.error;
    const seconds = (file.frames / 32000).toFixed(2);
    const loop =
      file.loopOffset > 0 ? `loop @ ${file.loopOffset.toLocaleString()}` : 'no loop point';
    return `${file.blocks.toLocaleString()} blocks · ${seconds}s · ${loop}`;
  }

  /** How much of a bank is actually populated — real banks are rarely full. */
  protected bankLabel(file: SampleFile): string {
    return `${file.slotCount} slots · ${file.usedSlots} non-empty`;
  }

  protected freeLabel(): string {
    const free = this.freeBytes();
    if (free < 0) return `over ARAM by ${(-free).toLocaleString()} B`;
    return `${free.toLocaleString()} B free of ${ARAM_SIZE.toLocaleString()}`;
  }
}
