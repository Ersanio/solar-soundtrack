import { Component, inject } from '@angular/core';

import type { Diagnostic, Severity } from '@amk/core/types';
import { EditorRequests } from '../../state/editor-requests';
import { EditorStore } from '../../state/editor-store';

@Component({
  selector: 'amk-diagnostics-list',
  templateUrl: './diagnostics-list.html',
})
export class DiagnosticsList {
  protected readonly store = inject(EditorStore);
  protected readonly requests = inject(EditorRequests);

  /** The severity chip; complete literals, as Tailwind needs. */
  protected readonly severityClass: Record<Severity, string> = {
    error: 'rounded-md bg-danger/15 px-1.5 text-danger',
    severe: 'rounded-md bg-severe/15 px-1.5 text-severe',
    warning: 'rounded-md bg-warn/15 px-1.5 text-warn',
    info: 'rounded-md bg-ink-muted/15 px-1.5 text-ink-muted',
  };

  protected reveal(diagnostic: Diagnostic): void {
    // A fresh object each time, so clicking the same diagnostic twice re-selects.
    this.requests.reveal.set({ span: { ...diagnostic.span }, show: true });
  }
}
