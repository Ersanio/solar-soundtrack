import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';

import type { Span } from '@amk/core/types';
import { clamp } from '../../util/math';

/** Replaces the playhead marks wholesale; the field below renders them. */
export const setPlayhead = StateEffect.define<readonly Span[]>();

const mark = Decoration.mark({ class: 'cm-amk-playhead' });

/**
 * The notes being sounded, as decorations — up to one per voice, pushed in at
 * 10 Hz from the driver's own read pointers. Between effects a document change
 * just maps the marks along; the staleness guard upstream clears them on the
 * next tick anyway, since edited text no longer matches what is playing.
 */
export const playheadField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setPlayhead)) {
        const length = tr.newDoc.length;
        return Decoration.set(
          effect.value
            .filter((span) => span.start < length)
            .map((span) => mark.range(span.start, clamp(span.end, span.start + 1, length))),
          true,
        );
      }
    }

    return tr.docChanged ? decorations.map(tr.changes) : decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});
