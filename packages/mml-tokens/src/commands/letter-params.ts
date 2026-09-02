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

/** The length denominators worth stopping on: every one that divides 192 evenly. */
export const NOTE_DENOMINATORS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 192] as const;

/** `l` — the length later notes fall back to (`parser.ts:parseDefaultLength`). Default: l8 */
const defaultLength: Resolver = (command) => ({
	params: [
		u8("Length", "denominator", {
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
	// No note letters, no `r` and no `^`. A `ParamDescriptor` is bound to one
	// argument of one command, and a note's length is not always in an argument:
	// `c` under a standing `l` writes none, `c^8` writes one for two segments,
	// and `c0` writes one `getNoteLength` then throws away. The subject is the
	// **segment**, which `NoteLengthSegment` already is —
	// `command-inspector/note-length/` is where the eleven spellings are told
	// apart and where each one's splice is chosen.
	//
	// No `[`. `parseLoopStart` never calls `getInt`, so digits after an opening
	// bracket are read as music and the row could never be filled; `resolveCommand`
	// falls back to "no arguments", which is what the command has. A loop's count
	// is `commands/loops.ts`'s answer — it sits on the second of two `]` commands
	// for a subloop, on none at all for a `(n)m`, and one less than itself for a
	// `$E6` — and `]` is what is left for when that reading declines, which is a
	// close with nothing open. No `*` either: `readLoops` raises a recall for every
	// one it meets, so the construct always answers for a caret on it.
	"]": fixed([u8("Repeats", "index", { min: 1, describe: (n) => `plays ${n} times` })]),
};
