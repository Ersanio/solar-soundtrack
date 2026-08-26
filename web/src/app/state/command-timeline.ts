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
 * The commands no note bar stands over, and the ticks they run at.
 *
 * A bar draws the commands in force at its note, on that note's own tick, so it
 * speaks for where the driver read one only when the two ticks are the same.
 * This answers the rest, and there are two kinds:
 *
 *   - **The song's own settings** — `t`, `w`, `$E4` and the whole echo unit.
 *     `commandScope` calls these `'song'` and `commandsInForceOf` drops them,
 *     because one DSP holds one echo unit and a global tempo reaches every
 *     channel alike: they act on the song and not on any note of it.
 *   - **The channel state no note keys on with** — a `v` or an `@` the driver
 *     reads while its channel is resting, one it reads inside a tie, one
 *     replaced before the next note sounds, one written after a channel's last
 *     note, and `$DF`, `$F0`, `$FD` and `$FE`, which empty a slot rather than
 *     take one and so are in no `WalkNote.origins` at any tick — without which
 *     nothing in the app would ever say vibrato had been switched off.
 *     `WalkCommand.onANote` is the walk's own word for all five; the four
 *     opcodes are not restated here.
 *
 * A command written in a gap is therefore in **both** places, and neither is
 * repeating the other: the lane has it on the tick the driver runs it, and the
 * next note's chip says that note is the one playing under it. In
 * `c4 v200 r4 d4` those are tick 48 and tick 96, and saying only the second is
 * what this exists to correct.
 *
 * Left to the bars alone: a command written straight before the note that reads
 * it, where the two ticks agree, and `q`, `h` and `@21`-`@29`, which emit
 * nothing and whose only honest tick is the note they fold into.
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
    if (scope === 'song' || (scope === 'note-state' && !run.onANote)) {
      events.push({ tick: run.tick, channel: run.channel, command });
    }
  }

  // Stable, so within one tick the bytes stay in the order the driver ran them.
  return events.sort((a, b) => a.tick - b.tick || a.channel - b.channel);
}
