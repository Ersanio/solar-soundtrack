import {
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

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

    // Sanctioned effect: the same imperative-DOM job as `reveal` above, for a
    // panel that changes text rather than selecting it.
    //
    // The splice is applied here rather than through `store.edit` alone
    // because a one-way `[value]` binding rewrites the whole textarea, which
    // drops the caret to the end. The Tab handler below has the same problem
    // and solves it the same way.
    effect(() => {
      const edit = this.store.replace();
      if (!edit) return;

      const element = this.area()?.nativeElement;
      if (!element) return;

      untracked(() => {
        // Consumed on the spot. A splice describes one moment in one document,
        // so leaving it set would let any later re-run of this effect — a tab
        // switch, say — apply it a second time to text it no longer fits.
        this.store.replace.set(null);

        const { span, text } = edit;
        const next = `${element.value.slice(0, span.start)}${text}${element.value.slice(span.end)}`;
        element.value = next;

        // The caret stays where it was unless the edit moved the ground under
        // it, so dragging a slider does not drag the caret out of the command
        // being edited — which would swap the panel out mid-gesture. Read
        // untracked, or moving the caret would itself re-trigger this effect.
        const caret = Math.min(this.store.caret(), span.start + text.length);
        element.selectionStart = element.selectionEnd = Math.max(caret, span.start);

        this.store.edit(next);
        this.store.caret.set(element.selectionStart);
      });
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
