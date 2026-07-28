import { Component, inject } from '@angular/core';

import type { Diagnostic, Severity } from '@core/types';
import { EditorStore } from '../../state/editor-store';

@Component({
  selector: 'amk-diagnostics-list',
  templateUrl: './diagnostics-list.html',
})
export class DiagnosticsList {
  protected readonly store = inject(EditorStore);

  /** Severity carries a text badge too, so it is never colour alone. */
  protected readonly severityClass: Record<Severity, string> = {
    error: 'text-danger',
    warning: 'text-warn',
    info: 'text-ink-muted',
  };

  protected reveal(diagnostic: Diagnostic): void {
    // A fresh object each time, so clicking the same diagnostic twice re-selects.
    this.store.reveal.set({ ...diagnostic.span });
  }
}
