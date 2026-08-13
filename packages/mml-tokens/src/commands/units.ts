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

/** Driver ticks per second at a tempo byte — {@link tickSeconds} the other way up. */
export function ticksPerSecond(tempo: number): number {
	return 1 / tickSeconds(tempo);
}

/** The caveat is the driver's, not one spelling's: `t` compiles to `$E2` and `t,` to `$E3`. */
export function tempoLabel(tempo: number): string {
	const rate = `about ${bpm(tempo).toFixed(1)} BPM · ${ticksPerSecond(tempo).toFixed(1)} ticks per second`;
	return `${rate} — estimated; the driver drops ticks when it is busy`;
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
 * The tempo a song is already playing at before it sets one.
 *
 * `main.asm:177` puts `#$36` straight into `$51`, which holds one more than the
 * MML byte would write — so t53, not the 0x36 `Music.cpp:207` assumes for its
 * own length estimate.
 */
export const DEFAULT_TEMPO = 0x36 - 1;

/** A tempo in a readout, marked where it is {@link DEFAULT_TEMPO} and not the song's. */
function tempoName(tempo: number | null): string {
	return tempo === null ? `the default t${DEFAULT_TEMPO}` : `t${tempo}`;
}

/** The tick count and the note length it comes to — true whatever the tempo is. */
function tickParts(ticks: number): string[] {
	const parts = [`${ticks} tick${ticks === 1 ? "" : "s"}`];

	const named = noteLengthName(ticks);
	if (named) {
		parts.push(named);
	}

	return parts;
}

/**
 * A duration said in all the ways it can be: ticks, the note length it comes to,
 * and the seconds it lasts at the tempo in force.
 */
export function ticksLabel(ticks: number, tempo: number | null): string {
	const parts = tickParts(ticks);

	if (tempo !== null) {
		parts.push(`${(ticks * tickSeconds(tempo)).toFixed(2)} s at t${tempo}`);
	}

	return parts.join(" · ");
}

/**
 * {@link ticksLabel} for a fade's "Over", which always states its seconds: a song
 * with no `t` in it yet is not a song with no tempo — the driver is already
 * running at {@link DEFAULT_TEMPO}, and that is what the fade would be heard at.
 */
export function fadeTicksLabel(ticks: number, tempo: number | null): string {
	const seconds = ticks * tickSeconds(tempo ?? DEFAULT_TEMPO);
	return [...tickParts(ticks), `${seconds.toFixed(2)} s at ${tempoName(tempo)}`].join(" · ");
}

/**
 * Seconds a tempo fade really takes, or `null` when it ends the song.
 *
 * {@link ticksLabel}'s arithmetic cannot answer this one: the tick length it
 * multiplies by is the thing the command is changing. `main.asm:2461` steps the
 * tempo once per tick by `Commands.asm:335`'s 8.8 delta and snaps to the target
 * on the last, so the elapsed time is the sum of each step's own tick length —
 * `t255,254` from t144 takes 0.67 s where 255 ticks at t144 would be 0.90 s, and
 * a fade the other way is out by more than double.
 *
 * Walked rather than integrated because the walk is the driver's: 255 terms at
 * most, and it lands on the same truncation the fixed-point delta does.
 */
export function tempoFadeSeconds(ticks: number, from: number, to: number): number | null {
	// Both handlers are entered with the carry set, so the driver holds one more
	// than either byte says (`Commands.asm:320`, `:330`).
	const start = (from + 1) & 0xff;
	const target = (to + 1) & 0xff;
	if (start === 0 || target === 0 || ticks === 0) {
		// A tempo of 0 stops the song advancing, so there is no duration to give.
		return null;
	}

	// Commands.asm:332 — `Divide16` truncates towards zero, and $50/$51 keeps the
	// fraction, so what the driver plays at is the whole part of the running sum.
	const delta = Math.trunc(((target - start) * 256) / ticks) / 256;

	let seconds = 0;
	for (let step = 0; step < ticks; step++) {
		seconds += 256 / (500 * Math.floor(start + step * delta));
	}

	return seconds;
}

/**
 * A tempo fade's duration: ticks, as {@link ticksLabel} says them, then the
 * seconds {@link tempoFadeSeconds} works out across the tempo change itself.
 */
export function tempoFadeLabel(ticks: number, from: number | null, to: number | null): string {
	const parts = tickParts(ticks);

	// Only the tempo it leaves has a default to fall back on; the one it fades to
	// is the command's own second byte, and a half-typed one has nothing to say.
	const seconds = to === null ? null : tempoFadeSeconds(ticks, from ?? DEFAULT_TEMPO, to);
	if (seconds !== null) {
		parts.push(`${seconds.toFixed(2)} s, ${tempoName(from)} → t${to}`);
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
