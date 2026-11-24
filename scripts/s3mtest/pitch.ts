/** `s3mtest`: pitch — three octaves at three C2SPDs and three factors, each note walked within a few cents of the semitone ST3's period plays it nearest; ST3's period arithmetic; S2x's finetune; and the octaves past what a letter reaches folded. */

import { notePeriod } from "@amk/import/s3m/play";
import { check, section } from "../harness";
import { type Cell, centsOff, imported, noteAt, pattern, played, problems, s3mBytes, square } from "./support";

/**
 * The cents a note may stray: the driver's floor at a low factor, as in `modtest`, which holds it down
 * to a base rate of about 2.5 kHz (a MOD's C-2 at 0.3). Below that a small multiplier is coarser still.
 */
const TOLERANCE = 11;
const LOWEST_RATE = 2400;

/** Each note struck on its own row, in order. */
function scale(notes: readonly number[], instrument = 1): Cell[][] {
	return pattern(notes.map((n, row) => [row, 0, { note: n, instrument }] as [number, number, Cell]));
}

section("pitch: ST3's periods");

check("C-4 at 8363 is period 1712", notePeriod(0x40, 8363) === 1712, String(notePeriod(0x40, 8363)));
check("A-4 at 8363 is period 1016", notePeriod(0x49, 8363) === 1016, String(notePeriod(0x49, 8363)));
check("C-5 at 16726 is period 428", notePeriod(0x50, 16726) === 428, String(notePeriod(0x50, 16726)));
check("a period past 16 bits is held to 32767", notePeriod(0x00, 100) === 32767, String(notePeriod(0x00, 100)));

section("pitch: three octaves");

// C-3 to B-5: 36 notes.
const NOTES = Array.from({ length: 36 }, (_, i) => noteAt(36 + i));

for (const c2spd of [8363, 22050, 4000]) {
	for (const factor of [1, 0.5, 0.3].filter((f) => c2spd * f >= LOWEST_RATE)) {
		const imp = imported(
			s3mBytes({
				samples: [{ pcm: square(64, 4), loopStart: 0, loopLength: 256, c2spd }],
				orders: [0],
				patterns: [scale(NOTES)],
			}),
			{ factors: new Map([[1, factor]]) },
		);
		const notes = played(imp.song, 0);
		const worst = Math.max(...notes.map((n, i) => Math.abs(centsOff(imp, n, 0, i * 6))));
		check(
			`C2SPD ${c2spd} at factor ${factor}: 36 notes, each within ${TOLERANCE} cents`,
			notes.length === 36 && worst < TOLERANCE,
			`${notes.length} notes, worst ${worst.toFixed(2)} cents`,
		);
		check(
			`C2SPD ${c2spd} at factor ${factor} raises nothing`,
			problems(imp.song).length === 0,
			problems(imp.song).join("; "),
		);
	}
}

section("pitch: finetune and range");

{
	// S2x changes the C2SPD the next note's period is worked out from.
	const imp = imported(
		s3mBytes({
			samples: [{ pcm: square(64, 4), loopStart: 0, loopLength: 256 }],
			orders: [0],
			patterns: [
				pattern([
					[0, 0, { note: "C-4", instrument: 1 }],
					[1, 0, { command: "S", info: 0x28 }],
					[2, 0, { note: "C-4" }],
				]),
			],
		}),
	);
	const pitch = imp.s3m.play.channels[0].pitch;
	const semitones = pitch[12] - pitch[0];
	// S28 is 7895 Hz at C-4: about a semitone below 8363.
	check(
		"S28 plays the next note at C2SPD 7895",
		Math.abs(semitones - 12 * Math.log2(7895 / 8363)) < 0.02,
		semitones.toFixed(3),
	);
}

{
	// C-1 to B-7: seven octaves, more than o1 c to o6 a holds.
	const wide = Array.from({ length: 84 }, (_, i) => noteAt(12 + i)).filter((_, i) => i % 5 === 0);
	const imp = imported(
		s3mBytes({
			channels: 8,
			samples: [{ pcm: square(64, 4), loopStart: 0, loopLength: 256 }],
			orders: [0],
			patterns: [scale(wide)],
		}),
	);
	const notes = played(imp.song, 0);
	check(
		"every note of a seven-octave range is played",
		notes.length === wide.length,
		`${notes.length} of ${wide.length}`,
	);
	check(
		"each keeps its pitch class",
		notes.every((n, i) => n.key !== null && (n.key - (12 + i * 5)) % 12 === 0),
		notes.map((n) => n.key).join(),
	);
	check(
		"those outside are folded and counted",
		imp.written.warnings.some((w) => w.code === "mod-folded"),
	);
	check("and the song raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
}
