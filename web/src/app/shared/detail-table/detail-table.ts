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
  templateUrl: './detail-table.html',
  host: { class: 'block' },
})
export class DetailTable {
  readonly rows = input.required<readonly DetailRow[]>();
}
