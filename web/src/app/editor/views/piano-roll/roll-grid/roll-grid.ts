import { Component, input } from '@angular/core';

/** One rule of the porter's grid, already placed. */
export interface GridLine {
  tick: number;
  x: number;
  /** A bar's own first beat, drawn heavier than the beats inside it. */
  strong: boolean;
}

/**
 * The grid behind the notes, and the two markers that are the song's own.
 *
 * Sits inside the scrolled group, so its coordinates are the song's ticks at
 * this zoom rather than the pane's. Nothing here reads the frame clock: the
 * transform above it is what moves, and this rebuilds only when the mark window
 * does.
 *
 * An attribute on a real `<g>`, and its template's elements carry the `svg:`
 * prefix — see `roll-lanes.ts` for why both halves are needed.
 */
@Component({
  selector: 'g[amk-roll-grid]',
  templateUrl: './roll-grid.html',
})
export class RollGrid {
  readonly lines = input.required<readonly GridLine[]>();
  readonly height = input.required<number>();
  /** Where the song loops back to, or null for a song that does not. */
  readonly loopX = input.required<number | null>();
  /** The last tick, or null before there is a song to have one. */
  readonly endX = input.required<number | null>();
}
