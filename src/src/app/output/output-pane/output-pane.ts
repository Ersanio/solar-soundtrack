import { Component, computed, inject } from '@angular/core';

import { Panel } from '../../shared/panel/panel';
import { DriverStore } from '../../state/driver-store';
import { type StatusKind, EditorStore } from '../../state/editor-store';
import { AramBudget } from '../aram-budget/aram-budget';
import { DiagnosticsList } from '../diagnostics-list/diagnostics-list';
import { HexDump } from '../hex-dump/hex-dump';
import { StatsGrid } from '../stats-grid/stats-grid';

@Component({
  selector: 'amk-output-pane',
  imports: [Panel, AramBudget, DiagnosticsList, HexDump, StatsGrid],
  templateUrl: './output-pane.html',
  host: { class: 'flex min-h-0 min-w-0 flex-col' },
})
export class OutputPane {
  protected readonly store = inject(EditorStore);
  protected readonly drivers = inject(DriverStore);

  private readonly statusClass: Record<StatusKind, string> = {
    ok: 'text-good',
    error: 'text-danger',
    busy: 'text-ink-muted',
  };

  protected readonly statusColor = computed(() => this.statusClass[this.store.status().kind]);

  /**
   * Without a driver there is no load address, so there is nothing meaningful to
   * compile against — the panel says so instead of showing stale or invented
   * numbers.
   */
  protected readonly blocked = computed(() => !this.drivers.ready());
}
