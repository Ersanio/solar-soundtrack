import { Component, inject } from '@angular/core';

import type { Diagnostic, Severity } from '@amk/core/types';
import { EditorStore } from '../../state/editor-store';

@Component({
  selector: 'amk-diagnostics-list',
  templateUrl: './diagnostics-list.html',
})
export class DiagnosticsList {
  protected readonly store = inject(EditorStore);

  /**
   * Severity is spelled out beside the code as well, so it is never colour alone.
   *
   * Three of the four are warm and now sit close together — red, orange, yellow — which is exactly
   * the pairing that goes flat under the common colour vision deficiencies. The word carries it;
   * the colour only makes it quicker to scan.
   */
  protected readonly severityClass: Record<Severity, string> = {
    error: 'text-danger',
    severe: 'text-severe',
    warning: 'text-warn',
    info: 'text-ink-muted',
  };

  protected reveal(diagnostic: Diagnostic): void {
    // A fresh object each time, so clicking the same diagnostic twice re-selects.
    this.store.reveal.set({ ...diagnostic.span });
  }
}
