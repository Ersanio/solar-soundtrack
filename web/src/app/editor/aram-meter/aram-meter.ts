import { Component, computed, inject } from '@angular/core';

import { AramBar } from '../../output/aram-bar/aram-bar';
import { budgetSegments } from '../../output/aram-bar/aram-segments';
import { EditorRequests } from '../../state/editor-requests';
import { EditorStore } from '../../state/editor-store';

/**
 * The top bar's ARAM readout: FL's CPU and memory panel, for the one resource
 * an SPC song runs out of.
 *
 * The bar and the free label are the budget panel's own, fed the same segments,
 * so the two never disagree; the tooltip is the panel's table in one line per
 * region. A click asks the output pane for its Build section, which is where
 * that table is.
 */
@Component({
  selector: 'amk-aram-meter',
  imports: [AramBar],
  templateUrl: './aram-meter.html',
})
export class AramMeter {
  protected readonly store = inject(EditorStore);
  protected readonly requests = inject(EditorRequests);

  protected readonly segments = computed(() => budgetSegments(this.store.budget()));

  /** Over ARAM, by the test the budget panel colours its own free label on. */
  protected readonly overflowing = computed(() => (this.store.budget()?.overflowBytes ?? 0) > 0);

  /** One line per region and then the free label, for the tooltip. */
  protected readonly breakdown = computed(() =>
    [
      ...this.segments().map((segment) => `${segment.label}: ${segment.bytes.toLocaleString()} B`),
      this.store.freeLabel(),
    ].join('\n'),
  );
}
