import { type Signal, linkedSignal } from '@angular/core';

import type { Command } from '@compiler/tokens';

/** What a drag is showing, keyed however the caller finds convenient. */
export interface DragPreview {
  /** The value to draw: the one being dragged, or the committed one. */
  at(key: string | number, committed: number): number;
  /** Bind to a slider's `(preview)`. */
  set(key: string | number, value: number): void;
}

/**
 * Values a slider is showing mid-drag, before anything has been written.
 *
 * `amk-slider` deliberately commits once per gesture — dragging a slider that
 * recompiled per frame would push a recompile through the typing debounce dozens
 * of times a second. But that also meant the graphs sat still until the pointer
 * came up, which is exactly backwards: the picture is the thing you are dragging
 * *towards*, and it is most useful while you are still moving.
 *
 * So the slider's `(preview)` output feeds this, and anything drawn from it
 * follows the drag while the document does not. Nothing here writes; the commit
 * path is untouched.
 *
 * `source` is what makes it self-clearing: pass the command (or entry) the view
 * is rendering, and the moment a commit lands and the scan produces a new one,
 * the previewed values are dropped and the graph reads the document again. There
 * is no "drag ended" event to forget, and a stale preview cannot outlive the
 * thing it was previewing.
 */
export function dragPreview(source: Signal<unknown>): DragPreview {
  const pending = linkedSignal<unknown, Record<string, number>>({
    source,
    computation: () => ({}),
  });

  return {
    at: (key, committed) => pending()[key] ?? committed,
    set: (key, value) => {
      pending.update((current) => ({ ...current, [key]: value }));
    },
  };
}

/**
 * A command's arguments as the controls are showing them.
 *
 * For the views keyed by argument index, which is most of them — a panel that
 * draws several readouts off the same run of bytes wants the whole run in the
 * units it is being edited in, not one `at()` call per reader.
 */
export function shownArgs(command: Command, drag: DragPreview): number[] {
  return command.args.map((arg, index) => drag.at(index, arg.value));
}
