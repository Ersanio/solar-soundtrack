import { Component, computed, inject, input, output, signal } from '@angular/core';

import { CommandIcon } from '../../../command-palette/command-icon';
import { EditorRequests } from '../../../../state/editor-requests';
import { EditorStore } from '../../../../state/editor-store';
import type { CommandLane, LaneGlyph } from '../roll-command-lane';
import { type GridLine, RollGrid } from '../roll-grid/roll-grid';
import { KEY_WIDTH, LANE_HEIGHT, LANE_ROW } from '../roll-metrics';

/**
 * The command lane: the commands a note bar cannot carry, on the song's own
 * timeline and with the note data out of the way.
 *
 * Drawn in the roll's **own** coordinates, like the scrub bar above it — the
 * same `viewBox`, the same key column, the same scroll transform, and the same
 * `RollGrid` behind it — so a command is at the same x as the note it acts on
 * and lands on the same rule. Its `<svg>` is its own root, so nothing here needs
 * the `svg:` prefix an attribute component's template does.
 *
 * Everything in it is a command *taking effect*, so nothing here wears the
 * inverted plate a bar's glyph does: a bar draws what a note defines beside what
 * it inherits and has to tell them apart, and nothing in this is inherited.
 *
 * It writes to `EditorRequests` itself, as the roll's own bars do. It does not
 * pick the edit channel with it, which a bar's glyph does: this holds all eight,
 * and a `t` belongs to none of them.
 */
@Component({
  selector: 'amk-roll-command-lane',
  imports: [CommandIcon, RollGrid],
  templateUrl: './roll-command-lane.html',
  host: { class: 'border-edge bg-raised block shrink-0 border-t' },
})
export class RollCommandLane {
  private readonly editor = inject(EditorStore);

  private readonly requests = inject(EditorRequests);

  /** The lane's `viewBox`. Null until the pane is measured, so the parent withholds it. */
  readonly box = input.required<string>();
  /** The pane's width, which is the lane's, in CSS pixels. */
  readonly width = input.required<number>();
  readonly rollWidth = input.required<number>();
  /** The roll's scroll transform, so a glyph cannot drift from the note below it. */
  readonly scroll = input.required<string>();
  /** The playhead's x, which is the roll's own line's. */
  readonly playheadX = input.required<number>();
  /** The roll's own grid, so a glyph reads against the same bars and beats. */
  readonly lines = input.required<readonly GridLine[]>();
  readonly loopX = input.required<number | null>();
  readonly endX = input.required<number | null>();
  /** The window's glyphs, and the whole song's depth. */
  readonly lane = input.required<CommandLane>();

  /** A wheel the lane does not use itself, which is the roll's zoom and its pan. */
  readonly wheeled = output<WheelEvent>();

  protected readonly keyWidth = KEY_WIDTH;
  protected readonly laneHeight = LANE_HEIGHT;

  /**
   * How far the stack is lifted, in pixels.
   *
   * A transform and not a scroller. The project styles no scrollbars, so a
   * native one is the platform's — some fifteen pixels of a lane forty-two tall
   * — and its gutter comes out of the content box, which would make the lane
   * narrower than the roll it is drawn to track and put its right edge out of
   * step by that much.
   */
  private readonly lifted = signal(0);

  /** Past the bottom of the lane, or zero where the whole stack fits. */
  private readonly reach = computed(() => Math.max(0, this.lane().depth * LANE_ROW - LANE_HEIGHT));

  protected readonly offset = computed(() => Math.min(this.lifted(), this.reach()));

  protected readonly stack = computed(() => `translate(0 ${(-this.offset()).toFixed(2)})`);

  /** The thumb, drawn inside the `<svg>` so it costs the lane no width. */
  protected readonly thumb = computed(() => {
    const reach = this.reach();
    if (reach <= 0) {
      return null;
    }

    const shown = LANE_HEIGHT / (this.lane().depth * LANE_ROW);
    const height = Math.max(6, LANE_HEIGHT * shown);
    return { y: (this.offset() / reach) * (LANE_HEIGHT - height), height };
  });

  /**
   * Whether the editor still shows the text that compiled.
   *
   * The same test the roll's bars take: a span into a document that has changed
   * underneath points at the wrong thing.
   */
  private readonly inSync = computed(() => this.editor.compiledText() === this.editor.source());

  protected onWheel(event: WheelEvent): void {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      this.wheeled.emit(event);
      return;
    }

    if (this.reach() <= 0) {
      return;
    }

    event.preventDefault();
    const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
    this.lifted.set(Math.max(0, Math.min(this.offset() + delta, this.reach())));
  }

  /** A single click asks the inspector about the command; a double click goes to it. */
  protected inspect(glyph: LaneGlyph, event: Event, show = false): void {
    event.stopPropagation();
    if (this.inSync()) {
      this.requests.reveal.set({ span: { ...glyph.span }, show });
    }
  }
}
