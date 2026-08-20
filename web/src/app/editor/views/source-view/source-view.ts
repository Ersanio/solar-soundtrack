import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  effect,
  inject,
  Injector,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { defaultKeymap, history, historyKeymap, insertTab } from '@codemirror/commands';
import { setDiagnostics } from '@codemirror/lint';
import { Compartment, EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';

import type { Severity } from '@amk/core/types';
import { commandAt } from '@amk/tokens';
import { IconWrap } from '../../../shared/icons/icon-wrap';
import { Toolbar } from '../../../shared/toolbar/toolbar';
import { EditorStore, type Insertion } from '../../../state/editor-store';
import { Playback } from '../../../state/playback';
import { clamp } from '../../../util/math';
import { CommandPalette } from '../../command-palette/command-palette';
import { commandHover } from '../../codemirror/command-hover';
import { mmlLanguage } from '../../codemirror/mml-language';
import { mmlTheme } from '../../codemirror/mml-theme';
import { playheadField, setPlayhead } from '../../codemirror/playhead';
import { setUnreachable, unreachableField } from '../../codemirror/unreachable';
import { readStored, writeStored } from '../../../util/storage';

const PALETTE_KEY = 'solar-soundtrack.palette';

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
 * The MML source, as a CodeMirror view.
 *
 * Its document is the text authority: `EditorStore.source` remains the signal
 * everything else reads, but it is written only from the view's update
 * listener. Programmatic changes — `reveal`, `replace`, `insertion` — go *into*
 * the view as transactions and come back out through that listener, so the sync
 * is strictly one-way and there is no store→view mirror to feed back through.
 *
 * Alone among the pane's views this one is hidden rather than destroyed when
 * another tab is selected, because it holds undo history, scroll position and
 * selection that nothing else could restore. That is why it is told whether it
 * is showing rather than working it out: {@link active} is false while it is
 * still very much alive, and the three effects above still have to run — a
 * diagnostic clicked from the Samples tab must bring the source back. They ask
 * for that with {@link activate}, since the tab is the pane's business.
 */
@Component({
  selector: 'amk-source-view',
  imports: [Toolbar, IconWrap, CommandPalette],
  templateUrl: './source-view.html',
  host: { class: 'flex min-h-0 min-w-0 flex-col' },
})
export class SourceView {
  protected readonly store = inject(EditorStore);
  private readonly playback = inject(Playback);
  private readonly injector = inject(Injector);

  /** Whether the pane is showing this view. A hidden view cannot be measured. */
  readonly active = input(false);

  /** Asks the pane to select this view, for an edit that arrived from elsewhere. */
  readonly activate = output<void>();

  /**
   * Off by default. A `Compartment` rather than a plain extension: word wrap
   * has to flip without tearing down the view, which would lose undo history,
   * scroll position and selection.
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

  /**
   * Whether the command palette is showing.
   *
   * The palette is the caret's own tool, so its switch belongs on this view's
   * toolbar rather than inside the palette — where it would be the one row of a
   * closed palette that still had to be drawn.
   */
  protected readonly paletteOpen = signal(readStored(PALETTE_KEY) !== 'closed');

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
            // escape backwards.
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
          unreachableField,
          EditorState.tabSize.of(8),
          EditorView.contentAttributes.of({
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

    // Sanctioned effect: mirroring a view preference into localStorage, as the
    // palette does for its category and `app.ts` for the split.
    effect(() => writeStored(PALETTE_KEY, this.paletteOpen() ? 'open' : 'closed'));

    // Sanctioned effect: driving an imperative view API (selection) from state.
    //
    // A shown reveal does its work after the next render rather than here:
    // making the editor visible comes first, and focusing or measuring a
    // `display: none` view is a no-op. A quiet one needs neither, since it only
    // moves the selection — which is how a panel beside another tab retargets
    // the inspector without taking the tab away.
    effect(() => {
      const reveal = this.store.reveal();
      if (!reveal) {
        return;
      }

      untracked(() => {
        // Consumed on the spot: a reveal describes one moment, and leaving it
        // set would let a later re-run select it again long after the author
        // has moved on.
        this.store.reveal.set(null);
        if (!reveal.show) {
          this.selectSpan(reveal.span);
          return;
        }

        this.activate.emit();
        afterNextRender(() => this.revealSpan(reveal.span), { injector: this.injector });
      });
    });

    // Sanctioned effect: the same imperative-view job as `reveal` above, for a
    // panel that changes text rather than selecting it. The dispatch maps the
    // selection through the change, which is what preserves the caret; the
    // update listener then propagates the new document and caret back into the
    // store.
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
        const from = Math.min(edit.span.start, length);
        const to = Math.min(edit.span.end, length);

        // The span was worked out against a scan of `source`, which is written
        // from the update listener below and so *is* the document — but only up
        // to the microtask that carried this edit across. Checking the text
        // rather than trusting the offsets is what makes a stale splice a
        // no-op instead of an overwrite of whatever moved into its place.
        if (this.view.state.doc.sliceString(from, to) !== edit.expect) {
          return;
        }

        this.view.dispatch({ changes: { from, to, insert: edit.text } });
      });
    });

    // Sanctioned effect: the palette's insert, which is the same imperative-view
    // job again — but at the caret rather than at a span, so unlike `replace`
    // there is nothing to compare against and the view's own selection is the
    // only authority. `store.caret` lags a debounce behind and is the head only.
    effect(() => {
      const insertion = this.store.insertion();
      if (!insertion) {
        return;
      }

      untracked(() => {
        // Consumed on the spot, as `reveal` and `replace` are: an insertion
        // describes one gesture, and a re-run would land it a second time.
        this.store.insertion.set(null);

        // Revealing into a hidden view cannot measure or focus, so becoming the
        // selected tab takes the same render barrier `reveal` takes.
        if (!this.active()) {
          this.activate.emit();
          afterNextRender(() => this.insertAtCaret(insertion), { injector: this.injector });
          return;
        }

        this.insertAtCaret(insertion);
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
                to: clamp(diagnostic.span.end, diagnostic.span.start + 1, length),
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

    // Sanctioned effect: the same, for the notes AMK0502 says never play.
    effect(() => {
      const spans = this.store.unreachableSpans();
      untracked(() => this.view.dispatch({ effects: setUnreachable.of(spans) }));
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

  /**
   * Drops `insertion` in after the caret, padded so it cannot fuse with the text
   * beside it.
   *
   * **It never deletes.** A palette click means "add this", so unlike typing it
   * does not replace the selection — and it must not, because the previous click
   * left the argument it wrote selected for typing over. Two clicks in a row
   * would otherwise have the second eat the first's argument.
   *
   * **It never lands mid-command.** A caret inside `$EF $FF $28 $28` — which is
   * exactly where the previous click left it — advances to the end of that
   * command first. Splitting a hex run is never what was meant and never valid:
   * the bytes after the split become arguments of the command inserted into it.
   * The same rule keeps a click from cutting a note in half.
   *
   * MML is whitespace-separated, so the padding is decided from the characters
   * actually either side; inserting into open space adds nothing.
   */
  private insertAtCaret(insertion: Insertion): void {
    const doc = this.view.state.doc;
    const command = commandAt(this.store.tokens().commands, this.view.state.selection.main.to);
    const at = Math.min(
      Math.max(this.view.state.selection.main.to, command?.span.end ?? 0),
      doc.length,
    );

    const before = at > 0 && !/\s/.test(doc.sliceString(at - 1, at)) ? ' ' : '';
    const after = at < doc.length && !/\s/.test(doc.sliceString(at, at + 1)) ? ' ' : '';
    const text = `${before}${insertion.text}${after}`;

    // The selection is named in the insertion's own coordinates, so it moves
    // with whatever padding was added in front of it.
    const anchor = at + before.length + (insertion.select?.start ?? insertion.text.length);
    const head = at + before.length + (insertion.select?.end ?? insertion.text.length);

    this.view.dispatch({
      changes: { from: at, insert: text },
      selection: EditorSelection.range(anchor, head),
      scrollIntoView: true,
    });
    this.view.focus();
  }

  /** Selects and centers `span`, clamped to the document as it stands now. */
  private revealSpan(span: { start: number; end: number }): void {
    this.view.dispatch({
      selection: this.selectionFor(span),
      effects: EditorView.scrollIntoView(span.start, { y: 'center' }),
    });
    this.view.focus();
  }

  /**
   * Selects `span` and nothing more — no scroll, no focus, no tab switch.
   *
   * Safe on a hidden view precisely because it measures nothing, which is what
   * lets it run inline rather than behind a render barrier. The update listener
   * carries the new selection out to `caret`, so the inspector follows.
   */
  private selectSpan(span: { start: number; end: number }): void {
    this.view.dispatch({ selection: this.selectionFor(span) });
  }

  /** The two of them clamp alike, so a quiet selection lands where a loud one would. */
  private selectionFor(span: { start: number; end: number }): { anchor: number; head: number } {
    const length = this.view.state.doc.length;
    const anchor = Math.min(span.start, length);
    return { anchor, head: clamp(span.end, span.start + 1, length) };
  }
}
