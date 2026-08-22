import { Component, computed, input, output, signal } from '@angular/core';

import type { GridLine } from '../roll-grid/roll-grid';
import { KEY_WIDTH, MARKER_HEIGHT, MARKER_REACH, SCRUB_HEIGHT } from '../roll-metrics';

/** One of the roll's own grid lines, with the number of the bar it opens. */
export interface TimeMark extends GridLine {
  /** Counted from 1 at tick 0, or null for a beat inside a bar. */
  bar: number | null;
}

/**
 * The timeline over the roll, and the only way to seek from it.
 *
 * It is drawn in the roll's **own** coordinates rather than the song's — the
 * same `viewBox`, the same key column, the same scroll transform, the same grid
 * lines — so a tick is at the same x here as it is in the roll below, and the
 * marker's tip meets the playhead line because it is handed that line's own x.
 *
 * The pointer capture is here because it is geometry of the element this draws;
 * what a drag *means* — the seek it previews, and the pull on the view when it
 * runs off the end — is the parent's, so this emits the pointer's x and nothing
 * more. See `roll-overview.ts` for why the `<svg>` is sized in pixels.
 */
@Component({
  selector: 'amk-roll-scrub',
  templateUrl: './roll-scrub.html',
  host: { class: 'border-edge bg-raised block shrink-0 border-b' },
})
export class RollScrub {
  /** The bar's `viewBox`. Null until the pane is measured, so the parent withholds it. */
  readonly box = input.required<string>();
  /** The pane's width, which is the bar's, in CSS pixels. */
  readonly width = input.required<number>();
  readonly rollWidth = input.required<number>();
  /** The song's whole length. Zero refuses the drag, since there is nowhere to seek to. */
  readonly ticks = input.required<number>();
  /** The roll's own grid lines, numbered. Empty when the porter has no grid. */
  readonly marks = input.required<readonly TimeMark[]>();
  /** The roll's scroll transform, so the lines cannot drift from the ones below. */
  readonly scroll = input.required<string>();
  /** The playhead's x, which is the roll's own line's. */
  readonly playheadX = input.required<number>();

  readonly scrubStart = output<number>();
  readonly scrubTo = output<number>();
  readonly scrubEnd = output<void>();

  protected readonly keyWidth = KEY_WIDTH;
  protected readonly barHeight = SCRUB_HEIGHT;
  /** Where a beat's tick starts, and a bar's, leaving the numbers the row above. */
  protected readonly beatTop = SCRUB_HEIGHT - 6;
  protected readonly barTop = MARKER_HEIGHT;
  /** The numbers' baseline, clear of the tallest tick under it. */
  protected readonly numberBase = MARKER_HEIGHT - 2;

  /** The marker, drawn about x = 0 and carried to the playhead by a transform. */
  protected readonly marker = `M${-MARKER_REACH} ${SCRUB_HEIGHT - MARKER_HEIGHT}h${MARKER_REACH * 2}L0 ${SCRUB_HEIGHT}Z`;
  protected readonly markerAt = computed(() => `translate(${this.playheadX().toFixed(2)} 0)`);

  /** A pointer is down on the bar. The parent tracks the same gesture for the seek. */
  private readonly dragging = signal(false);

  protected onDown(event: PointerEvent): void {
    if (this.ticks() <= 0) {
      return;
    }

    event.preventDefault();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    this.dragging.set(true);
    this.scrubStart.emit(this.offsetAt(event));
  }

  protected onMove(event: PointerEvent): void {
    if (this.dragging()) {
      this.scrubTo.emit(this.offsetAt(event));
    }
  }

  protected onUp(event: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }

    const target = event.currentTarget as Element;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }

    this.dragging.set(false);
    this.scrubEnd.emit();
  }

  /**
   * Where the pointer is across the bar, in the bar's own coordinates.
   *
   * Left unclamped, because past either end is what the pull reads: a drag held
   * off the right edge is asking for music that is not on screen yet.
   */
  private offsetAt(event: PointerEvent): number {
    return event.clientX - (event.currentTarget as Element).getBoundingClientRect().left;
  }
}
