import { Component, computed, inject } from '@angular/core';

import { EditorRequests } from '../state/editor-requests';
import { type StatusKind, EditorStore } from '../state/editor-store';

/**
 * The dot per status, spelled out in full: Tailwind finds classes by scanning
 * source text, so a built-up name generates no CSS. `busy` pulses, being the
 * one kind that is about to change on its own.
 */
const DOT: Record<StatusKind, string> = {
  ok: 'size-2 shrink-0 rounded-full bg-good',
  info: 'size-2 shrink-0 rounded-full bg-ink-muted',
  error: 'size-2 shrink-0 rounded-full bg-danger',
  busy: 'size-2 shrink-0 rounded-full bg-ink-muted animate-pulse',
};

const TEXT: Record<StatusKind, string> = {
  ok: 'text-good',
  info: 'text-ink-muted',
  error: 'text-danger',
  busy: 'text-ink-muted',
};

/**
 * The one-row footer: FL's hint bar.
 *
 * It holds the compile status, the problem count, the free ARAM, the note
 * count and the credits — five things that are each a line long and belong to
 * the whole song rather than to either pane, so they sit at the same height on
 * every screen and no pane has to keep a header for them. The status, the
 * counts and the free space are what a porter glances at between keystrokes;
 * the problem count and the space are buttons because the answer to "what
 * problems?" and "what is using it?" is a section of the output pane.
 */
@Component({
  selector: 'amk-status-bar',
  templateUrl: './status-bar.html',
  host: {
    class: 'border-edge bg-raised flex h-6 shrink-0 items-center gap-3 border-t px-3 text-xs',
  },
})
export class StatusBar {
  protected readonly store = inject(EditorStore);
  protected readonly requests = inject(EditorRequests);

  protected readonly dotClass = computed(() => DOT[this.store.status().kind]);
  protected readonly textClass = computed(() => TEXT[this.store.status().kind]);

  protected readonly problemsLabel = computed(() => {
    const count = this.store.diagnostics().length;

    if (count === 0) {
      return 'No problems';
    }

    return count === 1 ? '1 problem' : `${count} problems`;
  });

  /** The worst severity in the list decides the colour; `info` alone earns none. */
  protected readonly problemsClass = computed(() => {
    const diagnostics = this.store.diagnostics();

    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      return 'text-danger';
    }

    if (
      diagnostics.some(
        (diagnostic) => diagnostic.severity === 'warning' || diagnostic.severity === 'severe',
      )
    ) {
      return 'text-warn';
    }

    return 'text-ink-muted';
  });

  /** The walk's note count: a fact about the song, so it is here whatever view is showing. */
  protected readonly notesLabel = computed(() => {
    const song = this.store.timeline();
    return song ? `${song.notes.length.toLocaleString()} notes` : null;
  });

  /** Red once the song no longer fits, which is the one reading that changes what a porter does next. */
  protected readonly aramClass = computed(() =>
    (this.store.budget()?.overflowBytes ?? 0) > 0 ? 'text-danger' : 'text-ink-muted',
  );
}
