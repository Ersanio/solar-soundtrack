import { Component, computed, inject, input, output, signal } from '@angular/core';

import type { Command } from '@amk/tokens';
import { CommandIcon } from '../../../command-palette/command-icon';
import { noteHeardOn } from '../../../../state/commands-in-force';
import { EditorRequests } from '../../../../state/editor-requests';
import { EditorStore } from '../../../../state/editor-store';
import { type CommandLane, type LaneGlyph, laneGlyphX } from '../roll-command-layout';
import {
  type MoveTarget,
  commandMoveRefusal,
  commandMoveTargets,
  eraseCommand,
  nearestTarget,
  planCommandMove,
} from '../roll-command-move';
import { isEdits } from '../roll-edit';
import { SLOP_PX } from '../roll-gesture';
import { type GridLine, RollGrid } from '../roll-grid/roll-grid';
import { KEY_WIDTH, LANE_ROW } from '../roll-metrics';
import { type Strip, type StripRefusal, channelStrip, isStrip } from '../roll-strip';

/** A press on a glyph, held until it becomes a drag or turns out to be a click. */
interface LaneDrag {
  glyph: LaneGlyph;
  /** Client coordinates at the press: the x a move is measured from, the y for the slop alone. */
  atX: number;
  atY: number;
  /** The document it was made against — an edit built for one that has moved answers nothing. */
  source: string;
}

/**
 * The command lane: every command the song puts in force, on the song's own
 * timeline and with the note data out of the way.
 *
 * The bars draw the commands acting on each note; this draws them where the
 * driver reads them, whether or not a note begins there — the two answer
 * different questions, and the lane is the only place the whole song's commands
 * can be read in the order they run.
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
  // No border of its own: the seam above it is a real element the porter drags,
  // and a border under that would draw the line twice.
  host: { class: 'bg-raised block shrink-0' },
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
  /** Pixels per tick, which is what turns a drag's travel into ticks. */
  readonly zoom = input.required<number>();
  /** How tall the lane is drawn, which the seam above it sets. */
  readonly laneHeight = input.required<number>();
  /** The song's own length, which holds the end glyphs inside it. */
  readonly songTicks = input.required<number>();
  /**
   * The command the inspector is answering about, which the lane rings.
   *
   * The roll's, rather than read off the caret here: the bars ring it too, and
   * one signal is what stops the two layers coming to different answers.
   * Compared by **identity**, which is what makes `[[ v100 v200 ]]2` right — one
   * written `v200` runs twice, so two glyphs carry the one `Command` and both are
   * rung, it being one command wherever the driver reads it.
   */
  readonly inspected = input.required<Command | null>();

  /** A wheel the lane does not use itself, which is the roll's zoom and its pan. */
  readonly wheeled = output<WheelEvent>();

  /**
   * A command was picked here, so the roll should let go of its notes.
   *
   * An output, as `RollNotes.channelPicked` is one, and for the same reason: the
   * selection is a set of indices into the roll's own strip, which this knows
   * nothing about and holds all eight channels' commands regardless.
   */
  readonly commandPicked = output<void>();

  protected readonly keyWidth = KEY_WIDTH;

  /**
   * How far the stack is lifted, in pixels.
   *
   * A transform and not a scroller. The project styles no scrollbars, so a
   * native one is the platform's — some fifteen pixels of a lane seventy tall
   * — and its gutter comes out of the content box, which would make the lane
   * narrower than the roll it is drawn to track and put its right edge out of
   * step by that much.
   */
  private readonly lifted = signal(0);

  /**
   * Past the bottom of the lane, or zero where the whole stack fits.
   *
   * Taking the lane taller shrinks this, and {@link offset} is the lift held
   * against it — so a stack scrolled to its end rises to meet the new bottom
   * rather than leaving a band of empty rows under it.
   */
  private readonly reach = computed(() =>
    Math.max(0, this.lane().depth * LANE_ROW - this.laneHeight()),
  );

  protected readonly offset = computed(() => Math.min(this.lifted(), this.reach()));

  protected readonly stack = computed(() => `translate(0 ${(-this.offset()).toFixed(2)})`);

  /** The thumb, drawn inside the `<svg>` so it costs the lane no width. */
  protected readonly thumb = computed(() => {
    const reach = this.reach();
    if (reach <= 0) {
      return null;
    }

    const height = this.laneHeight();
    const shown = Math.max(6, (height * height) / (this.lane().depth * LANE_ROW));
    return { y: (this.offset() / reach) * (height - shown), height: shown };
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

  /**
   * A single click asks the inspector about the command; a double click goes to
   * it. It points `inspecting` at the note the command is heard on, so a value
   * committed from the panel it opens replays that note, as one committed for a
   * bar's chip replays the bar's — and at nothing where no note is left to hear it.
   *
   * It lets go of the roll's outlines, which are indices into a strip only the
   * roll has and so go back up as {@link commandPicked}: a lane glyph names a
   * command of the song, and a note outlined beside it would be two subjects at
   * once, with `Delete` meaning one of them.
   */
  protected inspect(glyph: LaneGlyph, event: Event, show = false): void {
    event.stopPropagation();
    if (this.inSync()) {
      const heard = noteHeardOn(
        this.editor.timeline()?.notes ?? [],
        this.editor.commandsInForce(),
        glyph,
      );
      this.requests.inspecting.set(
        heard === null ? null : { address: heard.address, tick: heard.tick },
      );
      this.commandPicked.emit();
      this.requests.reveal.set({ span: { ...glyph.span }, show });
    }
  }

  /**
   * A right click deletes the command, which is the roll's own erase idiom.
   *
   * The counterweight to a rule that keeps more than it removes: an edit gives a
   * command back to a note that still needs it, and this is how the porter says
   * no note does. `preventDefault` is load-bearing rather than tidy — this
   * `<svg>` is a sibling of the roll's scroller, so nothing there sees the event
   * and the browser menu would open over the lane.
   *
   * Through `applyAll`, so one right click is one undo step; and through
   * `eraseCommand`, which the `Delete` key goes through as well — `removable` is
   * that function's own precondition, kept on the glyph for the cursor and the
   * hover, which are the only things on screen that say the delete is there.
   */
  protected erase(glyph: LaneGlyph, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.inSync()) {
      return;
    }

    // Keeps the notes: a command taken out adds and removes none, so the roll's
    // selection still names the notes it named.
    const edit = eraseCommand(this.editor.source(), glyph.command);
    this.requests.applyAll(edit ? [edit] : null, null, true);
  }

  // --- carrying a command to another tick ------------------------------------

  private readonly held = signal<LaneDrag | null>(null);

  /**
   * The tick the pointer is asking for.
   *
   * Its own signal rather than a field of {@link held}, so that the strip below
   * does not depend on the pointer: `channelStrip` walks every token and every
   * command in the song, and one object carrying both would rebuild it on every
   * pointer move.
   */
  private readonly toTick = signal(0);

  /** Whether the press has passed the slop and become a drag. */
  private readonly moved = signal(false);

  /** The held glyph's channel as something splices can be planned against. */
  private readonly dragStrip = computed<Strip | StripRefusal | null>(() => {
    const drag = this.held();
    const result = this.editor.result();
    const timeline = this.editor.timeline();
    if (drag === null || !result?.ok || !timeline || !this.inSync()) {
      return null;
    }

    return channelStrip({
      source: this.editor.source(),
      channel: drag.glyph.channel,
      noteMap: result.noteMap ?? [],
      commandMap: result.commandMap ?? [],
      timeline,
      index: this.editor.tokens(),
      tempoRatio: result.stats?.tempoRatio ?? 1,
    });
  });

  /** Where a drop would put the held command, or `null` while there is nowhere for it. */
  private readonly dragTarget = computed<MoveTarget | null>(() => {
    const strip = this.dragStrip();
    return strip !== null && isStrip(strip)
      ? nearestTarget(commandMoveTargets(strip), this.toTick())
      : null;
  });

  /** Why the drop will change nothing, in the words the channel or the move gives. */
  protected readonly dragRefusal = computed<string | null>(() => {
    const drag = this.held();
    const strip = this.dragStrip();
    if (drag === null || !this.moved() || strip === null) {
      return null;
    }

    return isStrip(strip) ? commandMoveRefusal(strip, drag.glyph.command) : strip.refused;
  });

  /**
   * The glyph as the pointer is carrying it.
   *
   * A refused drag keeps its glyph where the command still is, and red: the
   * porter is being told this cannot go, which needs the thing that cannot go to
   * still be on screen. The lane's own copy stands aside for it either way, or
   * the command would be painted twice.
   */
  protected readonly carried = computed(() => {
    const drag = this.held();
    const target = this.dragTarget();
    if (drag === null || !this.moved()) {
      return null;
    }

    const blocked = this.dragRefusal() !== null || target === null;
    return {
      glyph: drag.glyph,
      // Through the same anchoring the pack uses, or the ghost would sit half a
      // glyph off from where letting go actually puts it.
      x:
        blocked || target === null
          ? drag.glyph.x
          : laneGlyphX(target.tick, this.zoom(), this.songTicks()),
      blocked,
    };
  });

  /**
   * A press on a glyph, which may still turn out to be a click.
   *
   * Neither the pointer nor the default is taken here: both stop the browser
   * raising `click` and `dblclick`, which are the reveal and the go-to. The
   * capture is taken on the first move past the slop instead, which is late
   * enough to leave a click alone and early enough to follow the pointer off the
   * glyph — the roll's own rule.
   */
  protected onGlyphDown(glyph: LaneGlyph, event: PointerEvent): void {
    if (event.button !== 0 || !glyph.removable || !this.inSync()) {
      return;
    }

    this.held.set({ glyph, atX: event.clientX, atY: event.clientY, source: this.editor.source() });
    this.toTick.set(glyph.tick);
    this.moved.set(false);
  }

  /**
   * Bound on the lane's `<svg>` and not on the glyph, which a fast first move can
   * leave before there is a capture to hold it.
   */
  protected onLaneMove(event: PointerEvent): void {
    const drag = this.held();
    if (drag === null) {
      return;
    }

    if (
      !this.moved() &&
      (Math.abs(event.clientX - drag.atX) > SLOP_PX || Math.abs(event.clientY - drag.atY) > SLOP_PX)
    ) {
      this.moved.set(true);
      if (event.currentTarget instanceof Element) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    }

    // The travel and not the pointer's own x: the roll scrolls under a still
    // pointer for the whole of a followed playback, and a tick read off the
    // camera would wander with it. Vertical movement is read for the slop above
    // and for nothing else — lane rows are packing, so they say nothing.
    const zoom = this.zoom();
    this.toTick.set(
      zoom > 0 ? drag.glyph.tick + (event.clientX - drag.atX) / zoom : drag.glyph.tick,
    );
  }

  /** The drop. A press that never passed the slop is a click and commits nothing. */
  protected onLaneUp(event: PointerEvent): void {
    const drag = this.held();
    const strip = this.dragStrip();
    const target = this.dragTarget();
    const moved = this.moved();

    if (
      event.currentTarget instanceof Element &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    this.held.set(null);
    this.moved.set(false);
    if (drag === null || !moved || strip === null || !isStrip(strip) || target === null) {
      return;
    }

    // The glyph's span came off the lane as it was drawn for the document the
    // press was made against.
    if (!this.inSync() || this.editor.source() !== drag.source) {
      return;
    }

    const outcome = planCommandMove(
      this.editor.source(),
      strip,
      drag.glyph.command,
      drag.glyph.tick,
      target,
    );
    // An empty list is a drop that changes nothing, which `applyAll` ignores, so
    // a command let go where it already runs costs no undo step.
    if (isEdits(outcome)) {
      // Keeps the notes: a command carried to another tick moves none, so the
      // roll's selection outlives the splice.
      this.requests.applyAll(outcome, null, true);
    }
  }

  protected onLaneCancel(): void {
    this.held.set(null);
    this.moved.set(false);
  }
}
