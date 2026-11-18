import { Component, computed, inject, signal, viewChild } from '@angular/core';

import type { Severity } from '@amk/core/types';
import { Button } from '../../../shared/button/button';
import { IconSuppress } from '../../../shared/icons/icon-suppress';
import { Modal } from '../../../shared/modal/modal';
import { EditorRequests } from '../../../state/editor-requests';
import { SUPPRESSIBLE } from '../../../state/suppressible';
import { Suppressions } from '../../../state/suppressions';
import { onChange } from '../../../util/on-change';

/** The chip a code is drawn in; complete literals, as Tailwind needs. */
const SEVERITY_CLASS: Record<Severity, string> = {
  error: 'rounded-md bg-danger/15 px-1.5 text-danger',
  severe: 'rounded-md bg-severe/15 px-1.5 text-severe',
  warning: 'rounded-md bg-warn/15 px-1.5 text-warn',
  info: 'rounded-md bg-ink-muted/15 px-1.5 text-ink-muted',
};

/** How much of a description a picker option shows. */
const OPTION_LENGTH = 72;

/** The top bar's list of suppressed warnings: a button, and the dialog it opens to edit the list. */
@Component({
  selector: 'amk-suppressions-button',
  imports: [Button, IconSuppress, Modal],
  templateUrl: './suppressions-button.html',
  host: { class: 'contents' },
})
export class SuppressionsButton {
  protected readonly suppressions = inject(Suppressions);
  private readonly requests = inject(EditorRequests);

  protected readonly text = {
    heading: $localize`:@@topbar.suppressed.heading:topbar.suppressed.heading`,
    title: $localize`:@@topbar.suppressed.title:topbar.suppressed.title`,
  };

  private readonly dialog = viewChild.required<Modal>('dialog');

  /** The code the picker has selected, `''` for none. */
  protected readonly picked = signal('');

  /** Each suppressed code, with what it says where the table knows it. */
  protected readonly rows = computed(() =>
    [...this.suppressions.codes()].sort().map((code) => {
      const known = SUPPRESSIBLE.find((entry) => entry.code === code);
      return {
        code,
        chip: SEVERITY_CLASS[known?.severity ?? 'warning'],
        lines: known?.describe() ?? [],
      };
    }),
  );

  /** The codes that could still be suppressed, as the picker lists them. */
  protected readonly options = computed(() => {
    const codes = this.suppressions.codes();
    return SUPPRESSIBLE.filter((entry) => !codes.has(entry.code)).map((entry) => {
      const [line = ''] = entry.describe();
      const short = line.length > OPTION_LENGTH ? `${line.slice(0, OPTION_LENGTH - 1)}…` : line;
      return { code: entry.code, label: `${entry.code} — ${short}` };
    });
  });

  constructor() {
    // The Problems list's count asks for the same list, which matters below 67rem, where the
    // button is hidden and this dialog is the only way to it.
    onChange(this.requests.suppressedListOpens, () => this.open());
  }

  protected open(): void {
    this.picked.set('');
    this.dialog().open();
  }

  protected pick(event: Event): void {
    this.picked.set((event.target as HTMLSelectElement).value);
  }

  protected add(): void {
    const code = this.picked();
    if (code !== '') {
      this.suppressions.suppress(code);
      this.picked.set('');
    }
  }
}
