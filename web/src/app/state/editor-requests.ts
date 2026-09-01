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
  /**
   * Whether this batch leaves a channel's notes as they are — the same notes,
   * in the same order, whatever their ticks do.
   *
   * True of a splice into one command's own text, which is every commit a panel
   * makes and every command the piano roll's lane erases or carries. The roll
   * reads {@link EditorRequests.notesKept} to know it, and what it does with it
   * is keep its selection, which is a set of indices into a channel's strip: the
   * channel is rebuilt with the same items in the same order, so those indices
   * still name the notes they named. False is not a claim that something moved,
   * only that nothing here says otherwise.
   */
  keepsNotes: boolean;
  /**
   * A range to select once the batch lands, in the document *after* it. How a
   * panel puts the caret on text the batch itself writes — the note palette
   * leaves the new command's first argument selected, and the caret is what
   * retargets the inspector.
   */
  select: { anchor: number; head: number } | null;
}

/**
 * What a panel asks the editor to do, and what the view and the roll report back.
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
   * Every edit carries `expect`, the text the splice believes occupies the
   * span, and the editor compares before it dispatches — see `web/README.md`
   * for the race that guards against.
   */
  readonly replace = signal<EditBatch | null>(null);

  /**
   * Applies a splice built by `@amk/tokens`'s `edits.ts`, ignoring the `null`
   * those builders return when nothing would change.
   *
   * Here rather than in each panel so the no-op check and the defensive copy
   * are stated once.
   */
  apply(edit: Edit | null): void {
    if (edit) {
      this.replace.set({
        edits: [copyEdit(edit)],
        immediate: false,
        select: null,
        keepsNotes: true,
      });
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
  applyAll(
    edits: readonly Edit[] | null,
    select: { anchor: number; head: number } | null = null,
    keepsNotes = false,
  ): void {
    if (edits && edits.length > 0) {
      this.replace.set({
        edits: edits.map(copyEdit),
        immediate: true,
        select: select && { ...select },
        keepsNotes,
      });
    }
  }

  /**
   * How deep the editor's undo and redo stacks are, written by the view.
   *
   * Written by the view rather than read by it, as {@link notesKept} is, and it
   * has to be: CodeMirror owns the history, the roll's toolbar carries the same
   * two buttons the source toolbar does, and a button that cannot tell whether
   * there is anything to undo is a button that is never disabled.
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
   * How many {@link EditBatch.keepsNotes} batches the editor has applied.
   *
   * Written by the view, as {@link undoDepth} is, and for the same kind of
   * reason: only the view knows whether a batch really landed.
   * Every `expect` is checked before anything is dispatched, so a stale batch is
   * dropped in silence — counted where it is *asked for*, this would run ahead of
   * the document and the next change from anywhere would be read as one that
   * kept the notes.
   *
   * A count rather than a flag, because what the reader wants is the transition
   * and nothing here is in a position to put a flag back down.
   */
  readonly notesKept = signal(0);

  /**
   * The selected note: which occurrence of one the piano roll was last asked
   * about.
   *
   * A note written once inside a loop is played many times, and the commands in
   * force can differ between them, so the caret — which names the *text* — is
   * one answer short. A click on a bar or on one of its glyphs sets it; a click
   * on the command lane and the roll's `Escape` let it go, a lane glyph naming
   * a command of the song rather than a note of it. The note panel reads it
   * only while it is still an occurrence of the note the caret is on, and
   * `CommitAudition` replays it after a panel's commit, resolved against the
   * fresh compile so a note that no longer exists is silence.
   */
  readonly inspecting = signal<{ address: number; tick: number } | null>(null);

  /**
   * The run of text the piano roll's note selection covers, or `null` for none.
   *
   * The roll's own selection is a set of indices into a channel's strip, which
   * nothing outside the roll has any business knowing about; this is that
   * selection said in the one currency every panel already speaks. The command
   * palette in the inspector reads it to know what a loop's brackets would go
   * round — a marquee over forty bars is a run the caret cannot describe.
   *
   * Beside {@link inspecting} because it is the same channel: the roll saying
   * what the porter has hold of. It travels with the roll, so it goes back to
   * `null` when the roll does.
   */
  readonly selectedRun = signal<{ start: number; end: number } | null>(null);

  /**
   * The loop construct the piano roll was last asked about: the text of the pass
   * whose box was pressed, and the body that pass plays.
   *
   * A body played from three places is three constructs and one text, and a
   * press on a box's edge puts the caret on the body's first note — so the caret
   * cannot say whether the box was the declaration's or one of its recalls'.
   * This is the roll naming which of them it took hold of, beside
   * {@link inspecting}, which says the same thing for one pass of a note.
   *
   * It only ever **redirects** an answer the caret has already given: the panel
   * reads it while the caret is still inside the body it names, so it retires
   * itself and nothing has to clear it. Matched on the body rather than on the
   * label, since an unlabelled `[ ]` recalled by a `*` has no name for the roll's
   * reading and the token reading to agree on.
   *
   * It travels with the roll, so it goes back to `null` when the roll does.
   */
  readonly inspectingLoop = signal<{ text: Span; body: Span } | null>(null);

  /**
   * The caret the inspector's question was withdrawn at, or `null` for none.
   *
   * The roll's `Escape` lets a note go, and the panel that was answering about
   * it has to let go too. It cannot be done by moving the caret: `commandAt` is
   * inclusive at both ends, so `c8 d8` has no offset between the two that
   * belongs to neither, and there is nowhere neutral to put it.
   *
   * An offset rather than a flag, so it retires itself the way
   * {@link inspecting} does — the panel is blank only while the caret is still
   * the one it was dismissed at, and any move at all, in the roll or in the
   * text, brings it back. {@link reveal} clears it outright, for asking again
   * about the very note it was dismissed on.
   */
  readonly dismissed = signal<number | null>(null);
}

/** A splice the sender cannot go on mutating after it has posted it. */
function copyEdit(edit: Edit): Edit {
  return { ...edit, span: { ...edit.span } };
}
