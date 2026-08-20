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

  protected readonly severityClass: Record<Severity, string> = {
    error: 'text-danger',
    severe: 'text-severe',
    warning: 'text-warn',
    info: 'text-ink-muted',
  };

  protected reveal(diagnostic: Diagnostic): void {
    // A fresh object each time, so clicking the same diagnostic twice re-selects.
    this.requests.reveal.set({ span: { ...diagnostic.span }, show: true });
  }
}
