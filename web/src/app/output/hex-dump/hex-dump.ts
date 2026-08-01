import { Component, computed, inject } from '@angular/core';

import { EditorStore } from '../../state/editor-store';
import { hex2, hex4 } from '../../util/format';

/** Rows are cut into two runs, because the header is always a prefix. */
interface DumpRow {
  address: string;
  /** Bytes belonging to the pointer table / instrument block, tinted. */
  header: string;
  rest: string;
}

const MAX_ROWS = 512;

@Component({
  selector: 'amk-hex-dump',
  templateUrl: './hex-dump.html',
})
export class HexDump {
  private readonly store = inject(EditorStore);

  protected readonly range = computed(() => {
    const data = this.store.result()?.data;
    const base = this.store.aramAddress();
    if (!data || base === null) return '';
    return `0x${hex4(base)}–0x${hex4(base + data.length - 1)}`;
  });

  protected readonly rows = computed<DumpRow[]>(() => {
    const result = this.store.result();
    const base = this.store.aramAddress();
    const data = result?.data;
    if (!data || base === null) return [];

    const headerSize = result?.stats?.headerSize ?? 0;
    const total = Math.min(Math.ceil(data.length / 16), MAX_ROWS);
    const rows: DumpRow[] = [];

    for (let row = 0; row < total; row++) {
      const offset = row * 16;
      let header = '';
      let rest = '';

      for (let column = 0; column < 16; column++) {
        const index = offset + column;
        if (index >= data.length) {
          rest += '   ';
        } else if (index < headerSize) {
          header += `${hex2(data[index])} `;
        } else {
          rest += `${hex2(data[index])} `;
        }
      }

      rows.push({ address: hex4(base + offset), header, rest });
    }

    return rows;
  });

  protected readonly truncated = computed(() => {
    const length = this.store.result()?.data?.length ?? 0;
    const shown = this.rows().length * 16;
    return length > shown ? length - shown : 0;
  });
}
