import { Component, type ElementRef, computed, input, signal, viewChild } from '@angular/core';

import type { BudgetRow } from '@amk/spc/layout';
import { elementSize } from '../../shared/chart/element-size';
import { stackSegments } from '../../shared/chart/stack';

export type Group = BudgetRow['key'];

export interface Segment {
  group: Group;
  label: string;
  bytes: number;
}

/** A segment with its geometry resolved: everything one `<rect>` needs. */
interface Mark extends Segment {
  x: number;
  width: number;
  /** Centre of the mark, in px from the bar's left edge, where its tooltip points. */
  centre: number;
  /** The `fill-seg-*` utility this group is drawn in. */
  fill: string;
}

const HEIGHT = 16;
/** Surface gap between adjacent fills, so segments never read as one block. */
const GAP = 2;
const RADIUS = 4;
/**
 * Floor for any region that is present at all.
 *
 * Song data is small next to 64 KiB of ARAM — a few hundred bytes is well under
 * 1% — so without this the "your song" segment rounds away to nothing exactly
 * when you are starting a song and most want to see it.
 */
const MIN_SEGMENT = 3;

/**
 * Fill utilities, spelled out in full.
 *
 * These MUST stay complete literals. Tailwind v4 finds classes by scanning
 * source text, so a built-up name like `` `fill-seg-${group}` `` generates no
 * CSS at all and the marks render unfilled.
 */
const FILL: Record<Group, string> = {
  driver: 'fill-seg-driver',
  song: 'fill-seg-song',
  samples: 'fill-seg-samples',
  free: 'fill-seg-free',
  echo: 'fill-seg-echo',
};

let nextId = 0;

/**
 * The ARAM usage bar: a single stacked proportion bar.
 *
 * Angular-templated SVG, as the four inspector graphs are — but measured rather
 * than drawn in a fixed viewBox. `stackSegments` lays the bar out in pixels, so
 * the gap between fills and the floor under a small region are real sizes and
 * not fractions that dwindle as the bar narrows; `elementSize` supplies the
 * pixels as a signal, which lets the whole of the geometry be a `computed`.
 */
@Component({
  selector: 'amk-aram-bar',
  templateUrl: './aram-bar.html',
  host: { class: 'relative block' },
})
export class AramBar {
  readonly segments = input.required<Segment[]>();

  private readonly svg = viewChild.required<ElementRef<SVGSVGElement>>('svg');
  private readonly size = elementSize(this.svg);

  protected readonly hover = signal<Mark | null>(null);
  protected readonly clipId = `aram-bar-clip-${nextId++}`;
  protected readonly clipUrl = `url(#${this.clipId})`;
  protected readonly height = HEIGHT;
  protected readonly radius = RADIUS;

  /** The measured width, which is also the bar's own coordinate space. */
  protected readonly width = computed(() => this.size().width);

  /**
   * Absent until the bar has been measured.
   *
   * `null` removes the attribute, which keeps the first pass — before the
   * `ResizeObserver` has reported anything — from declaring a coordinate space
   * zero units wide.
   */
  protected readonly viewBox = computed(() => {
    const width = this.width();
    return width > 0 ? `0 0 ${width} ${HEIGHT}` : null;
  });

  /**
   * Pixel geometry for each segment, gaps and the visibility floor applied.
   *
   * Empty until the bar has a width: `stackSegments` answers with no geometry
   * rather than bad geometry, so the unmeasured pass simply draws nothing.
   */
  protected readonly marks = computed<Mark[]>(() => {
    const segments = this.segments();
    const placements = stackSegments(
      segments.map((segment) => ({ value: segment.bytes })),
      { width: this.width(), gap: GAP, minWidth: MIN_SEGMENT },
    );

    return placements.map((placement, index) => {
      const segment = segments[index];
      return {
        ...segment,
        ...placement,
        centre: placement.x + placement.width / 2,
        fill: FILL[segment.group],
      };
    });
  });

  protected readonly tooltip = computed(() => {
    const mark = this.hover();
    if (!mark) {
      return null;
    }

    return {
      x: mark.centre,
      text: `${mark.label}: ${mark.bytes.toLocaleString()} B`,
    };
  });
}
