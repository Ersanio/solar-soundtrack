import type { SongTimeline, WalkNote } from '@amk/spc/song-walk';
import { type Command, commandStartingAt } from '@amk/tokens';
import { commandScope } from '@amk/tokens/commands/in-force';
import { type InForceSources, definedAt, foldedInForceOf } from './commands-in-force';
import { CHANNELS } from './transport-view';

/** One command going in effect, placed on the song's own timeline. */
export interface TimelineCommand {
  /** Ticks from the start of the pass, as a `WalkNote`'s is. */
  tick: number;
  /** 0-7. The voice that ran it, which is the one thing a colour can say. */
  channel: number;
  command: Command;
}

export interface TimelineSources extends InForceSources {
  timeline: SongTimeline;
}

/**
 * Every command the song puts in force, and where.
 *
 * The sibling of `commands-in-force.ts` and its two halves seen from the other
 * end: that one asks a note what is acting on it, this one asks the song when
 * each of those started. Both are needed and neither answers the other's
 * question — a bar can only ever say "here", and a timeline has to say "then".
 *
 *   - **The emitted half** is `SongTimeline.commands`, which is the driver's own
 *     record of a slot changing hands. It carries the tick the byte ran at,
 *     which is the reason the walk keeps it: `WalkNote.origins` is read off a
 *     sounding note, and a rest emits none, so a `v` written before one would be
 *     placed a whole rest late. It is also the only thing that can name `$DF`,
 *     `$F0`, `$FD` and `$FE`, which take a slot away rather than filling one.
 *   - **The folded half** is `q`, `h` and `@21`-`@29`, which emit nothing and so
 *     have no tick but the note they fold into — where that note *is* the exact
 *     answer, not an approximation. `definedAt` against the note before on the
 *     channel is what tells the note that starts a run from the ones carrying it.
 *
 * Filtered to what acts on the music: channel state and the song's own settings.
 * Structure (`[`, `]`, `*`, `$E6`, `$E9`, `$FC`) and position (`o`, `l`, `<`,
 * `>`) are what the roll's rows, widths and bar lines already are.
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
    if (scope === 'note-state' || scope === 'song') {
      events.push({ tick: run.tick, channel: run.channel, command });
    }
  }

  // The walk's order is this loop's, so the neighbour is free here where
  // anything asking per note would have to go looking. Taken above the guard: a
  // note with nothing folded into it is still the note the next one follows.
  const folded = foldedInForceOf(sources);
  const last: (WalkNote | null)[] = new Array<WalkNote | null>(CHANNELS).fill(null);
  for (const note of timeline.notes) {
    const previous = last[note.channel];
    last[note.channel] = note;

    const acting = folded(note);
    if (acting.length === 0) {
      continue;
    }

    const fresh = definedAt(acting, previous === null ? [] : folded(previous));
    for (const command of acting) {
      if (fresh.has(command)) {
        events.push({ tick: note.tick, channel: note.channel, command });
      }
    }
  }

  // Stable, so within one tick and channel the bytes the driver read come before
  // the note it then read them for — which is the order it ran them in.
  return events.sort((a, b) => a.tick - b.tick || a.channel - b.channel);
}
