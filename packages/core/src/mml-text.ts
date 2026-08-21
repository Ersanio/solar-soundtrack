/**
 * How a parse-time value is spelled as MML.
 *
 * Shared by everything that writes a note length, an octave or a `q` back into
 * the source, so that one spelling rule exists — the normalizer's and the piano
 * roll's text have to agree with each other and with what `parser.ts` reads.
 */

import { TICKS_PER_WHOLE } from "./hardcoded-tables";
import { hex2 } from "./hex";

/**
 * The shortest spelling of `ticks` as a note length, or `null` where the target
 * has none.
 *
 * `N` where `192 / N` is exact, then `N.` and `N..` — one and two dots, halving
 * as `getNoteLengthModifier` halves (Music.cpp:2950, floor at each step) — and
 * `=ticks` for anything else. A note takes every one of these on every target
 * (`parser.ts:getNoteLength`); an `l` takes dots and `=` only from `#amk 4`
 * (`parser.ts:parseDefaultLength`), so below that a default length that is not
 * a plain divisor cannot be written at all.
 */
export function spellLength(ticks: number, kind: "note" | "l", targetAMKVersion: number): string | null {
	if (!Number.isInteger(ticks) || ticks < 1 || ticks > TICKS_PER_WHOLE) {
		return null;
	}

	if (TICKS_PER_WHOLE % ticks === 0) {
		return String(TICKS_PER_WHOLE / ticks);
	}

	const modifiers = kind === "note" || targetAMKVersion >= 4;
	if (!modifiers) {
		return null;
	}

	for (let divisor = 1; divisor <= TICKS_PER_WHOLE; divisor++) {
		if (TICKS_PER_WHOLE % divisor !== 0) {
			continue;
		}

		const base = TICKS_PER_WHOLE / divisor;
		const half = Math.floor(base / 2);
		if (base + half === ticks) {
			return `${divisor}.`;
		}

		if (base + half + Math.floor(half / 2) === ticks) {
			return `${divisor}..`;
		}
	}

	return `=${ticks}`;
}

/**
 * An absolute octave, or `null` where `o` cannot reach it.
 *
 * `o` takes 0 to 6 (`parser.ts:parseOctave`); the parser's own octave runs one
 * past either end, because `>` under `o6` stops at 7 and `<` under `o0` at -1.
 */
export function spellOctave(octave: number): string | null {
	return Number.isInteger(octave) && octave >= 0 && octave <= 6 ? `o${octave}` : null;
}

/** A quantization byte as `q` writes it: two hex digits, `01` to `7F`. */
export function spellQ(q: number): string {
	return `q${hex2(q)}`;
}
