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
    if (!stats || base === null) {
      return [];
    }

    const echoBytes = stats.echoBufferSize << 11;
    const end = base + stats.totalSize;
    const playSeconds =
      stats.introSeconds === null || stats.mainSeconds === null
        ? null
        : stats.introSeconds + stats.mainSeconds;

    const cells: Cell[] = [
      {
        label: $localize`:@@output.stats.total-size:output.stats.total-size`,
        value: stats.totalSize ? `0x${hex4(stats.totalSize)}` : '—',
        dim: !stats.totalSize,
      },
      {
        label: $localize`:@@output.stats.aram-range:output.stats.aram-range`,
        value: stats.totalSize ? `${hex4(base)}–${hex4(end - 1)}` : '—',
        dim: !stats.totalSize,
      },
      {
        label: $localize`:@@output.stats.header:output.stats.header`,
        value: stats.headerSize ? `0x${hex4(stats.headerSize)}` : '—',
        dim: !stats.headerSize,
      },
      {
        label: $localize`:@@output.stats.loop-block:output.stats.loop-block`,
        value: stats.loopDataSize ? `0x${hex4(stats.loopDataSize)}` : '—',
        dim: !stats.loopDataSize,
      },
      {
        label: $localize`:@@output.stats.echo-buffer:output.stats.echo-buffer`,
        value: echoBytes ? `0x${hex4(echoBytes)}` : '0',
        dim: echoBytes === 0,
      },
      // One pass through the song, as AddmusicK itself reports it. Not the ID666
      // header field, which doubles the loop and is not shown here.
      {
        label: $localize`:@@output.stats.length:output.stats.length`,
        value:
          playSeconds === null
            ? $localize`:@@output.stats.unknown:output.stats.unknown`
            : formatTime(playSeconds),
        dim: playSeconds === null,
      },
      {
        label: $localize`:@@output.stats.intro:output.stats.intro`,
        value: stats.hasIntro
          ? $localize`:@@output.stats.yes:output.stats.yes`
          : $localize`:@@output.stats.no:output.stats.no`,
        dim: !stats.hasIntro,
      },
    ];

    // Only show the channels practically in use
    for (let channel = 0; channel < 8; channel++) {
      const size = stats.channelSizes[channel] ?? 0;
      if (size === 0) {
        continue;
      }

      const ticks = stats.channelTicks[channel] ?? 0;
      cells.push({
        label: $localize`:@@output.stats.channel:output.stats.channel ${channel}:channel:`,
        value: `0x${hex4(size)} · ${ticks}t`,
        dim: false,
      });
    }

    return cells;
  });
}
