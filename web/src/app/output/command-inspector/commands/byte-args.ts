import { type Signal, computed, inject } from '@angular/core';

import { toSigned } from '@amk/spc/fir';
import type { Command } from '@amk/tokens';
import { argEditable, spliceArg } from '@amk/tokens/edits';
import { CommitAudition } from '../../../state/commit-audition';
import { EditorStore } from '../../../state/editor-store';
import { hex2 } from '../../../util/format';
import { argLockedBecause } from './context';
import { dragPreview, shownArgs } from './preview';

/**
 * A hex command's arguments, as a panel of sliders needs them.
 *
 * Nine of the inspector's children edit a run of bytes the same way: bind the
 * sliders to what the document says, read the drag for the readouts, and write
 * one argument back as `$XX` on commit. Each had its own copy of that — the
 * `args` computed alone appeared in six files, beside a `shownArgs` helper that
 * already existed — so this is the plumbing stated once.
 *
 * The split between {@link at} and {@link shownAt} is the load-bearing part and
 * the reason a single accessor will not do: binding the previewed value back
 * into a slider makes it conclude the gesture changed nothing, and nothing is
 * ever written. Sliders take `at`; readouts and graphs take `shownAt`.
 *
 * Call from an injection context — it injects `EditorStore` to do its writes.
 */
export interface ByteArgs {
  /** What the document says. Bind a slider's `[value]` to this. */
  at(index: number): number;
  /** The same, read as a signed byte. */
  signedAt(index: number): number;
  /** What the controls are showing, drag included. For readouts and graphs. */
  shownAt(index: number): number;
  /** Every argument as the controls are showing them. */
  shown(): readonly number[];
  /** Bind to a slider's `(preview)`. */
  preview(index: number, value: number): void;
  /** Bind to a slider's `(commit)`. Writes `$XX`, leaving the rest of the run alone. */
  commit(index: number, value: number): void;
  editable(index: number): boolean;
  lockedBecause(index: number): string | null;
  /** `$xx`, and whether the DSP will read it as negative. */
  signedNote(index: number): string;
}

/** A byte as it is written back: negatives fold into the high half. */
function asByte(value: number): number {
  return value < 0 ? value + 0x100 : value;
}

export function byteArgs(command: Signal<Command>): ByteArgs {
  const store = inject(EditorStore);
  const commitAudition = inject(CommitAudition);
  const drag = dragPreview(command);

  const args = computed(() => command().args.map((a) => a.value));
  const shown = computed(() => shownArgs(command(), drag));

  return {
    at: (index) => args()[index] ?? 0,
    signedAt: (index) => toSigned(args()[index] ?? 0),
    shownAt: (index) => shown()[index] ?? 0,
    shown: () => shown(),
    preview: (index, value) => drag.set(index, asByte(value)),
    commit: (index, value) => {
      commitAudition.apply(
        spliceArg(store.source(), command(), index, `$${hex2(asByte(value) & 0xff)}`),
      );
    },
    editable: (index) => argEditable(command(), index),
    lockedBecause: (index) => argLockedBecause(command(), index),
    signedNote: (index) => {
      const byte = shown()[index] ?? 0;
      return `$${hex2(byte)}${byte >= 0x80 ? ' — negative, so phase-inverted' : ''}`;
    },
  };
}
