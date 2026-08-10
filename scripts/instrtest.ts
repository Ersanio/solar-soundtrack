/**
 * The driver's instrument and percussion tables.
 *
 * The load-bearing assertion is that the tables are found **uniquely** in the
 * shipped `main.bin`. The reader locates them by matching the SRCN column
 * against AddmusicK's `instrToSample`, and a search that silently took the first
 * of several candidates would be a guess wearing a checked answer's clothes —
 * so the count is asserted, not just the contents.
 *
 * The second is the cross-check between `@amk/core`'s `tables.ts`'s
 * `INSTRUMENT_TO_SAMPLE` and the bytes actually in the driver. They are separate
 * statements of the same fact, kept apart because `compiler/` does not depend on
 * `@amk/spc`, and they agree on 29 of 30 entries. The 30th — index 19 — is pinned
 * here rather than smoothed over, because that disagreement *is* the `@19` story.
 *
 *   npm run instrtest
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	FIRST_CUSTOM_INSTRUMENT as COMPILER_FIRST_CUSTOM,
	FIRST_PERCUSSION_INSTRUMENT as COMPILER_FIRST_PERCUSSION,
	INSTRUMENT_TO_SAMPLE,
	NOTE_DURATIONS,
	NSPC_VELOCITY_OFFSET,
	VELOCITY_VALUES,
} from "@amk/core/tables";
import { type DriverManifest, analyzeDriver } from "@amk/spc/driver";
import {
	FIRST_CUSTOM_INSTRUMENT,
	FIRST_PERCUSSION_INSTRUMENT,
	INSTRUMENT_ENTRY_BYTES,
	MELODIC_SLOTS,
	NOISE_FLAG,
	PERCUSSION_ENTRY_BYTES,
	PERCUSSION_SLOTS,
	bundledInstrumentTables,
	findInstrumentTables,
	readInstrumentTables,
} from "@amk/spc/instruments";

import { SPC_ASSETS, check, summarise } from "./harness";

const driverDir = join(SPC_ASSETS, "driver");
const manifest = JSON.parse(readFileSync(join(driverDir, "manifest.json"), "utf8")) as DriverManifest;

// Through `analyzeDriver`, exactly as `DriverStore` does it. main.bin is a
// final-pass build carrying a 4-byte upload header, and searching the raw file
// would put every offset four bytes out — the tables would still be found, and
// every address reported about them would be wrong.
const analysis = analyzeDriver(new Uint8Array(readFileSync(join(driverDir, "main.bin"))), manifest, false);
const program = analysis.programData;
/** Where `main.bin` sits in ARAM, from its own upload header. */
const PROGRAM_POS = analysis.programPos;

console.log("\nfinding the tables in the shipped driver");
{
	const hits = findInstrumentTables(program);
	check("exactly one candidate, so the match is not a guess", hits.length === 1, `${hits.length} hit(s)`);

	const tables = readInstrumentTables(program, PROGRAM_POS);
	check("read from the driver rather than the fallback", tables.source === "driver");
	check("the melodic table has 20 slots", tables.melodic.length === MELODIC_SLOTS);
	check("the percussion table has 9", tables.percussion.length === PERCUSSION_SLOTS);
	check("the strides are 6 and 7", INSTRUMENT_ENTRY_BYTES === 6 && PERCUSSION_ENTRY_BYTES === 7);
	// Read straight out of the image at the offset the reader claims, so this
	// tests the placement rather than restating arithmetic.
	const percussionAt = hits[0] + MELODIC_SLOTS * INSTRUMENT_ENTRY_BYTES;
	check(
		"percussion begins one melodic table later, in the bytes themselves",
		Array.from({ length: PERCUSSION_SLOTS }, (_, k) => program[percussionAt + k * PERCUSSION_ENTRY_BYTES]).join() ===
			tables.percussion.map((entry) => entry.srcn).join(),
	);
	check(
		"the melodic table's last entry ends where percussion starts",
		tables.melodic[MELODIC_SLOTS - 1].bytes.join() ===
			Array.from(program.subarray(percussionAt - INSTRUMENT_ENTRY_BYTES, percussionAt)).join(),
	);
	// Not a requirement, but if this moves the driver has been rebuilt and the
	// bundled fallback below is the thing to re-check.
	check("it lands where the bundled build puts it", tables.address === 0x1893, `$${tables.address?.toString(16)}`);
}

console.log("\nthe SRCN column against AddmusicK's own table");
{
	const tables = readInstrumentTables(program, PROGRAM_POS);

	let melodic = true;
	for (let n = 0; n <= 18; n++) {
		if (tables.melodic[n].srcn !== INSTRUMENT_TO_SAMPLE[n]) {
			melodic = false;
		}
	}

	check("@0-@18 match instrToSample", melodic);

	let percussion = true;
	for (let k = 0; k < PERCUSSION_SLOTS; k++) {
		if (tables.percussion[k].srcn !== INSTRUMENT_TO_SAMPLE[FIRST_PERCUSSION_INSTRUMENT + k]) {
			percussion = false;
		}
	}

	check("@21-@29 match instrToSample", percussion);

	// The one disagreement, and the reason the search key stops at 18. AMK's
	// array marks 19 and 20 "Nothing" (Music.cpp:60) while the driver still has a
	// real 20th slot. Nothing in MML can reach it: `parseInstrument` emits no
	// `$DA` for @19, and its 4.05 remap sends `@@19` to custom instrument 30.
	check("index 19 disagrees, and that is the @19 story", INSTRUMENT_TO_SAMPLE[19] === 0x00);
	check("the driver's own entry 19 is a real one", tables.melodic[19].srcn === 0x0f);
	check(
		"@20 would alias percussion entry 0, being 20 * 6 past the start",
		MELODIC_SLOTS * INSTRUMENT_ENTRY_BYTES === 120,
	);
}

console.log("\nthe bundled fallback");
{
	const fromDriver = readInstrumentTables(program, PROGRAM_POS);
	const bundled = bundledInstrumentTables();

	check("it is labelled as the fallback", bundled.source === "bundled" && bundled.address === null);
	check(
		"its melodic bytes are the shipped driver's",
		bundled.melodic.every((entry, n) => entry.bytes.join() === fromDriver.melodic[n].bytes.join()),
	);
	check(
		"its percussion bytes are too",
		bundled.percussion.every((entry, k) => entry.bytes.join() === fromDriver.percussion[k].bytes.join()),
	);
	check(
		"an image with no table falls back rather than throwing",
		readInstrumentTables(new Uint8Array(64), PROGRAM_POS).source === "bundled",
	);
}

console.log("\nentry shape");
{
	const tables = readInstrumentTables(program, PROGRAM_POS);

	check(
		"a melodic entry carries its six bytes",
		tables.melodic.every((entry) => entry.bytes.length === INSTRUMENT_ENTRY_BYTES),
	);
	check(
		"a percussion entry carries seven, the last being its note",
		tables.percussion.every((entry) => entry.bytes.length === PERCUSSION_ENTRY_BYTES && entry.note === entry.bytes[6]),
	);
	check(
		"a melodic entry has no note",
		tables.melodic.every((entry) => entry.note === undefined),
	);
	check(
		"every drum note is a real note byte",
		tables.percussion.every((entry) => (entry.note ?? 0) >= 0x80 && (entry.note ?? 0) < 0xc6),
	);
	check(
		"no stock entry is flagged as noise",
		tables.melodic.every((entry) => (entry.srcn & NOISE_FLAG) === 0),
	);
	// `@22` is the one the request called out: a drum whose sample is $06, not 22.
	check(
		"@22 is drum 1, sample $06, note $A4",
		tables.percussion[1].srcn === 0x06 && tables.percussion[1].note === 0xa4,
	);
	check("the first custom instrument is @30", FIRST_CUSTOM_INSTRUMENT === 30);

	// tables.ts and instruments.ts each state these for their own layer, because
	// compiler/ does not depend on spc/. That is only safe if they agree.
	check(
		"the compiler and the SPC layer agree on where the custom band starts",
		COMPILER_FIRST_CUSTOM === FIRST_CUSTOM_INSTRUMENT,
		`${COMPILER_FIRST_CUSTOM} vs ${FIRST_CUSTOM_INSTRUMENT}`,
	);
	check(
		"and on where percussion starts",
		COMPILER_FIRST_PERCUSSION === FIRST_PERCUSSION_INSTRUMENT,
		`${COMPILER_FIRST_PERCUSSION} vs ${FIRST_PERCUSSION_INSTRUMENT}`,
	);
}

console.log("\nthe quantization tables against the shipped driver");
{
	// `NOTE_DURATIONS` and `VELOCITY_VALUES` are hand-copied out of `main.asm`,
	// which is not in an AddmusicK release's `AddmusicKsrc/` — so, exactly as
	// with the instrument tables above, the only thing that can verify them is
	// the driver binary itself. They sit adjacent in the source
	// (`main.asm:3477-3483`), so searching for the 40 bytes as one run also pins
	// their order, and a *unique* hit is what makes it a check rather than a
	// coincidence: eight bytes alone would be findable almost anywhere.
	const run = Uint8Array.from([...NOTE_DURATIONS, ...VELOCITY_VALUES]);

	let hits = 0;
	let at = -1;
	for (let i = 0; i + run.length <= program.length; i++) {
		let match = true;
		for (let j = 0; j < run.length; j++) {
			if (program[i + j] !== run[j]) {
				match = false;
				break;
			}
		}

		if (match) {
			hits++;
			at = i;
		}
	}

	check("the 40 bytes appear in main.bin", hits > 0);
	check("and appear exactly once, so this is not a coincidence", hits === 1, `${hits} matches`);
	if (at >= 0) {
		console.log(`        NoteDurations at $${(PROGRAM_POS + at).toString(16).toUpperCase().padStart(4, "0")}`);
	}

	// The two halves are the whole reason the table is 32 entries: the driver
	// picks between them with `or a, #$10` (`main.asm:2374-2378`).
	check("the N-SPC half begins where the driver's offset says", NSPC_VELOCITY_OFFSET === 0x10);
	check("so the table holds both halves", VELOCITY_VALUES.length === NSPC_VELOCITY_OFFSET * 2);
	check("and the duration table has one entry per value of a 3-bit nibble", NOTE_DURATIONS.length === 8);

	// The two facts a reader of `q` needs, and the two that would be wrong if a
	// digit were transposed at either end of the ladder.
	check("q0 gates a note to a fifth of its length", Math.round((NOTE_DURATIONS[0] / 256) * 100) === 20);
	check("and q7 never quite reaches the whole of it", NOTE_DURATIONS[7] === 0xff);
}

summarise();
