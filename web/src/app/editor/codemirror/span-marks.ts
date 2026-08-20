import { type StateEffectType, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';

import type { Span } from '@amk/core/types';
import { clamp } from '../../util/math';

/**
 * A decoration field fed by one effect carrying the whole set of spans.
 *
 * Both of this folder's mark layers want the same field: replace everything on
 * the effect, map along the document otherwise. What differs is the CSS class
 * and which effect to listen for, so those are the arguments and the rest is
 * stated once.
 *
 * Two rules are in the mapping and neither is obvious. A span starting past the
 * end of the document is dropped rather than clamped — text has been deleted
 * under it, and a mark collapsed onto the last character would sit on a note
 * that is not the one it names. And the end is held at least one character past
 * the start, because CodeMirror discards an empty `Decoration.mark` range, which
 * would silently lose the mark rather than draw a thin one.
 */
export function spanMarkField(
  effect: StateEffectType<readonly Span[]>,
  className: string,
): StateField<DecorationSet> {
  const mark = Decoration.mark({ class: className });

  return StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(decorations, tr) {
      for (const applied of tr.effects) {
        if (applied.is(effect)) {
          const length = tr.newDoc.length;
          return Decoration.set(
            applied.value
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
}
