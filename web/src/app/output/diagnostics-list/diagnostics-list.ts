/** The Problems list: each diagnostic, a click that reveals its span in the source, and the suppression beside it. */

import { Component, computed, inject } from '@angular/core';

import type { Diagnostic, Severity } from '@amk/core/types';
import { Button } from '../../shared/button/button';
import { EditorRequests } from '../../state/editor-requests';
import { EditorStore } from '../../state/editor-store';
import { Suppressions } from '../../state/suppressions';

interface Row {
  readonly diagnostic: Diagnostic;
  /** Anything but an error, which has to be dealt with rather than hidden. */
  readonly suppressible: boolean;
}

@Component({
  selector: 'amk-diagnostics-list',
  imports: [Button],
  templateUrl: './diagnostics-list.html',
})
export class DiagnosticsList {
  protected readonly store = inject(EditorStore);
  protected readonly requests = inject(EditorRequests);
  private readonly suppressions = inject(Suppressions);

  /** The severity chip; complete literals, as Tailwind needs. */
  protected readonly severityClass: Record<Severity, string> = {
    error: 'rounded-md bg-danger/15 px-1.5 text-danger',
    severe: 'rounded-md bg-severe/15 px-1.5 text-severe',
    warning: 'rounded-md bg-warn/15 px-1.5 text-warn',
    info: 'rounded-md bg-ink-muted/15 px-1.5 text-ink-muted',
  };

  protected readonly rows = computed<Row[]>(() =>
    this.store.diagnostics().map((diagnostic) => ({
      diagnostic,
      suppressible: diagnostic.severity !== 'error',
    })),
  );

  protected reveal(diagnostic: Diagnostic): void {
    // A fresh object each time, so clicking the same diagnostic twice re-selects.
    this.requests.reveal.set({ span: { ...diagnostic.span }, show: true });
  }

  protected suppress(diagnostic: Diagnostic): void {
    this.suppressions.suppress(diagnostic.code);
  }
}
