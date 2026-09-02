import { Component, input, output } from '@angular/core';

import { noteName } from '@amk/tokens/commands/units';
import { Button } from '../../../../shared/button/button';
import { Toggle } from '../../../../shared/toggle/toggle';

/** One instrument the song plays, as the panel needs it. */
export interface PercussionChip {
  instrument: number;
  label: string;
  on: boolean;
  title: string;
}

/**
 * One chip per instrument the song plays, as a view model rather than methods
 * called per row — `web/README.md` on why.
 */
export function percussionChips(
  used: readonly number[],
  chosen: ReadonlySet<number>,
  drumNotes: ReadonlyMap<number, number>,
): PercussionChip[] {
  return used.map((instrument) => {
    const sounds = drumNotes.get(instrument);
    return {
      instrument,
      label: `@${instrument}`,
      on: chosen.has(instrument),
      title:
        sounds === undefined
          ? `Draw @${instrument} on a percussion lane instead of the keyboard`
          : `@${instrument} is one of the driver's own drums, and plays ${noteName(sounds)}`,
    };
  });
}

/**
 * Which of the song's instruments are drawn on percussion lanes.
 *
 * A preference rather than a fact about the song: the driver's `@21`-`@29` are
 * drums whatever the porter says, and a sampled kick loaded as `@30` is one only
 * because they say so. The parent holds the chosen set, since the lane stack and
 * the minimap are both built from it. Each chip is an `amk-toggle`, lit while
 * its instrument is in the set.
 */
@Component({
  selector: 'amk-percussion-panel',
  imports: [Button, Toggle],
  templateUrl: './percussion-panel.html',
  host: {
    class: 'border-edge bg-raised flex shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-1',
  },
})
export class PercussionPanel {
  readonly chips = input.required<readonly PercussionChip[]>();
  readonly hasOverrides = input.required<boolean>();

  readonly toggled = output<number>();
  readonly resetAll = output<void>();
}
