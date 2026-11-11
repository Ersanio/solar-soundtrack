/** `charttest`: the roll's mark window and grid, and the ladder the wheel walks while a note is being drawn. */

import "../localize";
import { gridLines, tickWindow } from "../../web/src/app/editor/views/piano-roll/roll-layout";
import { DRAW_LENGTHS, stepDrawLength } from "../../web/src/app/editor/views/piano-roll/roll-lengths";
import { check, section } from "../harness";

section("piano roll window and grid");
{
	// The window is snapped outward to a whole note so the mark list rebuilds a
	// couple of times per screen rather than on every frame of a scroll.
	const w = tickWindow(1000, 800, 2, 0.2);
	check("the window is snapped to whole notes", w.from % 192 === 0 && w.to % 192 === 0, `${w.from}..${w.to}`);
	check("it contains what is on screen", w.from <= 1000 - 80 && w.to >= 1000 + 320, `${w.from}..${w.to}`);
	check("it carries a screen of margin either side", w.to - w.from >= (800 / 2) * 2, `${w.to - w.from} ticks`);
	check("it never runs before the start", tickWindow(0, 800, 2, 0.2).from === 0);

	// The property that keeps the DOM still while the transform moves: sweeping a
	// playhead across the song must produce only a handful of distinct windows,
	// not one per position. Counted rather than compared pairwise, because two
	// neighbouring positions legitimately differ when one crosses a boundary —
	// what matters is how often that happens, not that it never does.
	const seen = new Set<string>();
	let sampled = 0;
	for (let tick = 0; tick <= 2000; tick += 5) {
		sampled++;
		seen.add(JSON.stringify(tickWindow(tick, 800, 2, 0.2)));
	}

	// Two per whole note, not one: the near and far edges snap independently, so
	// each contributes its own crossings. That is still a rebuild roughly once a
	// second at the default tempo, against sixty frames in the same second.
	check(
		"a sweep rebuilds the window twice per whole note at most",
		seen.size <= (2 * 2000) / 192 + 2,
		`${seen.size} windows over ${sampled} positions`,
	);
	check("which is far below one per frame", seen.size * 10 < sampled, `${seen.size} against ${sampled}`);
	check("a zero width does not divide by zero", Number.isFinite(tickWindow(100, 0, 2, 0.2).to));
	check("a zero zoom does not divide by zero", Number.isFinite(tickWindow(100, 800, 0, 0.2).to));

	// 4/4: four quarter notes, so a bar is one whole note and the default grid is
	// a line every 48 ticks with a bar line every 192.
	const lines = gridLines(0, 384, 48, 4);
	check("the grid steps every quarter note in 4/4", lines.length === 9, `${lines.length} lines`);
	check("and marks every whole note heavily", lines.filter((l) => l.strong).length === 3);
	check(
		"the strong lines are the multiples of 192",
		lines.filter((l) => l.strong).every((l) => l.tick % 192 === 0),
	);

	// A signature the porter set: the bar is beats * (192 / unit) whichever way
	// the two numbers get there. 3/4 and 6/8 are both 144 ticks.
	check(
		"3/4 bars every 144 ticks",
		gridLines(0, 288, 48, 3)
			.filter((l) => l.strong)
			.every((l) => l.tick % 144 === 0),
	);
	check(
		"6/8 too, at twice the lines",
		gridLines(0, 288, 24, 6).length === 13 &&
			gridLines(0, 288, 24, 6)
				.filter((l) => l.strong)
				.every((l) => l.tick % 144 === 0),
	);

	// The load-bearing one. `tickWindow` snaps to a whole note and a 7/8 bar is
	// 168 ticks, so the two align only by coincidence — a window that opens
	// mid-bar must still put its bar lines on the song's own bars, which is what
	// counting beats from tick 0 rather than testing `tick % barTicks` buys.
	const seven = gridLines(192, 384, 24, 7);
	check(
		"7/8 bar lines hold their place in a window that opens mid-bar",
		seven.filter((l) => l.strong).length === 1 && seven.filter((l) => l.strong).every((l) => l.tick % 168 === 0),
		seven
			.filter((l) => l.strong)
			.map((l) => l.tick)
			.join(),
	);

	check("a zero beat yields nothing rather than hanging", gridLines(0, 384, 0, 4).length === 0);
	check("and no beats in a bar is the grid switched off", gridLines(0, 384, 48, 0).length === 0);
}

section("the ladder the wheel walks while a note is being drawn");
{
	// Fourteen rungs, one per denominator that divides a whole note exactly, so
	// every one of them is an `l` the roll can write without dots or `=N`. The
	// dotted rungs a stretch snaps to are deliberately not here: twice the rungs
	// is twice the turns of the wheel it takes to cross the ladder.
	check("the ladder is the fourteen divisors of a whole note", DRAW_LENGTHS.length === 14, `${DRAW_LENGTHS.length}`);
	check(
		"and every rung divides one exactly",
		DRAW_LENGTHS.every((ticks) => 192 % ticks === 0),
		DRAW_LENGTHS.join(),
	);
	check(
		"it runs l192 to l1",
		DRAW_LENGTHS[0] === 1 && DRAW_LENGTHS[DRAW_LENGTHS.length - 1] === 192,
		`${DRAW_LENGTHS[0]}..${DRAW_LENGTHS[DRAW_LENGTHS.length - 1]}`,
	);
	check(
		"no dotted rung is on it",
		!DRAW_LENGTHS.includes(72) && !DRAW_LENGTHS.includes(36) && !DRAW_LENGTHS.includes(144),
	);

	check("a quarter note steps up to l3", stepDrawLength(48, 1) === 64, `${stepDrawLength(48, 1)}`);
	check("and down to l6", stepDrawLength(48, -1) === 32, `${stepDrawLength(48, -1)}`);

	// A length off the ladder — a tick-precise stretch is remembered as the one
	// a note is drawn at — is brought onto it by the first turn either way,
	// rather than being left where a wheel appears to do nothing.
	check("an off-ladder length comes up onto it", stepDrawLength(37, 1) === 48, `${stepDrawLength(37, 1)}`);
	check("and down onto it", stepDrawLength(37, -1) === 32, `${stepDrawLength(37, -1)}`);
	check("one past a whole note comes back to l1", stepDrawLength(384, 1) === 192, `${stepDrawLength(384, 1)}`);

	check("a whole note is the top", stepDrawLength(192, 1) === 192, `${stepDrawLength(192, 1)}`);
	check("and one tick is the bottom", stepDrawLength(1, -1) === 1, `${stepDrawLength(1, -1)}`);
	check(
		"every rung steps to its neighbour",
		DRAW_LENGTHS.every((ticks, at) => stepDrawLength(ticks, 1) === DRAW_LENGTHS[Math.min(at + 1, 13)]),
	);
}
