/**
 * Chart geometry: the stacked bar, the plot space and `clamp`.
 *
 * The ARAM bar spans all 64 KiB, so real regions are routinely a fraction of a
 * percent of it and land on sub-pixel widths. That arithmetic has already gone
 * wrong once — subtracting the inter-segment gap from each segment silently
 * zeroed anything narrower than the gap, so a small song vanished from the bar
 * entirely — and it is awkward to eyeball in a browser. So it lives in a pure
 * function and is checked here.
 *
 *   npm run charttest
 */

import { KEY_COUNT, type SongTimeline, type TempoChange, type WalkNote } from "@amk/spc/song-walk";
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
	advanceTick,
	gridLines,
	keyIsBlack,
	keyName,
	laneStack,
	tickWindow,
} from "../web/src/app/editor/views/piano-roll/roll-layout";
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
	// editor-pane spans rely on: `clamp(end, start + 1, length)` with an empty
	// document has `min` above `max`.
	check("an inverted range answers with max", clamp(5, 10, 0) === 0, String(clamp(5, 10, 0)));
}

console.log("\npiano roll lanes");
{
	// The whole point of fitting: a song that lives in one octave should not be
	// drawn against seventy rows, most of them empty.
	const fitted = laneStack({ lowestKey: 28, highestKey: 33 });
	check("a fitted range covers whole octaves", fitted.lanes.length === 12, `${fitted.lanes.length} rows`);
	check("and it contains the notes played", fitted.rowOfKey[28] >= 0 && fitted.rowOfKey[33] >= 0);
	check("while a key outside it has no row", fitted.rowOfKey[0] === -1 && fitted.rowOfKey[69] === -1);
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

	const lines = gridLines(0, 384, 48);
	check("the grid steps every quarter note", lines.length === 9, `${lines.length} lines`);
	check("and marks every whole note heavily", lines.filter((l) => l.strong).length === 3);
	check(
		"the strong lines are the multiples of 192",
		lines.filter((l) => l.strong).every((l) => l.tick % 192 === 0),
	);
	check("a zero step yields nothing rather than hanging", gridLines(0, 384, 0).length === 0);
}

console.log("\nthe playhead's own clock");
{
	const RATE = 95.7; // t48, the tempo the stutter was found on
	const FRAME = 1 / 60;
	const PASS = 12312;

	// The bug this exists to prevent. Every anchor arrives with about the same
	// small lag, so a clock that re-derived its position from the newest one
	// reproduced that lag ten times a second and jerked to close it: measured at
	// 2.4x speed on one frame in ten, exactly 100 ms apart. Run the real thing
	// against a steadily-lagging anchor and no frame may be far off the median.
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

	const context = (percussion: number[], noisy: number[] = []) => ({
		percussion: new Set(percussion),
		noisy: new Set(noisy),
		drumNotes: DRUM_NOTES,
	});

	/** A note as the walk would report it; only the fields placement reads. */
	const note = (instrument: number | null, byte: number, noise: number | null = null): WalkNote => ({
		channel: 0,
		tick: 0,
		ticks: 24,
		gateTicks: 24,
		note: byte,
		key: byte >= 0x80 && byte < 0xc6 ? byte - 0x80 : null,
		percussion: byte >= 0xd0 ? byte - 0xd0 : null,
		address: 0,
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
}

console.log("\nthe transport's clock, over songs the compiler will not time");
{
	/** Only the four fields `songClock` reads; the rest is padding. */
	const song = (ticks: number, tempoChanges: TempoChange[] = [], truncated = false): SongTimeline => ({
		notes: [],
		ticks,
		loopTick: null,
		tempoChanges,
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
	// what the compiler said", and a song of no length would disable seeking all
	// over again — which is the bug this whole change is about.
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
	const MAX_EXTRAPOLATION = 0.15; // PianoRoll.MAX_EXTRAPOLATION
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

	// A song the driver keeps up with never had a problem, and must not gain one.
	check(
		"an ordinary song tracks within a couple of ticks",
		drift(105.5, 105.5) < 3,
		`${drift(105.5, 105.5).toFixed(1)}`,
	);

	// 231.2 measured against 498.0 nominal, on the song that prompted this.
	const nominal = drift(231.2, 498.0);
	const measured = drift(231.2, 231.2);
	check("the tempo byte puts it more than a quarter note out", nominal > 48, `${nominal.toFixed(1)} ticks`);
	check("the clock's own rate keeps it within a 32nd", measured < 6, `${measured.toFixed(1)} ticks`);
}

summarise();
