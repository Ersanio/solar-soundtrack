import { Component, input, output, signal } from '@angular/core';

import type { MinimapBar } from '../roll-marks';
import { KEY_WIDTH, OVERVIEW_HEIGHT } from '../roll-metrics';
import { overviewTick } from '../roll-layout';

/**
 * The whole song at once, and the only way to seek from the roll.
 *
 * Its width is one song — tick 0 on the left edge, the last tick on the right,
 * at every zoom — so it is the song rather than a view of it. It sits outside
 * the roll's own scroller, because a scroller that scrolled out of view would be
 * gone exactly when a tall song most needs it.
 *
 * The pointer capture and the hit test are here because they are geometry of the
 * element this draws; what a drag *means* — coming off the song, and the seek at
 * the end of it — is the parent's, so this emits the gesture and nothing more.
 *
 * The `<svg>` is sized in pixels rather than `w-full` so that one user unit is
 * one CSS px: the pane is measured inside its vertical scrollbar and the bar is
 * drawn outside it, and a `w-full` bar stretches its `viewBox` over that gutter
 * while the hit test below, which works in client px, does not follow it.
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
  /** The song's whole length. Zero refuses the drag, since there is nowhere to seek to. */
  readonly ticks = input.required<number>();
  readonly bars = input.required<readonly MinimapBar[]>();
  /** Where the playhead sits along the bar. */
  readonly playheadX = input.required<number>();
  /** The slice of the song the roll is showing, or null when there is none to show. */
  readonly viewWindow = input.required<{ x: number; w: number } | null>();

  readonly scrubStart = output<void>();
  readonly scrubTo = output<number>();
  readonly scrubEnd = output<void>();

  protected readonly keyWidth = KEY_WIDTH;
  protected readonly barHeight = OVERVIEW_HEIGHT;

  /** A pointer is down on the bar. The parent tracks the same gesture for the seek. */
  private readonly dragging = signal(false);

  protected onDown(event: PointerEvent): void {
    if (this.ticks() <= 0) {
      return;
    }

    event.preventDefault();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    this.dragging.set(true);
    // Before the first position, so the parent can read the lead the playhead
    // had while it was still on the song.
    this.scrubStart.emit();
    this.scrubTo.emit(this.tickAt(event));
  }

  protected onMove(event: PointerEvent): void {
    if (this.dragging()) {
      this.scrubTo.emit(this.tickAt(event));
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
   * The tick under a pointer on the bar.
   *
   * Measured from the element the handler is on, so it stays right wherever the
   * pane is and however it is scrolled — and past either end it is the song's
   * own end, since a drag that leaves the bar is still asking for the last tick.
   */
  private tickAt(event: PointerEvent): number {
    const box = (event.currentTarget as Element).getBoundingClientRect();
    return overviewTick(
      event.clientX - box.left - KEY_WIDTH,
      this.ticks(),
      Math.max(0, box.width - KEY_WIDTH),
    );
  }
}
