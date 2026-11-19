import { Component, computed, inject } from '@angular/core';

import { ARAM_SIZE } from '@amk/spc/layout';
import { AramBar } from '../../output/aram-bar/aram-bar';
import { budgetSegments } from '../../output/aram-bar/aram-segments';
import { EditorRequests } from '../../state/editor-requests';
import { EditorStore } from '../../state/editor-store';

/**
 * The top bar's ARAM readout: FL's CPU and memory panel, for the one resource
 * an SPC song runs out of.
 *
 * The bar is the budget panel's own, fed the same segments, so the two never
 * disagree. A click asks the output pane for its Build section, where the
 * byte counts are.
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

  /** "n% free" on the bar, or the full over-by label once the song does not fit. */
  protected readonly label = computed(() => {
    const budget = this.store.budget();
    if (!budget || budget.overflowBytes > 0) {
      return this.store.freeLabel();
    }

    const percent = ((budget.freeBytes / ARAM_SIZE) * 100).toFixed(0);
    return $localize`:@@topbar.aram.percent-free:topbar.aram.percent-free ${percent}:percent:`;
  });
}
