import { Component, input } from '@angular/core';

/** One label/value cell in the compile-statistics grid. */
@Component({
  selector: 'amk-stat-tile',
  templateUrl: './stat-tile.html',
  host: { class: 'bg-surface flex flex-col gap-0.5 px-3 py-2' },
})
export class StatTile {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  /** Recedes the value when it carries no information ("—", "no", zero). */
  readonly dim = input(false);
}
