/**
 * The driver's own instrument and percussion tables: what `@n` actually selects.
 *
 * `@n` is not a sample reference. It selects a fixed-size entry in a table the
 * driver carries, and only that entry's *first* byte is a sample (SRCN). The
 * rest is voice setup: ADSR, GAIN, and a pitch multiplier. Percussion entries
 * carry one byte more, the drum's own note.
 *
 * ```
 *   byte 0  SRCN            sample index; bit 7 set means noise, low 5 bits the clock
 *   byte 1  ADSR1  %eddd aaaa   bit 7 clear => GAIN is used instead of ADSR
 *   byte 2  ADSR2  %sss rrrrr
 *   byte 3  GAIN
 *   byte 4  tuning           integer part of the pitch multiplier
 *   byte 5  subtuning        fractional part, /256 — "dd.ee"
 *   byte 6  note             percussion only
 * ```
 *
 * The byte meanings are AddmusicK's own, documented for `#instruments` in
 * `AddmusicKreadme/readme_files/syntax_reference.html:257-263`. The 6- and
 * 7-byte strides come from the vanilla driver, which is where this layout
 * started: `AddmusicKsrc/Super Mario World.s:1029-1069` applies an instrument as
 * "set sample A in bank at $14/15 width Y" with `y = #$05` — four bytes to DSP
 * registers, then the multiplier — and `:103-118` takes the percussion path with
 * `y = #$06`, then does `inc y` to fetch "perc note num from instr tbl". AMK
 * widens both by one byte for the sub-multiplier, giving 6 and 7.
 * `AddmusicKsrc/main.asm:383-388` is the same code in AMK's own source.
 *
 * ## Why these bytes are read out of the driver rather than stated here
 *
 * The tables are assembled from `InstrumentData.asm`, which `main.asm:3618`
 * `incsrc`s and which is **not in this repository** — nor is `Commands.asm`,
 * which holds the routine that indexes them, so there is no citable address
 * either. What there *is* is the assembled `main.bin`, and the tables can be
 * found in it without knowing where they live: byte 0 of each entry has to
 * reproduce AddmusicK's `instrToSample`, so a stride-6 column matching it is the
 * table. On the bundled driver that match is unique (`instrtest` asserts it) and
 * lands at ARAM `$1893`, with percussion at `$190B`.
 *
 * Reading rather than restating also means a **user-supplied `main.bin` reports
 * its own instruments**, which a hardcoded copy could only get wrong, and it
 * keeps 129 hand-transcribed bytes out of the tree. The bundled tables below are
 * a labelled fallback for a driver the search cannot make sense of, not the
 * primary source; `instrtest` pins them against the shipped binary so they
 * cannot drift.
 *
 * ## The search key, and the one place the two tables disagree
 *
 * {@link MELODIC_SRCN} and {@link PERCUSSION_SRCN} restate the SRCN column that
 * `compiler/tables.ts` already holds as `INSTRUMENT_TO_SAMPLE`. That is
 * deliberate duplication, for the reason given at `tables.ts:42-51` for
 * `BANK_SLOT_COUNT`: the compiler layer does not depend on the SPC layer, so
 * each side states the constant and a harness asserts they agree.
 *
 * They agree on 29 of 30 bytes. At index 19 the driver holds `$0F` and
 * `instrToSample[19]` holds `$00`, because AMK's array marks 19 and 20 as
 * "Nothing" (`Music.cpp:60`) while the driver still has a real 20th slot there.
 * Nothing can reach it — see {@link MELODIC_SLOTS} — so the divergence is
 * harmless, but it is why the search key stops at 18.
 */

/** Bytes per melodic entry. */
export const INSTRUMENT_ENTRY_BYTES = 6;
/** Bytes per percussion entry: the six above plus the drum's note. */
export const PERCUSSION_ENTRY_BYTES = 7;

/**
 * Slots in the melodic table.
 *
 * Twenty are present, but only `@0`-`@18` are reachable by name: `parser.ts:1594`
 * emits no `$DA` for 19-29, and `parser.ts:1597` remaps the `@@n` direct form's
 * 19-29 to custom instruments 30-40. Slot 19 is reachable only as a raw
 * `$DA $13`, and slot 20 does not exist — `20 * 6 = 120` is where the percussion
 * table starts, so `@@20`'s bytes would be percussion entry 0's first six.
 */
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

/**
 * The bundled driver's tables, as a fallback when the search fails.
 *
 * Flat bytes rather than decoded entries so `instrtest` can compare them to the
 * binary directly, with no decoding step in between to be wrong.
 */
const BUNDLED_MELODIC: readonly number[] = [
	0x00, 0xfe, 0x6a, 0xb8, 0x06, 0x00, 0x01, 0xfa, 0x6a, 0xb8, 0x03, 0x00, 0x02, 0xae, 0x2f, 0xb8, 0x04, 0x00, 0x03,
	0xfe, 0x6a, 0xb8, 0x03, 0x00, 0x04, 0xa9, 0x6a, 0xb8, 0x03, 0x00, 0x07, 0xae, 0x26, 0xb8, 0x07, 0x00, 0x08, 0xfa,
	0x6a, 0xb8, 0x03, 0x00, 0x09, 0x9e, 0x1f, 0xb8, 0x03, 0x00, 0x05, 0xae, 0x26, 0xb8, 0x1e, 0x00, 0x0a, 0xee, 0x6a,
	0xb8, 0x02, 0x00, 0x0b, 0xfe, 0x6a, 0xb8, 0x08, 0x00, 0x01, 0xf7, 0x6a, 0xb8, 0x03, 0x00, 0x10, 0x0e, 0x6a, 0x7f,
	0x04, 0x00, 0x0c, 0xfe, 0x6a, 0xb8, 0x03, 0x00, 0x0d, 0xae, 0x26, 0xb8, 0x07, 0x00, 0x12, 0x8e, 0xe0, 0xb8, 0x03,
	0x00, 0x0c, 0xfe, 0x70, 0xb8, 0x03, 0x00, 0x11, 0xfe, 0x6a, 0xb8, 0x05, 0x00, 0x01, 0xe9, 0x6a, 0xb8, 0x03, 0x00,
	0x0f, 0x0f, 0x6a, 0x7f, 0x03, 0x00,
];

const BUNDLED_PERCUSSION: readonly number[] = [
	0x0f, 0x0f, 0x6a, 0x7f, 0x03, 0x00, 0xa8, 0x06, 0x0e, 0x6a, 0x40, 0x07, 0x00, 0xa4, 0x06, 0x8c, 0xe0, 0x70, 0x07,
	0x00, 0xa1, 0x0e, 0xfe, 0x6a, 0xb8, 0x07, 0x00, 0xa4, 0x0e, 0xfe, 0x6a, 0xb8, 0x08, 0x00, 0xa4, 0x0b, 0xfe, 0x6a,
	0xb8, 0x02, 0x00, 0x9c, 0x0b, 0x7e, 0x6a, 0x7f, 0x08, 0x00, 0xa6, 0x0b, 0x7e, 0x6a, 0x30, 0x08, 0x00, 0xa6, 0x0e,
	0x0e, 0x6a, 0x7f, 0x03, 0x00, 0xa1,
];

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
	/** Whether the search succeeded, so the UI can say which it is showing. */
	source: "driver" | "bundled";
	/** ARAM address of the melodic table, when it was found in a driver. */
	address: number | null;
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

/** The bundled tables, labelled as such. */
export function bundledInstrumentTables(): InstrumentTables {
	return {
		melodic: decodeAll(BUNDLED_MELODIC, MELODIC_SLOTS, INSTRUMENT_ENTRY_BYTES),
		percussion: decodeAll(BUNDLED_PERCUSSION, PERCUSSION_SLOTS, PERCUSSION_ENTRY_BYTES),
		source: "bundled",
		address: null,
	};
}

/**
 * Read the tables out of a driver image, falling back to the bundled copy.
 *
 * An ambiguous match counts as a failure: with more than one candidate there is
 * no way to tell which the driver indexes, and answering with the wrong one
 * would misreport every instrument in the song.
 */
export function readInstrumentTables(program: Uint8Array, programPos: number): InstrumentTables {
	const hits = findInstrumentTables(program);
	if (hits.length !== 1) {
		return bundledInstrumentTables();
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
		source: "driver",
		address: at + programPos,
	};
}
