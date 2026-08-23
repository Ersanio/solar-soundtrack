/**
 * Everything the app draws that is arithmetic rather than markup: the stacked
 * bar, the plot space, `clamp`, the piano roll's lanes, mark window, grid and
 * playhead clock, its percussion set, the slider's track, and the transport's
 * tick-to-seconds clock.
 *
 * The ARAM bar spans all 64 KiB, so real regions are routinely a fraction of a
 * percent of it and land on sub-pixel widths — subtracting the inter-segment gap
 * from each segment would zero anything narrower than the gap — and that is
 * awkward to eyeball in a browser. So it lives in a pure function and is checked
 * here.
 *
 *   npm run charttest
 */

import { KEY_COUNT, type SongTimeline, type TempoChange, type WalkNote } from "@amk/spc/song-walk";
import { tokenize } from "@amk/tokens";
import type { TimelineCommand } from "../web/src/app/state/command-timeline";
import {
	DEFAULT_TEMPO,
	driverTickSeconds,
	tempoFadeSeconds,
	tempoFadeSteps,
	tickSeconds,
} from "@amk/tokens/commands/units";
import { secondsAtTick, songClock, ticksPerSecondAt } from "../web/src/app/state/song-clock";
import {
	DEFAULT_PERCUSSION,
	keyOf,
	parsePercussion,
	rollShape,
} from "../web/src/app/editor/views/piano-roll/percussion";
import { PLOT, plot } from "../web/src/app/shared/chart/plot";
import { stackSegments } from "../web/src/app/shared/chart/stack";
import {
	DRAW_LENGTHS,
	advanceTick,
	edgeUrgency,
	gridLines,
	keyIsBlack,
	fitBarContent,
	keyName,
	noteLabel,
	laneStack,
	pageStart,
	overviewOffset,
	overviewTick,
	stepDrawLength,
	tickAtX,
	tickWindow,
	xAtTick,
} from "../web/src/app/editor/views/piano-roll/roll-layout";
import { MUTED_OPACITY, buildMinimap } from "../web/src/app/editor/views/piano-roll/roll-marks";
import {
	type CommandLane,
	MAX_LANE_ROWS,
	laneWindow,
	packCommandLane,
} from "../web/src/app/editor/views/piano-roll/roll-command-lane";
import { KEY_WIDTH, LANE_GLYPH, LANE_ROW } from "../web/src/app/editor/views/piano-roll/roll-metrics";
import {
	mirror,
	readout,
	trackBounds,
	trackFraction,
	trackImage,
	trackPosition,
	valueAt,
} from "../web/src/app/shared/slider/slider-track";
import {
	channelStates,
	estimatedSecondsAt,
	silencedMask,
	silencedReason,
	soleAudible,
	soundingSpans,
} from "../web/src/app/state/transport-view";
import { clamp } from "../web/src/app/util/math";

import { check, summarise } from "./harness";

const OPTS = { width: 600, gap: 2, minWidth: 3 };
const EPSILON = 1e-6;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const place = (values: number[], options = OPTS) =>
	stackSegments(
		values.map((value) => ({ value })),
		options,
	);

/**
 * driver, song, samples, free, echo — the shape the ARAM budget produces, summing
 * to 64 KiB. The driver figure is the shipped `main.bin`'s: it ends at `$2996`,
 * where the song's slot in its own table starts.
 */
const REALISTIC = [10646, 700, 21000, 29094, 4096];

console.log("\nevery region that exists stays visible");
{
	for (const songBytes of [1, 120, 218, 700]) {
		const placed = place([10646, songBytes, 21000, 29794 - songBytes, 4096]);
		check(
			`a ${songBytes} byte song is at least ${OPTS.minWidth}px`,
			placed[1].width >= OPTS.minWidth - EPSILON,
			`${placed[1].width.toFixed(2)}px`,
		);
	}

	check(
		"no segment is ever wider than the bar",
		place(REALISTIC).every((p) => p.width <= OPTS.width),
	);
}

console.log("\nthe floor is paid for by donors, not by the total");
{
	const placed = place(REALISTIC);
	const last = placed[placed.length - 1];
	check(
		"the bar ends flush with its container",
		Math.abs(last.x + last.width - OPTS.width) < EPSILON,
		`${(last.x + last.width).toFixed(4)} vs ${OPTS.width}`,
	);
	check(
		"widths plus gaps exactly fill the width",
		Math.abs(sum(placed.map((p) => p.width)) + OPTS.gap * (REALISTIC.length - 1) - OPTS.width) < EPSILON,
	);
	check(
		"segments never overlap",
		placed.every((p, i) => i === 0 || p.x >= placed[i - 1].x + placed[i - 1].width + OPTS.gap - EPSILON),
	);
}

console.log("\nproportions survive where no floor is needed");
{
	const placed = place([1, 1, 2]);
	check("equal values get equal widths", Math.abs(placed[0].width - placed[1].width) < EPSILON);
	check("a doubled value gets double the width", Math.abs(placed[2].width - placed[0].width * 2) < EPSILON);
}

console.log("\ndegenerate input produces no geometry rather than bad geometry");
{
	check("no segments", place([]).length === 0);
	check("all values zero", place([0, 0]).length === 0);
	check("zero width", place([5], { ...OPTS, width: 0 }).length === 0);
	check("negative width", place([5], { ...OPTS, width: -10 }).length === 0);

	// Narrower than minWidth * count + gaps: the floor cannot be honoured.
	const cramped = place([1, 1, 1, 1, 1], { ...OPTS, width: 20 });
	check(
		"a cramped bar has no negative widths",
		cramped.every((p) => p.width >= 0),
	);
	const end = cramped[cramped.length - 1];
	check("a cramped bar does not overflow", end.x + end.width <= 20 + EPSILON, `${(end.x + end.width).toFixed(2)}`);
}

console.log("\nthe plot space reads back as its own viewBox");
{
	check("the shared plot is 320 by 120", PLOT.w === 320 && PLOT.h === 120, `${PLOT.w}x${PLOT.h}`);
	check("its box states the same numbers", PLOT.box === `0 0 ${PLOT.w} ${PLOT.h}`, PLOT.box);
	// The FIR plot is the one graph that differs, and only in height.
	check("a taller plot keeps the width", plot(320, 150).box === "0 0 320 150", plot(320, 150).box);
}

console.log("\nclamp holds a value inside its bounds");
{
	check("inside is untouched", clamp(5, 0, 10) === 5);
	check("below floors", clamp(-1, 0, 10) === 0);
	check("above ceilings", clamp(11, 0, 10) === 10);
	check("the bounds themselves are inside", clamp(0, 0, 10) === 0 && clamp(10, 0, 10) === 10);
	// A degenerate range still answers with a number in it, which is what the
	// source view's spans rely on: `clamp(end, start + 1, length)` with an empty
	// document has `min` above `max`.
	check("an inverted range answers with max", clamp(5, 10, 0) === 0, String(clamp(5, 10, 0)));
}

console.log("\npiano roll lanes");
{
	// The whole point of fitting: a song that lives in one octave should not be
	// drawn against seventy rows, most of them empty.
	const fitted = laneStack({ lowestKey: 28, highestKey: 33 });
	check("a fitted range covers whole octaves", fitted.lanes.length === 12, `${fitted.lanes.length} rows`);
	check("and it contains the notes played", fitted.rowOfKey.has(28) && fitted.rowOfKey.has(33));
	check("while a key outside it has no row", !fitted.rowOfKey.has(0) && !fitted.rowOfKey.has(69));
	check(
		"the top row is the highest pitch",
		fitted.lanes[0].index === 35 && fitted.lanes[fitted.lanes.length - 1].index === 24,
		`${fitted.lanes[0].label} down to ${fitted.lanes[fitted.lanes.length - 1].label}`,
	);

	const all = laneStack({ lowestKey: 28, highestKey: 33, all: true });
	check("all octaves is the whole keyboard", all.lanes.length === KEY_COUNT, `${all.lanes.length} rows`);
	// "All octaves" widens the pitch range and nothing else — asking for the
	// whole keyboard must not conjure nine drum lanes the song never plays.
	check(
		"and it still adds no unused drum",
		all.lanes.every((l) => l.kind === "key"),
	);
	check("o1 c is key 0 and o6 a is key 69", keyName(0) === "o1 c" && keyName(69) === "o6 a");
	check("the black keys are the five", [1, 3, 6, 8, 10].every(keyIsBlack) && ![0, 2, 4, 5, 7, 9, 11].some(keyIsBlack));

	// Rows are written pitches, and `o0` is legal MML: `h12 o0 c` is a note the
	// driver plays and the roll must have a row for, below the driver's own
	// keyboard. The names and the black keys have to wrap the right way there.
	check("o0 c is key -12", keyName(-12) === "o0 c" && keyName(-1) === "o0 b", `${keyName(-12)}, ${keyName(-1)}`);
	check("and o7 b+ is o8 c", keyName(84) === "o8 c" && keyName(72) === "o7 c", `${keyName(84)}, ${keyName(72)}`);
	check(
		"a black key below o1 is still black",
		keyIsBlack(-11) && keyIsBlack(-2) && !keyIsBlack(-12) && !keyIsBlack(-1),
	);
	const below = laneStack({ lowestKey: -12, highestKey: 3 });
	check("a range below o1 is drawn in whole octaves", below.lanes.length === 24, `${below.lanes.length} rows`);
	check(
		"from o1 b down to o0 c",
		below.lanes[0].index === 11 && below.lanes[23].index === -12 && below.rowOfKey.get(-12) === 23,
		`${below.lanes[0].label} down to ${below.lanes[23].label}`,
	);
	check("o0 c starts its octave", below.lanes[23].octaveStart && !below.lanes[22].octaveStart);
	const allBelow = laneStack({ lowestKey: -5, highestKey: 3, all: true });
	check("all octaves grows to take in a written note below o1", allBelow.lanes.length === KEY_COUNT + 12);
	// The driver's top octave stops at o6 a, since `$C6` is the tie — unless
	// something is written above it, when the octave is filled out.
	const top = laneStack({ lowestKey: 60, highestKey: 69 });
	check("a range up to o6 a stops at o6 a", top.lanes[0].index === 69, top.lanes[0].label);
	const above = laneStack({ lowestKey: 60, highestKey: 70 });
	check("a written o6 a+ fills out o6", above.lanes[0].index === 71, above.lanes[0].label);
	const beyond = laneStack({ lowestKey: 60, highestKey: 72, all: true });
	check("all octaves grows to take in a written note above o6", beyond.lanes.length === KEY_COUNT + 2 + 12);

	// Drums and noise appear only when the song plays them — nine empty drum
	// rows on a song with no percussion is nine rows of nothing. A drum is
	// named by its instrument number, so `@10` sits in the same list as the
	// driver's own `@21`-`@29` and needs no separate concept.
	const withDrums = laneStack({
		lowestKey: 28,
		highestKey: 33,
		usedDrums: [10, 21, 29],
		usesNoise: true,
		drumNotes: new Map([
			[21, 0xa8],
			[29, 0xa1],
		]),
	});
	check("only the drums played get a lane", withDrums.lanes.filter((l) => l.kind === "drum").length === 3);
	check("the ones that are not played have no row", withDrums.rowOfDrum.get(24) === undefined);
	check("a noise lane appears when noise is used", withDrums.noiseRow === 0, `row ${withDrums.noiseRow}`);
	check("and no noise lane when it is not", fitted.noiseRow === -1);
	check(
		"drums and noise sit above the keyboard",
		withDrums.lanes.slice(0, 4).every((l) => l.kind !== "key") && withDrums.lanes[4].kind === "key",
	);
	check(
		"drums count down to the keyboard, @10 last",
		withDrums.lanes
			.slice(1, 4)
			.map((l) => l.index)
			.join(",") === "29,21,10",
		withDrums.lanes
			.slice(1, 4)
			.map((l) => l.label)
			.join(" | "),
	);
	// A table drum states the note it plays; `@10` has no percussion-table entry
	// to state one from, so it is named and nothing more.
	check("a table drum's lane names its own note", withDrums.lanes[1].label === "@29 o3 a", withDrums.lanes[1].label);
	check("a melodic-slot drum is named alone", withDrums.lanes[3].label === "@10", withDrums.lanes[3].label);

	// A song the compiler produced no notes for still has to lay out.
	const empty = laneStack();
	check("a song with no notes still draws a keyboard", empty.lanes.length === KEY_COUNT);
}

console.log("\npiano roll window and grid");
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

console.log("\nthe ladder the wheel walks while a note is being drawn");
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

console.log("\nthe roll's pages");
{
	// The paged view holds the music still and sweeps the playhead across it,
	// turning over once the playhead reaches PAGE_TURN_AT and moving PAGE_STEP of
	// a pane — so it lands at the difference, a tenth in, with the bar it has just
	// played still on screen. None of it is visible in a screenshot: a page that
	// turns a fraction early or late looks exactly like one that does not.
	const TURN_AT = 0.9; // PianoRoll.PAGE_TURN_AT
	const STEP = 0.8; // PianoRoll.PAGE_STEP
	const LEAD = 0.2; // PianoRoll.PLAYHEAD_AT, the continuous roll's fixed lead
	const SCREEN = 800; // ticks across the pane
	const STRIDE = SCREEN * STEP;
	const LEAD_IN = SCREEN * (TURN_AT - STEP);
	const page = (tick: number) => pageStart(tick, SCREEN, TURN_AT, STEP);
	const offset = (tick: number) => tick - page(tick);

	// The song opens on the lead-in every later page opens on, which means page
	// zero starts before tick 0 and the first bar is drawn with space in front of
	// it. Opening flush against the key column instead makes that margin appear
	// out of nowhere at the first turn, and makes a scroll back to the beginning
	// show the space and then lose it again on the way back to the song.
	check("a song opens on the lead-in, not against the key column", page(0) === -LEAD_IN, `${page(0)}`);
	check(
		"which is the margin every later page opens on too",
		Math.abs(offset(0) - LEAD_IN) < EPSILON && Math.abs(offset(STRIDE) - LEAD_IN) < EPSILON,
		`${offset(0)} then ${offset(STRIDE)}`,
	);
	check(
		"and it holds there until the playhead reaches the turn",
		page(STRIDE - 1) === page(0) && Math.abs(page(STRIDE) - (page(0) + STRIDE)) < EPSILON,
		`${page(STRIDE - 1)} then ${page(STRIDE)}`,
	);
	check(
		"the turn comes when the playhead is TURN_AT across the pane",
		Math.abs(offset(STRIDE - EPSILON) - SCREEN * TURN_AT) < 1e-3,
		`${offset(STRIDE - EPSILON)} ticks in, of ${SCREEN}`,
	);

	// Why the step is shorter than the turn: a page moving the whole pane would
	// drop the playhead hard against the key column with nothing behind it, and
	// the phrase that had just played would be gone at the moment you looked for it.
	check(
		"a turn leaves the music just played still on screen",
		Math.abs(offset(STRIDE) - SCREEN * (TURN_AT - STEP)) < EPSILON,
		`${offset(STRIDE)} ticks in, of ${SCREEN}`,
	);

	// The playhead is drawn at its offset into the page, so an offset outside the
	// pane is a line over the key column or off the right edge — where the clip
	// hides it rather than showing anything wrong.
	let outside = "";
	let backwards = "";
	let previous = page(0);
	for (let tick = 0; tick <= SCREEN * 12; tick += 7) {
		const into = offset(tick);
		if (into < LEAD_IN - EPSILON || into >= SCREEN * TURN_AT + EPSILON) {
			outside += ` ${tick}`;
		}

		if (page(tick) < previous - EPSILON) {
			backwards += ` ${tick}`;
		}

		previous = page(tick);
	}

	check("the playhead is never outside the lead-in and the turn", outside === "", outside);
	check("and a page never turns backwards as the song runs forwards", backwards === "", backwards);

	// One turn per stride, not one per frame. The transform itself is cheap, but a
	// page flickering between two values at the boundary takes the marks with it,
	// and that is the whole pane rebuilt.
	const starts = new Set<number>();
	let sampled = 0;
	for (let tick = 0; tick <= SCREEN * 12; tick += 7) {
		sampled++;
		starts.add(page(tick));
	}

	check(
		"a sweep turns one page per stride at most",
		starts.size <= (SCREEN * 12) / STRIDE + 1,
		`${starts.size} pages over ${(SCREEN * 12) / STRIDE} strides`,
	);
	check("which is far below one per frame", starts.size * 20 < sampled, `${starts.size} against ${sampled}`);
	check(
		"and every page starts a whole stride past the lead-in",
		[...starts].every((tick) => Math.abs((tick + LEAD_IN) % STRIDE) < EPSILON),
	);

	check("an unmeasured pane pages nowhere rather than dividing by zero", pageStart(500, 0, TURN_AT, STEP) === 0);
	check("and neither does a zero step", pageStart(500, SCREEN, TURN_AT, 0) === 0);

	// The anchor, which is what a scroll moves. Measured from the song's own start
	// always, a seek drops the playhead wherever its place in that fixed grid
	// happens to fall — so the notes jump the moment the wheel goes quiet, by up
	// to a whole stride, and the roll looks like it is fighting the scroll.
	{
		const anchored = (tick: number, origin: number) => pageStart(tick, SCREEN, TURN_AT, STEP, origin);
		check(
			"the anchor is the tick that sits on the lead-in",
			anchored(1234, 1234) === 1234 - LEAD_IN,
			`${anchored(1234, 1234)}`,
		);
		check("and an anchor of zero is the song's own start", anchored(500, 0) === page(500));

		// The property the fix exists for: a scroll leaves the view at some tick and
		// some lead, and re-anchoring on it must reproduce that exact camera. Over
		// every lead a page can show the playhead at, which is the lead-in up to but
		// not including the turn — a page ends *at* the turn, so that is the one
		// value no page has the playhead sitting at.
		let moved = "";
		for (const tick of [0, 137, 900, 5000, 12345]) {
			for (const lead of [0.1, 0.2, 0.35, 0.5, 0.75, 0.85, 0.899]) {
				const viewLeft = tick - SCREEN * lead;
				const origin = viewLeft + LEAD_IN;
				if (Math.abs(anchored(tick, origin) - viewLeft) > EPSILON) {
					moved += ` ${tick}@${lead}`;
				}
			}
		}

		check("re-anchoring on a parked view leaves the notes exactly where they are", moved === "", moved);

		// And that the excluded value is excluded because the page has turned there,
		// not because the arithmetic gives up: anchoring at the turn lands the
		// playhead on the next page's lead-in, which is what turning a page is.
		const atTurn = anchored(5000, 5000 - SCREEN * TURN_AT + LEAD_IN);
		check(
			"anchoring exactly at the turn turns the page, as it should",
			Math.abs(5000 - atTurn - LEAD_IN) < EPSILON,
			`playhead ${5000 - atTurn} into the page, lead-in ${LEAD_IN}`,
		);

		// Which is reachable only in theory: a page shows the playhead below the
		// turn by construction, so the lead a scroll parks with is never that value.
		let atOrPast = "";
		for (let tick = 0; tick <= SCREEN * 12; tick += 3) {
			if (offset(tick) >= SCREEN * TURN_AT) {
				atOrPast += ` ${tick}`;
			}
		}

		check("and a real page never has the playhead at the turn to begin with", atOrPast === "", atOrPast);

		// And the grid still behaves once anchored: same lead-in, same turn, and a
		// page behind the anchor rather than the playhead stranded off the pane —
		// which is what a loop wrap back past the anchor would otherwise do.
		const ORIGIN = 5000;
		let bad = "";
		for (let tick = 0; tick <= 12000; tick += 11) {
			const into = tick - anchored(tick, ORIGIN);
			if (into < LEAD_IN - EPSILON || into >= SCREEN * TURN_AT + EPSILON) {
				bad += ` ${tick}`;
			}
		}

		check("an anchored grid still holds the playhead on the pane, before the anchor too", bad === "", bad);
	}

	// The one with no visual tell at all. The marks are built for a window around
	// the *playhead*, snapped and carrying a screen of margin either side, while
	// the transform points at the *page*. A page reaching outside that window
	// would scroll perfectly smoothly over blank music, so the two are pinned
	// together rather than left to be rediscovered.
	let uncovered = "";
	for (const zoom of [0.5, 1, 2, 4, 8]) {
		const width = SCREEN * zoom;
		for (let tick = 0; tick <= 20000; tick += 13) {
			// Clamped at 0, because the opening page reaches before the first tick
			// and there is no music there to be missing.
			const from = Math.max(0, pageStart(tick, SCREEN, TURN_AT, STEP));
			const window = tickWindow(tick, width, zoom, LEAD);
			if (from < window.from || from + SCREEN > window.to) {
				uncovered += ` ${zoom}@${tick}`;
				break;
			}
		}
	}

	check("every page is inside the window the marks are built for", uncovered === "", uncovered);
}

console.log("\nthe roll's playhead marks the song, not the camera");
{
	// `lead` is where the camera holds the playhead, and the transform is the same
	// fraction run the other way — so while the roll is *on* the song, the line is
	// at `lead` across the pane by construction. Parked it is not: the camera
	// stands still and the music does not, so the line is drawn at the song's own
	// tick in the camera's coordinates and is allowed to leave. None of it shows
	// in a screenshot, since a line that has stopped and one that is off the pane
	// look the same as a line that is simply somewhere else.
	const WIDTH = 724; // a pane, less the key column
	const TURN_AT = 0.9; // PianoRoll.PAGE_TURN_AT
	const STEP = 0.8; // PianoRoll.PAGE_STEP
	const LEAD = 0.2; // PianoRoll.PLAYHEAD_AT

	// The two directions of the camera, and they have to agree: a gesture turns a
	// pointer into a tick and the playhead turns a tick back into an x, so a pair
	// that did not round-trip would draw a note somewhere other than under the
	// pointer that drew it.
	let drifted = "";
	for (const zoom of [0.5, 1, 2, 4, 8]) {
		for (const viewTick of [-96, 0, 1, 4919.5]) {
			for (const tick of [0, 1, 96, 12345.5]) {
				const back = tickAtX(xAtTick(tick, viewTick, zoom), viewTick, zoom);
				if (Math.abs(back - tick) > EPSILON) {
					drifted += ` ${zoom}@${viewTick}:${tick}`;
				}
			}
		}
	}

	check("a tick drawn and read back is the tick it was", drifted === "", drifted);

	// A following roll's camera is built around the playhead, in both view modes:
	// paging leaves the view on the page start, scrolling the notes leaves it a
	// fifth behind the tick. Either way the line cannot be off the pane, which is
	// what makes drawing it from the song rather than from `lead` a no-op here.
	let offPane = "";
	for (const zoom of [0.5, 1, 2, 4, 8]) {
		const screen = WIDTH / zoom;
		for (let tick = 0; tick <= screen * 12; tick += 7) {
			for (const view of [pageStart(tick, screen, TURN_AT, STEP), tick - screen * LEAD]) {
				const x = xAtTick(tick, view, zoom);
				if (x < KEY_WIDTH - EPSILON || x > KEY_WIDTH + WIDTH + EPSILON) {
					offPane += ` ${zoom}@${tick}`;
					break;
				}
			}
		}
	}

	check("a following roll never draws the line off its own pane", offPane === "", offPane);

	// Parked, the view is one fixed tick and the song goes on without it.
	const parked = pageStart(4800, WIDTH, TURN_AT, STEP); // a view left mid-song
	check(
		"a parked roll moves the line at the song's own rate while the view stands still",
		Math.abs(xAtTick(4800, parked, 2) - xAtTick(4700, parked, 2) - 200) < EPSILON,
		`${xAtTick(4800, parked, 2)} against ${xAtTick(4700, parked, 2)}`,
	);

	// And lets it go, which is why `xAtTick` does not clamp: a line held at the
	// edge would say the song was there. The clip in `piano-roll.html` is what
	// keeps an x past either end off the key column and out of the pane.
	check(
		"and lets it leave the pane rather than holding it at the edge",
		xAtTick(parked + WIDTH * 3, parked, 1) > KEY_WIDTH + WIDTH && xAtTick(parked - WIDTH, parked, 1) < KEY_WIDTH,
		`${xAtTick(parked + WIDTH * 3, parked, 1)} and ${xAtTick(parked - WIDTH, parked, 1)}`,
	);
}

console.log("\nthe overview bar's time axis");
{
	// The bar holds the whole song and nothing else, so a drag on it is a mapping
	// and its inverse. The inverse has to be exact: the view goes where the box
	// under the pointer is put, and one that landed merely near it would drop the
	// roll a note away from where it was dropped, every time, with nothing on
	// screen to say so.
	const WIDTH = 724; // a pane, less the key column
	const TICKS = 12312;

	check("tick 0 is the left edge", overviewOffset(0, TICKS, WIDTH) === 0);
	check("and the last tick is the right edge", overviewOffset(TICKS, TICKS, WIDTH) === WIDTH);
	check("with the middle in the middle", Math.abs(overviewOffset(TICKS / 2, TICKS, WIDTH) - WIDTH / 2) < EPSILON);

	let apart = "";
	for (let tick = 0; tick <= TICKS; tick += 7) {
		const back = overviewTick(overviewOffset(tick, TICKS, WIDTH), TICKS, WIDTH);
		if (Math.abs(back - tick) > 1e-9) {
			apart += ` ${tick}->${back}`;
		}
	}

	check("a tick survives the round trip to the bar and back", apart === "", apart);

	// The whole song and nothing else: the same tick lands on a different pixel of
	// a wider pane, and on the same *fraction* of either. A bar that drew a fixed
	// number of pixels per tick would run off the end of a long song.
	check(
		"the song fills the bar at any width",
		[200, 724, 1600, 3000].every((w) => overviewOffset(TICKS, TICKS, w) === w && overviewOffset(0, TICKS, w) === 0),
	);
	check(
		"and a short song fills it exactly as a long one does",
		[1, 96, 12312, 999999].every((t) => Math.abs(overviewOffset(t / 2, t, WIDTH) - WIDTH / 2) < EPSILON),
	);

	// A drag that leaves the bar is still asking for an end of the song, not for a
	// tick outside it — which the transport would clamp anyway, silently.
	check("a drag off the left end asks for the first tick", overviewTick(-500, TICKS, WIDTH) === 0);
	check("and off the right end for the last", overviewTick(WIDTH + 500, TICKS, WIDTH) === TICKS);
	check("a tick past the end draws at the right edge", overviewOffset(TICKS * 2, TICKS, WIDTH) === WIDTH);
	check("and one before the start at the left", overviewOffset(-100, TICKS, WIDTH) === 0);

	// A NaN here is an x of NaN on every bar of the minimap: a strip that renders
	// blank, with nothing in the console to say why.
	check(
		"a song of no ticks answers 0 rather than NaN",
		overviewOffset(50, 0, WIDTH) === 0 && overviewTick(50, 0, WIDTH) === 0,
	);
	check("and so does an unmeasured pane", overviewOffset(50, TICKS, 0) === 0 && overviewTick(50, TICKS, 0) === 0);
}

console.log("\nthe overview bar's minimap");
{
	// A bar's colour is which channel it is, so the dedupe that keeps a dense song
	// inside the DOM has to keep the channels apart. Everything here is invisible
	// in a screenshot: a note folded into another channel's bar leaves the picture
	// altogether, and the only tell is a colour that is not there.
	const WIDTH = 724;
	const TICKS = 12312;
	const stack = laneStack({ lowestKey: 24, highestKey: 35 });
	const context = {
		percussion: new Set<number>(),
		noisy: new Set<number>(),
		drumNotes: new Map<number, number>(),
		written: new Map<number, number>(),
	};

	/** A pitched note as the walk would report it; only the fields the minimap reads. */
	const note = (channel: number, key: number, tick: number, ticks: number): WalkNote => ({
		origins: [],
		drumFrom: null,
		channel,
		tick,
		ticks,
		gateTicks: ticks,
		note: 0x80 + key,
		key,
		percussion: null,
		address: 0,
		state: {
			instrument: 0,
			volume: null,
			pan: null,
			quantization: null,
			gate: 0xff,
			velocity: 0xff,
			vibrato: false,
			tremolo: false,
			noise: null,
			transpose: 0,
			tune: 0,
			tempo: 0,
			globalVolume: null,
		},
	});

	const minimap = (notes: WalkNote[], audible: ReadonlyMap<number, boolean> = new Map()) =>
		buildMinimap({ notes, stack, context, ticks: TICKS, width: WIDTH, audible });

	// One pixel of this bar is some seventeen ticks, so ticks 0 and 1 land on it
	// together — which is the collision the key has to tell apart.
	const together = minimap([note(0, 28, 0, 24), note(1, 28, 1, 24)]);
	check("two channels through one pixel of a row are two bars", together.length === 2, `${together.length}`);
	check(
		"each in its own channel's colour",
		together
			.map((bar) => bar.fill)
			.sort()
			.join(",") === "fill-ch-0,fill-ch-1",
		together.map((bar) => bar.fill).join(","),
	);

	// One channel's two are one picture, and the wider holds a long note's reach
	// against a short one starting alongside it.
	const doubled = minimap([note(0, 28, 0, 24), note(0, 28, 1, 96)]);
	check("one channel's two through that pixel are one bar", doubled.length === 1, `${doubled.length}`);
	check(
		"and it is the wider of them",
		Math.abs(doubled[0].w - overviewOffset(96, TICKS, WIDTH)) < EPSILON,
		`${doubled[0].w}`,
	);

	const reversed = minimap([note(0, 28, 0, 96), note(0, 28, 1, 24)]);
	check(
		"whichever order the two arrive in",
		reversed.length === 1 && Math.abs(reversed[0].w - doubled[0].w) < EPSILON,
		`${reversed.length} at ${reversed[0].w}`,
	);

	// A silenced channel is dimmed rather than dropped, at the roll's own value,
	// and its bars come back first so a live one is never veiled by the wash of
	// something that cannot be heard.
	const mixed = minimap(
		[note(0, 28, 0, 24), note(1, 30, 0, 24), note(2, 32, 0, 24)],
		new Map([
			[0, true],
			[1, false],
			[2, true],
		]),
	);
	check("a silenced channel is dimmed rather than dropped", mixed.length === 3, `${mixed.length}`);
	check(
		"at the value the roll's own bars use",
		mixed.filter((bar) => bar.fill === "fill-ch-1").every((bar) => bar.opacity === MUTED_OPACITY),
	);
	check("its bars come back before every audible one", mixed[0].fill === "fill-ch-1", mixed[0].fill);
	check(
		"and an audible one is not dimmed at all",
		mixed.filter((bar) => bar.fill !== "fill-ch-1").every((bar) => bar.opacity === 1),
	);
	// The mixer only has controls for the channels a song writes to, so a channel
	// missing from the map is one nothing has silenced.
	check("a channel the mixer has no entry for is heard", minimap([note(3, 28, 0, 24)])[0].opacity === 1);

	// `track bar.id` — two bars sharing an id is a duplicate-key error in dev and
	// a bar that never updates in production, which is why the channel is in the
	// key rather than beside it.
	const dense: WalkNote[] = [];
	for (let channel = 0; channel < 8; channel++) {
		for (let tick = 0; tick < TICKS; tick += 13) {
			dense.push(note(channel, 24 + (tick % 12), tick, 24));
		}
	}

	const bars = minimap(dense);
	check("every bar's id is its own", new Set(bars.map((bar) => bar.id)).size === bars.length, `${bars.length} bars`);
	check("and there are never more bars than notes", bars.length <= dense.length, `${bars.length} of ${dense.length}`);
}

console.log("\nthe pull at the end of the scrub bar");
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

console.log("\nthe playhead's own clock");
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

console.log("\npercussion is a preference, not a rule");
{
	/** The driver's own notes for `@21` and `@29`, decoded from `main.bin`. */
	const DRUM_NOTES = new Map([
		[21, 0xa8], // o4 e
		[29, 0xa1], // o3 a
	]);

	const context = (percussion: number[], noisy: number[] = [], written: [number, number][] = []) => ({
		percussion: new Set(percussion),
		noisy: new Set(noisy),
		drumNotes: DRUM_NOTES,
		written: new Map(written),
	});

	/** A note as the walk would report it; only the fields placement reads. */
	const note = (instrument: number | null, byte: number, noise: number | null = null, address = 0): WalkNote => ({
		origins: [],
		drumFrom: null,
		channel: 0,
		tick: 0,
		ticks: 24,
		gateTicks: 24,
		note: byte,
		key: byte >= 0x80 && byte < 0xc6 ? byte - 0x80 : null,
		percussion: byte >= 0xd0 ? byte - 0xd0 : null,
		address,
		state: {
			instrument,
			volume: null,
			pan: null,
			quantization: null,
			gate: 0xff,
			velocity: 0xff,
			vibrato: false,
			tremolo: false,
			noise,
			transpose: 0,
			tune: 0,
			tempo: 0,
			globalVolume: null,
		},
	});

	check(
		"the default is @10 and the driver's nine",
		DEFAULT_PERCUSSION.join(",") === "10,21,22,23,24,25,26,27,28,29",
		DEFAULT_PERCUSSION.join(","),
	);

	// A hi-hat must not stretch the keyboard. `@10` sits at o4 f+ once its
	// default transposition applies, and letting that widen the range adds
	// octaves of empty rows to every song with a drum in it.
	const drummed = rollShape([note(29, 0xd8), note(29, 0x97), note(0, 0xa4)], context([...DEFAULT_PERCUSSION]));
	check("a drum lane never widens the pitched range", drummed.usedDrums.join(",") === "29" && drummed.lowestKey === 36);
	check("and the melodic note is the only thing in it", drummed.lowestKey === drummed.highestKey);

	// The case the whole feature exists for: a song that repointed its samples,
	// where `@10` is no longer a drum and its notes belong on the keyboard.
	const melodicTen = rollShape([note(10, 0x9e)], context([12, 21, 29]));
	check("removing a drum gives its notes back to the keyboard", melodicTen.usedDrums.length === 0);
	check("and they claim their own pitch", melodicTen.lowestKey === 30, String(melodicTen.lowestKey));

	// A bare `$D0`-`$D8` carries no pitch, so a removed drum's notes would have
	// no lane *and* no key — they would silently disappear. The driver's own
	// table is what they fall back to.
	const bare = note(29, 0xd8);
	check("a bare drum falls back to the note the driver's table gives it", keyOf(bare, context([])) === 33);
	check("and @21's is its own", keyOf(note(21, 0xd0), context([])) === 40, String(keyOf(note(21, 0xd0), context([]))));
	const removed = rollShape([bare], context([]));
	check(
		"so removing it keeps the note rather than losing it",
		removed.lowestKey === 33 && removed.usedDrums.length === 0,
	);

	// The fallback is for the bare byte only. A pitched note after a drum was
	// written at a pitch and must keep it.
	check("a pitched note after a drum keeps the pitch it was written at", keyOf(note(29, 0x97), context([])) === 23);

	// The row is the pitch that was *written*, which only the note map knows:
	// `@2 o5 g` emits `$B2` because `@2` takes five semitones off, and the roll
	// draws it on o5 g all the same — the byte is neither what was written nor
	// what sounds, and only the letter is something an edit could go back to.
	const transposed = note(2, 0xb2, null, 0x1234);
	check("a pitched note draws at its written pitch", keyOf(transposed, context([], [], [[0x1234, 0xb7]])) === 55);
	check("and at the byte when the map does not know it", keyOf(transposed, context([])) === 50);
	check(
		"the fitted range is over written pitches too",
		rollShape([transposed], context([], [], [[0x1234, 0xb7]])).highestKey === 55,
	);
	// `h12 o0 c` is `$80` on the wire and o0 c in the source; the row is below o1.
	check(
		"a written pitch below o1 is a negative key",
		keyOf(note(0, 0x80, null, 7), context([], [], [[7, 0x74]])) === -12,
	);
	// A bare drum's letter had no say in its byte, so the map has no say in its row.
	check(
		"a bare drum ignores the pitch it was written under",
		keyOf(note(29, 0xd8, null, 9), context([], [], [[9, 0xa4]])) === 33,
	);

	// Nothing about the rule may be special-cased to `@21`-`@29`.
	check(
		"any instrument the porter names leaves the keyboard",
		rollShape([note(4, 0xa4)], context([4])).usedDrums.join(",") === "4",
	);

	// Two classifications over one note, invisible until a row comes out empty.
	const both = rollShape([note(30, 0xa4)], context([30], [30]));
	check("percussion takes precedence over noise", both.usedDrums.join(",") === "30" && !both.usesNoise);
	check("and noise still wins when it is not named", rollShape([note(30, 0xa4)], context([], [30])).usesNoise);

	check(
		"an empty set leaves everything on the keyboard",
		rollShape([note(29, 0xd8), note(10, 0x9e)], context([])).usedDrums.length === 0,
	);

	// Storage is a string someone can hand-edit.
	check("a stored set that is not a list is ignored", parsePercussion("yes") === null && parsePercussion(42) === null);
	check("junk inside a list is dropped", parsePercussion([10, "x", 12, 1.5, -1, 999])?.join(",") === "10,12");
	check("and it comes back sorted and deduped", parsePercussion([29, 10, 29])?.join(",") === "10,29");
	// The `sampleList: null is not []` rule, in miniature: `null` means nothing
	// was stored and the default stands, `[]` means the porter turned everything
	// off. Reading `[]` as "no opinion" would make that undo itself on reload.
	check("an empty stored set is kept, not treated as absent", parsePercussion([])?.length === 0);
	// The porter's answer for a custom instrument is worth as much as the one for
	// `@21`, and costs more to give again: nothing here treats it differently.
	check(
		"a custom instrument is stored like any other",
		parsePercussion([10, 29, 30, 200])?.join(",") === "10,29,30,200",
		parsePercussion([10, 29, 30, 200])?.join(","),
	);
}

console.log("\nthe transport's clock, over songs the compiler will not time");
{
	/** Only the four fields `songClock` reads; the rest is padding. */
	const song = (ticks: number, tempoChanges: TempoChange[] = [], truncated = false): SongTimeline => ({
		notes: [],
		ticks,
		loopTick: null,
		tempoChanges,
		commands: [],
		channelTicks: [ticks, 0, 0, 0, 0, 0, 0, 0],
		used: [true, false, false, false, false, false, false, false],
		usedInstruments: [],
		unreachable: [],
		customInstruments: [],
		truncated,
		problems: [],
	});

	const at = (tempo: number, tick = 0): TempoChange => ({ tick, tempo, fadeTicks: 0 });
	const fade = (tick: number, tempo: number, fadeTicks: number): TempoChange => ({ tick, tempo, fadeTicks });
	const near = (got: number, want: number) => Math.abs(got - want) < 1e-9;

	// A song with no `t` is not a song with no tempo — main.asm:177 has already
	// put #$36 into $51. Reading it as a written byte would give 55 and retime
	// every untempoed song by 1.85%.
	const bare = songClock(song(192))!;
	check(
		"no tempo command still clocks, at the driver's t53",
		near(bare.seconds, 192 * driverTickSeconds(54)),
		`${bare.seconds.toFixed(4)} s`,
	);
	check("and leaves no empty segment in front of a t at tick 0", songClock(song(192, [at(96)]))!.segments.length === 1);

	// Two exact terms, not one average: the halves do not agree by a constant.
	const stepped = songClock(song(384, [at(96, 192)]))!;
	check(
		"a $E2 takes effect on its own tick",
		near(stepped.seconds, 192 * driverTickSeconds(54) + 192 * driverTickSeconds(97)),
		`${stepped.seconds.toFixed(4)} s`,
	);

	// The whole point of the change: the clock and the inspector's label are one
	// model, so they cannot give a song two lengths.
	const faded = songClock(song(255, [fade(0, 254, 255)]))!;
	check(
		"a fade is priced tick by tick, exactly as its label is",
		faded.seconds === tempoFadeSeconds(255, DEFAULT_TEMPO, 254),
		`${faded.seconds.toFixed(4)} s`,
	);
	check("which is not what those ticks take at the tempo it leaves", faded.seconds < 255 * tickSeconds(DEFAULT_TEMPO));

	// A row per tick would work and make the binary search pointless.
	check(
		"equal-tempo ticks fold into segments",
		faded.segments.length < 255 &&
			faded.segments.every((s, n) => n === 0 || s.secondsPerTick !== faded.segments[n - 1].secondsPerTick),
		`${faded.segments.length} segments`,
	);

	// The table has to join up: a segment's own seconds plus its rate across its
	// span must land on the next one's, or the readout jumps at every boundary
	// while still looking monotone and plausible either side of it.
	check(
		"segments join up, so the readout does not jump at a boundary",
		faded.segments.every((s, n) => {
			const next = faded.segments[n + 1];
			return next === undefined || near(s.seconds + (next.tick - s.tick) * s.secondsPerTick, next.seconds);
		}),
	);
	check(
		"and seconds never run backwards",
		Array.from({ length: 256 }, (_, tick) => secondsAtTick(faded, tick)).every(
			(seconds, n, all) => n === 0 || seconds > all[n - 1],
		),
	);

	// The delta belongs to the written duration. Re-deriving it from the ticks
	// that survive is a different fade, and reads entirely reasonable.
	const cut = songClock(song(96, [fade(0, 254, 255)]))!;
	const first96 = (tempoFadeSteps(255, DEFAULT_TEMPO, 254) ?? [])
		.slice(0, 96)
		.reduce((total, tempo) => total + driverTickSeconds(tempo), 0);
	check("a fade cut short keeps the delta its written duration gave it", near(cut.seconds, first96));
	check("which is not the same as a shorter fade", !near(cut.seconds, tempoFadeSeconds(96, DEFAULT_TEMPO, 254)!));

	// The driver has one tempo, not a stack: a second command ends the ramp.
	const interrupted = songClock(song(192, [fade(0, 254, 255), at(53, 96)]))!;
	const ramped = (tempoFadeSteps(255, DEFAULT_TEMPO, 254) ?? [])
		.slice(0, 96)
		.reduce((total, tempo) => total + driverTickSeconds(tempo), 0);
	check(
		"a tempo command inside a fade ends it there",
		near(interrupted.seconds, ramped + 96 * driverTickSeconds(54)),
		`${interrupted.seconds.toFixed(4)} s`,
	);

	// Commands.asm:330's carry-set adc wraps $FF to 0. Not a division by zero,
	// not an infinite song: the pass genuinely never finishes.
	const stopped = songClock(song(384, [at(255, 192)]))!;
	check("t255 stops the song rather than running it fastest", stopped.stalled && stopped.ticks === 192);
	check(
		"and the clock pins there instead of diverging",
		Number.isFinite(stopped.seconds) && secondsAtTick(stopped, 999) === stopped.seconds,
	);
	check("a fade into a stop stops too", songClock(song(384, [fade(0, 255, 96)]))!.stalled);

	// `null` and not a zero-length clock: the callers read it as "no opinion, use
	// what the compiler said", and a song of no length would disable seeking.
	check("no walk, no clock", songClock(null) === null);
	check("nor for a song of no ticks", songClock(song(0)) === null);
	check("nor for a walk that ran out of budget", songClock(song(192, [], true)) === null);

	// The rate the roll extrapolates at, which has to be the clock's own slope.
	const rate = songClock(song(384, [at(96, 192)]))!;
	check("the clock reports its own rate", near(ticksPerSecondAt(rate, 0), 1 / driverTickSeconds(54)));
	check("which follows a tempo change", near(ticksPerSecondAt(rate, 300), 1 / driverTickSeconds(97)));
}

console.log("\nthe roll's playhead follows the music, not the tempo it was written at");
{
	// The driver runs at most one tick per pass of its main loop, so a song that
	// asks for more than it can manage gets fewer — measured, about 231 of the
	// 498 ticks a second a t254 song on eight channels writes. A playhead
	// extrapolated at the tempo *byte* therefore races between anchors and sits a
	// steady distance ahead of the notes being sounded. There is no visual tell:
	// it scrolls perfectly smoothly, in the wrong place.
	const PASS = 7488;
	const MAX_EXTRAPOLATION = 0.15; // roll-clock.ts's MAX_EXTRAPOLATION
	const FPS = 60;

	/** The roll's clock over `seconds`, with `rate` as its belief about speed. */
	const drift = (trueRate: number, rate: number, seconds = 6) => {
		let shown = 0;
		let anchorTicks = 0;
		let anchorAt = 0;
		let last = 0;
		let worst = 0;

		for (let f = 1; f <= seconds * FPS; f++) {
			const now = (f * 1000) / FPS;
			// The transport posts the driver's own count about ten times a second.
			if (now - anchorAt >= 100) {
				anchorAt = now;
				anchorTicks = (now / 1000) * trueRate;
			}

			const elapsed = last === 0 ? 0 : (now - last) / 1000;
			last = now;

			const since = Math.max(0, (now - anchorAt) / 1000);
			const reach = anchorTicks + Math.min(since, MAX_EXTRAPOLATION) * rate;
			shown = advanceTick({ shown, target: clamp(reach, 0, PASS), rate, elapsed, pass: PASS });

			// Second half only, so the start-up transient is not the answer.
			if (f > seconds * FPS * 0.5) {
				worst = Math.max(worst, Math.abs(shown - (now / 1000) * trueRate));
			}
		}

		return worst;
	};

	check(
		"an ordinary song tracks within a couple of ticks",
		drift(105.5, 105.5) < 3,
		`${drift(105.5, 105.5).toFixed(1)}`,
	);

	// 231.2 measured against 498.0 nominal.
	const nominal = drift(231.2, 498.0);
	const measured = drift(231.2, 231.2);
	check("the tempo byte puts it more than a quarter note out", nominal > 48, `${nominal.toFixed(1)} ticks`);
	check("the clock's own rate keeps it within a 32nd", measured < 6, `${measured.toFixed(1)} ticks`);
}

// ---------------------------------------------------------------------------
console.log("\nwhat fits inside one bar");
// ---------------------------------------------------------------------------
//
// A bar names its own note and carries a glyph per command acting on it. Both
// are drawn inside a rectangle whose width is a note length times a zoom and
// whose height is a stretched row, so "does it fit" is arithmetic and the
// failure — text running out over the next bar, or over the key column — is the
// kind that only shows up on somebody else's song.
{
	// Two spellings of one pitch. `keyName` is four characters too wide for a bar
	// and `noteLabel` is what goes in one, so the only thing that matters is that
	// they can never name different keys.
	let apart = "";
	for (let key = -24; key < 96; key++) {
		const long = keyName(key);
		const at = long.indexOf(" ");
		const rewritten = long.slice(at + 1).toUpperCase() + long.slice(1, at);
		if (noteLabel(key) !== rewritten) {
			apart += ` ${long} vs ${noteLabel(key)}`;
		}
	}

	check("a bar's name and the key column's name the same key", apart === "", apart);
	check("including below o1, where the octave floors", noteLabel(-12) === "C0" && noteLabel(-1) === "B0");
	check("and the accidental is MML's own +", noteLabel(1) === "C+1");

	// A row too short to hold text holds nothing: half a letter is worse than a
	// bar that simply says nothing and leaves it to the hover.
	check("nothing is drawn in a row too short for it", fitBarContent(400, 8, "C4", 3).name === null);
	check("and no glyphs either", fitBarContent(400, 8, "C4", 3).glyphs.length === 0);
	check("nor the mark that says there are more", fitBarContent(400, 8, "C4", 3).more === null);
	check("nor in a bar of no width", fitBarContent(0, 30, "C4", 3).name === null);

	// The name goes first and the glyphs are dropped from the end. A bar saying
	// `C6` is still saying something; glyphs with no note beside them are a row of
	// icons floating over the music.
	const wide = fitBarContent(300, 20, "C4", 4);
	check("a wide bar takes its name and every glyph", wide.name !== null && wide.glyphs.length === 4);
	check("and says nothing about more, because there are none", wide.more === null);

	// A truncated list and a complete one are the same picture without this, so
	// the mark is the only thing that says the hover is worth asking. It costs a
	// slot, and the slot comes off the glyphs rather than off the name.
	{
		// Every width from "one slot" upwards, so the claims below are about the
		// rule rather than about three widths that happen to agree with it.
		let unmarked = "";
		let overrun = "";
		let alone = -1;
		for (let width = 0; width <= 400; width += 1) {
			const fit = fitBarContent(width, 20, "C4", 4);
			if (fit.more === null && fit.glyphs.length < 4 && fit.glyphs.length > 0) {
				unmarked += ` ${width}`;
			}

			if (fit.more !== null && fit.glyphs.length >= 4) {
				overrun += ` ${width}`;
			}

			if (fit.more !== null && fit.glyphs.length === 0 && alone < 0) {
				alone = width;
			}
		}

		check("a bar showing some of four always says there are more", unmarked === "", unmarked);
		check("and one showing all four never does", overrun === "", overrun);
		check("the narrowest bar with a slot spends it on the mark", alone >= 0, `never stood alone`);

		// The second half of that, and the one the rule is chosen for: one slot
		// and one glyph is the glyph, not a mark standing in for it.
		const one = fitBarContent(alone, 20, "C4", 1);
		check("but a bar with one slot and one glyph draws the glyph", one.glyphs.length === 1 && one.more === null);

		// `MAX_GLYPHS` is a cut like any other: a bar wide enough for eight shows
		// five at most, and the three it drops are three the porter cannot see.
		const capped = fitBarContent(400, 20, "C4", 8);
		check("a bar past the glyph cap says so too", capped.more !== null, `${capped.glyphs.length} glyphs, no mark`);
		check("and spends one of the capped slots on saying it", capped.glyphs.length === 4);

		// `buildMarks` reads the boxes back onto the front of the list it asked
		// about and takes the tail as the ones the mark stands for — which is what
		// decides both the icon each box gets and whether the mark wears a
		// defining note's plate. Both are silently wrong if the order is not the
		// list's own, left to right with the mark past the end of them.
		const cut = fitBarContent(120, 20, "C4", 5);
		let ordered = cut.glyphs.length > 1;
		for (let n = 1; n < cut.glyphs.length; n++) {
			ordered &&= cut.glyphs[n - 1].x < cut.glyphs[n].x;
		}

		check("a cut bar hands its boxes back in the order it was given", ordered, `${cut.glyphs.length} boxes`);
		check(
			"with the mark for the rest past the last of them",
			cut.more !== null && cut.more.x > cut.glyphs[cut.glyphs.length - 1].x,
		);
	}

	// Monotone, and it has to be: a bar that grows an icon as it shrinks is what
	// happens when the glyphs are allowed the room the name gave up.
	let last = 99;
	let grew = "";
	let nameLost = -1;
	for (let width = 300; width >= 0; width -= 1) {
		const fit = fitBarContent(width, 20, "C4", 4);
		if (fit.glyphs.length > last) {
			grew += ` ${fit.glyphs.length} at ${width}`;
		}

		last = fit.glyphs.length;
		if (fit.name === null && nameLost < 0) {
			nameLost = width;
		}
	}

	check("glyphs only ever drop as a bar narrows", grew === "", grew);
	check("down to none", last === 0);
	check(
		"and the name is the last thing to go",
		nameLost >= 0 && fitBarContent(nameLost + 1, 20, "C4", 4).glyphs.length === 0,
		`name lost at ${nameLost}`,
	);

	// Nothing may cross the bar it is drawn in: the roll clips at the key column
	// and not per mark, so an overhang lands on the neighbouring note.
	let overflow = "";
	for (const width of [12, 20, 40, 80, 160, 320]) {
		for (const glyphs of [0, 1, 3, 5, 8]) {
			const fit = fitBarContent(width, 24, "C+4", glyphs);
			const boxes = fit.more === null ? fit.glyphs : [...fit.glyphs, fit.more];
			for (const box of boxes) {
				if (box.x < 0 || box.x + box.size > width) {
					overflow += ` ${width}/${glyphs}`;
				}
			}

			// The name is measured at the monospace advance, which is what makes
			// this an estimate worth trusting: the roll's text is `font-mono`.
			const nameEnd = fit.name === null ? 0 : fit.name.x + "C+4".length * fit.name.size * 0.6;
			if (boxes.length > 0 && boxes[0].x < nameEnd) {
				overflow += ` overlap ${width}/${glyphs}`;
			}
		}
	}

	check("nothing is laid outside its bar or over its name", overflow === "", overflow);
}

// ---------------------------------------------------------------------------
console.log("\nhow the command lane stacks what lands together");
// ---------------------------------------------------------------------------
//
// The lane draws one glyph per command going in effect, at `tick * zoom`, and
// never moves one sideways to make room — where a glyph is *is* the claim it
// makes. So room is found by going deeper, and the rule has to hold at every
// zoom: two commands a beat apart do not collide at 4 px per tick and do at 0.5.
//
// Rows are dealt over the whole song rather than over the window on screen. A
// window-scoped pack would re-deal them at every turnover, and a glyph changing
// row as the roll scrolled past it would be saying something about the scroll.
{
	const source = "#amk 4\n#0 v200 y10 q7f @1 $ED $3F $4D t144 n10 p12,8 $DE $00 $0C $08 $F8 $10 c8\n";
	const written = tokenize(source).commands.filter((command) => command.kind !== "c");
	/** Real commands off a real scan, so `glyphOf` is exercised as the lane exercises it. */
	const at = (tick: number, channel: number, n: number): TimelineCommand => ({
		tick,
		channel,
		command: written[n % written.length],
	});
	const pack = (events: TimelineCommand[], zoom: number, audible = new Map<number, boolean>()) =>
		packCommandLane({ events, text: source, zoom, audible });
	const rows = (lane: CommandLane) => lane.glyphs.map((glyph) => glyph.y / LANE_ROW).join(",");

	const together = pack([at(96, 0, 0), at(96, 1, 1), at(96, 2, 2)], 2);
	check("three commands on one tick take three rows", rows(together) === "0,1,2", rows(together));
	check(
		"and all three keep that tick's x",
		together.glyphs.every((g) => g.x === 192),
	);
	check("which is how deep the lane says it is", together.depth === 3, String(together.depth));

	// Far enough apart at this zoom that the first has cleared before the second
	// begins, so the second goes back to the top rather than staying where the
	// one before it happened to land.
	const apart = pack([at(0, 0, 0), at(96, 0, 1)], 2);
	check("two commands far apart share row 0", rows(apart) === "0,0", rows(apart));

	// The same two events, zoomed out until their boxes overlap. Nothing about
	// the song changed; the picture did, and the lane has to answer for the
	// picture or one glyph is drawn over another.
	const crowded = pack([at(0, 0, 0), at(4, 0, 1)], 0.5);
	check("and stack once the zoom brings them together", rows(crowded) === "0,1", rows(crowded));

	const opened = pack([at(0, 0, 0), at(4, 0, 1)], 8);
	check("then flatten again when it is wound back in", rows(opened) === "0,0", rows(opened));

	// The rule the two above are cases of, over every zoom the toolbar offers.
	let overlapping = "";
	for (const zoom of [0.5, 1, 2, 4, 8]) {
		const lane = pack(
			[0, 3, 6, 9, 24, 25, 48, 192].map((tick, n) => at(tick, 0, n)),
			zoom,
		);
		const byRow = new Map<number, number[]>();
		for (const glyph of lane.glyphs) {
			const row = byRow.get(glyph.y) ?? [];
			row.push(glyph.x);
			byRow.set(glyph.y, row);
		}

		for (const xs of byRow.values()) {
			for (let n = 1; n < xs.length; n++) {
				if (xs[n] - xs[n - 1] < LANE_GLYPH) {
					overlapping += ` ${zoom}`;
				}
			}
		}
	}

	check("no glyph is ever drawn over another, at any zoom", overlapping === "", overlapping);

	// A column deeper than the lane will draw is counted rather than dropped in
	// silence: a stack cut to keep the DOM finite is still a stack cut.
	const deep = pack(
		Array.from({ length: MAX_LANE_ROWS + 3 }, (_, n) => at(48, n % 8, n)),
		2,
	);
	check(
		"a column past the cap keeps the cap's worth",
		deep.glyphs.length === MAX_LANE_ROWS,
		String(deep.glyphs.length),
	);
	check(
		"and says how many it could not draw, in the deepest row",
		deep.more.length === 1 && deep.more[0].count === 3 && deep.more[0].y === (MAX_LANE_ROWS - 1) * LANE_ROW,
		deep.more.map((m) => `${m.count}@${m.y}`).join(" "),
	);

	// Dimmed rather than dropped, as the roll's bars and the overview's are, and
	// still taking its row: a muted channel is still part of the song.
	const muted = pack([at(96, 3, 0), at(96, 4, 1)], 2, new Map([[3, false]]));
	check(
		"a silenced channel's command is dimmed and keeps its place",
		muted.glyphs[0].opacity === MUTED_OPACITY && muted.glyphs[1].opacity === 1 && muted.depth === 2,
		muted.glyphs.map((g) => g.opacity).join(","),
	);

	// The colour is `color` and not `fill`: a palette glyph paints its own shapes
	// with `currentColor`, so a `fill-ch-*` would reach none of them. And the
	// hover names the channel, because the eight colours do not identify one on
	// their own — `styles.css` says so and this is where it is kept true.
	check("a glyph is tinted by color, per channel", muted.glyphs[1].tint === "text-ch-4", muted.glyphs[1].tint);
	check(
		"and its hover names the command, the text, the channel and the tick",
		muted.glyphs[1].title.includes("#4") && muted.glyphs[1].title.includes("tick 96"),
		muted.glyphs[1].title,
	);

	// The window is a slice of the pack, so a glyph keeps the row the whole song
	// gave it, and `depth` stays the whole song's — it is how far the lane can be
	// scrolled, and a range that shrank as the roll moved would take the porter's
	// position with it.
	const whole = pack([at(0, 0, 0), at(0, 1, 1), at(0, 2, 2), at(960, 0, 3)], 2);
	const slice = laneWindow(whole, 900, 1000, 2);
	check("a window holds only the glyphs inside it", slice.glyphs.length === 1, String(slice.glyphs.length));
	check("keeps the row the whole song dealt it", slice.glyphs[0].y === 0, String(slice.glyphs[0].y));
	check("and reports the whole song's depth", slice.depth === 3, String(slice.depth));

	check(
		"a lane with no commands has no depth",
		packCommandLane({ events: [], text: source, zoom: 2, audible: new Map() }).depth === 0,
	);
}

console.log("\nthe slider's track, whose two rules fail invisibly");
{
	// A slider with `stops` is an index into that list; a plain one is its value.
	const STOPS = [0, 1, 2, 4, 8, 16];
	const overStops = trackBounds(STOPS, -128, 127);
	const plain = trackBounds(null, -128, 127);

	check("stops are indexed from 0", overStops.low === 0 && overStops.high === STOPS.length - 1);
	check("a plain track is its own range", plain.low === -128 && plain.high === 127);

	check("a value on a stop takes its index", trackPosition(4, STOPS) === 3);
	check("and one between stops takes the nearest", trackPosition(3, STOPS) === 2 && trackPosition(12, STOPS) === 4);
	check("a value past the end pins to the last stop", trackPosition(999, STOPS) === 5);
	check("a plain track passes the value through", trackPosition(-40, null) === -40);

	// The claim: `mirror` is its own inverse. AddmusicK's pan runs backwards
	// (main.asm:3486) and the roll's own `invert` relies on one function serving
	// both directions — the thumb going out, and the raw input coming back.
	let notInvolutive = "";
	for (const bounds of [plain, overStops, { low: 0, high: 0 }, { low: -7, high: 7 }]) {
		for (let n = bounds.low; n <= bounds.high; n++) {
			if (mirror(mirror(n, bounds, true), bounds, true) !== n) {
				notInvolutive += ` ${n} in ${bounds.low}..${bounds.high}`;
			}

			if (mirror(n, bounds, false) !== n) {
				notInvolutive += ` uninverted moved ${n}`;
			}
		}
	}

	check("mirroring twice is the identity", notInvolutive === "", notInvolutive);
	check("and it reflects through the middle", mirror(-128, plain, true) === 127);

	check("the fraction runs 0 to 1 across the track", trackFraction(-128, plain) === 0);
	check("  and reaches 1 at the top", trackFraction(127, plain) === 1);
	check("  with the centre at a half", trackFraction(-0.5, plain) === 0.5);
	check("a track of no width is 0 rather than NaN", trackFraction(5, { low: 5, high: 5 }) === 0);

	// The claim: the centre detent is listed *first*, which in CSS paints it over
	// the fill. The fill always reaches the centre by definition, so a detent
	// underneath it could never be seen at any value but the extremes.
	let detentBehind = "";
	for (let percent = 0; percent <= 100; percent += 5) {
		const image = trackImage(percent / 100, true);
		const detent = image.indexOf("--color-ink-muted");
		const fill = image.indexOf("--color-accent");
		if (detent < 0 || fill < 0 || detent > fill) {
			detentBehind += ` ${percent}%`;
		}
	}

	check("the centre detent is drawn over the fill at every value", detentBehind === "", detentBehind);
	check("an off-centre track has no detent at all", !trackImage(0.5, false).includes("--color-ink-muted"));

	// Out of range at either end still produces a usable gradient rather than a
	// percentage CSS drops the whole declaration over.
	let unclamped = "";
	for (const fraction of [-2, -0.01, 0, 0.5, 1, 1.01, 5]) {
		for (const centred of [true, false]) {
			const image = trackImage(fraction, centred);
			// Every bare percentage in the gradient — the `calc(50% ± 1px)` detent
			// is written as a calc and is not one of these.
			const stops = [...image.matchAll(/(?<![\w(])(-?\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));
			if (stops.some((stop) => stop < 0 || stop > 100)) {
				unclamped += ` ${fraction}${centred ? " centred" : ""} -> ${stops.join(",")}`;
			}
		}
	}

	check("a fraction outside 0..1 is clamped into the gradient", unclamped === "", unclamped);

	// The round trip a drag makes: a track coordinate back to a value.
	check("an inverted plain track reads back its value", valueAt(127, null, plain, true, 0) === -128);
	check("an inverted stop track reads back its stop", valueAt(0, STOPS, overStops, true, -1) === 16);
	check("an uninverted stop track reads straight through", valueAt(3, STOPS, overStops, false, -1) === 4);
	check("a coordinate off the stop list falls back", valueAt(99, STOPS, overStops, false, -1) === -1);

	check("the readout signs a positive value", readout(5, null, true) === "+5");
	check("  leaves a negative alone", readout(-5, null, true) === "-5");
	check("  and an unsigned one alone", readout(5, null, false) === "5");
	check("a caller's own label wins", readout(5, "12 ticks", true) === "12 ticks");
}

console.log("\nthe transport's mixer and playhead, which a browser cannot be made to show");
{
	// Solo clears the mutes outright rather than holding them: what the buttons
	// show is always what is heard.
	check("no mutes and no solo silences nothing", silencedMask(0, null) === 0);
	check("a mute mask passes through", silencedMask(0b0000_0101, null) === 0b0000_0101);
	check(
		"solo silences everything else, mutes included",
		silencedMask(0b1111_1111, 3) === 0b1111_0111,
		silencedMask(0b1111_1111, 3).toString(2),
	);

	const sizes = [40, 0, 12, 0, 0, 0, 0, 9];
	const rows = channelStates(sizes, 0, null);
	check("only channels the song writes to get a row", rows.length === 3, rows.map((r) => r.index).join(","));
	check("and they keep their own indices", rows.map((r) => r.index).join(",") === "0,2,7");
	check(
		"all audible with nothing muted",
		rows.every((r) => r.audible),
	);

	const muted = channelStates(sizes, 0b0000_0001, null);
	check("a muted channel reads muted and inaudible", muted[0].muted && !muted[0].audible);
	check("  and leaves the others alone", muted[1].audible && muted[2].audible);

	const soloed = channelStates(sizes, 0b0000_0001, 2);
	check("under solo only that channel is audible", soloed.filter((r) => r.audible).length === 1);
	check("  and it is the soloed one", soloed.find((r) => r.audible)?.index === 2);
	// The mute survives in the button's state even while solo overrides it.
	check("  while a mute is still shown as set", soloed[0].muted && !soloed[0].audible);

	// An empty channel keeps no row, whatever its mute state.
	check("an empty channel gets no row even when muted", channelStates([0, 0], 0b11, null).length === 0);

	// What the roll adopts as the channel to edit. Soloing and muting every other
	// channel by hand are one answer, which is the point of asking it over the rows.
	check("nothing muted leaves no sole channel", soleAudible(rows) === null);
	check("a solo leaves the soloed channel", soleAudible(soloed) === 2);
	check(
		"muting every other row by hand leaves the same one",
		soleAudible(channelStates(sizes, 0b1000_0001, null)) === 2,
	);
	check("one mute short of that leaves none", soleAudible(muted) === null);
	check("muting every row leaves none", soleAudible(channelStates(sizes, 0b1000_0101, null)) === null);
	check("a song with one channel leaves that one", soleAudible(channelStates([40], 0, null)) === 0);
	check("and a song with no channels at all leaves none", soleAudible(channelStates([], 0, null)) === null);

	check("a mute is reported as a mute", silencedReason(3, null) === "channel 3 is muted");
	check("  and a solo names the channel that has it", silencedReason(3, 5) === "only channel 5 is soloed");
}

console.log("\nthe playhead drops what a mid-update read of ARAM invents");
{
	// `noteAddressAt` finds the last note *before* the pointer, because the
	// driver's read pointer has already stepped past the note it is sounding —
	// so every pointer below sits just after the entry it should resolve to.
	const span = (start: number) => ({ start, end: start + 1, line: 1 });
	const map = [
		{ address: 0x100, channel: 0, span: span(10), written: 0, note: 0 },
		{ address: 0x200, channel: 1, span: span(20), written: 0, note: 0 },
		{ address: 0x300, channel: 8, span: span(30), written: 0, note: 0 },
	] as unknown as Parameters<typeof soundingSpans>[0];
	const starts = (pointers: number[], silenced = 0) =>
		soundingSpans(map, pointers, silenced)
			.map((s) => s.start)
			.join(",");

	check("each voice decorates its own note", starts([0x150, 0x250, 0, 0, 0, 0, 0, 0]) === "10,20");

	// Voice 1's pointer landing in voice 0's region is the artefact: reading ARAM
	// between the driver's writes, never a real thing to draw.
	check("a pointer in another voice's region is dropped", starts([0, 0x150, 0, 0, 0, 0, 0, 0]) === "");

	// The loop block is the exception, and has to be: a subroutine's notes belong
	// to whichever voice called it.
	check("but the loop block is kept for any voice", starts([0x350, 0, 0, 0, 0, 0, 0, 0]) === "30");

	check(
		"two voices in one subroutine decorate it once",
		soundingSpans(map, [0x350, 0x350, 0, 0, 0, 0, 0, 0], 0).length === 1,
	);

	check("a silenced voice is not drawn", starts([0x150, 0x250, 0, 0, 0, 0, 0, 0], 0b0000_0001) === "20");
	check("a voice that has not started is not drawn", starts([0, 0, 0, 0, 0, 0, 0, 0]) === "");
	check("a pointer before every note resolves to nothing", starts([0x010, 0, 0, 0, 0, 0, 0, 0]) === "");

	// Addresses ascend where the spans do not, so the sort is doing the work.
	const jumbled = [
		{ address: 0x100, channel: 0, span: span(40), written: 0, note: 0 },
		{ address: 0x200, channel: 1, span: span(15), written: 0, note: 0 },
	] as unknown as Parameters<typeof soundingSpans>[0];
	const sorted = soundingSpans(jumbled, [0x150, 0x250, 0, 0, 0, 0, 0, 0], 0).map((s) => s.start);
	check("spans come back in document order", sorted.join(",") === "15,40", sorted.join(","));
}

console.log("\nthe seconds estimate for a song the walk could not read");
{
	const pass = { introTicks: 96, loopTicks: 192, introSeconds: 2, mainSeconds: 6 };

	check("tick 0 is second 0", estimatedSecondsAt(pass, 0) === 0);
	check("the intro is exact at its end", estimatedSecondsAt(pass, 96) === 2);
	check("and the pass is exact at its end", estimatedSecondsAt(pass, 288) === 8);
	check("halfway through the intro is half its seconds", estimatedSecondsAt(pass, 48) === 1);
	check("halfway round the loop is half of the main", estimatedSecondsAt(pass, 192) === 5);

	// Two straight lines, so it never runs backwards even though it bends.
	let backwards = "";
	for (let tick = 1; tick <= 288; tick++) {
		if (estimatedSecondsAt(pass, tick) < estimatedSecondsAt(pass, tick - 1)) {
			backwards += ` ${tick}`;
		}
	}

	check("it never runs backwards", backwards === "", backwards);

	// A song with no loop stops at the intro rather than extrapolating past it.
	const once = { introTicks: 96, loopTicks: 0, introSeconds: 2, mainSeconds: 0 };
	check("a song that does not loop holds at its end", estimatedSecondsAt(once, 500) === 2);
	check(
		"an intro-less song is all loop",
		estimatedSecondsAt({ introTicks: 0, loopTicks: 100, introSeconds: 0, mainSeconds: 4 }, 50) === 2,
	);
}

summarise();
