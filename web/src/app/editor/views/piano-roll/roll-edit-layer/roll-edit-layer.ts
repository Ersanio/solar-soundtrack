import { Component, input } from '@angular/core';

import type { Preview, PreviewBar } from '../roll-preview';

/**
 * The gesture in flight, drawn over the song.
 *
 * Its own component, and inside the scrolled group above the notes, for the
 * reason the mark list is a `computed` snapped to the tick window: the marks
 * rebuild about twice per screen, and folding a per-frame drag into them would
 * rebuild the whole song's DOM on every pointer move. This layer holds only what
 * is moving.
 *
 * An attribute component on a real `<g>`, like the other four inside the roll's
 * `<svg>` — a component *element* there is an unknown SVG element with no layout
 * box, and neither it nor its children render.
 */
@Component({
  selector: 'g[amk-roll-edit]',
  templateUrl: './roll-edit-layer.html',
})
export class RollEditLayer {
  readonly preview = input.required<Preview | null>();
  readonly marquee = input.required<{ x: number; y: number; w: number; h: number } | null>();
  /** The note the next press would draw. Never set while a gesture is in flight. */
  readonly ghost = input.required<PreviewBar | null>();
  /** The channel's own fill, so a note being dragged stays the colour it is. */
  readonly fill = input.required<string>();
  /** The same channel's stroke, which is what outlines the ghost. */
  readonly stroke = input.required<string>();
  /** True while the gesture cannot be committed, which turns the live bars red. */
  readonly blocked = input.required<boolean>();
  /**
   * The length readout that follows a stretch.
   *
   * Drawn inside the `<svg>` rather than as the HTML bubble the volume slider
   * uses, because the roll's coordinates are already the song's: an HTML one
   * would have to undo the scroll transform and the scroller's own offset to
   * land in the same place this lands in by standing still.
   */
  readonly bubble = input.required<{ text: string; x: number; y: number } | null>();
}
