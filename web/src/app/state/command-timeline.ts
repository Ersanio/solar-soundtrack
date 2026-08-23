import type { CommandAddress } from '@amk/core/types';
import type { SongTimeline } from '@amk/spc/song-walk';
import { type Command, type TokenIndex, commandStartingAt } from '@amk/tokens';
import { commandScope } from '@amk/tokens/commands/in-force';

/** One command going in effect, placed on the song's own timeline. */
export interface TimelineCommand {
  /** Ticks from the start of the pass, as a `WalkNote`'s is. */
  tick: number;
  /** 0-7. The voice that ran it, which is the one thing a colour can say. */
  channel: number;
  command: Command;
}

export interface TimelineSources {
  timeline: SongTimeline;
  /** The scan of the compiled text, which is what turns a span back into a command. */
  index: TokenIndex;
  /** `CompileResult.commandMap` by address, which is how the walk names a command. */
  commands: ReadonlyMap<number, CommandAddress>;
}

/**
 * The commands a note bar can never carry, and the ticks they run at.
 *
 * The complement of `commands-in-force.ts` rather than a second view of it: that
 * one answers a note, this one answers the song, and between them every command
 * is drawn exactly once. Nothing here is on a bar, so nothing is said twice.
 *
 * Two kinds qualify, and the test for each is the reason a bar cannot show it:
 *
 *   - **The song's own settings** — `t`, `w`, `$E4` and the whole echo unit.
 *     `commandScope` calls these `'song'` and `commandsInForceOf` drops them,
 *     because one DSP holds one echo unit and a global tempo reaches every
 *     channel alike: they act on the song and not on any note of it.
 *   - **The commands that switch something off** — `$DF`, `$F0`, `$FD` and
 *     `$FE`. A bar's glyphs come from `WalkNote.origins`, which names what
 *     *occupies* a slot, so a command that empties one is in no note's list at
 *     any tick. `WalkCommand.fills` is the walk's own word for it.
 *
 * Everything else is left to the bars: channel state a note reports itself, and
 * `q`, `h` and `@21`-`@29`, which emit nothing and whose only honest tick is the
 * note they fold into — which is the note that already draws them.
 *
 * The ticks come from `SongTimeline.commands`, the driver's record of a slot
 * changing hands. That is why the walk keeps it: `origins` is read off a
 * sounding note and a rest emits none, so a command written before a rest would
 * be placed a whole rest late by anything anchored on notes.
 *
 * Whole-song and once per compile, deliberately — it reads no clock, and a list
 * built per window would repack its rows at every turnover.
 */
export function commandTimeline(sources: TimelineSources): readonly TimelineCommand[] {
  const { timeline, index, commands: byAddress } = sources;
  const events: TimelineCommand[] = [];

  for (const run of timeline.commands) {
    // The blob's own `$FA` prefix is in no command map, so it falls out here.
    const span = byAddress.get(run.address)?.span;
    const command = span === undefined ? null : commandStartingAt(index.commands, span.start);
    if (command === null) {
      continue;
    }

    // `'structure'` is what falls out here: `$FC` arms a slot of its own, and
    // the loop bytes are the shape of the music rather than a setting in it.
    const scope = commandScope(command);
    if (scope === 'song' || (scope === 'note-state' && !run.fills)) {
      events.push({ tick: run.tick, channel: run.channel, command });
    }
  }

  // Stable, so within one tick the bytes stay in the order the driver ran them.
  return events.sort((a, b) => a.tick - b.tick || a.channel - b.channel);
}
