/** What happens to the commands a removed note carried: which still reach something that sounds, and which go with it. */

import { replacedByNextInSlot } from '@amk/spc/song-walk';
import type { Command } from '@amk/tokens';
import { commandScope } from '@amk/tokens/commands/in-force';
import { type Edit, spliceOut } from '@amk/tokens/edits';
import type { EditContext, PlacedNote } from '../roll-edit';
import type { Strip, StripItem } from '../roll-strip';

/**
 * Whether anything in the edited song still sounds under a command.
 *
 * The one test that decides whether a removed item's declaration goes with it,
 * and it names no gesture: what a `v200` reaches is a fact about the song after
 * the edit, where "a carve took these ticks" is a fact about the edit path.
 *
 * `tick` is the command's own — the start of the item whose prefix holds it,
 * since a prefix runs just before the item it stands in front of. The scan
 * carries forward from that item looking for a note that **begins** at or after
 * it with the command still in force, which is `WalkCommand.onANote`'s question
 * asked of the plan rather than of the pass.
 *
 * Where a slot changes hands is the walk's own answer and not a table restated
 * here: the first note the pass played without the command in `origins` is the
 * note something else had taken the slot by. That is what makes `v200 c4 v100
 * d4` answer "nothing" for the `v200` while `v200 c4 d4` answers "`d4`", with no
 * source-side notion of which commands write the same thing.
 *
 * A note the pass never reached answers `true`: past the shortest channel the
 * walk has nothing to say, and a command is dropped only where something can say
 * it reaches nothing.
 */
export function reachesSomething(
  context: EditContext,
  command: Command,
  tick: number,
  from: number,
  survivors: ReadonlyMap<number, PlacedNote>,
  born: readonly PlacedNote[],
): boolean {
  const { strip } = context;

  // Inside a body the question is unprovable: a command there is read once per
  // pass under per-instance state, and a `q` written in a body writes the
  // caller's slot as well as the block's — so the conservative answer is the
  // one the scan already gives a note past the pass cut, and the command stays.
  if (context.frame.body >= 0) {
    return true;
  }

  /** Where the slot changed hands, and so where this command stops reaching. */
  let end = Number.POSITIVE_INFINITY;
  for (let index = from; index < context.frame.to; index++) {
    const item = strip.items[index];
    // A loop's body may still read the command on any of its passes, and the
    // scan cannot see inside it — so nothing past this point can prove the
    // command reaches no one.
    if (item.kind === 'construct') {
      return true;
    }

    if (item.kind !== 'note' || item.startTick < tick) {
      continue;
    }

    if (!item.verified) {
      return true;
    }

    const acting = context.inForce(item.address);
    if (acting === null) {
      return true;
    }

    if (!acting.includes(command)) {
      end = item.startTick;
      break;
    }

    if (survivors.has(index)) {
      return true;
    }
  }

  return born.some((note) => note.startTick >= tick && note.startTick < end);
}

/**
 * Whether {@link reachesSomething} can speak for a command at all: a byte-less
 * `q`, `h` or drum `@` the walk folds into a note, or one whose slot the next
 * write takes over whole (`replacedByNextInSlot`). A switch-off, a `$F4` toggle
 * or a one-shot write is never shown in force at a note, so a note playing
 * without it proves nothing, and it stays.
 */
export function droppable(command: Command): boolean {
  return (
    command.vcmd === undefined || replacedByNextInSlot(command.vcmd, command.args[0]?.value ?? 0)
  );
}

/**
 * The commands an item wholly overwritten takes with it: the `'note-state'`
 * ones in its prefix, which are its own declarations and nobody else's. A `t`
 * or a `w` acts on the whole song, an `l`, an `o`, a `<` or a `>` is parse
 * state every later note reads, and the intro `/` and a comment are not
 * commands at all — all of those stay exactly where they are written.
 *
 * The scope test is also the overlap guard: a trailing `o` claimed by the
 * previous unit (`roll-strip.ts:trailsAUnit`) lies inside both that unit's span
 * and this prefix, and `'position'` is what keeps the deletion off it.
 *
 * Callers skip the channel's first item, whose prefix reaches back over the
 * channel's own header: what stands above the first note or rest is the
 * channel's setup rather than that item's declaration.
 */
export function prefixCommandsOf(strip: Strip, item: StripItem): Command[] {
  return strip.commands.filter(
    (command) =>
      command.span.start >= item.prefixSpan.start &&
      command.span.end <= item.prefixSpan.end &&
      !command.inRemoteDefinition &&
      // `$DD` is `'note-state'` and is nonetheless never this item's
      // declaration: it is read by the note *before* it (`main.asm:L_10E4`), so
      // it sits in this prefix while belonging to the item behind it, and
      // `reachesSomething` — which scans forward — has no way to say so. Left
      // where it was written, which is where `StripItem.bend` keeps track of it.
      command.vcmd !== 0xdd &&
      commandScope(command) === 'note-state',
  );
}

/**
 * The commands written between two of an item's segments, each on the tick it
 * runs at.
 *
 * A unit is more than one segment only where the porter wrote something between
 * the head and a `^` continuation (`roll-strip.ts:segments`), so this is the
 * mid-note ramp and whatever else stands with it. Every scope, not just
 * `'note-state'`: {@link removeItem} splices the whole unit, so a `t` written in
 * there would go as quietly as a `v`, and the caller has to know it is there.
 */
export function insideCommands(
  strip: Strip,
  item: StripItem,
): { command: Command; tick: number }[] {
  const out: { command: Command; tick: number }[] = [];
  let at = item.startTick;
  for (let part = 1; part < item.segments.length; part++) {
    at += item.segments[part - 1].ticks;
    const from = item.segments[part - 1].span.end;
    const to = item.segments[part].span.start;
    for (const command of strip.commands) {
      // A `$DD` between two of a note's frames is that note's rider rather than
      // a command written inside it — it has no tick of its own, arming where
      // the read-ahead finds it — and `StripItem.bend` is what answers for it.
      if (command.vcmd === 0xdd) {
        continue;
      }

      if (command.span.start >= from && command.span.end <= to) {
        out.push({ command, tick: at });
      }
    }
  }

  return out;
}

/** A prefix command and the whitespace in front of it, as {@link removeItem} takes a unit. */
export function removeCommand(source: string, command: Command): Edit[] {
  const edit = spliceOut(source, command.span);
  return edit ? [edit] : [];
}

/** Whether the born notes cover every tick of the rest. `order` is in tick order. */
export function coveredByBorn(order: readonly PlacedNote[], rest: StripItem): boolean {
  let at = rest.startTick;
  for (const note of order) {
    if (note.startTick > at) {
      return false;
    }

    at = Math.max(at, note.startTick + note.ticks);
    if (at >= rest.startTick + rest.ticks) {
      return true;
    }
  }

  return false;
}
