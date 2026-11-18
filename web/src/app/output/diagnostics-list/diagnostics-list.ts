/** The Problems list: each diagnostic, a click that reveals its span in the source, and the fix or suppression beside it. */

import { Component, computed, inject, signal, viewChild } from '@angular/core';

import type { Diagnostic, Severity } from '@amk/core/types';
import { Button } from '../../shared/button/button';
import { Modal } from '../../shared/modal/modal';
import { EditorRequests } from '../../state/editor-requests';
import { EditorStore } from '../../state/editor-store';
import { SampleStore } from '../../state/sample-store';
import { Suppressions } from '../../state/suppressions';
import { FixDiff } from './fix-diff/fix-diff';
import { applied } from './fixes/fix-diff';
import { type Fix, type FixContext, fixesFor } from './fixes/fixes';

interface Row {
  readonly diagnostic: Diagnostic;
  readonly fixes: readonly Fix[];
  /** Anything but an error, which has to be dealt with rather than hidden. */
  readonly suppressible: boolean;
}

@Component({
  selector: 'amk-diagnostics-list',
  imports: [Button, FixDiff, Modal],
  templateUrl: './diagnostics-list.html',
})
export class DiagnosticsList {
  protected readonly store = inject(EditorStore);
  protected readonly requests = inject(EditorRequests);
  private readonly library = inject(SampleStore);
  private readonly suppressions = inject(Suppressions);

  protected readonly text = {
    stale: $localize`:@@output.fix.stale:output.fix.stale`,
  };

  private readonly dialog = viewChild.required<Modal>('fixDialog');

  /** The severity chip; complete literals, as Tailwind needs. */
  protected readonly severityClass: Record<Severity, string> = {
    error: 'rounded-md bg-danger/15 px-1.5 text-danger',
    severe: 'rounded-md bg-severe/15 px-1.5 text-severe',
    warning: 'rounded-md bg-warn/15 px-1.5 text-warn',
    info: 'rounded-md bg-ink-muted/15 px-1.5 text-ink-muted',
  };

  /** What a fix is computed from: the live scan, and the compile with the text it indexes. */
  private readonly context = computed<FixContext>(() => {
    const result = this.store.result();
    const text = this.store.compiledText();
    const index = this.store.compiledTokens();
    return {
      live: { text: this.store.source(), index: this.store.tokens() },
      compiled:
        result && text !== null && index !== null
          ? { text, index, result, timeline: this.store.timeline() }
          : null,
      sampleNames: this.library.names(),
      sampleGroups: this.library.groups(),
    };
  });

  protected readonly rows = computed<Row[]>(() => {
    const context = this.context();
    return this.store.diagnostics().map((diagnostic) => ({
      diagnostic,
      fixes: safeFixes(diagnostic, context),
      suppressible: diagnostic.severity !== 'error',
    }));
  });

  /**
   * The fix the dialog is asking about, and the errors its text would compile with that the song
   * does not have now — which hold Apply back.
   */
  protected readonly pending = signal<{
    diagnostic: Diagnostic;
    fix: Fix;
    breaks: readonly Diagnostic[];
  } | null>(null);

  protected readonly blocked = computed(() => (this.pending()?.breaks.length ?? 0) > 0);

  protected readonly heading = computed(() => {
    const code = this.pending()?.diagnostic.code ?? '';
    return $localize`:@@output.fix.heading:output.fix.heading ${code}:code:`;
  });

  protected reveal(diagnostic: Diagnostic): void {
    // A fresh object each time, so clicking the same diagnostic twice re-selects.
    this.requests.reveal.set({ span: { ...diagnostic.span }, show: true });
  }

  protected suppress(diagnostic: Diagnostic): void {
    this.suppressions.suppress(diagnostic.code);
  }

  /**
   * Opens the dialog on a fix. One built while typing was ahead of the compile is built again
   * against the compile it forces, so what the dialog shows is what Apply writes.
   */
  protected openFix(diagnostic: Diagnostic, fix: Fix): void {
    let shown: { diagnostic: Diagnostic; fix: Fix } | null = { diagnostic, fix };
    if (fix.against !== this.store.source()) {
      this.store.compileNow();
      const again = this.rows().find(
        (row) =>
          row.diagnostic.code === diagnostic.code && row.diagnostic.message === diagnostic.message,
      );
      const rebuilt = again?.fixes.find((each) => each.id === fix.id);
      shown = again && rebuilt ? { diagnostic: again.diagnostic, fix: rebuilt } : null;
    }

    if (shown?.fix.against !== this.store.source()) {
      this.store.say(this.text.stale);
      return;
    }

    this.pending.set({ ...shown, breaks: this.breaks(shown.fix) });
    this.dialog().open();
  }

  /**
   * The errors the fixed text compiles with that the song does not have now. Each fix is pinned
   * in `fixtest`; this is what stops one meeting a song no case there foresaw.
   */
  private breaks(fix: Fix): readonly Diagnostic[] {
    const fixed = this.store.compileText(applied(fix.against, fix.edits));
    const had = new Set(
      (this.store.result()?.diagnostics ?? [])
        .filter((diagnostic) => diagnostic.severity === 'error')
        .map((diagnostic) => diagnostic.code),
    );
    return (fixed?.result.diagnostics ?? []).filter(
      (diagnostic) => diagnostic.severity === 'error' && !had.has(diagnostic.code),
    );
  }

  /** One undo step, with the source brought forward on the change so Ctrl+Z reaches it. */
  protected apply(): void {
    const pending = this.pending();
    this.dialog().close();
    this.pending.set(null);
    if (pending === null) {
      return;
    }

    const { fix } = pending;
    if (pending.breaks.length > 0) {
      return;
    }

    if (fix.against !== this.store.source()) {
      this.store.say(this.text.stale);
      return;
    }

    const [first] = fix.edits;
    const select = first && {
      anchor: first.span.start,
      head: first.span.start + first.text.length,
    };
    this.requests.applyAll(fix.edits, select ?? null, false, true);
  }
}

/** A fix that cannot be built is no fix, rather than a Problems list that will not draw. */
function safeFixes(diagnostic: Diagnostic, context: FixContext): readonly Fix[] {
  try {
    return fixesFor(diagnostic, context);
  } catch (error) {
    console.error(`No fix for ${diagnostic.code}:`, error);
    return [];
  }
}
