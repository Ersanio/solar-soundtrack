/**
 * How a parse-time value is spelled as MML.
 *
 * Shared by everything that writes a note length, an octave or a `q` back into
 * the source, so that one spelling rule exists — the normalizer's and the piano
 * roll's text have to agree with each other and with what `parser.ts` reads.
 */

import { NOTE_MAX, NOTE_MIN, PITCH_TABLE, TICKS_PER_WHOLE } from "./hardcoded-tables";
import { hex2 } from "./hex";

/** Semitones in an octave. Here rather than in `hardcoded-tables`, which is AddmusicK's own tables. */
export const OCTAVE = 12;

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

/** A written pitch broken back into the pieces `getPitch` read (`parser.ts:734-745`). */
export interface WrittenPitch {
	/** `a`-`g`, lower case. */
	letter: string;
	/** The letter's own semitone, plus 1 for a `+` and minus 1 for a `-`. */
	semitone: number;
	/** Characters consumed, so a caller can keep the length text that follows. */
	length: number;
}

/**
 * The head of a note token, or `null` where it is not one.
 *
 * `getPitch` takes **one** accidental and stops (`parser.ts:736-742`), so `c++`
 * is a `c+` followed by a stray `+`, and the strictness here is what keeps an
 * edit from re-spelling a note the parser reads differently. `r` and `^` are
 * not pitches and answer `null`.
 */
export function parseWrittenPitch(text: string): WrittenPitch | null {
	const letter = text[0]?.toLowerCase() ?? "";
	const index = letter.charCodeAt(0) - 0x61;
	if (index < 0 || index >= PITCH_TABLE.length) {
		return null;
	}

	const sign = text[1];
	const accidental = sign === "+" ? 1 : sign === "-" ? -1 : 0;
	return {
		letter,
		semitone: PITCH_TABLE[index] + accidental,
		length: accidental === 0 ? 1 : 2,
	};
}

/**
 * The octave a note was written under, from its written byte and its own text.
 *
 * `written` is `PITCH_TABLE[letter] + (octave - 1) * 12 + 0x80` and nothing else
 * — `h`, the instrument's tuning and the drum remap all land on `note` instead
 * (`parser.ts:2884-2892`) — so the octave falls straight out of the two, exactly
 * rather than by inference. `null` when the text is not a plain note head or the
 * arithmetic does not come out whole, which is what a macro-expanded note gives.
 */
export function octaveOfNote(written: number, text: string): number | null {
	const pitch = parseWrittenPitch(text);
	if (!pitch || written < NOTE_MIN || written >= NOTE_MAX) {
		return null;
	}

	const above = written - NOTE_MIN - pitch.semitone;
	return above % OCTAVE === 0 ? above / OCTAVE + 1 : null;
}

/**
 * The letter and accidental for a written byte under `octave`, or `null` where
 * that octave cannot reach it.
 *
 * Sharps only. Every semitone of an octave is reachable with `+` alone, so the
 * flat spellings are never needed and one canonical answer means a note dragged
 * away and back comes home spelled the same way. It agrees with `NOTE_NAMES` in
 * `@amk/tokens` by construction, both being built from {@link PITCH_TABLE};
 * `rolltest` holds them to each other, since core may not import tokens.
 */
export function spellNote(written: number, octave: number): string | null {
	if (written < NOTE_MIN || written >= NOTE_MAX) {
		return null;
	}

	const above = written - NOTE_MIN - (octave - 1) * OCTAVE;
	if (above < 0 || above >= OCTAVE) {
		return null;
	}

	const natural = PITCH_TABLE.indexOf(above);
	if (natural >= 0) {
		return String.fromCharCode(0x61 + natural);
	}

	const sharp = PITCH_TABLE.indexOf(above - 1);
	return sharp >= 0 ? `${String.fromCharCode(0x61 + sharp)}+` : null;
}

/**
 * The octave a written byte needs, when the roll is free to choose one.
 *
 * The octave `spellNote` will answer in: the one whose `c` is at or below the
 * byte. `null` outside the range a note can be written in at all.
 */
export function octaveFor(written: number): number | null {
	if (written < NOTE_MIN || written >= NOTE_MAX) {
		return null;
	}

	return Math.floor((written - NOTE_MIN) / OCTAVE) + 1;
}

/**
 * A duration of any size, tied where one token cannot hold it.
 *
 * {@link spellLength} is a single token and so stops at a whole note, but a note
 * may be held for as long as the porter likes: `accumulateTiedLength` sums a run
 * of `^` segments (`parser.ts:2963-3004`) and `emitNote` splits whatever comes
 * out into `$60`-tick frames of its own (`parser.ts:3007-3036`), so there is no
 * ceiling in the driver to reach for. Whole notes first, then the remainder, so
 * the run reads as music rather than as arithmetic.
 */
export function spellDuration(ticks: number, targetAMKVersion: number): string | null {
	if (!Number.isInteger(ticks) || ticks < 1) {
		return null;
	}

	const parts: string[] = [];
	let left = ticks;
	while (left > TICKS_PER_WHOLE) {
		// A whole note, unless what is left over would be too short to spell on
		// its own — `=1` is legal, so only the exact-divisor case can strand one.
		parts.push("1");
		left -= TICKS_PER_WHOLE;
	}

	const last = spellLength(left, "note", targetAMKVersion);
	if (last === null) {
		return null;
	}

	parts.push(last);
	return parts.join("^");
}
