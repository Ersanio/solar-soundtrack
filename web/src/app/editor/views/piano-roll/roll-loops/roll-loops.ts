import { Component, input } from '@angular/core';

import type { LoopRegionBox } from '../roll-marks';

/**
 * The loop structure behind the notes: one washed box per pass of every run,
 * around the rows its notes span — dashed at the declaration, dotted at a
 * recall, solid where the group is selected, in the channel's own colour.
 *
 * Sits inside the scrolled group between the grid and the notes, so the regions
 * read as ground the bars stand on rather than as things over them. Nothing here
 * reads the frame clock, and the wash itself takes no pointer; the transparent
 * stroke over each box is the construct's handle, and `roll-gesture.ts` is what
 * a press on it reaches.
 *
 * An attribute on a real `<g>`, and its template's elements carry the `svg:`
 * prefix — see `roll-lanes.ts` for why both halves are needed.
 */
@Component({
  selector: 'g[amk-roll-loops]',
  templateUrl: './roll-loops.html',
})
export class RollLoops {
  readonly regions = input.required<readonly LoopRegionBox[]>();

  /**
   * The bodies every note of whose group the porter has selected, by body
   * address — the boxes whose outline closes up.
   *
   * An input beside {@link regions} rather than a field on one: the box list is
   * built on the mark window's cadence and a selection changes on every click,
   * so carrying it there would rebuild the whole song's boxes for a dash
   * pattern.
   */
  readonly selected = input.required<ReadonlySet<number>>();
}
