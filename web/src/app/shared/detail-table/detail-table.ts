import { Component, input } from '@angular/core';

/** One "what this argument means" line. */
export interface DetailRow {
  label: string;
  value: string;
  /** A sentence under the value, in prose rather than mono. Optional. */
  note?: string;
}

/**
 * The label/value/note table every command inspector reads out into.
 *
 * There were four copies of this markup — the letter, ADSR, echo and instrument
 * inspectors — each with its own inline `{ label, value, note? }` type. They are
 * read side by side as the caret moves between commands, so any drift between
 * them shows up immediately as the panel changing shape; one component is what
 * keeps that from happening.
 */
@Component({
  selector: 'amk-detail-table',
  host: { class: 'block' },
  template: `
    <table class="w-full border-collapse text-xs">
      <tbody>
        @for (row of rows(); track row.label) {
          <tr class="border-edge/60 border-t first:border-t-0">
            <td class="text-ink-muted py-1 pr-3 whitespace-nowrap">{{ row.label }}</td>
            <td class="py-1 font-mono tabular-nums">
              {{ row.value }}
              @if (row.note) {
                <span class="text-ink-muted block font-sans text-[11px]">{{ row.note }}</span>
              }
            </td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class DetailTable {
  readonly rows = input.required<readonly DetailRow[]>();
}
