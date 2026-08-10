import { TICKS_PER_WHOLE } from "@amk/core/tables";

/**
 * Turning driver bytes into the units a musician thinks in.
 *
 * Shared by the descriptor tables and the bespoke panels so that a tempo, a tick
 * count or a note byte is never spelled two ways in one screen.
 *
 * How a value is *written back* is not here — that is `argumentText` in
 * `@amk/tokens`'s `edits.ts`, because the radix is a fact about the language rather
 * than about presentation, and that layer is the one a harness can gate.
 */

/**
 * Seconds per driver tick at a tempo byte.
 *
 * `parser.ts:TEMPO_TICK_SECONDS` — a tick is `256 / (500 × (tempo + 1))` seconds.
 *
 * That `+ 1` is not a fudge. Every vcmd handler is entered with the carry set,
 * because the dispatcher's `asl a` (`main.asm:2659`) shifts out bit 7 of a byte
 * that is always `$DA` or above and nothing clears it before the jump; `$E2`'s
 * handler then does a carry-less `adc a, $0387` and stores the result. So the
 * driver runs one faster than the number written — which is also why `t255`
 * stores 0 and freezes the song outright.
 */
export function tickSeconds(tempo: number): number {
	return 256 / (500 * (tempo + 1));
}

/** Beats per minute for a tempo byte: 48 ticks to a quarter note. */
export function bpm(tempo: number): number {
	return 60 / (48 * tickSeconds(tempo));
}

/**
 * The tempo byte that comes closest to a BPM.
 *
 * Searched over the 256 candidates rather than inverted, so it cannot drift from
 * {@link bpm} and so the answer is always a byte that exists. `t0` is excluded:
 * the driver never advances at it.
 */
export function nearestTempo(target: number): number {
	let best = 1;
	let error = Infinity;
	for (let tempo = 1; tempo <= 0xff; tempo++) {
		const distance = Math.abs(bpm(tempo) - target);
		if (distance < error) {
			error = distance;
			best = tempo;
		}
	}

	return best;
}

/**
 * Every tick count the readme's Length table names, and the five dotted ones.
 *
 * `hex_command_reference.html`'s `#LengthInfo` is exactly `192 / n` for the plain
 * notes and two thirds of that for the triplets, which is what makes a duration
 * byte a plain tick count — and the readme says so itself: "any value in between
 * these may be used as well. For example, $48 is equal to a quarter note tied to
 * an eighth note" (72 = 48 + 24). The dotted rows are not in the readme's table;
 * they are the same arithmetic, and they come up constantly in real songs.
 */
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
 *
 * Ticks first because that is the byte; seconds last because they are the part
 * that depends on something written elsewhere, and naming the tempo is what lets
 * a reader check it. With no tempo set there is no honest seconds figure, so it
 * says nothing rather than assuming the driver's power-on default.
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

/** `1/8` when the tick count is a whole-note fraction exactly, else `null`. */
export function wholeNoteFraction(ticks: number): string | null {
	return ticks > 0 && TICKS_PER_WHOLE % ticks === 0 ? `1/${TICKS_PER_WHOLE / ticks}` : null;
}

/** The twelve chromatic pitches, as MML writes them. Index is the semitone. */
export const NOTE_NAMES = ["c", "c+", "d", "d+", "e", "f", "f+", "g", "g+", "a", "a+", "b"];

/**
 * A note byte as it would be written in MML.
 *
 * `pitch + (octave - 1) × 12 + 0x80` (`parser.ts` `getPitch`), read backwards.
 */
export function noteName(byte: number): string {
	const pitch = byte & 0x7f;
	return `o${Math.floor(pitch / 12) + 1} ${NOTE_NAMES[pitch % 12]}`;
}

/**
 * The eleven intervals inside an octave, by semitone. Index 0 is unused — a
 * distance of nothing is not an interval, and {@link intervalName} says so.
 */
const INTERVALS = [
	"",
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

/**
 * A signed semitone count as the interval it is.
 *
 * For the arpeggio list, whose entries are distances from the note being played
 * rather than notes. `+7` is a number you have to work out; "a perfect 5th
 * higher" is the thing you were trying to write.
 *
 * Higher and lower rather than up and down, because these are pitches rather
 * than positions in a list — nothing moves.
 */
export function intervalName(semitones: number): string {
	if (semitones === 0) {
		return "the note itself";
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

/**
 * The same, with the number in front — `+4 — a major 3rd higher`.
 *
 * Both halves, because they answer different questions: the semitones are what
 * the byte says and what a second entry is counted against, and the name is what
 * it will sound like. Zero reads as itself; "0 — the note itself" is a sum
 * nobody needed to see.
 */
export function intervalLabel(semitones: number): string {
	if (semitones === 0) {
		return intervalName(0);
	}

	return `${semitones > 0 ? "+" : ""}${semitones} — ${intervalName(semitones)}`;
}

/**
 * AddmusicK's pan, which runs 0 (hard right) to 20 (hard left) with 10 centre.
 *
 * Backwards from every other pan control anyone has used, and stated in words
 * here for exactly that reason.
 */
export function panLabel(value: number): string {
	if (value === 10) {
		return "centre";
	}

	return value < 10 ? `right ${10 - value}/10` : `left ${value - 10}/10`;
}

/** `80%` of the byte range, for a 0-255 level. */
export function percentOf255(value: number): string {
	return `${Math.round((value / 255) * 100)}% of full`;
}

/** A signed byte with its hex form — how every echo volume and feedback reads. */
export function signedLabel(value: number): string {
	const signed = value >= 0x80 ? value - 0x100 : value;
	return `${signed > 0 ? "+" : ""}${signed}`;
}
