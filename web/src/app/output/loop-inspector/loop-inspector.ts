import { Component, computed, inject } from '@angular/core';

import { Button } from '../../shared/button/button';
import { EnumSelect } from '../../shared/enum-select/enum-select';
import { NumberField } from '../../shared/number-field/number-field';
import { CommitAudition } from '../../state/commit-audition';
import { EditorRequests } from '../../state/editor-requests';
import { EditorStore } from '../../state/editor-store';
import {
  type LoopFocus,
  loopCountEdit,
  loopFocus,
  loopNameEdit,
  loopTargetEdit,
} from './loop-focus';

/**
 * The loops the caret is inside, and what each of them repeats.
 *
 * A panel of its own rather than an arm of the command inspector, because a loop
 * is not a command and the two questions do not share an answer. A `(n)m` raises
 * no `Command` at all — `label` is not a letter command kind — so a dispatcher
 * over the caret's command could never reach it; and a note in the middle of a
 * body is a note *and* inside a loop, which is two subjects rather than a choice
 * between them.
 *
 * It is also why the count is not a `ParamDescriptor`: one is bound to a single
 * argument of a single command, and a loop's count sits on the second of two `]`
 * commands, on no command at all, or one less than itself for a `$E6`.
 * `loop-focus.ts` is where the five spellings are told apart and where each
 * one's splice is chosen; this draws the answer and hands edits back.
 *
 * Absent, rather than empty, when the caret is in no loop: it is one subject
 * among several in this pane and a permanent row saying "not in a loop" would
 * sit on every song that has none.
 */
@Component({
  selector: 'amk-loop-inspector',
  imports: [Button, EnumSelect, NumberField],
  templateUrl: './loop-inspector.html',
  // It renders nothing at all for a caret outside every loop, which is most of
  // them, so it must not bring a box of its own along with it.
  host: { class: 'contents' },
})
export class LoopInspector {
  private readonly store = inject(EditorStore);

  private readonly requests = inject(EditorRequests);

  private readonly commitAudition = inject(CommitAudition);

  /**
   * Whether the roll has let go of what this was answering about — see
   * {@link EditorRequests.dismissed}. One caret's worth of silence, not a mode,
   * and the same gate the command inspector beside it takes.
   */
  private readonly dismissed = computed(() => this.requests.dismissed() === this.store.caret());

  protected readonly loops = computed(() =>
    this.dismissed()
      ? []
      : loopFocus({
          source: this.store.source(),
          index: this.store.tokens(),
          reading: this.store.loops(),
          caret: this.store.caret(),
          hint: this.requests.inspectingLoop(),
        }),
  );

  /** Shown in the summary row, so the section reads without being opened. */
  protected readonly summary = computed(() => {
    const loops = this.loops();
    const first = loops[0];
    if (!first) {
      return '';
    }

    return loops.length > 1 ? `${first.written} · in ${loops.length - 1} more` : first.written;
  });

  /**
   * Both writers go through `CommitAudition`, so the note the roll is asking
   * about sounds again once the change has compiled — a repeat count is a thing
   * you judge by ear.
   */
  protected setCount(focus: LoopFocus, plays: number): void {
    this.commitAudition.apply(loopCountEdit(this.store.source(), focus, plays));
  }

  protected setTarget(focus: LoopFocus, label: number): void {
    this.commitAudition.apply(loopTargetEdit(this.store.source(), focus, label));
  }

  protected setName(focus: LoopFocus, label: number): void {
    this.commitAudition.apply(loopNameEdit(focus, label));
  }
}
