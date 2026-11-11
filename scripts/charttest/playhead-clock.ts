/** `charttest`: the pull at the end of the scrub bar, and the playhead's own clock. */

import "../localize";
import { edgeUrgency } from "../../web/src/app/editor/views/piano-roll/roll-layout";
import { advanceTick } from "../../web/src/app/editor/views/piano-roll/roll-clock-step";
import { KEY_WIDTH } from "../../web/src/app/editor/views/piano-roll/roll-metrics";
import { check, section } from "../harness";

section("the pull at the end of the scrub bar");
{
	// A scrub can only ask for a tick that is on screen, so a drag held off the
	// end has to take the view with it. The middle must be dead still: a pull that
	// crept while the pointer sat over the music would scroll the roll under a
	// gesture that had only meant to seek.
	const WIDTH = 800; // the whole bar, key column included
	const MIDDLE = KEY_WIDTH + (WIDTH - KEY_WIDTH) / 2;

	check("the middle of the bar pulls not at all", edgeUrgency(MIDDLE, WIDTH) === 0);
	check("the right edge pulls forward at full", edgeUrgency(WIDTH, WIDTH) === 1);
	check("and past it no harder", edgeUrgency(WIDTH + 5000, WIDTH) === 1);
	check("the left edge pulls back at full", edgeUrgency(KEY_WIDTH, WIDTH) === -1);
	check("and past it no harder", edgeUrgency(-5000, WIDTH) === -1);

	// The key column is off the left end of the music rather than the start of it:
	// a drag that runs onto the keys is asking for what is before the pane.
	check("a pointer over the key column pulls back", edgeUrgency(KEY_WIDTH / 2, WIDTH) === -1);

	// A ramp and not a switch, so a drag that has only just reached the strip
	// creeps and one held off the end runs.
	let climbed = true;
	for (let x = WIDTH - 28; x < WIDTH; x++) {
		const here = edgeUrgency(x, WIDTH);
		const next = edgeUrgency(x + 1, WIDTH);
		climbed &&= here >= 0 && next > here && next <= 1;
	}

	check("the pull ramps up over the last 28px", climbed);

	// Both strips have to fit with music between them, or a bar narrow enough
	// would pull in one direction wherever it was pressed.
	check("a bar too narrow to have a middle pulls nowhere", edgeUrgency(KEY_WIDTH + 10, KEY_WIDTH + 20) === 0);
	check("and an unmeasured pane answers 0 rather than NaN", edgeUrgency(50, 0) === 0);
}

section("the playhead's own clock");
{
	const RATE = 95.7; // t48
	const FRAME = 1 / 60;
	const PASS = 12312;

	// Every anchor arrives with about the same small lag, so a clock that
	// re-derived its position from the newest one would reproduce that lag ten
	// times a second and jerk to close it. Run the real thing against a
	// steadily-lagging anchor and no frame may be far off the median.
	{
		const LAG = 8; // ticks, roughly what a postMessage costs at this tempo
		let shown = 0;
		let truth = 0;
		const steps: number[] = [];
		for (let frame = 0; frame < 240; frame++) {
			truth += RATE * FRAME;
			const next = advanceTick({ shown, target: truth - LAG, rate: RATE, elapsed: FRAME, pass: PASS });
			steps.push(next - shown);
			shown = next;
		}

		// Discard the first half-second, which is the clock acquiring the lag.
		const settled = steps.slice(30);
		const median = [...settled].sort((a, b) => a - b)[Math.floor(settled.length / 2)];
		const worst = settled.reduce((a, b) => (Math.abs(b - median) > Math.abs(a - median) ? b : a));
		check(
			"a steady lag is absorbed, not re-corrected every anchor",
			Math.abs(worst - median) < median * 0.1,
			`worst frame ${worst.toFixed(3)} against a median of ${median.toFixed(3)} ticks`,
		);
		check(
			"and it still runs at the driver's rate",
			Math.abs(median / FRAME - RATE) < 1,
			`${(median / FRAME).toFixed(1)} ticks per second against ${RATE}`,
		);
	}

	// A wrap is not drift. Easing across one would crawl the whole song.
	check(
		"a loop wrap snaps rather than easing",
		advanceTick({ shown: PASS - 5, target: 24, rate: RATE, elapsed: FRAME, pass: PASS }) === 24,
	);
	check(
		"and so does a seek",
		advanceTick({ shown: 100, target: 9000, rate: RATE, elapsed: FRAME, pass: PASS }) === 9000,
	);

	// The anchor is folded into one pass, so the jump a wrap makes is one trip
	// round the loop and no more. Sized against a second of music alone, the test
	// for one cannot fire at all on a loop shorter than that — `#0 t54 aaaa` is
	// 96 ticks against a second's 107 — and the wrap is eased instead, which on a
	// song that short never finishes before the next one arrives.
	{
		const SHORT_RATE = 107.42; // t54
		const SHORT_PASS = 96; // `aaaa`, four notes at the default l8
		check(
			"a wrap on a song under a second of music still snaps",
			advanceTick({ shown: 94, target: 1, rate: SHORT_RATE, elapsed: FRAME, pass: SHORT_PASS }) === 1,
		);

		// And over the whole sweep, because the symptom is the steady state rather
		// than one frame: eased, the line settles into a cycle over the back half
		// of the roll and reaches the beginning on no pass at all.
		let shown = 0;
		let truth = 0;
		let lowest = SHORT_PASS;
		for (let frame = 0; frame < 300; frame++) {
			truth += SHORT_RATE * FRAME;
			shown = advanceTick({ shown, target: truth % SHORT_PASS, rate: SHORT_RATE, elapsed: FRAME, pass: SHORT_PASS });
			if (frame > 60) {
				lowest = Math.min(lowest, shown);
			}
		}

		check(
			"so the line comes back to the beginning on every pass",
			lowest < SHORT_RATE * FRAME * 2,
			`${lowest.toFixed(1)} ticks into a pass of ${SHORT_PASS}`,
		);
	}

	// The wrap lands on the loop point and not on tick 0, so what it has to clear
	// is the loop and never the pass: a short loop behind a long intro is the
	// same failure on a song of several seconds.
	{
		const INTRO = 3940;
		const LOOP = 60;
		check(
			"a short loop behind a long intro snaps too",
			advanceTick({
				shown: INTRO + LOOP - 2,
				target: INTRO,
				rate: RATE,
				elapsed: FRAME,
				pass: INTRO + LOOP,
			}) === INTRO,
		);
	}

	// The clock stops with the loop, so the first frame back is not elapsed time.
	check(
		"a long gap between frames snaps rather than lurching",
		advanceTick({ shown: 100, target: 130, rate: RATE, elapsed: 4, pass: PASS }) === 130,
	);

	// The anchor is folded into one pass, so anything past its end is the
	// display running off the end of the song.
	check(
		"the playhead never runs past the end of the pass",
		advanceTick({ shown: PASS, target: PASS, rate: RATE, elapsed: FRAME, pass: PASS }) === PASS,
	);
	check("nor before the start", advanceTick({ shown: 0, target: 0, rate: 0, elapsed: FRAME, pass: PASS }) === 0);
	// A stopped song has no tempo to run at; standing still beats guessing.
	check(
		"no tempo means no motion of its own",
		advanceTick({ shown: 50, target: 50, rate: 0, elapsed: FRAME, pass: PASS }) === 50,
	);
}
