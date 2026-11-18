import { Component, computed, input } from '@angular/core';

import type { Edit } from '@amk/tokens/edits';
import { type DiffRow, diffRows } from '../fixes/fix-diff';

/** A row as the template draws it: both line numbers, the gutter mark, and its text in parts. */
interface RowView {
  readonly kind: DiffRow['kind'];
  readonly old: string;
  readonly new: string;
  readonly mark: string;
  readonly parts: readonly { text: string; class: string }[];
  /** How many lines a `skipped` row stands for. */
  readonly count: number;
}

/** The gutter's mark, so a line's kind is never said by colour alone. */
const MARKS: Record<DiffRow['kind'], string> = {
  context: ' ',
  removed: '−',
  added: '+',
  changed: '~',
  skipped: '',
};

/** A fix's change to the song, as a diff trimmed to the lines it touches. */
@Component({
  selector: 'amk-fix-diff',
  templateUrl: './fix-diff.html',
  host: { class: 'block' },
})
export class FixDiff {
  /** The text the edits apply to. */
  readonly source = input.required<string>();
  readonly edits = input.required<readonly Edit[]>();

  /** Each kind's row, complete literals as Tailwind needs. */
  protected readonly rowClass: Record<DiffRow['kind'], string> = {
    context: 'text-ink-muted',
    removed: 'bg-diff-remove/15 text-ink',
    added: 'bg-diff-add/15 text-ink',
    changed: 'bg-diff-change/15 text-ink',
    skipped: 'text-ink-muted italic',
  };

  protected readonly markClass: Record<DiffRow['kind'], string> = {
    context: '',
    removed: 'text-diff-remove',
    added: 'text-diff-add',
    changed: 'text-diff-change',
    skipped: '',
  };

  protected readonly rows = computed<RowView[]>(() =>
    diffRows(this.source(), this.edits()).map((row): RowView => {
      const base = { kind: row.kind, mark: MARKS[row.kind], count: 0 };
      switch (row.kind) {
        case 'context':
          return { ...base, old: `${row.old}`, new: `${row.new}`, parts: plain(row.text) };
        case 'removed':
          return { ...base, old: `${row.old}`, new: '', parts: plain(row.text) };
        case 'added':
          return { ...base, old: '', new: `${row.new}`, parts: plain(row.text) };
        case 'changed':
          return {
            ...base,
            old: `${row.old}`,
            new: `${row.new}`,
            parts: row.parts.map((part) => ({
              text: part.text,
              class:
                part.kind === 'removed'
                  ? 'text-diff-remove line-through'
                  : part.kind === 'added'
                    ? 'text-diff-add font-semibold underline'
                    : '',
            })),
          };
        case 'skipped':
          return { ...base, old: '', new: '', parts: [], count: row.count };
      }
    }),
  );
}

function plain(text: string): { text: string; class: string }[] {
  return [{ text, class: '' }];
}
