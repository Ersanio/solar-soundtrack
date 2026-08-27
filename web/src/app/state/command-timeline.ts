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
 * Every command that takes effect, and the tick it runs at.
 *
 * The song's commands as a timeline, complete: `commandScope`'s `'song'` — `t`,
 * `w`, `$E4` and the whole echo unit, which act on the song and not on any note
 * of it — and every `'note-state'` one, wherever the driver reads it and whether
 * or not a note begins there.
 *
 * The bars and this answer **different questions about the same command**, so
 * one being drawn twice is not one drawing repeating the other. A bar's chips
 * are the commands acting on _that note_, standing where the note does; the lane
 * stands where the driver reads the command. In `c4 v200 d4` those are the same
 * tick and in `c4 v200 r4 d4` they are 48 apart, and the lane says the same
 * thing in both — it is the one place the whole song's commands can be read in
 * the order they run, which is a thing a set of per-note chips cannot be.
 *
 * `'structure'` is what falls out: `$FC` arms a slot of its own, and the loop
 * bytes are the shape of the music rather than a setting in it. So does
 * `'position'`, and `q`, `h` and `@21`-`@29` are absent for a harder reason —
 * they emit no byte to address, so they have no tick but the note they fold
 * into, and that note is already drawing them.
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

    const scope = commandScope(command);
    if (scope === 'song' || scope === 'note-state') {
      events.push({ tick: run.tick, channel: run.channel, command });
    }
  }

  // Stable, so within one tick the bytes stay in the order the driver ran them.
  return events.sort((a, b) => a.tick - b.tick || a.channel - b.channel);
}
