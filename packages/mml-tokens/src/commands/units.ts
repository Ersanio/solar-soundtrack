/**
 * Turning driver bytes into the units a musician thinks in. This file mainly focuses
 * on language, terminology and units that are widely recognized.
 */

/**
 * What `$51` holds for a tempo byte.
 *
 * One more than the byte, because both handlers are entered with the carry set
 * and add it in (`Commands.asm:320`, `:330`) — and it is an 8-bit `adc`, so
 * `t255` wraps to 0 and *stops* the song rather than running it at its fastest.
 */
export function driverTempo(tempo: number): number {
	return (tempo + 1) & 0xff;
}

/** Seconds per tick at a *driver* tempo — `$51` itself, not the byte that set it. */
export function driverTickSeconds(driver: number): number {
	return 256 / (500 * driver);
}

/**
 * Seconds per driver tick at a tempo byte.
 * `parser.ts:TEMPO_TICK_SECONDS` — a tick is `256 / (500 × (tempo + 1))` seconds.
 * The + 1 is intentional as in the ASM source, the carry flag is set.
 *
 * Deliberately `tempo + 1` and not {@link driverTempo}: this reads a byte for a
 * label, and `t255` should say how long its ticks would be rather than divide by
 * the zero the register really holds. The two part company at 255 alone, and
 * `tokentest` pins where.
 */
export function tickSeconds(tempo: number): number {
	return driverTickSeconds(tempo + 1);
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
	return $localize`:@@command.unit.tempo:command.unit.tempo ${bpm(tempo).toFixed(1)}:bpm: ${ticksPerSecond(tempo).toFixed(1)}:rate:`;
}

/** * Every tick count the readme's "Length" table names, and the five dotted ones. */
const NOTE_LENGTHS: Readonly<Record<number, string>> = {
	192: $localize`:@@command.unit.a-whole-note:command.unit.a-whole-note`,
	144: $localize`:@@command.unit.a-dotted-half-note:command.unit.a-dotted-half-note`,
	128: $localize`:@@command.unit.a-whole-triplet:command.unit.a-whole-triplet`,
	96: $localize`:@@command.unit.a-half-note:command.unit.a-half-note`,
	72: $localize`:@@command.unit.a-dotted-quarter-note:command.unit.a-dotted-quarter-note`,
	64: $localize`:@@command.unit.a-half-triplet:command.unit.a-half-triplet`,
	48: $localize`:@@command.unit.a-quarter-note:command.unit.a-quarter-note`,
	36: $localize`:@@command.unit.a-dotted-eighth-note:command.unit.a-dotted-eighth-note`,
	32: $localize`:@@command.unit.a-quarter-triplet:command.unit.a-quarter-triplet`,
	24: $localize`:@@command.unit.an-eighth-note:command.unit.an-eighth-note`,
	18: $localize`:@@command.unit.a-dotted-16th-note:command.unit.a-dotted-16th-note`,
	16: $localize`:@@command.unit.an-eighth-triplet:command.unit.an-eighth-triplet`,
	12: $localize`:@@command.unit.a-16th-note:command.unit.a-16th-note`,
	9: $localize`:@@command.unit.a-dotted-32nd-note:command.unit.a-dotted-32nd-note`,
	8: $localize`:@@command.unit.a-16th-triplet:command.unit.a-16th-triplet`,
	6: $localize`:@@command.unit.a-32nd-note:command.unit.a-32nd-note`,
	4: $localize`:@@command.unit.a-32nd-triplet:command.unit.a-32nd-triplet`,
	3: $localize`:@@command.unit.a-64th-note:command.unit.a-64th-note`,
	2: $localize`:@@command.unit.a-64th-triplet:command.unit.a-64th-triplet`,
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
export function tempoName(tempo: number | null): string {
	return tempo === null
		? $localize`:@@command.unit.default-tempo:command.unit.default-tempo ${DEFAULT_TEMPO}:tempo:`
		: `t${tempo}`;
}

/** "1 tick" or "N ticks". */
export function tickCount(ticks: number): string {
	return ticks === 1
		? $localize`:@@command.unit.ticks.one:command.unit.ticks.one`
		: $localize`:@@command.unit.ticks.other:command.unit.ticks.other ${ticks}:ticks:`;
}

/** A duration in seconds at a tempo, e.g. "0.50 s at t120". */
function secondsAt(seconds: number, tempo: string): string {
	return $localize`:@@command.unit.seconds-at:command.unit.seconds-at ${seconds.toFixed(2)}:seconds: ${tempo}:tempo:`;
}

/** The tick count and the note length it comes to — true whatever the tempo is. */
function tickParts(ticks: number): string[] {
	const parts = [tickCount(ticks)];

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
		parts.push(secondsAt(ticks * tickSeconds(tempo), `t${tempo}`));
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
	return [...tickParts(ticks), secondsAt(seconds, tempoName(tempo))].join(" · ");
}

/**
 * The tempo the driver plays each tick of a `$E3` fade at, driver-side, or
 * `null` when the fade ends the song.
 *
 * `main.asm:2461` steps the tempo once per tick by `Commands.asm:335`'s 8.8
 * delta and snaps to the target on the tick *after* the last, so this has
 * exactly `ticks` entries and the last of them is not the target.
 *
 * Walked rather than integrated because the walk is the driver's: 255 terms at
 * most, and it lands on the same truncation the fixed-point delta does. The one
 * model of a fade in the tree — {@link tempoFadeSeconds} sums it for a label and
 * the editor's transport clock reads it tick by tick, so the two cannot drift.
 */
export function tempoFadeSteps(ticks: number, from: number, to: number): number[] | null {
	const start = driverTempo(from);
	const target = driverTempo(to);
	if (start === 0 || target === 0 || ticks === 0) {
		// A tempo of 0 stops the song advancing, so there is no duration to give.
		return null;
	}

	// Commands.asm:332 — `Divide16` truncates towards zero, and $50/$51 keeps the
	// fraction, so what the driver plays at is the whole part of the running sum.
	const delta = Math.trunc(((target - start) * 256) / ticks) / 256;

	const steps: number[] = [];
	for (let step = 0; step < ticks; step++) {
		steps.push(Math.floor(start + step * delta));
	}

	return steps;
}

/**
 * Seconds a tempo fade really takes, or `null` when it ends the song.
 *
 * {@link ticksLabel}'s arithmetic cannot answer this one: the tick length it
 * multiplies by is the thing the command is changing. The elapsed time is the
 * sum of each of {@link tempoFadeSteps}' own tick lengths — `t255,254` from t144
 * takes 0.67 s where 255 ticks at t144 would be 0.90 s, and a fade the other way
 * is out by more than double.
 */
export function tempoFadeSeconds(ticks: number, from: number, to: number): number | null {
	const steps = tempoFadeSteps(ticks, from, to);
	return steps === null ? null : steps.reduce((total, tempo) => total + driverTickSeconds(tempo), 0);
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
		parts.push(
			$localize`:@@command.unit.seconds-fade:command.unit.seconds-fade ${seconds.toFixed(2)}:seconds: ${tempoName(from)}:from: ${to}:to:`,
		);
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
	$localize`:@@command.unit.minor-2nd:command.unit.minor-2nd`,
	$localize`:@@command.unit.major-2nd:command.unit.major-2nd`,
	$localize`:@@command.unit.minor-3rd:command.unit.minor-3rd`,
	$localize`:@@command.unit.major-3rd:command.unit.major-3rd`,
	$localize`:@@command.unit.perfect-4th:command.unit.perfect-4th`,
	$localize`:@@command.unit.tritone:command.unit.tritone`,
	$localize`:@@command.unit.perfect-5th:command.unit.perfect-5th`,
	$localize`:@@command.unit.minor-6th:command.unit.minor-6th`,
	$localize`:@@command.unit.major-6th:command.unit.major-6th`,
	$localize`:@@command.unit.minor-7th:command.unit.minor-7th`,
	$localize`:@@command.unit.major-7th:command.unit.major-7th`,
];

/** A signed semitone count as the interval it is. */
export function intervalName(semitones: number): string {
	if (semitones === 0) {
		return $localize`:@@command.unit.interval.unison:command.unit.interval.unison`;
	}

	const up = semitones > 0;
	const size = Math.abs(semitones);
	const octaves = Math.floor(size / 12);
	const interval = INTERVALS[size % 12];

	if (octaves === 0) {
		return up
			? $localize`:@@command.unit.interval.higher:command.unit.interval.higher ${interval}:interval:`
			: $localize`:@@command.unit.interval.lower:command.unit.interval.lower ${interval}:interval:`;
	}

	if (interval === "") {
		if (octaves === 1) {
			return up
				? $localize`:@@command.unit.interval.octave-higher:command.unit.interval.octave-higher`
				: $localize`:@@command.unit.interval.octave-lower:command.unit.interval.octave-lower`;
		}

		return up
			? $localize`:@@command.unit.interval.octaves-higher:command.unit.interval.octaves-higher ${octaves}:octaves:`
			: $localize`:@@command.unit.interval.octaves-lower:command.unit.interval.octaves-lower ${octaves}:octaves:`;
	}

	if (octaves === 1) {
		return up
			? $localize`:@@command.unit.interval.octave-and-higher:command.unit.interval.octave-and-higher ${interval}:interval:`
			: $localize`:@@command.unit.interval.octave-and-lower:command.unit.interval.octave-and-lower ${interval}:interval:`;
	}

	return up
		? $localize`:@@command.unit.interval.octaves-and-higher:command.unit.interval.octaves-and-higher ${octaves}:octaves: ${interval}:interval:`
		: $localize`:@@command.unit.interval.octaves-and-lower:command.unit.interval.octaves-and-lower ${octaves}:octaves: ${interval}:interval:`;
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
		return $localize`:@@command.unit.pan.centre:command.unit.pan.centre`;
	}

	return value < 10
		? $localize`:@@command.unit.pan.right:command.unit.pan.right ${10 - value}:amount:`
		: $localize`:@@command.unit.pan.left:command.unit.pan.left ${value - 10}:amount:`;
}

/** % of the byte range of 0-255. */
export function percentOf255(value: number): string {
	return $localize`:@@command.unit.percent-of-full:command.unit.percent-of-full ${Math.round((value / 255) * 100)}:percent:`;
}
