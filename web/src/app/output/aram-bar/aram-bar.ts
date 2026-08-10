import {
  Component,
  type ElementRef,
  afterRenderEffect,
  computed,
  input,
  signal,
  viewChild,
} from '@angular/core';
// Import from d3 submodules, never the `d3` metapackage: it re-exports every
// module and does not fully tree-shake, which measured +17 kB raw / +4.8 kB
// transfer for these same two symbols.
import { select } from 'd3-selection';

import type { BudgetRow } from '@amk/spc/layout';
import { elementSize } from '../../shared/chart/element-size';
import { stackSegments } from '../../shared/chart/stack';

export type Group = BudgetRow['key'];

export interface Segment {
  group: Group;
  label: string;
  bytes: number;
}

interface Placed extends Segment {
  x: number;
  width: number;
}

interface Hover {
  segment: Segment;
  /** Centre of the hovered mark, in px from the bar's left edge. */
  x: number;
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
 * The ARAM usage bar: a single stacked proportion bar drawn with d3.
 *
 * d3 owns the `<svg>` subtree and Angular does not template into it — the two
 * would otherwise fight over the same nodes. Angular still renders the tooltip,
 * which is plain HTML positioned over the chart, so hover state stays a signal
 * rather than something d3 keeps privately.
 *
 * Redraw is driven by `afterRenderEffect`'s write phase: it tracks the segment
 * and size signals, and runs after Angular has laid the host element out, which
 * is what makes the measured width correct on the first pass.
 */
@Component({
  selector: 'amk-aram-bar',
  templateUrl: './aram-bar.html',
  host: { class: 'relative block' },
})
export class AramBar {
  readonly segments = input.required<Segment[]>();
  /** A name for the bar. */
  readonly label = input('ARAM usage by region');

  private readonly svg = viewChild.required<ElementRef<SVGSVGElement>>('svg');
  protected readonly size = elementSize(this.svg);

  protected readonly hover = signal<Hover | null>(null);
  protected readonly clipId = `aram-bar-clip-${nextId++}`;
  protected readonly height = HEIGHT;

  protected readonly tooltip = computed(() => {
    const hover = this.hover();
    if (!hover) {
      return null;
    }

    return {
      x: hover.x,
      text: `${hover.segment.label}: ${hover.segment.bytes.toLocaleString()} B`,
    };
  });

  constructor() {
    afterRenderEffect({ write: () => this.draw() });
  }

  /** Pixel geometry for each segment, gaps and the visibility floor applied. */
  private place(width: number): Placed[] {
    const segments = this.segments();
    const placements = stackSegments(
      segments.map((segment) => ({ value: segment.bytes })),
      { width, gap: GAP, minWidth: MIN_SEGMENT },
    );
    return placements.map((placement, index) => ({ ...segments[index], ...placement }));
  }

  private draw(): void {
    const element = this.svg().nativeElement;
    const { width } = this.size();
    const svg = select(element);

    if (width <= 0) {
      svg.selectAll('*').remove();
      return;
    }

    svg.attr('viewBox', `0 0 ${width} ${HEIGHT}`);

    // Rounding the outer ends only: a clip path over the whole bar, rather than
    // per-rect corner radii, which would round the internal joins too.
    let defs = svg.selectAll<SVGDefsElement, null>('defs').data([null]);
    defs = defs.enter().append('defs').merge(defs);
    defs
      .selectAll<SVGClipPathElement, null>('clipPath')
      .data([null])
      .join((enter) => enter.append('clipPath').attr('id', this.clipId))
      .selectAll<SVGRectElement, null>('rect')
      .data([null])
      .join('rect')
      .attr('width', width)
      .attr('height', HEIGHT)
      .attr('rx', RADIUS);

    let group = svg.selectAll<SVGGElement, null>('g').data([null]);
    group = group.enter().append('g').merge(group);
    group.attr('clip-path', `url(#${this.clipId})`);

    group
      .selectAll<SVGRectElement, Placed>('rect')
      .data(this.place(width), (segment) => segment.group)
      .join('rect')
      // Fill comes from a Tailwind utility, so the palette stays in styles.css
      // and is not duplicated as hex literals in the drawing code.
      .attr('class', (segment) => FILL[segment.group])
      .attr('x', (segment) => segment.x)
      .attr('y', 0)
      .attr('width', (segment) => segment.width)
      .attr('height', HEIGHT)
      .on('mouseenter', (_event, segment) =>
        this.hover.set({ segment, x: segment.x + segment.width / 2 }),
      )
      .on('mouseleave', () => this.hover.set(null));
  }
}
