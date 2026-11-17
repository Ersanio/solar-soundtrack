/** The banner offering back a song the editor froze on, which the next load set aside instead of parsing. */

import { Component, inject } from '@angular/core';

import { EditorRequests } from '../state/editor-requests';
import { EditorStore } from '../state/editor-store';
import { Button } from '../shared/button/button';
import { downloadBlob } from '../util/format';

@Component({
  selector: 'amk-held-song-banner',
  imports: [Button],
  templateUrl: './held-song-banner.html',
})
export class HeldSongBanner {
  private readonly store = inject(EditorStore);
  private readonly requests = inject(EditorRequests);

  protected readonly held = this.store.held;

  /** Replaces the whole document, one undo step back to what was open. */
  protected open(): void {
    const text = this.held();
    if (text === null) {
      return;
    }

    const current = this.store.source();
    this.requests.applyAll([
      { span: { start: 0, end: current.length, line: 1 }, text, expect: current },
    ]);
    this.store.dropHeld();
  }

  protected download(): void {
    const text = this.held();
    if (text !== null) {
      downloadBlob('song.txt', new TextEncoder().encode(text));
    }
  }

  protected discard(): void {
    this.store.dropHeld();
  }
}
