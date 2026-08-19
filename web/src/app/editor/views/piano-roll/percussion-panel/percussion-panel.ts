import { Component, computed, input, output } from '@angular/core';

import { noteName } from '@amk/tokens/commands/units';
import { Button } from '../../../../shared/button/button';

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

function chipClass(on: boolean): string {
  return `cursor-pointer rounded px-2 py-0.5 font-mono text-xs transition-colors ${
    on ? 'bg-accent/20 text-accent font-semibold' : 'text-ink-muted hover:text-ink'
  }`;
}

/**
 * Which of the song's instruments are drawn on percussion lanes.
 *
 * A preference rather than a fact about the song: the driver's `@21`-`@29` are
 * drums whatever the porter says, and a sampled kick loaded as `@30` is one only
 * because they say so. The parent holds the chosen set, since the lane stack and
 * the minimap are both built from it.
 */
@Component({
  selector: 'amk-percussion-panel',
  imports: [Button],
  templateUrl: './percussion-panel.html',
  host: {
    class: 'border-edge bg-raised flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2',
  },
})
export class PercussionPanel {
  readonly chips = input.required<readonly PercussionChip[]>();
  readonly hasOverrides = input.required<boolean>();

  readonly toggled = output<number>();
  readonly resetAll = output<void>();

  /** One view model rather than a class method called per chip. */
  protected readonly rows = computed(() =>
    this.chips().map((chip) => ({ ...chip, class: chipClass(chip.on) })),
  );
}
