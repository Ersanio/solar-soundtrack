import { Component, computed, input, output } from '@angular/core';

import type { Lane } from '../roll-layout';
import { KEY_WIDTH } from '../roll-metrics';

/**
 * The key itself, which is a real keyboard: white keys pale, black keys dark,
 * and a lit one in the accent. The label is painted to suit — dark on a pale
 * key, pale on a dark one — so it stays readable in all three states.
 */
function keyClass(lane: Lane): string {
  if (lane.kind !== 'key') {
    return 'fill-edge';
  }

  return lane.black ? 'fill-inset' : 'fill-ink';
}

function keyTextClass(lane: Lane): string {
  if (lane.kind !== 'key') {
    return 'fill-ink';
  }

  return lane.black ? 'fill-ink-muted' : 'fill-surface';
}

/**
 * The key column down the left, drawn last so notes never spill over it.
 *
 * An attribute on a real `<g>`, and its template's elements carry the `svg:`
 * prefix — see `roll-lanes.ts` for why both halves are needed.
 */
@Component({
  selector: 'g[amk-roll-keys]',
  templateUrl: './roll-keys.html',
})
export class RollKeys {
  readonly lanes = input.required<readonly Lane[]>();
  readonly rowHeight = input.required<number>();
  /** The stack's full height, for the column's plate and its right-hand rule. */
  readonly height = input.required<number>();
  /** The rows sounding right now. Changes every frame; nothing is derived from it. */
  readonly held = input.required<ReadonlySet<number>>();
  readonly showLabels = input.required<boolean>();
  readonly labelSize = input.required<number>();
  /** Whether a press sounds anything, which needs a channel to sound it on. */
  readonly playable = input.required<boolean>();

  /** The row that was pressed, so the porter can find a pitch before drawing it. */
  readonly pressed = output<number>();

  protected readonly keyWidth = KEY_WIDTH;

  /**
   * One view model rather than two class methods called per key per pass.
   *
   * The lit colours stay in the template for the same reason as `roll-lanes.ts`:
   * `held` moves at frame rate, and the rest of this does not.
   */
  protected readonly rows = computed(() => {
    const height = this.rowHeight();
    return this.lanes().map((lane) => ({
      row: lane.row,
      y: lane.row * height + 0.5,
      height: height - 1,
      textY: lane.row * height + height / 2,
      label: lane.label,
      fill: keyClass(lane),
      textFill: `${keyTextClass(lane)} font-mono`,
    }));
  });
}
