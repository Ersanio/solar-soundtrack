/**
 * Importing a MIDI file: read once into parts, then written as a song as often as the porter
 * changes what to keep.
 *
 * Reading is the expensive half and has no options; writing takes the grid, the parts kept and
 * their instruments, and runs again for each change. The steps and why they are shaped as they are
 * is in this package's `CLAUDE.md`.
 */

import type { InstrumentTables } from "@amk/spc/instruments";
import { type Part, splitParts, suggestedParts } from "./midi/parts";
import { type Performance, perform } from "./midi/performance";
import { readSmf } from "./midi/smf";
import { CHANNEL_LIMIT, type SongOptions, type WrittenSong, writeSong } from "./midi/write-mml";

export { CHANNEL_LIMIT, type ImportWarning, type SongOptions, type WrittenSong } from "./midi/write-mml";
export { SmfError, type SmfErrorCode } from "./midi/smf";
export type { Part } from "./midi/parts";
export type { Performance } from "./midi/performance";

export interface MidiImport {
	performance: Performance;
	parts: Part[];
	/** Kit hits no stock drum stands in for, dropped. */
	unmappedDrums: number;
	/** The parts kept until the porter chooses: the eight that sound the most. */
	suggested: string[];
}

/** Reads a MIDI file into parts. Throws {@link SmfError} for a file it cannot read at all. */
export function readMidi(bytes: Uint8Array): MidiImport {
	const performance = perform(readSmf(bytes));
	const { parts, unmappedDrums } = splitParts(performance);
	return { performance, parts, unmappedDrums, suggested: suggestedParts(parts, CHANNEL_LIMIT) };
}

/** Writes the import as an `#amk 4` song. */
export function writeMidi(midi: MidiImport, options: SongOptions, tables: InstrumentTables | null): WrittenSong {
	return writeSong(midi.performance, midi.parts, midi.unmappedDrums, options, tables);
}
