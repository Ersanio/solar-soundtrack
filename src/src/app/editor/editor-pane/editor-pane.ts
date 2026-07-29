import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';

import { Panel } from '../../shared/panel/panel';
import { EditorStore } from '../../state/editor-store';
import { ChannelMixer } from '../channel-mixer/channel-mixer';

/**
 * The MML source editor.
 *
 * Still a plain `<textarea>`, as the prototype was — CodeMirror and syntax
 * highlighting are a later milestone. Everything is arranged so that swap only
 * has to touch this component.
 */
@Component({
  selector: 'amk-editor-pane',
  imports: [Panel, ChannelMixer],
  templateUrl: './editor-pane.html',
  host: { class: 'flex min-h-0 min-w-0 flex-col' },
})
export class EditorPane {
  protected readonly store = inject(EditorStore);
  private readonly area = viewChild.required<ElementRef<HTMLTextAreaElement>>('area');

  constructor() {
    // Sanctioned effect: driving an imperative DOM API (selection) from state.
    effect(() => {
      const span = this.store.reveal();
      if (!span) return;
      const element = this.area().nativeElement;
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
