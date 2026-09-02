import { Component, computed, inject } from '@angular/core';

import { IconRedo } from '../../shared/icons/icon-redo';
import { IconUndo } from '../../shared/icons/icon-undo';
import { EditorRequests } from '../../state/editor-requests';

/** The keys `historyKeymap` binds on this platform, for the buttons' titles. */
const HISTORY_KEYS = /Mac|iP/.test(navigator.platform)
  ? { undo: '⌘Z', redo: '⇧⌘Z' }
  : { undo: 'Ctrl+Z', redo: 'Ctrl+Y' };

/**
 * Undo and redo, for the two toolbars that need them.
 *
 * One component with `display: contents` — so the pair is a direct flex child
 * of whichever `<amk-toolbar>` hosts it — because
 * the piano roll writes MML now and an edit made there has to be undoable
 * without going to the Source tab to do it.
 *
 * There is one history in the app and it is CodeMirror's, so a roll gesture and
 * a keystroke sit on the same stack and `Ctrl+Z` walks back through both in the
 * order they happened. The view owns it and nothing else may touch it, so this
 * asks through `EditorRequests` exactly as a splice does.
 */
@Component({
  selector: 'amk-history-buttons',
  imports: [IconUndo, IconRedo],
  templateUrl: './history-buttons.html',
  host: { class: 'contents' },
})
export class HistoryButtons {
  private readonly requests = inject(EditorRequests);

  protected readonly historyKeys = HISTORY_KEYS;
  protected readonly canUndo = computed(() => this.requests.undoDepth() > 0);
  protected readonly canRedo = computed(() => this.requests.redoDepth() > 0);

  protected undo(): void {
    this.requests.history.set('undo');
  }

  protected redo(): void {
    this.requests.history.set('redo');
  }
}
