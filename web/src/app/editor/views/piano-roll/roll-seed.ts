import type { CompileResult } from '@amk/core/types';
import type { TokenIndex } from '@amk/tokens';
import { DEFAULT_TEMPO } from '@amk/tokens/commands/units';
import { type Edit, insertAt, spliceRange } from '@amk/tokens/edits';
import { channelHome, channelMarkers } from './roll-strip';
import { eol, openingCommands } from './roll-write';

/**
 * The first rest a song with no playable music needs, so the roll can edit it.
 *
 * A `Strip` exists only for a song that compiles, and a song with nothing in it
 * does not (AMK0302/AMK0303), so nothing the roll's gestures can do is able to
 * write the first note. The seed is that first note's precondition: one rest,
 * and whatever has to stand in front of it, written as one batch so it is one
 * undo step. Everything here is arithmetic over plain data, so `rolltest`
 * drives it against a real compile.
 */

/**
 * The two failures with no playable music behind them: channels 0-7 emitted no
 * bytes (AMK0302) or bytes with no ticks (AMK0303). Every other error is
 * something the porter wrote, and the document is not touched.
 */
const SEEDABLE = new Set(['AMK0302', 'AMK0303']);

/**
 * The channel a song started from nothing opens with: {@link openingCommands}'s
 * state, plus the two song-wide values a whole song needs somewhere —
 * `channelOpening` leaves `t` out because drawing one note into an existing
 * song is not asking for a tempo, where starting a song is. `t53` is the
 * driver's boot tempo written out, and `w255` the convention every song here
 * opens with. The rest carries its own length because every length the roll
 * writes is the note's own.
 */
export function seededChannel(songTargetProgram: number): string {
  return `#0 w255 t${DEFAULT_TEMPO} ${openingCommands(songTargetProgram)} r1`;
}

/** The whole document a blank editor is seeded with. */
export const SEED_SONG = `#amk 4\n\n${seededChannel(0)}\n`;

/**
 * The splices that give a song with no playable music its first rest, or null
 * for a song this must not touch.
 *
 * A whitespace-only document is replaced with {@link SEED_SONG} whole. It is
 * read off the text rather than its diagnostic: the header it has not got is
 * AMK0002, which is also what a real song missing its `#amk` fails with.
 * Otherwise only a compile whose every error is in {@link SEEDABLE} is seeded —
 * the song parses clean and merely has no playable music.
 *
 * Defaults are written only into a document holding no commands at all (a
 * `#spc` block raises none): commands above the first `#N` gather on the
 * starting channel (`Music.cpp:383-406`), and everything in the scaffold is
 * tick-0 last-writer-wins state, so a `v255 t53` seeded after a porter's own
 * `v200 t60` would silently win. With a `#N` declared the rest alone goes at
 * the end of the last-declared channel's block — the end of the document, where
 * nothing follows it to be disturbed — on a line of its own, so a `;` comment
 * ending the block cannot swallow it.
 */
export function seedEdits(source: string, result: CompileResult, index: TokenIndex): Edit[] | null {
  if (source.trim() === '') {
    const scaffold = spliceRange(source, { start: 0, end: source.length, line: 1 }, SEED_SONG);
    return scaffold ? [scaffold] : null;
  }

  if (result.ok) {
    return null;
  }

  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length === 0 || errors.some((diagnostic) => !SEEDABLE.has(diagnostic.code))) {
    return null;
  }

  const markers = channelMarkers(index, source);
  const line = eol(source);
  if (markers.length === 0) {
    const home = channelHome(source, 0, markers);
    const block =
      index.commands.length === 0 ? seededChannel(result.stats?.songTargetProgram ?? 0) : '#0 r1';
    const opened = insertAt(home.at, home.at === 0 ? block : `${line}${line}${block}`);
    return opened ? [opened] : null;
  }

  const home = channelHome(source, markers[markers.length - 1].channel, markers);
  const rest = insertAt(home.at, `${line}r1`);
  return rest ? [rest] : null;
}
