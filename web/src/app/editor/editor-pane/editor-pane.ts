import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  effect,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { defaultKeymap, history, historyKeymap, insertTab } from '@codemirror/commands';
import { setDiagnostics } from '@codemirror/lint';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';

import type { Severity } from '@core/types';
import { IconWrap } from '../../shared/icons/icon-wrap';
import { Panel } from '../../shared/panel/panel';
import { type TabDef, Tabs } from '../../shared/tabs/tabs';
import { EditorStore } from '../../state/editor-store';
import { Playback } from '../../state/playback';
import { ChannelMixer } from '../channel-mixer/channel-mixer';
import { SampleBrowser } from '../sample-browser/sample-browser';
import { commandHover } from '../codemirror/command-hover';
import { mmlLanguage } from '../codemirror/mml-language';
import { mmlTheme } from '../codemirror/mml-theme';
import { playheadField, setPlayhead } from '../codemirror/playhead';

type EditorTab = 'source' | 'samples';

/**
 * CodeMirror's lint severities are a smaller set than ours: `severe` renders
 * as a warning whose squiggle the theme re-tints via `cm-amk-severe`. The
 * diagnostics list still spells every severity out in words, so the colour is
 * never the only channel.
 */
const LINT_SEVERITY: Record<Severity, 'error' | 'warning' | 'info'> = {
  error: 'error',
  severe: 'warning',
  warning: 'warning',
  info: 'info',
};

/**
 * The MML source editor and the sample library, as two tabs.
 *
 * They share this pane rather than taking a column of their own so that the
 * ARAM budget stays visible on the right while samples are being added — the
 * moment a sample set stops fitting is the moment you want to see it.
 *
 * The source view is a CodeMirror `EditorView`, and its document is the text
 * authority: `EditorStore.source` remains the signal everything else reads,
 * but it is written only from the view's update listener. Programmatic changes
 * — `reveal`, `replace` — go *into* the view as transactions and come back out
 * through that listener, so the sync is strictly one-way and there is no
 * store→view mirror to feed back through.
 *
 * The source panel is hidden rather than destroyed while the Samples tab is
 * open, so undo history, scroll position and selection survive the round trip.
 */
@Component({
  selector: 'amk-editor-pane',
  imports: [Panel, Tabs, ChannelMixer, SampleBrowser, IconWrap],
  templateUrl: './editor-pane.html',
  host: { class: 'flex min-h-0 min-w-0 flex-col' },
})
export class EditorPane {
  protected readonly store = inject(EditorStore);
  private readonly playback = inject(Playback);
  private readonly injector = inject(Injector);

  protected readonly TABS: readonly TabDef<EditorTab>[] = [
    { id: 'source', label: 'Source' },
    { id: 'samples', label: 'Samples' },
  ];
  protected readonly tab = signal<EditorTab>('source');

  /**
   * Off by default, matching the editor's prior behaviour. A `Compartment`
   * rather than a plain extension: word wrap has to flip without tearing down
   * the view, which would lose undo history, scroll position and selection.
   */
  protected readonly wordWrap = signal(false);
  private readonly wrapCompartment = new Compartment();

  /** Mirrors the mute/solo toggles' own on/off styling in `channel-mixer.html`. */
  protected readonly wrapButtonClass = computed(
    () =>
      `border-edge cursor-pointer rounded-md border px-1.5 py-1.5 transition-colors ${
        this.wordWrap() ? 'bg-accent/20 text-accent font-semibold' : 'text-ink-muted hover:text-ink'
      }`,
  );

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('editorHost');
  private readonly view: EditorView;

  constructor() {
    // Built detached, so the sanctioned effects below never race its
    // existence; afterNextRender only attaches it.
    this.view = new EditorView({
      state: EditorState.create({
        doc: this.store.source(),
        extensions: [
          keymap.of([
            // Before defaultKeymap, which binds Mod-Enter to insertBlankLine.
            {
              key: 'Mod-Enter',
              run: () => {
                this.store.compileNow();
                return true;
              },
            },
            // Tab inserts; Shift-Tab stays unbound so keyboard focus can
            // escape backwards, exactly as the textarea behaved.
            { key: 'Tab', run: insertTab },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          history(),
          lineNumbers(),
          this.wrapCompartment.of(this.wordWrap() ? EditorView.lineWrapping : []),
          mmlLanguage,
          mmlTheme,
          commandHover(() => this.store.tokens().commands),
          playheadField,
          EditorState.tabSize.of(8),
          EditorView.contentAttributes.of({
            'aria-label': 'MML source',
            spellcheck: 'false',
            autocorrect: 'off',
            autocapitalize: 'off',
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              this.store.edit(update.state.doc.toString());
            }

            if (update.docChanged || update.selectionSet) {
              this.store.caret.set(update.state.selection.main.head);
            }
          }),
        ],
      }),
    });

    afterNextRender(() => {
      this.host().nativeElement.appendChild(this.view.dom);
      this.view.requestMeasure();
    });

    inject(DestroyRef).onDestroy(() => this.view.destroy());

    // Sanctioned effect: driving an imperative view API (selection) from state.
    //
    // The work happens after the next render rather than here: revealing a span
    // while the Samples tab is open first has to make the editor visible, and
    // focusing or measuring a `display: none` view is a no-op. afterNextRender
    // is the render barrier the old viewChild dependency used to provide.
    effect(() => {
      const span = this.store.reveal();
      if (!span) {
        return;
      }

      untracked(() => {
        // Consumed on the spot: a reveal describes one moment, and leaving it
        // set would let a later re-run select it again long after the author
        // has moved on.
        this.store.reveal.set(null);
        this.tab.set('source');
        afterNextRender(() => this.revealSpan(span), { injector: this.injector });
      });
    });

    // Sanctioned effect: the same imperative-view job as `reveal` above, for a
    // panel that changes text rather than selecting it. The dispatch maps the
    // selection through the change, which is the caret preservation the old
    // textarea code did by hand; the update listener then propagates the new
    // document and caret back into the store.
    effect(() => {
      const edit = this.store.replace();
      if (!edit) {
        return;
      }

      untracked(() => {
        // Consumed on the spot: a splice describes one document, and a re-run
        // must never apply it a second time to text it no longer fits.
        this.store.replace.set(null);

        const length = this.view.state.doc.length;
        this.view.dispatch({
          changes: {
            from: Math.min(edit.span.start, length),
            to: Math.min(edit.span.end, length),
            insert: edit.text,
          },
        });
      });
    });

    // Sanctioned effect: mirroring diagnostics into the CodeMirror view.
    //
    // Compiler spans can lag the document by the typing debounce, so every
    // position is clamped; a span the document has since shrunk away from
    // still underlines something sensible rather than throwing.
    effect(() => {
      const diagnostics = this.store.diagnostics();
      untracked(() => {
        const length = this.view.state.doc.length;
        this.view.dispatch(
          setDiagnostics(
            this.view.state,
            diagnostics
              .filter((diagnostic) => diagnostic.span.start <= length)
              .map((diagnostic) => ({
                from: Math.min(diagnostic.span.start, length),
                to: Math.min(Math.max(diagnostic.span.end, diagnostic.span.start + 1), length),
                severity: LINT_SEVERITY[diagnostic.severity],
                message: `${diagnostic.code}: ${diagnostic.message}`,
                markClass: diagnostic.severity === 'severe' ? 'cm-amk-severe' : undefined,
              })),
          ),
        );
      });
    });

    // Sanctioned effect: mirroring the playhead into the CodeMirror view.
    effect(() => {
      const spans = this.playback.playheadSpans();
      untracked(() => this.view.dispatch({ effects: setPlayhead.of(spans) }));
    });
  }

  /** Flips word wrap without rebuilding the view. */
  protected toggleWordWrap(): void {
    const wrap = !this.wordWrap();
    this.wordWrap.set(wrap);
    this.view.dispatch({
      effects: this.wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  }

  /** Selects and centers `span`, clamped to the document as it stands now. */
  private revealSpan(span: { start: number; end: number }): void {
    const length = this.view.state.doc.length;
    const anchor = Math.min(span.start, length);
    const head = Math.min(Math.max(span.end, span.start + 1), length);
    this.view.dispatch({
      selection: { anchor, head },
      effects: EditorView.scrollIntoView(anchor, { y: 'center' }),
    });
    this.view.focus();
  }
}
