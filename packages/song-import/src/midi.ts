/**
 * Importing a MIDI file: read once into parts, then written as a song as often as the porter
 * changes what to keep.
 *
 * Reading is the expensive half and has no options; writing takes the grid, the parts kept and
 * their instruments, and runs again for each change. The steps and why they are shaped as they are
 * is in this package's `CLAUDE.md`.
 */

import type { InstrumentTables } from "@amk/spc/instruments";
import { type Clashes, addWhileFits, clashes } from "./midi/channels";
import { type Part, splitParts, suggestedParts } from "./midi/parts";
import { type Performance, perform, quarterTicks } from "./midi/performance";
import { readSmf } from "./midi/smf";
import { CHANNEL_LIMIT, type SongOptions, type WrittenSong, writeSong } from "./midi/write-mml";

export { CHANNEL_LIMIT, type ImportWarning, type SongOptions, type WrittenSong } from "./midi/write-mml";
export { SmfError, type SmfErrorCode } from "./midi/smf";
export type { Part } from "./midi/parts";
export type { DrumSound } from "./midi/gm";
export { type Clashes, addWhileFits, fits, oneEach, packChannels } from "./midi/channels";
export type { Performance } from "./midi/performance";

export interface MidiImport {
	performance: Performance;
	parts: Part[];
	/** Kit hits no stock drum stands in for, dropped. */
	unmappedDrums: number;
	/** The hits on each kit key a stock drum stands in for, by GM key: the sounds a drum map can change. */
	drumKeys: ReadonlyMap<number, number>;
	/** The parts kept until the porter chooses, one a channel: every instrument's first voice, then the ones that sound the most. */
	suggested: string[];
	/** Which parts cannot share a channel, by part index. */
	clash: Clashes;
	/** The parts kept when they may share: the same order, each taken while the packing fits eight channels. */
	suggestedShared: string[];
}

/** Reads a MIDI file into parts. Throws {@link SmfError} for a file it cannot read at all. */
export function readMidi(bytes: Uint8Array): MidiImport {
	const performance = perform(readSmf(bytes));
	const { parts, unmappedDrums, drumKeys } = splitParts(performance);
	// A sixty-fourth note, the overlap a hand-over may have, as the voice split allows within a part.
	const clash = clashes(parts, quarterTicks(performance) / 16);
	return {
		performance,
		parts,
		unmappedDrums,
		drumKeys,
		suggested: suggestedParts(parts, CHANNEL_LIMIT),
		clash,
		suggestedShared: addWhileFits(parts, [], clash, CHANNEL_LIMIT),
	};
}

/** Writes the import as an `#amk 4` song. */
export function writeMidi(midi: MidiImport, options: SongOptions, tables: InstrumentTables | null): WrittenSong {
	return writeSong(midi.performance, midi.parts, midi.clash, midi.unmappedDrums, options, tables);
}
