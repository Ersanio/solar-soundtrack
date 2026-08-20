import { TICKS_PER_WHOLE } from "@amk/core/hardcoded-tables";
import { noiseHz } from "@amk/spc/adsr";
import { isFade } from "../tokens";
import { DURATION, type Resolver, TEMPO_FADE_DURATION, fixed, s8, ticks, u8 } from "./param";
import { noteLengthName, percentOf255, tempoLabel } from "./units";

/** See `MAX_TEMPO` in `hex-params.ts`: the driver stores one more than you write. */
const MAX_TEMPO = 254;

/** What each single-letter command's arguments mean. */

/**
 * `v`, `w` and `t`: one argument sets, two fade. `parser.ts:parseFadeableValue`,
 * `parseTempo`. The comma form compiles to `$E8` / `$E1` / `$E3`, so it is shown
 * as those are — same descriptors, same order, duration first.
 *
 * Below `#amk 3` the comma is not looked for, so the second number is not an
 * argument at all: `isFade` is the test both this and `gather`'s naming make,
 * and what is left is the plain form with a warning after it (AMK0100).
 */
function fadeable(name: string, describe: (value: number) => string | null): Resolver {
	return (command) => {
		const target = u8(name, "level", { describe });
		if (!isFade(command.kind, command.args.length, command.target)) {
			return {
				params: [target],
				note: command.args.length >= 2 ? NOT_A_FADE : undefined,
			};
		}

		return { params: [DURATION, target] };
	};
}

/** Said where a comma was written and the dialect does not read one. */
const NOT_A_FADE =
	"The comma form needs #amk 4, so only the first number takes effect here; the rest is read as stray characters.";

/** The vibrato rate. */
const RATE = u8("Rate", "rate", {
	min: 1,
	describe: (value) => (value === 0 ? "a rate of 0 never advances, so the vibrato stays still" : "higher is faster"),
});

/**
 * `p` — `pRate,Extent` or `pDelay,Rate,Extent` (`parser.ts:parseVibrato`).
 *
 * Adding a third argument moves the first one's meaning from rate to delay: the
 * same position says two different things depending on how many there are. That
 * is `p`'s own doing and not something the panel can smooth over, so it says so.
 */
const vibrato: Resolver = (command) =>
	command.args.length >= 3
		? { params: [ticks("Delay"), RATE, u8("Depth", "level")] }
		: {
				params: [RATE, u8("Depth", "level")],
				note: "With two arguments the first is the rate. Add a third and the first becomes a delay instead.",
			};

/** The length denominators worth stopping on: every one that divides 192 evenly + 128 */
const NOTE_DENOMINATORS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192] as const;

/** `l` — the length later notes fall back to (`parser.ts:parseDefaultLength`). Default: l8 */
const defaultLength: Resolver = (command) => ({
	params: [
		u8("Length", "index", {
			min: 1,
			max: TICKS_PER_WHOLE,
			stops: NOTE_DENOMINATORS,
			describe: (value) => {
				if (value < 1 || value > TICKS_PER_WHOLE) {
					return "out of range, so the standing length is kept";
				}

				// parser.ts:parseDefaultLength floors, so l128 and l192 both come to a single tick.
				const resolved = Math.floor(TICKS_PER_WHOLE / value);
				const named = noteLengthName(resolved);
				const rounded = TICKS_PER_WHOLE % value === 0 ? "" : ", rounded down";
				return `1/${value}${named ? ` — ${named}` : ""} · ${resolved} tick${resolved === 1 ? "" : "s"}${rounded}`;
			},
		}),
	],
	note:
		command.target.amkVersion >= 4
			? "l=NN writes an exact tick count instead, and dots are allowed — both need #amk 4."
			: undefined,
});

/** A note or rest, whose arguments are the lengths of its tied segments. */
const noteLength: Resolver = (command) => ({
	params: command.args.map((_argument, index) =>
		u8(index === 0 ? "Length" : `Tied to`, "index", {
			min: 1,
			max: TICKS_PER_WHOLE,
			stops: NOTE_DENOMINATORS,
			describe: (value) => {
				const resolved = command.noteLength?.[index]?.ticks;
				const named = resolved === undefined ? null : noteLengthName(resolved);
				return [`1/${value}`, named, resolved === undefined ? null : `${resolved} tick${resolved === 1 ? "" : "s"}`]
					.filter((part) => part !== null)
					.join(" · ");
			},
		}),
	),
});

export const LETTER_PARAMS: Readonly<Record<string, Resolver>> = {
	t: (command) => {
		const target = u8("Tempo", "rate", {
			// `parser.ts:parseTempo` rejects a zero outright — AMK0079 — where the raw
			// `$E2 $00` it compiles to is legal and means the slowest tempo there is.
			min: 1,
			max: MAX_TEMPO,
			describe: tempoLabel,
		});

		const ceiling = "Stops at 254: the driver adds one, so t255 would be tempo 0 and the song would freeze.";
		if (isFade(command.kind, command.args.length, command.target)) {
			return { params: [TEMPO_FADE_DURATION, target], note: `A tempo fade. ${ceiling}` };
		}

		return {
			params: [target],
			note: command.args.length >= 2 ? `${NOT_A_FADE} ${ceiling}` : ceiling,
		};
	},
	v: fadeable("Volume", percentOf255),
	w: fadeable("Global volume", percentOf255),
	// `y` has a view of its own, shared with the `$DB` it compiles to: its two
	// surround arguments are bits of that byte. See `pan-command/`.
	// `q` has a view of its own: two nibbles that mean two unrelated things
	l: defaultLength,
	o: fixed([u8("Octave", "index", { min: 0, max: 6 })]),
	"@": fixed([u8("Instrument", "index")]),
	h: fixed([s8("Transpose", "semitones", { min: -128, max: 127 })]),
	n: fixed(
		[
			u8("Noise clock", "rate", {
				max: 0x1f,
				describe: (value) => (value === 0 ? "silent" : `${Math.round(noiseHz(value)).toLocaleString()} Hz`),
			}),
		],
		// One DSP register drives every voice's noise (`main.asm:2554` ModifyNoise),
		// so this is not a per-channel setting even though it is written on one.
		"Replaces the instrument’s sample with noise until the next instrument change. The value of the latest n-command being played takes precedence.",
	),
	p: vibrato,
	c: noteLength,
	d: noteLength,
	e: noteLength,
	f: noteLength,
	g: noteLength,
	a: noteLength,
	b: noteLength,
	r: noteLength,
	"^": noteLength,
	"[": fixed([u8("Repeats", "index", { min: 1, describe: (n) => `plays ${n} times` })]),
	"]": fixed([u8("Repeats", "index", { min: 1, describe: (n) => `plays ${n} times` })]),
	"*": fixed([u8("Repeats", "index", { min: 1, describe: (n) => `replays the last loop ${n} times` })]),
};
