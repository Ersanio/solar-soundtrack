import { Component, input } from '@angular/core';

import type { LoopRegionBox } from '../roll-marks';

/**
 * The loop structure behind the notes: one washed box per pass of every run,
 * around the rows its notes span — dashed at the declaration, dotted at a
 * recall, in the channel's own colour.
 *
 * Sits inside the scrolled group between the grid and the notes, so the
 * regions read as ground the bars stand on rather than as things over them.
 * Nothing here reads the frame clock, and nothing here takes the pointer —
 * the whole layer is inert, the bars above it being the things a porter acts
 * on.
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
}
