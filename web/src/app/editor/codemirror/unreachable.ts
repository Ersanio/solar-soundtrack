import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';

import type { Span } from '@amk/core/types';
import { clamp } from '../../util/math';

/** Replaces the underlines wholesale; the field below renders them. */
export const setUnreachable = StateEffect.define<readonly Span[]>();

const mark = Decoration.mark({ class: 'cm-amk-unreachable' });

/**
 * Notes the song is never long enough to reach, underlined where they are
 * written.
 *
 * The driver ends a phrase the moment any voice runs out of data, so a channel
 * longer than the shortest is silently truncated — `AMK0502` names the channels
 * and this shows which notes it costs. The sibling of `playhead.ts`, and
 * deliberately a different kind of mark: the playhead is a filled highlight
 * that moves, this is a static underline, so a note can carry both at once
 * without either becoming unreadable.
 *
 * Unlike the playhead there is no staleness guard upstream — these come off the
 * last compile, so while an edit is mid-debounce they describe the previous
 * text. Mapping them through the document's own changes is what keeps them on
 * the right characters until the next compile replaces them outright.
 */
export const unreachableField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setUnreachable)) {
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
