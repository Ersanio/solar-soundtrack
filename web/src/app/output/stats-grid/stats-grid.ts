import { Component, computed, inject } from '@angular/core';

import { StatTile } from '../../shared/stat-tile/stat-tile';
import { EditorStore } from '../../state/editor-store';
import { formatTime, hex4 } from '../../util/format';

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
    const playSeconds =
      stats.introSeconds === null || stats.mainSeconds === null ? null : stats.introSeconds + stats.mainSeconds;

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
      // One pass through the song, as AddmusicK itself reports it. Not the ID666
      // header field, which doubles the loop and is not shown here.
      {
        label: 'Length',
        value: playSeconds === null ? 'unknown' : formatTime(playSeconds),
        dim: playSeconds === null,
      },
      { label: 'Intro', value: stats.hasIntro ? 'yes' : 'no', dim: !stats.hasIntro },
    ];

    // A channel with no data gets no tile at all — eight permanent placeholders
    // said nothing, and the grid reflows as channels come into use.
    for (let channel = 0; channel < 8; channel++) {
      const size = stats.channelSizes[channel] ?? 0;
      if (size === 0) continue;
      const ticks = stats.channelTicks[channel] ?? 0;
      cells.push({
        label: `Channel ${channel}`,
        value: `0x${hex4(size)} · ${ticks}t`,
        dim: false,
      });
    }

    return cells;
  });
}
