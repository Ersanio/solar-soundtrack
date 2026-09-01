/**
 * Which instrument an `@`, an `@@` or a raw `$DA` selects, and which number a
 * given spelling has to carry to select a different one.
 *
 * The three spellings do not reach the same set, and none of them reaches all of
 * it. `parseInstrument` (`parser.ts:2148`, Music.cpp:parseInstrumentCommand)
 * emits a `$DA` only for `@0`-`@18`, the direct `@@n` and `@30` upward, remapping
 * 19-29 to a custom instrument on the way — so `@21`-`@29` arm a drum and emit
 * nothing at all, while `@@21` is custom instrument 32 rather than a drum, and
 * `@19` is neither. A hand-written `$DA` goes through none of that: the byte is
 * the byte, which is what makes it the only way to reach the driver's own table
 * entry 19 — except under `#am4`, where `parseHexCommand` (`parser.ts:3448`,
 * Music.cpp:1976) remaps a byte from `$13` up to a custom instrument and takes
 * that entry away again.
 *
 * {@link selectedInstrument} is the forward map and {@link instrumentByte} its
 * inverse. They are stated together, in one file, so `edittest` can round-trip
 * the pair: a picker whose list and whose writer disagree puts an author on an
 * instrument they did not choose, and no assertion about the numbers on their own
 * can see that.
 *
 * Numbers only. What radix a spelling writes them in is `edits.ts`'s
 * `argumentText`, and restating it here would be a second answer to a question
 * that already has one.
 */

import { FIRST_CUSTOM_INSTRUMENT, FIRST_PERCUSSION_INSTRUMENT } from "@amk/core/hardcoded-tables";
import type { Command } from "../tokens";
import { LAST_PERCUSSION_INSTRUMENT, isPercussionInstrument } from "./in-force";

/**
 * The last entry of the driver's own instrument table.
 *
 * `@0`-`@18` plus the one no `@` names: `parseInstrument` refuses to emit for a
 * written 19, so only a raw `$DA $13` reaches it. `@amk/spc/instruments`'
 * `MELODIC_SLOTS` counts the same table from the driver's side, and this package
 * may not import it, so the two are restated and pinned equal in `instrtest`.
 */
export const LAST_DRIVER_INSTRUMENT = 19;

/** `@` and `$DA` carry one byte each, so nothing past this can be written (AMK0091). */
const MAX_ARGUMENT = 0xff;

/**
 * The instrument a written number reaches `$DA` as, or `null` where nothing is
 * emitted.
 *
 * `null` is three different things and the callers that care tell them apart by
 * the number written: no number at all, a plain `@19`/`@20`, and a drum.
 */
export function emittedInstrument(command: Command): number | null {
	const written = command.args[0]?.value ?? -1;
	if (written < 0) {
		return null;
	}

	if (command.vcmd === 0xda) {
		// parser.ts:3448 — Addmusic 4.05 numbered custom instruments from $13, so a
		// raw $DA is remapped before any of the rules below could apply to it.
		return command.target.program === 1 && written >= 0x13 ? written - 0x13 + FIRST_CUSTOM_INSTRUMENT : written;
	}

	// parser.ts:2148 — the one line that splits the bands. The inner remap runs
	// unconditionally where AddmusicK guards it with `convert`, which is on unless
	// its CLI is given `-c`.
	if (written <= 18 || command.direct === true || written >= FIRST_CUSTOM_INSTRUMENT) {
		return written >= 0x13 && written < FIRST_CUSTOM_INSTRUMENT ? written - 0x13 + FIRST_CUSTOM_INSTRUMENT : written;
	}

	return null;
}

/**
 * The instrument this command selects, or `null` where it selects none.
 *
 * {@link emittedInstrument} answers what reaches `$DA`, which is `null` for a
 * drum — `@21`-`@29` arm the percussion remap and emit nothing. A drum is still
 * an instrument to pick, so this is that answer widened by the nine, and it is
 * the value {@link instrumentByte} inverts.
 */
export function selectedInstrument(command: Command): number | null {
	return isPercussionInstrument(command) ? (command.args[0]?.value ?? null) : emittedInstrument(command);
}

/**
 * The number this command must carry to select `instrument`, or `null` where its
 * spelling cannot express that instrument at all.
 *
 * `null` is not a failure to be worked around: it is the spelling saying so. A
 * caller that wants the whole set has to rewrite the command, which changes text
 * the author wrote.
 */
export function instrumentByte(command: Command, instrument: number): number | null {
	if (instrument < 0) {
		return null;
	}

	const byte = spelling(command, instrument);
	return byte !== null && byte <= MAX_ARGUMENT ? byte : null;
}

function spelling(command: Command, instrument: number): number | null {
	if (command.vcmd === 0xda) {
		if (command.target.program === 1) {
			// Below `$13` the byte is the table entry and at or above it the byte is
			// a custom instrument, so entry 19 has no spelling left here.
			if (instrument < 0x13) {
				return instrument;
			}

			return instrument >= FIRST_CUSTOM_INSTRUMENT ? instrument - FIRST_CUSTOM_INSTRUMENT + 0x13 : null;
		}

		// The byte is the byte. 20-29 is past the driver's table and is not
		// percussion either: a drum is `@21`-`@29`, which emits no `$DA` to carry.
		return instrument <= LAST_DRIVER_INSTRUMENT || instrument >= FIRST_CUSTOM_INSTRUMENT ? instrument : null;
	}

	if (instrument <= 18 || instrument >= FIRST_CUSTOM_INSTRUMENT) {
		return instrument;
	}

	if (instrument < FIRST_PERCUSSION_INSTRUMENT || instrument > LAST_PERCUSSION_INSTRUMENT) {
		// `@19` and `@20` emit nothing and load nothing, so there is no instrument
		// there for a number to select.
		return null;
	}

	// The plain form is the only one that writes a drum: `@@21` is the direct
	// form, which the 19-29 remap turns into custom instrument 32.
	return command.direct === true ? null : instrument;
}

/**
 * Every instrument this command's spelling can select, ascending.
 *
 * Built by asking {@link instrumentByte} about each candidate rather than by
 * restating the bands, so a list and the write that follows it cannot disagree.
 * `customCount` is how many entries the song's `#instruments` blocks define —
 * `TokenIndex.instruments.length`.
 */
export function instrumentReach(command: Command, customCount: number): number[] {
	const candidates: number[] = [];
	for (let n = 0; n <= LAST_DRIVER_INSTRUMENT; n++) {
		candidates.push(n);
	}

	for (let n = FIRST_PERCUSSION_INSTRUMENT; n <= LAST_PERCUSSION_INSTRUMENT; n++) {
		candidates.push(n);
	}

	for (let n = 0; n < Math.max(0, customCount); n++) {
		candidates.push(FIRST_CUSTOM_INSTRUMENT + n);
	}

	return candidates.filter((n) => instrumentByte(command, n) !== null);
}
