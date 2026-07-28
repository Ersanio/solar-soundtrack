import { Component, computed, inject } from '@angular/core';

import { DriverStore } from '../../state/driver-store';
import { EditorStore } from '../../state/editor-store';
import { hex4 } from '../../util/format';
import { AramBar, type Group, type Segment } from '../aram-bar/aram-bar';
import { DriverPicker } from '../driver-picker/driver-picker';

interface TableRow {
  key: string;
  group: Group;
  label: string;
  detail: string;
  range: string;
  size: string;
}

/** Stacked-bar segments, in memory order. */
const GROUPS: ReadonlyArray<{ group: Group; label: string }> = [
  { group: 'driver', label: 'driver' },
  { group: 'song', label: 'your song' },
  { group: 'samples', label: 'samples' },
  { group: 'free', label: 'free' },
  { group: 'echo', label: 'echo' },
];

@Component({
  selector: 'amk-aram-budget',
  imports: [DriverPicker, AramBar],
  templateUrl: './aram-budget.html',
})
export class AramBudget {
  protected readonly store = inject(EditorStore);
  private readonly drivers = inject(DriverStore);

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

  protected readonly segments = computed<Segment[]>(() => {
    const budget = this.store.budget();
    if (!budget) return [];
    return GROUPS.map(({ group, label }) => ({
      group,
      label,
      bytes: budget.rows
        .filter((row) => row.group === group)
        .reduce((sum, row) => sum + row.bytes, 0),
    })).filter((segment) => segment.bytes > 0);
  });

  protected readonly tableRows = computed<TableRow[]>(() => {
    const budget = this.store.budget();
    if (!budget) return [];
    return budget.rows
      .filter((row) => row.bytes > 0 || row.key === 'free')
      .map((row) => ({
        key: row.key,
        group: row.group,
        label: row.label,
        detail: row.detail ?? '',
        range: `$${hex4(row.start)}–$${hex4(row.start + Math.max(row.bytes, 1) - 1)}`,
        size: row.bytes.toLocaleString(),
      }));
  });

  protected readonly overflowing = computed(() => (this.store.budget()?.overflowBytes ?? 0) > 0);

  protected readonly notes = computed(() => {
    const notes: string[] = [];
    if (this.drivers.plan()?.fromEmbeddedTable === false) {
      notes.push(
        'This driver has no song table of its own, so nothing is set aside for global songs — ' +
          'a real install will have less room than shown. Load your own main.bin for exact figures.',
      );
    }
    if (this.overflowing()) {
      notes.push('This will not fit in ARAM. Reduce samples, shorten the song, or lower the echo buffer.');
    }
    return notes;
  });
}
