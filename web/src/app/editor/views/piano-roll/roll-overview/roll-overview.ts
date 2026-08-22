import { Component, input, output, signal } from '@angular/core';

import type { MinimapBar } from '../roll-marks';
import { KEY_WIDTH, OVERVIEW_HEIGHT } from '../roll-metrics';

/**
 * The whole song at once, and the roll's horizontal scroller.
 *
 * Its width is one song — tick 0 on the left edge, the last tick on the right,
 * at every zoom — so it is the song rather than a view of it, and the box drawn
 * on it is the pane the roll is showing. It sits outside the roll's own
 * scroller, because a scroller that scrolled out of view would be gone exactly
 * when a tall song most needs it.
 *
 * The pointer capture is here because it is geometry of the element this draws;
 * what a drag *means* — where in the window box it was grabbed, and where the
 * camera goes — is the parent's, so this emits the pointer's x and nothing more.
 * The `<svg>` is sized in pixels rather than `w-full` so that one user unit is
 * one CSS px in the same space the roll's own `<svg>` uses: the pane is measured
 * inside the vertical scrollbar and the bar is drawn outside it, and a `w-full`
 * bar stretches its viewBox over that gutter while the pointer does not.
 */
@Component({
  selector: 'amk-roll-overview',
  templateUrl: './roll-overview.html',
  host: { class: 'border-edge bg-raised block shrink-0 border-b' },
})
export class RollOverview {
  /** The bar's `viewBox`. Null until the pane is measured, so the parent withholds it. */
  readonly box = input.required<string>();
  /** The pane's width, which is the bar's, in CSS pixels. */
  readonly width = input.required<number>();
  readonly rollWidth = input.required<number>();
  /** The song's whole length. Zero refuses the drag, since there is nowhere to scroll. */
  readonly ticks = input.required<number>();
  readonly bars = input.required<readonly MinimapBar[]>();
  /** Where the playhead sits along the bar. */
  readonly playheadX = input.required<number>();
  /** The slice of the song the roll is showing, or null when there is none to show. */
  readonly viewWindow = input.required<{ x: number; w: number } | null>();

  readonly panStart = output<number>();
  readonly panTo = output<number>();
  readonly panEnd = output<void>();

  protected readonly keyWidth = KEY_WIDTH;
  protected readonly barHeight = OVERVIEW_HEIGHT;

  /** A pointer is down on the bar. The parent tracks the same gesture for the camera. */
  protected readonly dragging = signal(false);

  protected onDown(event: PointerEvent): void {
    if (this.ticks() <= 0) {
      return;
    }

    event.preventDefault();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    this.dragging.set(true);
    this.panStart.emit(this.offsetAt(event));
  }

  protected onMove(event: PointerEvent): void {
    if (this.dragging()) {
      this.panTo.emit(this.offsetAt(event));
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
    this.panEnd.emit();
  }

  /**
   * Where the pointer is across the bar, in the bar's own coordinates.
   *
   * Measured from the element the handler is on, so it stays right wherever the
   * pane is and however it is scrolled, and left unclamped — a drag that runs
   * off either end is still asking for the end it ran off.
   */
  private offsetAt(event: PointerEvent): number {
    return event.clientX - (event.currentTarget as Element).getBoundingClientRect().left;
  }
}
