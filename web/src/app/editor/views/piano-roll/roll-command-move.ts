import type { Command } from '@amk/tokens';
import { commandScope } from '@amk/tokens/commands/in-force';
import { type Edit, commandRewritable, insertAt, spliceOut } from '@amk/tokens/edits';
import { type EditRefusal, REFUSE_CROWDED } from './roll-edit';
import type { Strip } from './roll-strip';
import { coalesce } from './roll-write';

/**
 * Moving one command along its channel: the only edit here that changes where a
 * command runs without touching a note.
 *
 * Every other path that moves one is a note gesture carrying a command it could
 * not leave where it stood (`roll-edit.ts:spawnRun`), and it re-emits it on the
 * tick it already had — the gesture is about the notes, so the command's own
 * tick is preserved rather than chosen. This is the porter naming the tick.
 *
 * Angular-free and driven by `rolltest`, which reads the result by compiling it
 * and walking the song rather than by looking at the text.
 */

export const REFUSE_MOVE_REMOTE =
  'that command is inside remote code, which runs wherever it is called';
export const REFUSE_MOVE_ELSEWHERE = 'that command is not written in the channel that runs it';
export const REFUSE_MOVE_MACRO = 'that command is written through a "name=value" replacement';
export const REFUSE_MOVE_KIND =
  'that command says where a note sits rather than when something happens';
export const REFUSE_MOVE_EMPTY = 'this channel has no note or rest to put a command in front of';

/** A tick a command may be dropped on, and where its text goes to run there. */
export interface MoveTarget {
  /** The tick the driver would read the command at. */
  tick: number;
  /** The offset its text is written at. */
  at: number;
  line: number;
}

/**
 * Why this command cannot be moved along this channel, or `null`.
 *
 * `channelStrip` has already refused every construct that plays one written run
 * more than once, so a strip that exists puts every one of its items on the tick
 * the driver reaches it at. What is left is four things about the *command*
 * rather than the channel, and they are this function's preconditions rather
 * than shapes the lane can hand it — the lane offers no drag on a glyph whose
 * span is not wholly the command's, `commandTimeline` emits no other scope, and
 * the walk does not step into a remote body, so nothing written in one has a
 * tick to be drawn at. They are checked because this is exported, and because
 * moving a command out of a remote body would change every site that calls it.
 *
 * The channel test is the one that would matter first if any of that changed: a
 * command whose scanner channel is not the strip's has its text and its
 * execution on different tracks, and there is nothing to snap it against.
 */
export function commandMoveRefusal(strip: Strip, command: Command): string | null {
  if (command.inRemoteDefinition) {
    return REFUSE_MOVE_REMOTE;
  }

  if (command.channel !== strip.channel) {
    return REFUSE_MOVE_ELSEWHERE;
  }

  if (!commandRewritable(command)) {
    return REFUSE_MOVE_MACRO;
  }

  const scope = commandScope(command);
  if (scope !== 'song' && scope !== 'note-state') {
    return REFUSE_MOVE_KIND;
  }

  if (strip.items.length === 0) {
    return REFUSE_MOVE_EMPTY;
  }

  return null;
}

/**
 * The ticks a command may be dropped on, in order: one per item, which is every
 * note and rest head on the channel.
 *
 * Item heads and nothing between them. A command landing part-way through a note
 * has to be written between two tied halves of it, which is what `spawnRun` does
 * for a note gesture that had no say in the matter; here the porter has one, and
 * the ticks something begins on are the ticks the roll is already drawing.
 *
 * Nothing past the last item either. The pass ends at the shortest channel, so a
 * command written after a channel's last note is read at or beyond the cut and
 * the walk reports no `WalkCommand` for it at all — it has no tick, so the lane
 * never draws it. A target out there would be somewhere a command could be
 * dragged to and not back from.
 */
export function commandMoveTargets(strip: Strip): readonly MoveTarget[] {
  return strip.items.map((item) => ({
    tick: item.startTick,
    // The unit's head rather than the prefix's end, though `channelStrip` clamps
    // the two to one offset: it is inside the unit's own leading `o`, so the
    // next `growUnits` finds the same boundary and a second drag of the same
    // command writes the same text. It is also always to the right of an intro
    // `/`, which terminates a unit's growth — and a command after the marker is
    // the one that is re-read on every pass.
    at: item.unitSpan.start,
    line: item.unitSpan.line,
  }));
}

/** The target nearest a tick, the earlier one on a tie. */
export function nearestTarget(targets: readonly MoveTarget[], toTick: number): MoveTarget | null {
  let best: MoveTarget | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const reach = Math.abs(target.tick - toTick);
    if (reach < distance) {
      best = target;
      distance = reach;
    }
  }

  return best;
}

/**
 * The command taken out of where it is and written in front of the target.
 *
 * `[]` for a drop that changes nothing, and the test for that is on the **tick**
 * rather than on where the text sits: equal ticks is the honest statement that
 * the driver does the same thing afterwards. A command let go on the item it
 * already leads would otherwise spend an undo step writing its own text back
 * where it was, and one written in a channel's header and dropped on the first
 * item would be taken out of the channel's setup for no change at all.
 *
 * `written` is the verbatim slice, so a command spelled through a head
 * replacement comes out and goes back in as the same characters.
 */
export function planCommandMove(
  source: string,
  strip: Strip,
  command: Command,
  tick: number,
  target: MoveTarget,
): Edit[] | EditRefusal {
  const reason = commandMoveRefusal(strip, command);
  if (reason !== null) {
    return { refused: reason };
  }

  if (target.tick === tick) {
    return [];
  }

  const written = source.slice(command.span.start, command.span.end);
  const taken = spliceOut(source, command.span);
  const put = insertAt(target.at, `${written} `, target.line);
  const edits = [taken, put].filter((edit): edit is Edit => edit !== null);

  // The insertion offset is a unit head — a note, a rest, or an `o` or drum `@`
  // the unit reached back over — and no command in the lane has a span covering
  // one, so the two ranges can abut but never overlap. `coalesce` is what joins
  // them where they do abut, since two edits sharing an offset are two ways of
  // saying one thing.
  const sorted = coalesce(
    edits.sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end),
  );
  for (let at = 1; at < sorted.length; at++) {
    // CodeMirror merges overlapping ranges instead of refusing them, so this is
    // the roll's own invariant to hold, as it is in `planEdits`.
    if (sorted[at].span.start < sorted[at - 1].span.end) {
      return { refused: REFUSE_CROWDED };
    }
  }

  return sorted;
}
