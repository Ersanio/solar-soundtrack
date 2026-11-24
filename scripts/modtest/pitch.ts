/** `modtest`: pitch — every note of ProTracker's three octaves, at finetunes and resampling factors, played by the walk within a few cents of where the MOD plays it; FastTracker's periods past the Amiga's; and a range too wide for one octave choice folded. */

import { check, section } from "../harness";
import { type Cell, PERIODS, centsOff, imported, modBytes, pattern, played, problems, square } from "./support";

/**
 * The cents a note may stray. `SetPitch` shifts its table value right before it multiplies
 * (`main.asm:484-554`), so a sample played over three octaves loses bits at its lowest, and a low
 * resampling factor leaves a small multiplier coarse: this is the driver's floor, not the importer's.
 */
const TOLERANCE = 11;

/** Each period struck on its own row, in order. */
function scale(periods: readonly number[], sample = 1): Cell[][] {
	return pattern(periods.map((p, row) => [row, 0, { period: p, sample }] as [number, number, Cell]));
}

section("pitch: ProTracker's three octaves");

for (const finetune of [0, 3, -5]) {
	for (const factor of [1, 0.5, 0.3]) {
		const imp = imported(
			modBytes({
				samples: [{ pcm: square(64, 4), loopStart: 0, loopLength: 256, finetune }],
				orders: [0],
				patterns: [scale(PERIODS)],
			}),
			{ factors: new Map([[1, factor]]) },
		);
		const notes = played(imp.song, 0);
		const worst = Math.max(...notes.map((n, i) => Math.abs(centsOff(imp, n, PERIODS[i]))));
		check(
			`finetune ${finetune} at factor ${factor}: 36 notes, each within 11 cents`,
			notes.length === 36 && worst < TOLERANCE,
			`${notes.length} notes, worst ${worst.toFixed(2)} cents`,
		);
		check(
			`finetune ${finetune} at factor ${factor} raises nothing`,
			problems(imp.song).length === 0,
			problems(imp.song).join("; "),
		);
	}
}

section("pitch: past the Amiga's range");

{
	// FastTracker's periods go two octaves above B-3.
	const periods = [113, 85, 57, 47, 28];
	const imp = imported(
		modBytes({
			channels: 8,
			samples: [{ pcm: square(64, 4), loopStart: 0, loopLength: 256 }],
			orders: [0],
			patterns: [scale(periods)],
		}),
	);
	const notes = played(imp.song, 0);
	const worst = Math.max(...notes.map((n, i) => Math.abs(centsOff(imp, n, periods[i]))));
	check(
		"periods to 28 play true within 11 cents",
		notes.length === periods.length && worst < TOLERANCE,
		`worst ${worst.toFixed(2)}`,
	);
	check("and raise nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
}

section("pitch: a range wider than the instrument plays");

{
	// Seven octaves on one sample: what one octave choice cannot hold is folded, and says so.
	const periods = [3424, 1712, 856, 428, 214, 107, 53, 27];
	const imp = imported(
		modBytes({
			channels: 8,
			samples: [{ pcm: square(64, 4), loopStart: 0, loopLength: 256 }],
			orders: [0],
			patterns: [scale(periods)],
		}),
	);
	check(
		"the notes outside are folded and counted",
		imp.written.warnings.some((w) => w.code === "mod-folded" && w.count > 0),
		JSON.stringify(imp.written.warnings),
	);
	check("a folded song raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
	const notes = played(imp.song, 0);
	check(
		"each folded note keeps its pitch class",
		notes.every((n, i) => {
			const offOctave = ((centsOff(imp, n, periods[i]) % 1200) + 1200) % 1200;
			return Math.min(offOctave, 1200 - offOctave) < 2 * TOLERANCE;
		}),
		notes.map((n, i) => centsOff(imp, n, periods[i]).toFixed(0)).join(),
	);
}
