/**
 * Turning driver bytes into the units a musician thinks in. This file mainly focuses
 * on language, terminology and units that are widely recognized.
 */

/**
 * Seconds per driver tick at a tempo byte.
 * `parser.ts:TEMPO_TICK_SECONDS` — a tick is `256 / (500 × (tempo + 1))` seconds.
 * The + 1 is intentional as in the ASM source, the carry flag is set.
 */
export function tickSeconds(tempo: number): number {
	return 256 / (500 * (tempo + 1));
}

/** Beats per minute for a tempo byte: 48 ticks to a quarter note. */
export function bpm(tempo: number): number {
	return 60 / (48 * tickSeconds(tempo));
}

/** * Every tick count the readme's "Length" table names, and the five dotted ones. */
const NOTE_LENGTHS: Readonly<Record<number, string>> = {
	192: "a whole note",
	144: "a dotted half note",
	128: "a whole triplet",
	96: "a half note",
	72: "a dotted quarter note",
	64: "a half triplet",
	48: "a quarter note",
	36: "a dotted eighth note",
	32: "a quarter triplet",
	24: "an eighth note",
	18: "a dotted 16th note",
	16: "an eighth triplet",
	12: "a 16th note",
	9: "a dotted 32nd note",
	8: "a 16th triplet",
	6: "a 32nd note",
	4: "a 32nd triplet",
	3: "a 64th note",
	2: "a 64th triplet",
};

/** The note length a tick count is exactly, or `null` for one that falls between. */
export function noteLengthName(ticks: number): string | null {
	return NOTE_LENGTHS[ticks] ?? null;
}

/**
 * A duration said in all the ways it can be: ticks, the note length it comes to,
 * and the seconds it lasts at the tempo in force.
 */
export function ticksLabel(ticks: number, tempo: number | null): string {
	const parts = [`${ticks} tick${ticks === 1 ? "" : "s"}`];

	const named = noteLengthName(ticks);
	if (named) {
		parts.push(named);
	}

	if (tempo !== null) {
		parts.push(`${(ticks * tickSeconds(tempo)).toFixed(2)} s at t${tempo}`);
	}

	return parts.join(" · ");
}

/** The twelve chromatic pitches, as MML writes them. Index is the semitone. */
export const NOTE_NAMES = ["c", "c+", "d", "d+", "e", "f", "f+", "g", "g+", "a", "a+", "b"];

/**
 * A note byte as it would be written in MML.
 * `pitch + (octave - 1) × 12 + 0x80` (`parser.ts` `getPitch`), read backwards.
 */
export function noteName(byte: number): string {
	const pitch = byte & 0x7f;
	return `o${Math.floor(pitch / 12) + 1} ${NOTE_NAMES[pitch % 12]}`;
}

/** The eleven intervals inside an octave, by semitone. */
const INTERVALS = [
	"", // Unused; Unison
	"minor 2nd",
	"major 2nd",
	"minor 3rd",
	"major 3rd",
	"perfect 4th",
	"tritone",
	"perfect 5th",
	"minor 6th",
	"major 6th",
	"minor 7th",
	"major 7th",
];

/** A signed semitone count as the interval it is. */
export function intervalName(semitones: number): string {
	if (semitones === 0) {
		return "unison";
	}

	const direction = semitones > 0 ? "higher" : "lower";
	const size = Math.abs(semitones);
	const octaves = Math.floor(size / 12);
	const rest = size % 12;

	if (octaves === 0) {
		return `a ${INTERVALS[rest]} ${direction}`;
	}

	const octaveText = octaves === 1 ? "an octave" : `${octaves} octaves`;
	return rest === 0 ? `${octaveText} ${direction}` : `${octaveText} and a ${INTERVALS[rest]} ${direction}`;
}

/** The same, with the number in front e.g. `+4 — a major 3rd higher`. */
export function intervalLabel(semitones: number): string {
	if (semitones === 0) {
		return intervalName(0);
	}

	return `${semitones > 0 ? "+" : ""}${semitones} — ${intervalName(semitones)}`;
}

/** AddmusicK's pan, which runs 0 (hard right) to 20 (hard left) with 10 centre. */
export function panLabel(value: number): string {
	if (value === 10) {
		return "centre";
	}

	return value < 10 ? `right ${10 - value}/10` : `left ${value - 10}/10`;
}

/** % of the byte range of 0-255. */
export function percentOf255(value: number): string {
	return `${Math.round((value / 255) * 100)}% of full`;
}
