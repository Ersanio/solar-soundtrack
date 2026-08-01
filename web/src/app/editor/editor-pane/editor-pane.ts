import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';

import { Panel } from '../../shared/panel/panel';
import { type TabDef, Tabs } from '../../shared/tabs/tabs';
import { EditorStore } from '../../state/editor-store';
import { ChannelMixer } from '../channel-mixer/channel-mixer';
import { SampleBrowser } from '../sample-browser/sample-browser';

/**
 * The MML source editor and the sample library, as two tabs.
 *
 * They share this pane rather than taking a column of their own so that the
 * ARAM budget stays visible on the right while samples are being added — the
 * moment a sample set stops fitting is the moment you want to see it.
 *
 * The source view is still a plain `<textarea>`, as the prototype was;
 * CodeMirror and syntax highlighting are a later milestone, and everything is
 * arranged so that swap only has to touch this component.
 */
@Component({
  selector: 'amk-editor-pane',
  imports: [Panel, Tabs, ChannelMixer, SampleBrowser],
  templateUrl: './editor-pane.html',
  host: { class: 'flex min-h-0 min-w-0 flex-col' },
})
export class EditorPane {
  protected readonly store = inject(EditorStore);

  protected readonly TABS: readonly TabDef[] = [
    { id: 'source', label: 'Source' },
    { id: 'samples', label: 'Samples' },
  ];
  protected readonly tab = signal('source');

  /**
   * Optional, not required: the textarea only exists while the Source tab is
   * showing, and `viewChild.required` throws when it is not.
   */
  private readonly area = viewChild<ElementRef<HTMLTextAreaElement>>('area');

  constructor() {
    // Sanctioned effect: driving an imperative DOM API (selection) from state.
    //
    // Depends on `area()` as well as `reveal()` so that revealing a span while
    // the Samples tab is open works: switching the tab renders the textarea,
    // which populates the view child, which re-runs this and does the focus.
    effect(() => {
      const span = this.store.reveal();
      if (!span) return;

      if (this.tab() !== 'source') {
        this.tab.set('source');
        return;
      }

      const element = this.area()?.nativeElement;
      if (!element) return;

      element.focus();
      element.setSelectionRange(span.start, Math.max(span.end, span.start + 1));
      this.store.caret.set(span.start);
    });
  }

  protected onInput(event: Event): void {
    const element = event.target as HTMLTextAreaElement;
    this.store.edit(element.value);
    this.store.caret.set(element.selectionStart);
  }

  protected syncCaret(event: Event): void {
    this.store.caret.set((event.target as HTMLTextAreaElement).selectionStart);
  }

  protected onKeydown(event: KeyboardEvent): void {
    // Ctrl/Cmd+Enter compiles; Tab inserts a tab instead of moving focus.
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      this.store.compileNow();
      return;
    }

    if (event.key !== 'Tab' || event.shiftKey) return;
    event.preventDefault();

    const element = event.target as HTMLTextAreaElement;
    const { selectionStart, selectionEnd, value } = element;
    const next = `${value.slice(0, selectionStart)}\t${value.slice(selectionEnd)}`;
    element.value = next;
    element.selectionStart = element.selectionEnd = selectionStart + 1;
    this.store.edit(next);
    this.store.caret.set(selectionStart + 1);
  }
}
