import type { Span } from '@amk/core/types';
import type { LoopRun, WalkNote } from '@amk/spc/song-walk';
import type { Command } from '@amk/tokens';
import { type CommandGlyph } from '../../command-palette/command-icon';
import { glyphOf } from '../../command-palette/glyph-of';
import { definedAt } from '../../../state/commands-in-force';
import { type PlaceContext, keyOf, placeOf } from './percussion';
import {
  CHANNEL_FILL,
  KEY_WIDTH,
  LOOP_LABEL_INSET,
  LOOP_LABEL_SIZE,
  MUTED_OPACITY,
  NOTE_GAP,
  OVERVIEW_HEIGHT,
  OVERVIEW_PAD,
  barRect,
  loopBox,
} from './roll-metrics';
import type { PassShift, ShiftBoundaries } from './roll-edit';
import { fitBarContent, plateWidth } from './roll-bar-text';
import { type LaneStack, keyName, noteLabel, overviewOffset } from './roll-layout';

/**
 * The three pictures of the song, and the one function that places a note in all
 * of them.
 *
 * The roll's bars, the overview bar's minimap and the lit keys all ask
 * {@link rowOf} rather than each working a row out for itself, so an instrument
 * taken off the percussion lanes moves to the keyboard in every one of them at
 * once. Answering that question three times is how they would drift, which is
 * why the builders share a file.
 */

/** Shared by every bar with nothing acting on it, which on a plain song is most. */
const NOTHING_DEFINED: ReadonlySet<Command> = new Set<Command>();

/** One glyph on a bar: a command acting on that note, and where to draw it. */
export interface MarkGlyph {
  id: string;
  icon: CommandGlyph;
  x: number;
  y: number;
  size: number;
  /** The command's own span, which is what a click on it selects. */
  span: Span;
  /** For the tooltip, since a glyph has no room to say what it is. */
  label: string;
  /** This note puts the command in force, where the rest of a run inherits it. */
  defining: boolean;
}

/** One note, with everything the template needs already resolved. */
export interface Mark {
  id: string;
  x: number;
  w: number;
  gateW: number;
  y: number;
  h: number;
  fill: string;
  /** Dimmed rather than hidden, so a muted part still reads as part of the song. */
  opacity: number;
  /** Drawn behind the audible marks and inert to the pointer, so a live note over it is the one hit. */
  muted: boolean;
  /** `C6` on a key, `@23` on a drum lane. `null` when the bar has no room. */
  label: { text: string; x: number; y: number; size: number } | null;
  /** As many as fit; the inspector is where the whole list is. */
  glyphs: readonly MarkGlyph[];
  /**
   * Of every command acting on the note, the ones it puts in force.
   *
   * The whole set and not only the drawn glyphs': the hover names the commands
   * the bar had no room for, and it reads this rather than asking again, so the
   * two cannot answer differently.
   */
  defining: ReadonlySet<Command>;
  /**
   * The "and more" mark, drawn when the bar had room for only some of them.
   *
   * `defining` when one of the commands it stands for takes effect at this note,
   * so it wears the same plate a defining glyph does: the mark is what is left
   * of that glyph, and a bar too narrow to show it would otherwise say the note
   * inherits everything it plays under.
   */
  more: { x: number; y: number; size: number; defining: boolean } | null;
  note: WalkNote;
}

/** One note on the overview bar's minimap, in its channel's colour. */
export interface MinimapBar {
  id: string;
  x: number;
  w: number;
  y: number;
  h: number;
  /** The same class the roll's own bar for this note carries. */
  fill: string;
  /** Dimmed rather than dropped, so a muted part still reads as part of the song. */
  opacity: number;
}

/**
 * Which row a note belongs on.
 *
 * The placement itself is `placeOf`, which the fitted range is built from too,
 * so the two cannot disagree. This only turns its answer into a row.
 *
 * By instrument, not by note byte: every note played while a drum is loaded is
 * that drum being hit, so `@29 c d e` is three hits on one lane rather than
 * one drum and two notes scattered across the keyboard. The pitched ones only
 * look melodic because `parser.ts:2681` stops remapping after the first.
 */
export function rowOf(note: WalkNote, stack: LaneStack, context: PlaceContext): number {
  switch (placeOf(note, context)) {
    case 'drum':
      return stack.rowOfDrum.get(note.state.instrument ?? -1) ?? -1;

    case 'noise':
      return stack.noiseRow;

    case 'key': {
      const key = keyOf(note, context);

      return key === null ? -1 : (stack.rowOfKey.get(key) ?? -1);
    }

    case 'none':
      return -1;
  }
}

/**
 * What a note is called, which is the bar's name and the tooltip's heading.
 *
 * One helper for both, so a bar cannot say one thing and its own hover
 * another. Derived from where the mark actually sits: a bare `$D0` whose drum
 * the porter has taken off the lanes is drawn on a key, and calling it `@29`
 * would name a row it is not on.
 */
export function headingOf(note: WalkNote, context: PlaceContext, short = true): string {
  const place = placeOf(note, context);
  const key = keyOf(note, context);
  if (place === 'key' && key !== null) {
    return short ? noteLabel(key) : keyName(key);
  }

  return `@${note.state.instrument ?? 0}`;
}

export interface MarkRequest {
  notes: readonly WalkNote[];
  stack: LaneStack;
  context: PlaceContext;
  /** The tick window to draw, from `tickWindow`. */
  from: number;
  to: number;
  /** Pixels per tick. */
  zoom: number;
  rowHeight: number;
  /** Channel index to whether it is heard; a missing entry counts as audible. */
  audible: ReadonlyMap<number, boolean>;
  inForce: (note: WalkNote) => readonly Command[];
}

export function buildMarks(request: MarkRequest): Mark[] {
  const { notes, stack, context, from, to, zoom, rowHeight, audible, inForce } = request;
  if (zoom <= 0) {
    return [];
  }

  // Muted marks are drawn first, so a live note over one is the one on top.
  // Each list keeps the walk's own tick-then-channel order.
  const behind: Mark[] = [];
  const front: Mark[] = [];

  // Which commands a note puts in force is the list against the one before it on
  // its channel, and the walk's order is this loop's, so the neighbour is free
  // here where anything asking per note would have to go looking. Taken above
  // both guards: a note off the screen, or on no row at all, is still the note
  // the next one follows.
  const last: (WalkNote | null)[] = new Array<WalkNote | null>(CHANNEL_FILL.length).fill(null);

  for (const note of notes) {
    const previous = last[note.channel];
    last[note.channel] = note;

    if (note.tick > to || note.tick + note.ticks < from) {
      continue;
    }

    const row = rowOf(note, stack, context);
    if (row < 0) {
      continue;
    }

    const { y, w, h } = barRect(row, rowHeight, note.ticks, zoom);
    const x = note.tick * zoom;

    const acting = inForce(note).map((command) => ({
      command,
      entry: glyphOf(command),
    }));
    // Only the notes on screen ask, so the neighbour's list is fetched at most
    // once per drawn bar and the lookup's cache answers all but the first of a
    // run. A note with nothing acting on it needs no comparison at all.
    const defining =
      acting.length === 0
        ? NOTHING_DEFINED
        : definedAt(
            acting.map((each) => each.command),
            previous === null ? [] : inForce(previous),
          );

    // The ones the note puts in force lead, and the slot order the list arrives
    // in holds within each half. A bar drops from the end, so what survives a
    // narrow one is what starts at this note rather than whatever `SLOTS`
    // happens to name first — a `q` no note has touched for a page outranked
    // the `v` the bar was drawn to show.
    const glyphed = acting.filter((each) => each.entry !== null);
    const drawable =
      defining.size === 0
        ? glyphed
        : [
            ...glyphed.filter((each) => defining.has(each.command)),
            ...glyphed.filter((each) => !defining.has(each.command)),
          ];
    const name = headingOf(note, context);
    const content = fitBarContent(w, h, name, drawable.length);
    const muted = audible.get(note.channel) === false;

    (muted ? behind : front).push({
      id: `${note.address}:${note.tick}:${note.channel}`,
      x,
      w,
      gateW: Math.max(1, note.gateTicks * zoom - NOTE_GAP),
      y,
      h,
      fill: CHANNEL_FILL[note.channel],
      opacity: muted ? MUTED_OPACITY : 1,
      muted,
      label:
        content.name === null
          ? null
          : { text: name, x: x + content.name.x, y: y + content.name.y, size: content.name.size },
      // `fitBarContent` returns however many fit, taken from the front of the
      // list, so the glyphs that survive a narrow bar are the same ones every
      // time rather than shuffling as the roll is zoomed.
      glyphs: content.glyphs.map((box, at) => ({
        id: `${note.address}:${note.tick}:${drawable[at].command.span.start}`,
        icon: drawable[at].entry!.icon,
        x: x + box.x,
        y: y + box.y,
        size: box.size,
        span: drawable[at].command.span,
        label: drawable[at].entry!.label,
        defining: defining.has(drawable[at].command),
      })),
      defining,
      more:
        content.more === null
          ? null
          : {
              x: x + content.more.x,
              y: y + content.more.y,
              size: content.more.size,
              // The ones it stands for are the tail, the boxes having been
              // handed back in the list's own order; `charttest` pins that.
              defining: drawable
                .slice(content.glyphs.length)
                .some((each) => defining.has(each.command)),
            },
      note,
    });
  }

  return [...behind, ...front];
}

export interface MinimapRequest {
  notes: readonly WalkNote[];
  stack: LaneStack;
  context: PlaceContext;
  /** The song's whole length, which is the bar's width. */
  ticks: number;
  /** The roll's width, less the key column. */
  width: number;
  /** Channel index to whether it is heard; a missing entry counts as audible. */
  audible: ReadonlyMap<number, boolean>;
}

/**
 * The whole song, drawn small.
 *
 * Built from the song, the lane stack, the pane's width and the mixer, and
 * deliberately **not** from the playhead — the bars are the song rather than a
 * view of it, so this rebuilds on a recompile, a percussion change, a mute or a
 * resize, and never on a frame. The moving parts of the bar are the component's
 * own.
 */
export function buildMinimap(request: MinimapRequest): MinimapBar[] {
  const { notes, stack, context, ticks, width, audible } = request;
  const rows = stack.lanes.length;
  if (ticks <= 0 || width <= 0 || rows <= 0) {
    return [];
  }

  const inner = OVERVIEW_HEIGHT - OVERVIEW_PAD * 2;
  const h = Math.max(1, inner / rows);

  // Keyed by the pixel a bar lands on, the row it lands in and the channel it
  // belongs to. One channel's two notes through a pixel of a row are the same
  // picture, and keeping the wider of them holds a long note's reach against a
  // short one starting alongside it; two channels' are two pictures, since the
  // colour is which channel it is, and a key without the channel in it takes the
  // narrower of them out of the minimap altogether — two channels sharing a drum
  // lane is the commonest way that happens. Never more bars than notes, and far
  // fewer on a dense song, which is what keeps the whole song inside the DOM.
  //
  // Muted in one map and audible in the other, so a live bar is never veiled by
  // the wash of a channel that cannot be heard. Two maps rather than one and a
  // partition after it: a channel is silenced or it is not, so a key can only
  // ever land in one of them, and the id stays unique across both.
  const behind = new Map<string, MinimapBar>();
  const front = new Map<string, MinimapBar>();
  for (const note of notes) {
    const row = rowOf(note, stack, context);
    if (row < 0) {
      continue;
    }

    const x = KEY_WIDTH + overviewOffset(note.tick, ticks, width);
    const w = Math.max(1, overviewOffset(note.ticks, ticks, width));
    const key = `${Math.round(x)}:${row}:${note.channel}`;
    const muted = audible.get(note.channel) === false;
    const cells = muted ? behind : front;
    const held = cells.get(key);
    if (held && held.w >= w) {
      continue;
    }

    cells.set(key, {
      id: key,
      x,
      w,
      y: OVERVIEW_PAD + (row / rows) * inner,
      h,
      fill: CHANNEL_FILL[note.channel],
      opacity: muted ? MUTED_OPACITY : 1,
    });
  }

  return [...behind.values(), ...front.values()];
}

/**
 * The tint a loop group's box is washed with, in the channel's own colour: the
 * declared pass — the text itself — reads the more solid, and a recall is the
 * fainter ghost of it. The channel is still never left to the colour alone
 * (`styles.css`) — the notes inside the box carry it as bars, and the wash only
 * repeats what they say.
 */
export const DECLARED_TINT = 0.16;
export const RECALLED_TINT = 0.08;

/**
 * One pass of one loop run, as drawn: a box around the rows its notes span,
 * washed in the channel's colour and edged dashed at the declaration, dotted
 * at a recall. Bounded to the group's own rows rather than the whole stack, so
 * two channels' loops through one stretch of song do not stack their washes.
 */
export interface LoopRegionBox {
  id: string;
  /** The pass's tick range at this zoom. */
  x: number;
  w: number;
  /** The rows the pass's own notes span. */
  y: number;
  h: number;
  /** The textual body playing at its own position; every other pass is a recall. */
  declared: boolean;
  /** The channel's own colour, as the bars inside the box wear it. */
  fill: string;
  /** {@link DECLARED_TINT} or {@link RECALLED_TINT}, dimmed with a muted channel. */
  tint: number;
  /** Dimmed with the channel's bars when the mixer silences it. */
  opacity: number;
  /**
   * What a press on the box's edge grabs: the voice, the body it plays —
   * `Strip.frames` names a frame by this — and the pass's own start, which is
   * the origin a group dragged from this pass projects through.
   */
  channel: number;
  body: number;
  tick: number;
  /**
   * The pass's length **as drawn**, which is the run's own only where the song
   * does not end inside it. What a press measures its ends against: a handle
   * that answered "resize" where no edge is drawn is a handle for something
   * invisible, and the porter is aiming at what they can see.
   */
  ticks: number;
}

export interface LoopRegionRequest {
  loops: readonly LoopRun[];
  notes: readonly WalkNote[];
  stack: LaneStack;
  context: PlaceContext;
  /** The tick window to draw, from `tickWindow`. */
  from: number;
  to: number;
  /** Pixels per tick. */
  zoom: number;
  rowHeight: number;
  /** `timeline.ticks` — a pass past the pass cut never plays and is not drawn. */
  ticks: number;
  /** Channel index to whether it is heard; a missing entry counts as audible. */
  audible: ReadonlyMap<number, boolean>;
  /** ARAM addresses the command map names, which is what tells a recall from a declaration. */
  mapped: ReadonlySet<number>;
}

/**
 * Which runs play at the place their body is written — the declaration sites.
 *
 * A `]n`'s own `$E9` is dropped from the command map (`parser.ts:649`), so a
 * call run whose `from` maps to a command is a `(n)m` or `*n` and never a
 * declaration. The rest is enclosure: a run opened inside another run's body is
 * a declaration only where the pass holding it is itself the declared one, so
 * the second outer pass of `[ [[c]]2 ]2` recalls the subloop however it was
 * spelled. The innermost body holding the run's `from` byte is the encloser,
 * and the pass is found by the tick the run's first pass entered at.
 */
function declaredSites(loops: readonly LoopRun[], mapped: ReadonlySet<number>): boolean[] {
  const resolve = (at: number, seen: ReadonlySet<number>): boolean => {
    const run = loops[at];
    if (run.kind === 'call' && mapped.has(run.from)) {
      return false;
    }

    let encloser = -1;
    for (let other = 0; other < loops.length; other++) {
      const candidate = loops[other];
      if (
        other === at ||
        seen.has(other) ||
        candidate.channel !== run.channel ||
        run.from < candidate.body.start ||
        run.from >= candidate.body.end
      ) {
        continue;
      }

      if (
        encloser < 0 ||
        candidate.body.end - candidate.body.start <
          loops[encloser].body.end - loops[encloser].body.start
      ) {
        encloser = other;
      }
    }

    if (encloser < 0) {
      return true;
    }

    const tick = run.passes[0]?.tick ?? -1;
    const pass = loops[encloser].passes.findIndex((p) => p.tick <= tick && tick < p.tick + p.ticks);

    // A run the encloser's passes cannot place is a crossed shape; nothing
    // there is the text playing at its own position.
    return pass === 0 && resolve(encloser, new Set([...seen, at]));
  };

  return loops.map((_, at) => resolve(at, new Set([at])));
}

/**
 * The loop structure, drawn: one box per pass of every run on screen, around
 * the rows that pass's own notes span.
 *
 * Built beside {@link buildMarks} on the mark window's cadence — never per
 * frame, never per pointer move. A pass with no note on a row draws nothing:
 * there is no group to draw a box around, and a stack-high wash was the shape
 * that had two channels' loops brightening each other where they crossed.
 */
export function buildLoopRegions(request: LoopRegionRequest): LoopRegionBox[] {
  const { loops, notes, stack, context, from, to, zoom, rowHeight, ticks, audible, mapped } =
    request;
  if (zoom <= 0 || loops.length === 0) {
    return [];
  }

  const declared = declaredSites(loops, mapped);

  interface Open {
    id: string;
    x: number;
    w: number;
    declared: boolean;
    fill: string;
    tint: number;
    opacity: number;
    channel: number;
    body: number;
    tick: number;
    end: number;
    low: number;
    high: number;
  }

  const byChannel: Open[][] = [];
  const opened: Open[] = [];

  for (let at = 0; at < loops.length; at++) {
    const run = loops[at];
    const muted = audible.get(run.channel) === false;
    for (let pass = 0; pass < run.passes.length; pass++) {
      const { tick, ticks: length } = run.passes[pass];
      // The cut `buildMarks` takes: a pass the song ends inside is clipped to
      // the cut, and one past it never plays at all.
      const end = ticks > 0 ? Math.min(tick + length, ticks) : tick + length;
      if ((ticks > 0 && tick >= ticks) || tick > to || end < from) {
        continue;
      }

      const isDeclared = declared[at] && pass === 0;
      const open: Open = {
        id: `${run.body.start}:${tick}:${run.channel}`,
        x: tick * zoom,
        w: Math.max(1, (end - tick) * zoom),
        declared: isDeclared,
        fill: CHANNEL_FILL[run.channel],
        tint: (isDeclared ? DECLARED_TINT : RECALLED_TINT) * (muted ? MUTED_OPACITY : 1),
        opacity: muted ? MUTED_OPACITY : 1,
        channel: run.channel,
        body: run.body.start,
        tick,
        end,
        low: Number.POSITIVE_INFINITY,
        high: Number.NEGATIVE_INFINITY,
      };
      opened.push(open);
      (byChannel[run.channel] ??= []).push(open);
    }
  }

  // The box is the rows the pass's own notes span. One walk over the notes,
  // each tested against its channel's few on-screen regions; a note is in every
  // region holding its tick, since a subloop's pass sits inside its loop's.
  for (const note of notes) {
    const opens = byChannel[note.channel];
    if (!opens) {
      continue;
    }

    let row = -2; // unasked; `rowOf` answers -1 for a note on no row
    for (const open of opens) {
      if (note.tick < open.tick || note.tick >= open.end) {
        continue;
      }

      if (row === -2) {
        row = rowOf(note, stack, context);
      }

      if (row >= 0) {
        open.low = Math.min(open.low, row);
        open.high = Math.max(open.high, row);
      }
    }
  }

  return opened
    .filter((open) => open.low <= open.high)
    .map(
      ({
        id,
        x,
        w,
        declared: isDeclared,
        fill,
        tint,
        opacity,
        low,
        high,
        channel,
        body,
        tick,
        end,
      }) => ({
        id,
        x,
        w,
        ...loopBox(low, high, rowHeight),
        declared: isDeclared,
        fill,
        tint,
        opacity,
        channel,
        body,
        tick,
        ticks: end - tick,
      }),
    );
}

export interface LoopFollowRequest {
  regions: readonly LoopRegionBox[];
  /**
   * The body a gesture is editing and the rows its notes span once the plan
   * lands — `null` where no plan is held, or where it has no notes to stand on.
   */
  rows: { body: number; low: number; high: number } | null;
  /**
   * How far a **tick** moves under a held body-length change: the same list the
   * marks are dealt over, for every box the change is not the body of.
   */
  boundaries: ShiftBoundaries | null;
  /** Ticks one boundary crossing adds. */
  delta: number;
  /** Where the changed body's own passes go, which {@link boundaries} cannot say. */
  passes: readonly PassShift[];
  zoom: number;
  rowHeight: number;
}

/**
 * The boxes again, drawn round where the gesture in flight is taking the notes.
 *
 * A second short pass over what {@link buildLoopRegions} has already built, in
 * {@link buildLoopLabels}'s mould: the walk over every loop, pass and note is on
 * the mark window's cadence and must not be re-run because a pointer moved.
 * Nothing held returns the very list it was given, so an idle roll allocates
 * nothing at all.
 *
 * Horizontally, the changed body's own passes are asked for by name — their
 * edges *are* the boundaries, which is the one place the marks' rule is
 * discontinuous. Every other box takes that rule at each of its two edges, and
 * the difference between the counts is what it gains: a boundary at a box's
 * **left** edge always lands inside it and counts, where one at its **right**
 * edge counts only if the pass it belongs to is a pass the box **holds**. That
 * one test is what tells an outer loop round a growing body, which widens by
 * every pass it holds, from a subloop sitting at that body's tail, which is
 * pushed along and does not grow — their edges are on the same tick and their
 * answers are opposite. It is also what stops the pass in front of an opening
 * gap swallowing it.
 *
 * A length change written by a plan is drawn as growth at the body's **tail**,
 * which is the same reading `buildPreview` takes: the bars a box is drawn round
 * are projected that way, and a box that told the truth about a shape the bars
 * inside it did not would be the worse answer of the two.
 *
 * Vertically the plan says where the changed body's own notes went, and a box is
 * then the union of itself with everything it holds — one pass and not a walk
 * down the nesting, because a built box is already the union of what is inside
 * it. A box holding one that moved therefore grows to keep it in, and one whose
 * inner body moved inwards keeps its width: the built span has already swallowed
 * those rows and cannot give them back.
 *
 * `tick`, `ticks`, `body` and `channel` stay the compiled song's — `region.id`
 * is built from them so a moved box keeps its identity and its rect, the
 * `.loop-edge` handle carries them as the `data-*` a press resolves against, and
 * `buildLoopLabels` names a loop by asking the strip about that tick. Nothing
 * reads them out of step: the hover runs only with no drag held, and a press can
 * only reach the handle before the pointer is captured, where the delta is still
 * zero and no box has moved.
 */
export function followLoopRegions(request: LoopFollowRequest): readonly LoopRegionBox[] {
  const { regions, rows, boundaries, delta, passes, zoom, rowHeight } = request;
  const moves = delta !== 0 && (boundaries !== null || passes.length > 0);
  if (!moves && rows === null) {
    return regions;
  }

  const crossed = (channel: number, tick: number, inclusive: boolean): number => {
    const steps = boundaries?.get(channel) ?? [];
    let count = 0;
    while (count < steps.length && (inclusive ? steps[count] <= tick : steps[count] < tick)) {
      count++;
    }

    return count;
  };

  /** Whether a box covers one of the passes the change lands in. */
  const holds = (region: LoopRegionBox): boolean =>
    passes.some(
      (pass) =>
        pass.channel === region.channel &&
        region.tick <= pass.tick &&
        pass.tick + pass.ticks <= region.tick + region.ticks,
    );

  const moved = rows === null ? null : loopBox(rows.low, rows.high, rowHeight);

  /** Where a box's rows end up: the plan's for the changed body, its own else. */
  const span = (region: LoopRegionBox): { y: number; h: number } =>
    moved !== null && rows !== null && region.body === rows.body
      ? moved
      : { y: region.y, h: region.h };

  return regions.map((region) => {
    let { x, w } = region;
    if (moves) {
      // By body as well as by pass: a loop playing inside another begins where
      // the outer one does, and the box that is not the changed one takes the
      // marks' answer rather than the changed body's.
      const own = passes.find(
        (pass) =>
          pass.body === region.body && pass.channel === region.channel && pass.tick === region.tick,
      );
      const left = own ? own.steps * delta : crossed(region.channel, region.tick, true) * delta;
      const right = own
        ? (own.steps + 1) * delta
        : crossed(region.channel, region.tick + region.ticks, holds(region)) * delta;
      x = region.x + left * zoom;
      w = Math.max(1, region.w + (right - left) * zoom);
    }

    let { y, h } = span(region);
    if (rows !== null) {
      // Enclosure off the song's own ticks rather than off the drawn boxes,
      // which have just moved apart: what holds what is a fact about the music.
      for (const each of regions) {
        if (
          each !== region &&
          each.channel === region.channel &&
          region.tick <= each.tick &&
          each.tick + each.ticks <= region.tick + region.ticks
        ) {
          const inner = span(each);
          const top = Math.min(y, inner.y);
          h = Math.max(y + h, inner.y + inner.h) - top;
          y = top;
        }
      }
    }

    return { ...region, x, w, y, h };
  });
}

/** A loop's own name, drawn in the corner of a box whose group is selected. */
export interface LoopLabel {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The `n` of the `(n)` the construct is written with. */
  text: string;
  /** Where the glyph's baseline centre goes, inside the plate. */
  textX: number;
  textY: number;
}

export interface LoopLabelRequest {
  regions: readonly LoopRegionBox[];
  /** The channel whose selection is being shown; no other channel has one. */
  channel: number;
  /** The bodies every note of whose group is selected, by body address. */
  selected: ReadonlySet<number>;
  /** The `(n)` the construct standing where a box is drawn is written with. */
  labelAt: (body: number, tick: number) => number | null;
}

/**
 * The labels a selected loop group's boxes carry.
 *
 * A second, short pass over the boxes {@link buildLoopRegions} has already
 * built, rather than a field on one: that list is on the mark window's cadence
 * and a selection changes on every click, so a two-character plate would rebuild
 * the whole song's boxes. It is drawn above the bars for the other half of the
 * reason — the loop layer is under them, where a label cannot be read.
 *
 * Per **construct** and not per body: `(1)[a1]5` and its `(1)2` recall both name
 * the body, where a `*2` recalling the very same body names nothing.
 */
export function buildLoopLabels(request: LoopLabelRequest): LoopLabel[] {
  const { regions, channel, selected, labelAt } = request;
  if (selected.size === 0) {
    return [];
  }

  const labels: LoopLabel[] = [];
  for (const region of regions) {
    if (region.channel !== channel || !selected.has(region.body)) {
      continue;
    }

    const label = labelAt(region.body, region.tick);
    if (label === null) {
      continue;
    }

    const text = String(label);
    const w = plateWidth(text, LOOP_LABEL_SIZE);
    const h = LOOP_LABEL_SIZE + LOOP_LABEL_INSET * 2;
    // A box with no room for its name says nothing rather than something cut,
    // which is the line `fitBarContent` takes for a bar's own.
    if (w + LOOP_LABEL_INSET * 2 > region.w || h + LOOP_LABEL_INSET * 2 > region.h) {
      continue;
    }

    const x = region.x + LOOP_LABEL_INSET;
    const y = region.y + LOOP_LABEL_INSET;
    labels.push({ id: region.id, x, y, w, h, text, textX: x + w / 2, textY: y + h / 2 });
  }

  return labels;
}

export interface HeldRequest {
  notes: readonly WalkNote[];
  stack: LaneStack;
  context: PlaceContext;
  /** Where the playhead is. */
  tick: number;
  audible: ReadonlyMap<number, boolean>;
}

/**
 * The rows sounding right now, from the timeline rather than the driver's
 * pointers.
 *
 * It is the only source that yields a pitch — the note map holds none — and
 * deriving the bar, the playhead and the lit key from one number is what stops
 * them disagreeing on screen. The caller takes the honesty test: if the editor
 * is not showing the text that is playing, it asks for nothing.
 */
export function heldRowsAt(request: HeldRequest): ReadonlySet<number> {
  const { notes, stack, context, tick, audible } = request;
  const held = new Set<number>();

  for (const note of notes) {
    if (note.tick > tick) {
      break; // sorted by tick
    }

    if (tick < note.tick + note.gateTicks && audible.get(note.channel) !== false) {
      const row = rowOf(note, stack, context);
      if (row >= 0) {
        held.add(row);
      }
    }
  }

  return held;
}
