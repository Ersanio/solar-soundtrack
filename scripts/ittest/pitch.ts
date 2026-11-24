/** `ittest`: pitch — three octaves with linear and Amiga slides at three C5Speeds and three factors, each walked within a few cents; and an instrument's keymap translating its notes and choosing its samples. */

import { itHz } from "@amk/import/it/play";
import { check, section } from "../harness";
import { type Cell, centsOff, imported, itBytes, note, pattern, played, problems, square } from "./support";

/** The cents a note may stray: the driver's floor at a low factor, as in `modtest`, down to a base rate of about 2.5 kHz. */
const TOLERANCE = 11;
const LOWEST_RATE = 2400;
/** Above about 128 kHz the DSP runs out of pitch, and the notes there are folded an octave down. */
const HIGHEST_RATE = 120_000;

const scale = (notes: readonly number[]): Cell[][] =>
	pattern(notes.map((n, row) => [row, 0, { note: n, instrument: 1 }] as [number, number, Cell]));

section("pitch: IT's rates");

check("C-5 plays at the C5Speed", itHz(8363, 60) === 8363);
check("an octave down is half", itHz(22050, 48) === 11025);

section("pitch: three octaves");

// C-4 to B-6.
const NOTES = Array.from({ length: 36 }, (_, i) => note("C-4") + i);
for (const linear of [true, false]) {
	for (const c5Speed of [8363, 22050, 44100]) {
		for (const factor of [1, 0.5, 0.3].filter(
			(f) => c5Speed * f >= LOWEST_RATE && itHz(c5Speed * f, NOTES[35]) < HIGHEST_RATE,
		)) {
			const imp = imported(
				itBytes({
					linear,
					samples: [{ pcm: square(64, 4), loopStart: 0, loopLength: 256, c5Speed }],
					orders: [0],
					patterns: [scale(NOTES)],
				}),
				{ factors: new Map([[1, factor]]) },
			);
			const notes = played(imp.song, 0);
			const worst = Math.max(...notes.map((n, i) => Math.abs(centsOff(imp, n, 0, i * 6))));
			const name = `${linear ? "linear" : "Amiga"}, C5Speed ${c5Speed}, at ${factor}`;
			check(
				`${name}: 36 notes within ${TOLERANCE} cents`,
				notes.length === 36 && worst < TOLERANCE,
				`${notes.length} notes, worst ${worst.toFixed(2)}`,
			);
			check(`${name} raises nothing`, problems(imp.song).length === 0, problems(imp.song).join("; "));
		}
	}
}

section("pitch: the keymap");

{
	const imp = imported(
		itBytes({
			instruments: [{ keymap: Array.from({ length: 120 }, (_, n) => ({ note: n + 12, sample: n < 60 ? 1 : 2 })) }],
			samples: [
				{ pcm: square(64, 4), loopStart: 0, loopLength: 256 },
				{ pcm: square(16, 16), loopStart: 0, loopLength: 256 },
			],
			orders: [0],
			patterns: [
				pattern([
					[0, 0, { note: "B-4", instrument: 1 }],
					[1, 0, { note: "C-5", instrument: 1 }],
				]),
			],
		}),
	);
	const channel = imp.it.play.channels[0];
	check(
		"the keymap picks each note's sample",
		channel.sample[0] === 1 && channel.sample[6] === 2,
		`${channel.sample[0]} ${channel.sample[6]}`,
	);
	check(
		"and plays its translated note, an octave up",
		Math.abs(channel.pitch[6] - 12) < 1e-9,
		channel.pitch[6].toFixed(3),
	);
	check("a keymapped instrument raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
}
