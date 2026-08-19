import { Component, computed, input } from '@angular/core';

import type { Lane } from '../roll-layout';

/** The row's background behind the notes. */
function laneClass(lane: Lane): string {
  if (lane.kind !== 'key') {
    return 'fill-raised';
  }

  return lane.black ? 'fill-inset' : 'fill-surface';
}

/**
 * The row stripes behind the music. Black keys sit darker, so the octaves read
 * at a glance.
 *
 * **An attribute on a real `<g>`, not an element of its own.** A component
 * element inside an `<svg>` is an unknown SVG element: no layout box, nothing
 * rendered, and no error to say so. Its template's elements carry the `svg:`
 * prefix for the other half of the same rule — Angular takes an element's
 * namespace from its parent *in the same template*, and this template has no
 * `<svg>` of its own.
 */
@Component({
  selector: 'g[amk-roll-lanes]',
  templateUrl: './roll-lanes.html',
})
export class RollLanes {
  readonly lanes = input.required<readonly Lane[]>();
  readonly rowHeight = input.required<number>();
  readonly width = input.required<number>();
  /** The rows sounding right now. Changes every frame, so nothing else may be derived from it. */
  readonly held = input.required<ReadonlySet<number>>();

  /**
   * One view model rather than a class method called per row per pass.
   *
   * The lit colours are not in it on purpose: `held` moves at frame rate, and
   * folding it in here would rebuild the whole stack sixty times a second to
   * change two rows.
   */
  protected readonly rows = computed(() => {
    const height = this.rowHeight();
    return this.lanes().map((lane) => ({
      row: lane.row,
      y: lane.row * height,
      height,
      fill: laneClass(lane),
      /** The separator under this row, or null where the octave has not turned over. */
      rule: lane.octaveStart || lane.kind !== 'key' ? (lane.row + 1) * height : null,
    }));
  });
}
