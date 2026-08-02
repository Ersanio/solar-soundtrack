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
   * One view model per row, with everything the template draws already resolved.
   *
   * The template used to call ten methods per row instead, and `slots()` among
   * them reached `SampleStore.bankSlots`. With a bank expanded that decoded up
   * to 64 BRR samples and rebuilt 64 SVG paths on *every* change-detection
   * pass — and the transport pushes a new position ten times a second while a
   * song plays, so it never stopped. As a `computed` the work happens when the
   * library, the compile result or the open set actually changes.
   *
   * A row's waveform is built only if it will be drawn, which is why `waveform`
   * is empty for anything unreadable or absent from the song.
   */
  protected readonly rows = computed<FileRow[]>(() => {
    const requested = this.requested();
    const used = this.used();
    const opened = this.opened();

    return this.library.files().map((file) => {
      const isRequested = requested.has(file.name);
      const expanded = opened.has(file.name);
      const open = expanded && file.kind === 'bank' && file.error === null;

      return {
        file,
        expanded,
        open,
        used: used.has(file.name),
        requested: isRequested,
        waveform:
          file.kind === 'sample' && file.error === null && isRequested ? waveform(file) : '',
        detail: detailLabel(file),
        size: `${file.bytes.length.toLocaleString()} B`,
        bank: `${file.slotCount} slots · ${file.usedSlots} non-empty`,
        // A real bank is mostly empty — showing all 64 buries the handful that
        // matter. Each row still displays its own slot index, so the SRCNs stay
        // readable.
        slots: open
          ? this.library
              .bankSlots(file.name)
              .filter((slot) => !slot.empty)
              .map((slot) => ({
                slot,
                used: used.has(slot.name),
                requested: requested.has(slot.name),
                waveform: waveform(slot),
                detail: detailLabel(slot),
                size: `${slot.bytes.toLocaleString()} B`,
              }))
          : [],
      };
    });
  });

  protected readonly freeLabel = computed(() => {
    const free = this.freeBytes();
    if (free < 0) {
      return `over ARAM by ${(-free).toLocaleString()} B`;
    }

    return `${free.toLocaleString()} B free of ${ARAM_SIZE.toLocaleString()}`;
  });

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

  protected onAudition(name: string): void {
    if (this.playback.auditioning() === name) {
      this.playback.stopAudition();
      return;
    }

    const pcm = this.library.pcm(name);
    if (pcm) {
      this.playback.audition(name, pcm);
    }
  }

  protected onImportant(name: string, important: boolean): void {
    this.library.setImportant(name, important);
  }
}

/** A bank slot as the template draws it. */
interface SlotRow {
  slot: SampleSlot;
  used: boolean;
  requested: boolean;
  waveform: string;
  detail: string;
  size: string;
}

/** A library entry as the template draws it, its open bank's slots included. */
interface FileRow {
  file: SampleFile;
  /** Whether the user has opened this row, whatever else is true of it. */
  expanded: boolean;
  /** Whether {@link slots} is showing — expanded, a bank, and readable. */
  open: boolean;
  used: boolean;
  requested: boolean;
  /** Empty when this row does not draw one. */
  waveform: string;
  detail: string;
  size: string;
  /** How much of a bank is actually populated — real banks are rarely full. */
  bank: string;
  slots: SlotRow[];
}

/**
 * Turns the min/max envelope into a single closed SVG path, top edge left to
 * right and bottom edge back again, in a 0..1 by -1..1 viewBox.
 */
function waveform(file: SampleFile | SampleSlot): string {
  const envelope = file.envelope;
  const buckets = envelope.length / 2;
  if (buckets === 0) {
    return '';
  }

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

function detailLabel(file: SampleFile | SampleSlot): string {
  if ('error' in file && file.error) {
    return file.error;
  }

  const seconds = (file.frames / 32000).toFixed(2);
  const loop = file.loopOffset > 0 ? `loop @ ${file.loopOffset.toLocaleString()}` : 'no loop point';
  return `${file.blocks.toLocaleString()} blocks · ${seconds}s · ${loop}`;
}
