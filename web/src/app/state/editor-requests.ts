import { Service, signal } from '@angular/core';

import type { Span } from '@amk/core/types';
import type { Edit } from '@amk/tokens/edits';

/**
 * A span to select, and whether the source view should come forward for it.
 *
 * See {@link EditorRequests.reveal}. A separate type rather than a bare `Span`
 * because the flag is the whole difference between a summons and a question.
 */
export interface Reveal {
  span: Span;
  show: boolean;
}

/** Text bound for the caret, and which slice of it to leave selected. */
export interface Insertion {
  text: string;
  /**
   * Offsets *within* `text`, not into the document, which the sender does not
   * know — so not a `Span`, which carries a line number that would be a lie.
   */
  select: { start: number; end: number } | null;
}

/**
 * A batch of splices, and whether the editor should compile as soon as it lands.
 *
 * `immediate` separates the two kinds of caller. An inspector slider fires once
 * per frame of a drag and must go through the typing debounce like a keystroke,
 * or a drag is dozens of compiles. A piano roll gesture is committed once, on
 * pointer-up, and the roll's spans are stale until the compile lands — so it
 * asks for the compile now and gets its next frame right.
 */
export interface EditBatch {
  edits: readonly Edit[];
  immediate: boolean;
}

/**
 * What a panel asks the editor to do, and nothing else.
 *
 * `editor/views/source-view/` owns the CodeMirror view, so nothing else may
 * touch it — not even the pane it sits in. These signals are how a sibling
 * asks: select this, splice that, type this in, undo, and remember which
 * occurrence of a note is being inspected.
 *
 * Its own service rather than more members on `EditorStore` because it shares
 * nothing with the compile pipeline — it reads no result, no scan and no source,
 * and it must not, or the spine would run both ways. It is a mailbox, and every
 * one of its correspondents is a panel.
 */
@Service()
export class EditorRequests {
  /**
   * A range the editor should select, set when a diagnostic or a piano roll bar
   * is clicked.
   *
   * `show` is what separates the two callers. A diagnostic is a summons — bring
   * the source forward, scroll to it, take focus. A single click on a bar is a
   * question about that note, and the inspector answers it from the pane beside
   * the roll, so switching tabs would take away the thing being asked about. The
   * quiet form still goes through the document, because the caret is the one
   * statement of what is being inspected and panels do not write it.
   */
  readonly reveal = signal<Reveal | null>(null);

  /**
   * A splice the editor should apply, set when a panel edits a command in
   * place. The counterpart to {@link reveal}: that one asks for a selection,
   * this one asks for a change, and both exist because the editor owns the view
   * and nothing else may reach into it.
   *
   * A fresh object each time, so writing the same edit twice still takes.
   *
   * `expect` is what the splice believes occupies the span. Panels read the
   * *undebounced* scan, so their spans agree with the document — but only up to
   * the microtask that carries the edit across, and a control that fires on
   * `pointerup` is one gesture away from a document that has moved. The editor
   * compares before it dispatches, which turns that whole class of race from
   * silent corruption into an edit that simply does not take.
   */
  readonly replace = signal<EditBatch | null>(null);

  /**
   * Applies a splice built by `@amk/tokens`'s `edits.ts`, ignoring the `null`
   * those builders return when nothing would change.
   *
   * Here rather than in each panel so the no-op check and the defensive copy are
   * stated once: a slider fires per frame of a drag, and the builders answering
   * "that is the text already there" is what keeps a drag from pushing dozens of
   * identical recompiles through the typing debounce.
   */
  apply(edit: Edit | null): void {
    if (edit) {
      this.replace.set({ edits: [copyEdit(edit)], immediate: false });
    }
  }

  /**
   * Applies a whole gesture's worth of splices as one change.
   *
   * One transaction and so **one undo step**, which is what a range-select over
   * forty notes has to be. The editor checks every `expect` before it dispatches
   * anything, so the batch either lands whole or not at all — a half-applied
   * gesture would leave the song in a shape nobody asked for.
   *
   * The ranges must be non-overlapping and in the document's own coordinates:
   * CodeMirror merges overlapping ones rather than refusing them, so nothing
   * downstream can catch it. `roll-edit.ts` asserts it where the edits are made.
   */
  applyAll(edits: readonly Edit[] | null): void {
    if (edits && edits.length > 0) {
      this.replace.set({ edits: edits.map(copyEdit), immediate: true });
    }
  }

  /**
   * How deep the editor's undo and redo stacks are, written by the view.
   *
   * The one thing in here that travels the other way, and it has to: CodeMirror
   * owns the history, the roll's toolbar carries the same two buttons the source
   * toolbar does, and a button that cannot tell whether there is anything to
   * undo is a button that is never disabled.
   */
  readonly undoDepth = signal(0);
  readonly redoDepth = signal(0);

  /** An undo or a redo for the editor to run, set by either toolbar's buttons. */
  readonly history = signal<'undo' | 'redo' | null>(null);

  /**
   * Text the editor should drop in at the caret, set when the command palette
   * inserts a command. The third of the same family as {@link reveal} and
   * {@link replace}, and separate from `replace` for two reasons: it carries a
   * selection, which a splice does not, and it has no span at all — where a
   * splice knows the range it is overwriting, this one lands wherever the caret
   * happens to be, which only the view knows.
   */
  readonly insertion = signal<Insertion | null>(null);

  /**
   * Asks for `text` at the caret, selecting the slice `select` names once it is
   * there — the first argument, so that the inspector opens on the command and
   * typing over it replaces the placeholder.
   */
  insert(text: string, select: { start: number; end: number } | null): void {
    this.insertion.set({ text, select: select && { ...select } });
  }

  /**
   * Which occurrence of a note the piano roll was last asked about.
   *
   * A note written once inside a loop is played many times, and the commands in
   * force can differ between them, so the caret — which names the *text* — is
   * one answer short. Set when a bar is clicked and read only while it is still
   * an occurrence of the note the caret is on, which is what makes moving the
   * caret enough to retire it.
   */
  readonly inspecting = signal<{ address: number; tick: number } | null>(null);
}

/** A splice the sender cannot go on mutating after it has posted it. */
function copyEdit(edit: Edit): Edit {
  return { ...edit, span: { ...edit.span } };
}
