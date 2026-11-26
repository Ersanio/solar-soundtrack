/** The Build section's per-channel tiles: each used channel's data size and length in ticks. */

import { Component, computed, inject } from '@angular/core';

import { StatTile } from '../../shared/stat-tile/stat-tile';
import { EditorStore } from '../../state/editor-store';
import { CHANNELS } from '../../state/transport-view';
import { hex4 } from '../../util/format';

interface Cell {
  label: string;
  value: string;
}

@Component({
  selector: 'amk-channel-stats',
  imports: [StatTile],
  templateUrl: './channel-stats.html',
})
export class ChannelStats {
  private readonly store = inject(EditorStore);

  protected readonly cells = computed<Cell[]>(() => {
    const stats = this.store.result()?.stats;
    if (!stats) {
      return [];
    }

    const cells: Cell[] = [];
    for (let channel = 0; channel < CHANNELS; channel++) {
      const size = stats.channelSizes[channel] ?? 0;
      if (size === 0) {
        continue;
      }

      const ticks = stats.channelTicks[channel] ?? 0;
      cells.push({
        label: $localize`:@@output.build.channel:output.build.channel ${channel}:channel:`,
        value: `0x${hex4(size)} · ${ticks}t`,
      });
    }

    return cells;
  });
}
