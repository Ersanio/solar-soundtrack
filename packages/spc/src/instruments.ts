/** The driver's own instrument and percussion tables: what `@n` actually selects. */

/** Bytes per melodic entry. */
export const INSTRUMENT_ENTRY_BYTES = 6;
/** Bytes per percussion entry: the six above plus the drum's note. */
export const PERCUSSION_ENTRY_BYTES = 7;

/** Slots in the melodic table. Twenty are present, but only `@0`-`@18` are reachable. */
export const MELODIC_SLOTS = 20;
/** Entries in the percussion table, reached by `@21`-`@29`. */
export const PERCUSSION_SLOTS = 9;

/** `@21` is the first drum, and `@30` the first of the song's own instruments. */
export const FIRST_PERCUSSION_INSTRUMENT = 21;
export const FIRST_CUSTOM_INSTRUMENT = 30;

/** Set in a SRCN byte to mean "noise at the clock in the low five bits". */
export const NOISE_FLAG = 0x80;

/**
 * The SRCN column of `@0`-`@18`, used to find the table. `instrToSample`,
 * `Music.cpp:58`. Stops at 18 because 19 is where the two sources diverge.
 */
const MELODIC_SRCN: readonly number[] = [
	0x00, 0x01, 0x02, 0x03, 0x04, 0x07, 0x08, 0x09, 0x05, 0x0a, 0x0b, 0x01, 0x10, 0x0c, 0x0d, 0x12, 0x0c, 0x11, 0x01,
];

/** The SRCN column of `@21`-`@29`, used to confirm the table. `Music.cpp:61`. */
const PERCUSSION_SRCN: readonly number[] = [0x0f, 0x06, 0x06, 0x0e, 0x0e, 0x0b, 0x0b, 0x0b, 0x0e];

export class InstrumentTableError extends Error {}

/** One table entry, decoded. `note` is present only for percussion. */
export interface InstrumentEntry {
	/** Sample index, or a noise clock when {@link NOISE_FLAG} is set. */
	srcn: number;
	adsr1: number;
	adsr2: number;
	gain: number;
	/** Integer part of the pitch multiplier. */
	tuning: number;
	/** Fractional part of the pitch multiplier, /256. */
	subTuning: number;
	/** The drum's own note byte; percussion entries only. */
	note?: number;
	/** The entry exactly as it sits in ARAM, for the inspector's byte row. */
	bytes: readonly number[];
}

export interface InstrumentTables {
	/** `@0`-`@19`; see {@link MELODIC_SLOTS} for what is reachable. */
	melodic: readonly InstrumentEntry[];
	/** `@21`-`@29`. */
	percussion: readonly InstrumentEntry[];
	/** ARAM address of the melodic table. */
	address: number;
}

function decode(bytes: readonly number[], at: number, size: number): InstrumentEntry {
	const entry = bytes.slice(at, at + size);
	return {
		srcn: entry[0],
		adsr1: entry[1],
		adsr2: entry[2],
		gain: entry[3],
		tuning: entry[4],
		subTuning: entry[5],
		note: size === PERCUSSION_ENTRY_BYTES ? entry[6] : undefined,
		bytes: entry,
	};
}

function decodeAll(bytes: readonly number[], count: number, size: number): InstrumentEntry[] {
	const out: InstrumentEntry[] = [];
	for (let i = 0; i < count; i++) {
		out.push(decode(bytes, i * size, size));
	}

	return out;
}

/**
 * Every offset in `program` where both tables could start.
 *
 * Separate from {@link readInstrumentTables} so `instrtest` can assert the match
 * is *unique* rather than merely present — a search that silently took the first
 * of several hits would be a guess wearing a checked answer's clothes.
 */
export function findInstrumentTables(program: Uint8Array): number[] {
	const melodicBytes = MELODIC_SLOTS * INSTRUMENT_ENTRY_BYTES;
	const percussionBytes = PERCUSSION_SLOTS * PERCUSSION_ENTRY_BYTES;
	const hits: number[] = [];

	for (let at = 0; at + melodicBytes + percussionBytes <= program.length; at++) {
		let ok = true;
		for (let i = 0; ok && i < MELODIC_SRCN.length; i++) {
			if (program[at + i * INSTRUMENT_ENTRY_BYTES] !== MELODIC_SRCN[i]) {
				ok = false;
			}
		}

		// The percussion column is an independent confirmation: it pins the
		// stride-7 table immediately after, which is what makes a coincidental
		// stride-6 run in unrelated code fail rather than be adopted.
		for (let i = 0; ok && i < PERCUSSION_SRCN.length; i++) {
			const perc = at + melodicBytes + i * PERCUSSION_ENTRY_BYTES;
			if (program[perc] !== PERCUSSION_SRCN[i]) {
				ok = false;
			}
		}

		if (ok) {
			hits.push(at);
		}
	}

	return hits;
}

/**
 * Read the tables out of the driver image.
 *
 * Throws rather than guessing. An ambiguous match is as bad as none: with more
 * than one candidate there is no way to tell which the driver indexes, and
 * answering with the wrong one would misreport every instrument in the song.
 * There is one driver, so anything but a single hit means the image is not the
 * one this build ships — and then its stated addresses are not to be trusted
 * either.
 */
export function readInstrumentTables(program: Uint8Array, programPos: number): InstrumentTables {
	const hits = findInstrumentTables(program);
	if (hits.length !== 1) {
		throw new InstrumentTableError(
			`The driver's instrument tables were not found in main.bin (${hits.length} candidates). ` +
				`They are located by matching the SRCN column against instrToSample, so anything but exactly ` +
				`one match means this is not the image this build ships.`,
		);
	}

	const at = hits[0];
	const melodic = Array.from(program.subarray(at, at + MELODIC_SLOTS * INSTRUMENT_ENTRY_BYTES));
	const percussionAt = at + MELODIC_SLOTS * INSTRUMENT_ENTRY_BYTES;
	const percussion = Array.from(
		program.subarray(percussionAt, percussionAt + PERCUSSION_SLOTS * PERCUSSION_ENTRY_BYTES),
	);

	return {
		melodic: decodeAll(melodic, MELODIC_SLOTS, INSTRUMENT_ENTRY_BYTES),
		percussion: decodeAll(percussion, PERCUSSION_SLOTS, PERCUSSION_ENTRY_BYTES),
		address: at + programPos,
	};
}
