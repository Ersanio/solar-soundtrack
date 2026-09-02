import { Component, type ElementRef, computed, effect, signal, viewChild } from '@angular/core';

import { EditorPane } from './editor/editor-pane/editor-pane';
import { TopBar } from './editor/top-bar/top-bar';
import { OutputPane } from './output/output-pane/output-pane';
import { StatusBar } from './status-bar/status-bar';
import { UpdateBanner } from './update-banner/update-banner';
import { clamp } from './util/math';
import { readStored, writeStored } from './util/storage';

const SPLIT_KEY = 'solar-soundtrack.split';
const DRAWER_KEY = 'solar-soundtrack.drawer';
const DRAWER_COLLAPSED_KEY = 'solar-soundtrack.drawer-collapsed';

/**
 * How much of the width the editor may take, as a percentage.
 *
 * The ceiling is three quarters because the output pane holds the hex dump and
 * the ARAM budget, which stop being readable much below the quarter it leaves
 * them; the floor keeps the editor wide enough to still be worth typing in.
 * Between them the author chooses.
 */
const MIN_SPLIT = 25;
const MAX_SPLIT = 75;
const DEFAULT_SPLIT = 50;

/**
 * How much of the height the output drawer may take below `lg`, where the panes
 * stack, as a percentage.
 *
 * The floor is what still shows one panel's worth of the drawer; the ceiling
 * leaves the editor enough rows to be typed in above it.
 */
const MIN_DRAWER = 20;
const MAX_DRAWER = 70;
const DEFAULT_DRAWER = 40;

/** Which seam is being dragged: the column seam moves `split`, the row seam moves `drawer`. */
type Axis = 'x' | 'y';

function clampSplit(value: number): number {
  return clamp(value, MIN_SPLIT, MAX_SPLIT);
}

function clampDrawer(value: number): number {
  return clamp(value, MIN_DRAWER, MAX_DRAWER);
}

/**
 * The stored percentage under `key`, or `fallback` if there is nothing usable
 * there.
 *
 * `Number(null)` and `Number('')` are both `0`, so the `> 0` guard covers a
 * missing key and an empty one as well as text that does not parse.
 */
function loadPercent(key: string, fallback: number, clampTo: (value: number) => number): number {
  const stored = Number(readStored(key));

  return Number.isFinite(stored) && stored > 0 ? clampTo(stored) : fallback;
}

/** Whether the drawer was left folded; anything but the one word that says so is open. */
function loadDrawerCollapsed(): boolean {
  return readStored(DRAWER_COLLAPSED_KEY) === 'closed';
}

@Component({
  selector: 'amk-root',
  imports: [UpdateBanner, TopBar, EditorPane, OutputPane, StatusBar],
  templateUrl: './app.html',
  host: { class: 'flex h-screen flex-col' },
})
export class App {
  protected readonly DEFAULT_SPLIT = DEFAULT_SPLIT;
  protected readonly DEFAULT_DRAWER = DEFAULT_DRAWER;

  /** Where the column seam sits, as a percentage of the shell's width. */
  protected readonly split = signal(loadPercent(SPLIT_KEY, DEFAULT_SPLIT, clampSplit));

  /**
   * How tall the output drawer is below `lg`, as a percentage of the shell's
   * height. It hangs from the bottom, so the row seam sits this far up.
   */
  protected readonly drawer = signal(loadPercent(DRAWER_KEY, DEFAULT_DRAWER, clampDrawer));

  /** Whether the drawer is folded to the header row the output pane leaves visible. */
  protected readonly drawerCollapsed = signal(loadDrawerCollapsed());

  protected readonly dragging = signal(false);

  protected readonly splitCss = computed(() => `${this.split()}%`);
  protected readonly drawerCss = computed(() => `${this.drawer()}%`);

  /**
   * The row seam is only ever a seam below `lg`, and not even there while the
   * drawer is folded. Two complete literals rather than `hidden` stacked on
   * `lg:hidden`, so Tailwind's scanner sees both.
   */
  protected readonly rowSeamClass = computed(() =>
    this.drawerCollapsed()
      ? "bg-edge hover:bg-control relative h-px shrink-0 cursor-row-resize touch-none before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] hidden"
      : "bg-edge hover:bg-control relative h-px shrink-0 cursor-row-resize touch-none before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] lg:hidden",
  );

  /**
   * The output pane's place in the shell: a grid column at `lg`, and below it a
   * drawer whose height is `--amk-drawer` — or, folded, whatever the header row
   * the pane leaves visible needs.
   */
  protected readonly sidebarClass = computed(() =>
    this.drawerCollapsed()
      ? 'border-edge min-h-0 max-lg:shrink-0 max-lg:border-t'
      : 'border-edge min-h-0 max-lg:h-[var(--amk-drawer)] max-lg:shrink-0 max-lg:border-t',
  );

  private readonly shell = viewChild.required<ElementRef<HTMLElement>>('shell');

  /**
   * The shell's extent along the seam's axis, measured once when the drag
   * starts. Nothing can move it mid-gesture, and re-measuring per `pointermove`
   * would be a forced layout on every frame. The two seams are one shape on two
   * axes, and this is where the axis is chosen.
   */
  private track: { axis: Axis; start: number; length: number } | null = null;

  constructor() {
    // Sanctioned effects: mirroring state into localStorage, as `editor-store.ts`
    // does for the draft and `sample-store.ts` for its settings.
    effect(() => writeStored(SPLIT_KEY, String(this.split())));
    effect(() => writeStored(DRAWER_KEY, String(this.drawer())));
    effect(() => writeStored(DRAWER_COLLAPSED_KEY, this.drawerCollapsed() ? 'closed' : 'open'));
  }

  protected toggleDrawer(): void {
    this.drawerCollapsed.update((collapsed) => !collapsed);
  }

  protected onGrab(event: PointerEvent, axis: Axis): void {
    const handle = event.target as HTMLElement;
    const box = this.shell().nativeElement.getBoundingClientRect();

    // Pointer capture is what keeps the drag attached once the pointer leaves
    // the 13px handle — which it does immediately. It also means `pointermove`
    // and `pointerup` can be bound on the handle itself rather than on the
    // document, so there is nothing to unsubscribe.
    handle.setPointerCapture(event.pointerId);
    this.track =
      axis === 'x'
        ? { axis, start: box.left, length: box.width }
        : { axis, start: box.top, length: box.height };
    this.dragging.set(true);

    // Stops the press turning into a text selection in the pane underneath.
    event.preventDefault();
  }

  protected onDrag(event: PointerEvent): void {
    if (!this.track) {
      return;
    }

    const { axis, start, length } = this.track;
    const percent = (((axis === 'x' ? event.clientX : event.clientY) - start) / length) * 100;

    if (axis === 'x') {
      this.split.set(clampSplit(percent));
    } else {
      // The drawer hangs from the bottom, so its height is what is left below the seam.
      this.drawer.set(clampDrawer(100 - percent));
    }
  }

  protected onRelease(): void {
    // Capture is released implicitly on pointerup and pointercancel, so there is
    // only the drag state to drop.
    this.track = null;
    this.dragging.set(false);
  }
}
