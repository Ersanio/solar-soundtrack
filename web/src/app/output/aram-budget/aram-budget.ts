import { Component, computed, inject } from '@angular/core';

import { EditorStore } from '../../state/editor-store';
import { hex4 } from '../../util/format';
import { AramBar, type Group, type Segment } from '../aram-bar/aram-bar';

/** A budget row as the table renders it: a bar segment plus its text columns. */
interface TableRow extends Segment {
  detail: string;
  range: string;
  size: string;
}

@Component({
  selector: 'amk-aram-budget',
  imports: [AramBar],
  templateUrl: './aram-budget.html',
})
export class AramBudget {
  protected readonly store = inject(EditorStore);

  /**
   * Legend swatches. The bar itself fills via `fill-seg-*` inside the SVG; these
   * are the `bg-seg-*` equivalents for the table, both resolving to the same
   * theme variables in styles.css.
   */
  protected readonly fill: Record<Group, string> = {
    driver: 'bg-seg-driver',
    song: 'bg-seg-song',
    samples: 'bg-seg-samples',
    free: 'bg-seg-free',
    echo: 'bg-seg-echo',
  };

  /**
   * The table's rows, which are also the bar's segments.
   *
   * `computeBudget` already emits exactly the five regions the bar draws, so
   * there is nothing to roll up here — one pass builds both.
   *
   * `free` is kept even at zero bytes: "no room left" is precisely what you
   * come to this table to read, and a missing row says it far less clearly.
   */
  protected readonly rows = computed<TableRow[]>(() => {
    const budget = this.store.budget();
    if (!budget) {
      return [];
    }

    return budget.rows
      .filter((row) => row.bytes > 0 || row.key === 'free')
      .map((row) => ({
        group: row.key,
        label: row.label,
        bytes: row.bytes,
        detail: row.detail ?? '',
        range: `$${hex4(row.start)}–$${hex4(row.start + Math.max(row.bytes, 1) - 1)}`,
        size: row.bytes.toLocaleString(),
      }));
  });

  /** The bar has no zero-width mark to draw, so it omits what the table lists. */
  protected readonly segments = computed<Segment[]>(() =>
    this.rows().filter((row) => row.bytes > 0),
  );

  protected readonly overflowing = computed(() => (this.store.budget()?.overflowBytes ?? 0) > 0);

  protected readonly notes = computed(() => {
    const notes: string[] = [];
    if (this.overflowing()) {
      notes.push(
        'This will not fit in ARAM. Reduce samples, shorten the song, or lower the echo buffer.',
      );
    }

    return notes;
  });
}
