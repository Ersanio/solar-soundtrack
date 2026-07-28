import { Component, computed, inject } from '@angular/core';

import { StatTile } from '../../shared/stat-tile/stat-tile';
import { EditorStore } from '../../state/editor-store';
import { hex4 } from '../../util/format';

interface Cell {
  label: string;
  value: string;
  dim: boolean;
}

@Component({
  selector: 'amk-stats-grid',
  imports: [StatTile],
  templateUrl: './stats-grid.html',
})
export class StatsGrid {
  private readonly store = inject(EditorStore);

  protected readonly cells = computed<Cell[]>(() => {
    const stats = this.store.result()?.stats;
    const base = this.store.aramAddress();
    if (!stats || base === null) return [];

    const echoBytes = stats.echoBufferSize << 11;
    const end = base + stats.totalSize;

    const cells: Cell[] = [
      { label: 'Total size', value: stats.totalSize ? `0x${hex4(stats.totalSize)}` : '—', dim: !stats.totalSize },
      {
        label: 'ARAM range',
        value: stats.totalSize ? `${hex4(base)}–${hex4(end - 1)}` : '—',
        dim: !stats.totalSize,
      },
      { label: 'Header', value: stats.headerSize ? `0x${hex4(stats.headerSize)}` : '—', dim: !stats.headerSize },
      {
        label: 'Loop block',
        value: stats.loopDataSize ? `0x${hex4(stats.loopDataSize)}` : '—',
        dim: !stats.loopDataSize,
      },
      { label: 'Echo buffer', value: echoBytes ? `0x${hex4(echoBytes)}` : '0', dim: echoBytes === 0 },
      {
        label: 'Length',
        value: stats.seconds === null ? 'unknown' : `${stats.seconds}s`,
        dim: stats.seconds === null,
      },
      { label: 'Intro', value: stats.hasIntro ? 'yes' : 'no', dim: !stats.hasIntro },
      { label: 'Loops', value: stats.loops ? 'yes' : 'no', dim: !stats.loops },
    ];

    for (let channel = 0; channel < 8; channel++) {
      const size = stats.channelSizes[channel] ?? 0;
      const ticks = stats.channelTicks[channel] ?? 0;
      cells.push({
        label: `Channel ${channel}`,
        value: size ? `0x${hex4(size)} · ${ticks}t` : '—',
        dim: size === 0,
      });
    }

    return cells;
  });
}
