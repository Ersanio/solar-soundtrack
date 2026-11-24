/** `xmtest`: pitch — FT2's periods and rates, three octaves on linear and Amiga frequencies at three relative notes and factors, each walked within a few cents; E5x and a relative note; and the keymap's sample for each note. */

import { xmHz, xmPeriod } from "@amk/import/xm/play";
import { check, section } from "../harness";
import { type Cell, centsOff, imported, note, pattern, played, problems, square, xmBytes } from "./support";

/** The cents a note may stray: the driver's floor at a low factor, as in `modtest`. */
const TOLERANCE = 11;

const scale = (notes: readonly number[]): Cell[][] =>
	pattern(notes.map((n, row) => [row, 0, { note: n, instrument: 1 }] as [number, number, Cell]));

section("pitch: FT2's periods");

check("C-4 is 4608 linear and 1712 Amiga", xmPeriod(784, true) === 4608 && xmPeriod(784, false) === 1712);
check(
	"C-4 plays at 8363 Hz either way",
	Math.abs(xmHz(4608, true) - 8363) < 1e-6 && Math.abs(xmHz(1712, false) - 8363) < 1e-6,
);
check("an octave up is 768 linear periods less", Math.abs(xmHz(4608 - 768, true) - 2 * 8363) < 1e-6);

section("pitch: three octaves");

// C-3 to B-5.
const NOTES = Array.from({ length: 36 }, (_, i) => note("C-3") + i);
for (const linear of [true, false]) {
	for (const relativeNote of [0, 12, -7]) {
		for (const factor of [1, 0.5, 0.3]) {
			const imp = imported(
				xmBytes({
					linear,
					instruments: [
						{ samples: [{ pcm: square(64, 4), loopStart: 0, loopLength: 256, relativeNote, finetune: 20 }] },
					],
					orders: [0],
					patterns: [scale(NOTES)],
				}),
				{ factors: new Map([[1, factor]]) },
			);
			const notes = played(imp.song, 0);
			const worst = Math.max(...notes.map((n, i) => Math.abs(centsOff(imp, n, 0, i * 6))));
			const name = `${linear ? "linear" : "Amiga"}, relative note ${relativeNote}, at ${factor}`;
			check(
				`${name}: 36 notes within ${TOLERANCE} cents`,
				notes.length === 36 && worst < TOLERANCE,
				`${notes.length} notes, worst ${worst.toFixed(2)}`,
			);
			check(`${name} raises nothing`, problems(imp.song).length === 0, problems(imp.song).join("; "));
		}
	}
}

section("pitch: finetune and keymap");

{
	const imp = imported(
		xmBytes({
			instruments: [{ samples: [{ pcm: square(64, 4), loopStart: 0, loopLength: 256 }] }],
			orders: [0],
			patterns: [
				pattern([
					[0, 0, { note: "C-4", instrument: 1 }],
					[1, 0, { note: "C-4", instrument: 1, effect: "E", param: 0x5c }],
				]),
			],
		}),
	);
	const pitch = imp.xm.play.channels[0].pitch;
	// E5C is a finetune of (12 × 16) - 128 = 64: half a semitone, at FT2's 16ths of one.
	check(
		"E5C plays the note half a semitone up",
		Math.abs(pitch[6] - pitch[0] - 0.5) < 0.01,
		(pitch[6] - pitch[0]).toFixed(3),
	);
}

{
	const imp = imported(
		xmBytes({
			instruments: [
				{
					samples: [
						{ pcm: square(64, 4), loopStart: 0, loopLength: 256 },
						{ pcm: square(16, 16), loopStart: 0, loopLength: 256, relativeNote: 12 },
					],
					keymap: Array.from({ length: 96 }, (_, i) => (i < note("C-4") - 1 ? 0 : 1)),
				},
			],
			orders: [0],
			patterns: [
				pattern([
					[0, 0, { note: "B-3", instrument: 1 }],
					[1, 0, { note: "C-4", instrument: 1 }],
				]),
			],
		}),
	);
	const sample = imp.xm.play.channels[0].sample;
	check("the keymap picks each note's sample", sample[0] === 1 && sample[6] === 2, `${sample[0]} ${sample[6]}`);
	check("and each is its own instrument", imp.written.samples.length === 2);
	check("a keymapped instrument raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
}
