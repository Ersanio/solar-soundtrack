import { Component, computed, inject, signal, viewChild } from '@angular/core';

import type { ExistingLoops, OptimizeResult } from '@amk/optimize/optimize';
import { Button } from '../../shared/button/button';
import { Modal } from '../../shared/modal/modal';
import { Toggle } from '../../shared/toggle/toggle';
import { DriverStore } from '../../state/driver-store';
import { EditorRequests } from '../../state/editor-requests';
import { EditorStore } from '../../state/editor-store';
import { optimizeText } from './optimize-text';

/** A page of ARAM: the sample directory starts on one after the song (`layout.ts`). */
const PAGE = 0x100;

/** The top bar's Finalize: the open song optimized to compile smaller, shown before it replaces the document. */
@Component({
  selector: 'amk-finalize-dialog',
  imports: [Button, Modal, Toggle],
  templateUrl: './finalize-dialog.html',
  host: { class: 'contents' },
})
export class FinalizeDialog {
  private readonly store = inject(EditorStore);
  private readonly drivers = inject(DriverStore);
  private readonly requests = inject(EditorRequests);

  protected readonly text = {
    heading: $localize`:@@topbar.finalize.heading:topbar.finalize.heading`,
  };

  private readonly dialog = viewChild.required<Modal>('dialog');

  protected readonly existingLoops = signal<ExistingLoops>('keep');
  /** The text it was run on, and what it made of it; null before it is run or when it cannot be. */
  private readonly outcome = signal<{ source: string; result: OptimizeResult | null } | null>(null);

  protected readonly result = computed(() => this.outcome()?.result ?? null);
  protected readonly saved = computed(() => {
    const result = this.result();
    return result ? result.before - result.after : 0;
  });

  /** Whole pages the song gives back, which is all the samples after it can use. */
  protected readonly pages = computed(() => {
    const result = this.result();
    return result ? Math.ceil(result.before / PAGE) - Math.ceil(result.after / PAGE) : 0;
  });

  protected readonly percent = computed(() => {
    const result = this.result();
    return result && result.before > 0 ? Math.round((100 * this.saved()) / result.before) : 0;
  });

  open(): void {
    this.dialog().open();
    this.run();
  }

  protected choose(loops: ExistingLoops): void {
    this.existingLoops.set(loops);
    this.run();
  }

  private run(): void {
    const source = this.store.source();
    const result = optimizeText(
      this.store,
      this.drivers.driver()?.manifest.localPos,
      source,
      'finalize',
      [],
      this.existingLoops(),
    );
    this.outcome.set({ source, result: result && result.before > 0 ? result : null });
  }

  protected apply(): void {
    const outcome = this.outcome();
    const current = this.store.source();
    if (!outcome?.result || this.saved() <= 0 || outcome.source !== current) {
      return;
    }

    this.requests.applyAll(
      [
        {
          span: { start: 0, end: current.length, line: 1 },
          text: outcome.result.text,
          expect: current,
        },
      ],
      null,
      false,
      true,
    );
    this.dialog().close();
  }
}
