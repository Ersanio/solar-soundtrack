import { Service, effect, inject, untracked } from '@angular/core';

import type { Edit } from '@amk/tokens/edits';
import { Audition, type NotePlay } from './audition';
import { EditorRequests } from './editor-requests';
import { EditorStore } from './editor-store';

/**
 * Replays the selected note when a command inspector panel commits a value.
 *
 * The inspector's write path: {@link apply} forwards the splice to
 * {@link EditorRequests.apply} and arms a one-shot preview, one call so the two
 * cannot drift apart. The preview cannot sound at the commit itself — a panel's
 * splice rides the typing debounce, so the compile in hand is still the song
 * before the edit — so it is delivered when the next in-sync compile lands and
 * resolved against that compile's own walk. Anything that stops the resolution —
 * no note selected, `Escape`, the note deleted, the compile failed — delivers
 * silence rather than a guess.
 *
 * Its own service rather than a member of `Audition`, which is mechanism only:
 * both of the roll's call sites keep the policy of which note, when and for how
 * long to themselves, and so does this one.
 */
@Service()
export class CommitAudition {
  private readonly editor = inject(EditorStore);

  private readonly requests = inject(EditorRequests);

  private readonly audition = inject(Audition);

  /** Whether a commit is waiting on its compile. A plain field: nothing renders it. */
  private armed = false;

  constructor() {
    // Sanctioned effect: driving the previewer, an imperative sink, from the
    // compile turning over.
    effect(() => {
      this.editor.result();
      untracked(() => this.deliver());
    });
  }

  /**
   * Applies a panel's splice and arms the preview for it.
   *
   * The `null` a splice builder returns for a no-op arms nothing — no text
   * changes, so no compile would come along to deliver it.
   */
  apply(edit: Edit | null): void {
    this.requests.apply(edit);

    if (edit) {
      this.armed = true;
    }
  }

  /**
   * Sounds the armed preview once the compile that includes the commit is in.
   *
   * A turnover for an older text — a debounce that was already running when the
   * commit landed — leaves it armed for the next one rather than previewing the
   * song before the edit.
   */
  private deliver(): void {
    if (!this.armed) {
      return;
    }

    if (this.editor.compiledText() !== this.editor.source()) {
      return;
    }

    this.armed = false;
    const play = this.resolve();

    if (play && !this.audition.notePending()) {
      this.audition.playNote(play);
    }
  }

  /**
   * The selected note as {@link Audition.playNote} takes it, or `null` for
   * silence.
   *
   * The occurrence is `EditorRequests.inspecting`, matched into the fresh walk
   * by address and tick with `note-command.ts`'s own fallback to the first
   * pass. The played byte is the drum's own `$D0`-`$D8` where the note is one —
   * `Audition.transposed` passes those through — and the *written* pitch
   * otherwise, since the audition applies the transposition in force itself and
   * `WalkNote.note` already carries it. The channel, length and slide are the
   * walk's, which is what a click on the bar sounds.
   */
  private resolve(): NotePlay | null {
    const asked = this.requests.inspecting();

    if (!asked) {
      return null;
    }

    const entry = this.editor.notesByAddress().get(asked.address);
    const timeline = this.editor.timeline();

    if (!entry || !timeline) {
      return null;
    }

    const note =
      timeline.notes.find((n) => n.address === asked.address && n.tick === asked.tick) ??
      timeline.notes.find((n) => n.address === asked.address);

    if (!note) {
      return null;
    }

    return {
      channel: note.channel,
      tick: note.tick,
      note: note.percussion !== null ? note.note : entry.written,
      ticks: note.ticks,
      slide: note.bend,
    };
  }
}
