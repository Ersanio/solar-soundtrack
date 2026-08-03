import { Component, type ElementRef, computed, effect, signal, viewChild } from '@angular/core';

import { EditorPane } from './editor/editor-pane/editor-pane';
import { TopBar } from './editor/top-bar/top-bar';
import { OutputPane } from './output/output-pane/output-pane';
import { UpdateBanner } from './update-banner/update-banner';

const STORAGE_KEY = 'solar-soundtrack.split';

/**
 * How much of the width the editor may take, as a percentage.
 *
 * The floor is half because the output pane holds the hex dump and the ARAM
 * budget, which stop being readable much below it; the ceiling leaves the right
 * column wide enough to still be worth looking at. Between them the author
 * chooses.
 */
const MIN_SPLIT = 25;
const MAX_SPLIT = 75;
const DEFAULT_SPLIT = 50;

function clampSplit(value: number): number {
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, value));
}

/**
 * The stored split, or the default if there is nothing usable there.
 *
 * `Number(null)` and `Number('')` are both `0`, so the `> 0` guard covers a
 * missing key and an empty one as well as text that does not parse.
 */
function loadSplit(): number {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));

    return Number.isFinite(stored) && stored > 0 ? clampSplit(stored) : DEFAULT_SPLIT;
  } catch {
    return DEFAULT_SPLIT; // Private browsing. The layout is not worth failing over.
  }
}

@Component({
  selector: 'amk-root',
  imports: [UpdateBanner, TopBar, EditorPane, OutputPane],
  templateUrl: './app.html',
  host: { class: 'flex h-screen flex-col' },
})
export class App {
  protected readonly DEFAULT_SPLIT = DEFAULT_SPLIT;

  /** Where the seam sits, as a percentage of the shell's width. */
  protected readonly split = signal(loadSplit());
  protected readonly dragging = signal(false);

  protected readonly splitCss = computed(() => `${this.split()}%`);

  /**
   * `aria-valuenow` wants a number, and a whole percent is what a screen reader
   * should read out. The signal itself stays fractional: rounding the drag would
   * make every step a ~19px jump on a 1920px window.
   */
  protected readonly splitNow = computed(() => Math.round(this.split()));

  private readonly shell = viewChild.required<ElementRef<HTMLElement>>('shell');

  /**
   * The shell's box, measured once when the drag starts. Nothing can move it
   * mid-gesture, and re-measuring per `pointermove` would be a forced layout on
   * every frame.
   */
  private track: { left: number; width: number } | null = null;

  constructor() {
    // Sanctioned effect: mirroring state into localStorage, as `editor-store.ts`
    // does for the draft and `sample-store.ts` for its settings.
    effect(() => {
      try {
        localStorage.setItem(STORAGE_KEY, String(this.split()));
      } catch {
        // Private browsing, or a full quota. The seam still drags this session.
      }
    });
  }

  protected onGrab(event: PointerEvent): void {
    const handle = event.target as HTMLElement;
    const box = this.shell().nativeElement.getBoundingClientRect();

    // Pointer capture is what keeps the drag attached once the pointer leaves
    // the 9px handle — which it does immediately. It also means `pointermove`
    // and `pointerup` can be bound on the handle itself rather than on the
    // document, so there is nothing to unsubscribe.
    handle.setPointerCapture(event.pointerId);
    this.track = { left: box.left, width: box.width };
    this.dragging.set(true);

    // Stops the press turning into a text selection in the pane underneath.
    event.preventDefault();
  }

  protected onDrag(event: PointerEvent): void {
    if (!this.track) {
      return;
    }

    const { left, width } = this.track;
    this.split.set(clampSplit(((event.clientX - left) / width) * 100));
  }

  protected onRelease(): void {
    // Capture is released implicitly on pointerup and pointercancel, so there is
    // only the drag state to drop.
    this.track = null;
    this.dragging.set(false);
  }
}
