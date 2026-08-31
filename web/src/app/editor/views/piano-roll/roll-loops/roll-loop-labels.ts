import { Component, input } from '@angular/core';

import { LOOP_LABEL_SIZE } from '../roll-metrics';
import type { LoopLabel } from '../roll-marks';

/**
 * The `(n)` a selected loop is written with, in the corner of each of its boxes.
 *
 * Its own layer above the bars rather than a rect inside `RollLoops`, which sits
 * under them: a name drawn there would be behind the music it names. Nothing
 * here takes the pointer — the edge under it is the construct's handle, and a
 * plate that swallowed a press would take the loop's own gestures away.
 *
 * An attribute component on a real `<g>`, and its template's elements carry the
 * `svg:` prefix — see `roll-lanes.ts` for why both halves are needed.
 */
@Component({
  selector: 'g[amk-roll-loop-labels]',
  templateUrl: './roll-loop-labels.html',
  host: { 'pointer-events': 'none' },
})
export class RollLoopLabels {
  readonly labels = input.required<readonly LoopLabel[]>();

  /** Fixed, so the name is the same size at every zoom and every row height. */
  protected readonly size = LOOP_LABEL_SIZE;
}
