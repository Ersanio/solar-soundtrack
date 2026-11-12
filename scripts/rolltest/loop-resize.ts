/** `rolltest`: the loop box's ends resize the loop. */

import "../localize";
import {
	type EditContext,
	isEdits,
	type PassShift,
	passShiftsFor,
	REFUSE_LOOP_BODY_ROOM,
	REFUSE_LOOP_LEAD_ROOM,
	REFUSE_LOOP_LEFT_PASS,
	REFUSE_NESTED_LOOP,
	shiftBoundariesFor,
} from "../../web/src/app/editor/views/piano-roll/roll-edit";
import {
	bodyRests,
	firstPassOn,
	passesAt,
	resizeLoop,
} from "../../web/src/app/editor/views/piano-roll/roll-write/loop-edits";
import type { Strip, StripFrame } from "../../web/src/app/editor/views/piano-roll/roll-strip";
import { check, section } from "../harness";
import { apply, build, type Built, type Expectation, introOf, listOf, playable, strip, tailsOf } from "./support";
import { walked, walkedOthers } from "./loops";
import { grabEdge } from "./loop-edge-gap";

// --- the loop box's ends resize the loop --------------------------------------
//
// Dragging an end changes the body's own length: a rest goes on at the end that
// was pulled, or that end's rests come off. What separates the two ends is who
// pays — the right end adds the ticks to the song, where the left end takes them
// out of the rests in front of the construct and pulls it back by the same
// amount, so the first pass plays exactly where it played and only the passes
// behind it move. `resizeLoop` is the whole write; `bodyRests` prices what a
// shrink may take, `gapSlack` what a leftward grow may eat, and
// `shiftBoundariesFor` is the same asymmetry as the boundaries the preview
// slides on.

section("the loop box's ends resize the loop");

/** `expectResize`'s own bag: a body edit may move another channel that plays it. */
interface ResizeExpectation extends Expectation {
	/** The other channels' walk afterwards. Unchanged where it is not given. */
	others?: string;
}

/**
 * The end dragged: the body whose pass starts at `grab` grown or shrunk by
 * `delta` ticks at `edge`, written by `resizeLoop`, applied, recompiled, and
 * held to `plays` — the edited voice's whole walk.
 */
function expectResize(
	name: string,
	source: string,
	channel: number,
	grab: number,
	edge: "start" | "end",
	delta: number,
	plays: string,
	expectation: ResizeExpectation = {},
): void {
	const held = grabResize(name, source, channel, grab);
	if (!held) {
		return;
	}

	const outcome = resizeLoop(held.context, held.item, held.body, grab, edge, delta);
	if (!isEdits(outcome)) {
		check(`${name}: the resize can be written`, false, outcome.refused);
		return;
	}

	let after: string;
	try {
		after = apply(source, outcome);
	} catch (error) {
		check(`${name}: the edits apply`, false, String(error));
		return;
	}

	const rebuilt = build(after);
	if (typeof rebuilt === "string") {
		check(`${name}: the result compiles`, false, `${rebuilt}\n        ${JSON.stringify(after)}`);
		return;
	}

	const again = strip(after, rebuilt, channel);
	check(
		`${name}: the result still frames`,
		typeof again !== "string",
		typeof again === "string" ? `${again}\n        ${JSON.stringify(after)}` : "",
	);

	check(
		`${name}: every pass plays as asked`,
		walked(rebuilt, channel) === plays,
		`want ${plays}\n        got  ${walked(rebuilt, channel)}\n        text ${JSON.stringify(after)}`,
	);

	// A body a second voice plays moves that voice too, by its own passes — which
	// is the one thing a same-channel case cannot show, so it is spelled out
	// rather than merely allowed.
	const beside = expectation.others ?? walkedOthers(held.before, channel);
	check(
		`${name}: the other channels play as asked`,
		walkedOthers(rebuilt, channel) === beside,
		`want ${beside}\n        got  ${walkedOthers(rebuilt, channel)}`,
	);

	if (expectation.playsFor !== undefined) {
		check(
			`${name}: plays for ${expectation.playsFor} ticks`,
			playable(rebuilt) === expectation.playsFor,
			`${playable(held.before)} -> ${playable(rebuilt)} ticks`,
		);
	}

	if (expectation.loopsWhereItDid) {
		check(
			`${name}: loops where it did`,
			held.before.timeline.loopTick === rebuilt.timeline.loopTick,
			`${held.before.timeline.loopTick} -> ${rebuilt.timeline.loopTick}`,
		);
	}

	for (const wanted of listOf(expectation.contains)) {
		check(`${name}: writes ${wanted}`, after.includes(wanted), JSON.stringify(after));
	}

	for (const unwanted of listOf(expectation.lacks)) {
		check(`${name}: does not write ${unwanted}`, !after.includes(unwanted), JSON.stringify(after));
	}
}

/** The end drag `resizeLoop` turns away, in the sentence it must give. */
function expectResizeRefusal(
	name: string,
	source: string,
	channel: number,
	grab: number,
	edge: "start" | "end",
	delta: number,
	refusal: string,
): void {
	const held = grabResize(name, source, channel, grab);
	if (!held) {
		return;
	}

	const outcome = resizeLoop(held.context, held.item, held.body, grab, edge, delta);
	check(
		`${name}: refused as "${refusal}"`,
		!isEdits(outcome) && outcome.refused === refusal,
		isEdits(outcome) ? "was written" : outcome.refused,
	);
}

/** The press's resolution again, plus the body frame a resize writes into. */
function grabResize(
	name: string,
	source: string,
	channel: number,
	grab: number,
): { before: Built; bar: Strip; context: EditContext; item: number; body: StripFrame } | null {
	const before = build(source);
	if (typeof before === "string") {
		check(`${name}: compiles to begin with`, false, before);
		return null;
	}

	const bar = strip(source, before, channel);
	if (typeof bar === "string") {
		check(`${name}: the channel can be edited`, false, bar);
		return null;
	}

	const found = grabEdge(bar, grab);
	const body = found ? bar.frames.find((each) => each.body === bar.items[found.item].address) : null;
	if (!found || !body) {
		check(`${name}: the grabbed pass names a construct`, false, `nothing starts a pass at ${grab}`);
		return null;
	}

	return {
		before,
		bar,
		item: found.item,
		body,
		context: {
			source,
			strip: bar,
			targetAMKVersion: before.result.stats?.targetAMKVersion ?? 4,
			songTargetProgram: before.result.stats?.songTargetProgram ?? 0,
			playableTicks: playable(before),
			introTicks: introOf(before),
			channels: tailsOf(source, before),
			frame: bar.frames[0],
			inForce: before.inForce,
		},
	};
}

// The pair the whole section turns on: one song, one delta, both ends. The right
// end puts the ticks on the body's tail and the voice's end moves by count ×
// delta; the left end puts them at its head, pays for them out of the `r4` in
// front, and moves the end by one delta less — with the first pass's own note
// standing exactly where it stood.
expectResize(
	"a right end grown",
	"#amk 2\n#0 o4 r4 [c4]3 d4",
	0,
	48,
	"end",
	48,
	"48+48:$a4 144+48:$a4 240+48:$a4 336+48:$a6",
	{
		contains: "[c4 r4]3",
		playsFor: 384,
	},
);

expectResize(
	"a left end grown, the first pass standing still",
	"#amk 2\n#0 o4 r4 [c4]3 d4",
	0,
	48,
	"start",
	48,
	"48+48:$a4 144+48:$a4 240+48:$a4 288+48:$a6",
	{ contains: "[r4 c4]3", lacks: "r4 [", playsFor: 336 },
);

// The headline shrink: a body's trailing rest is the one stretch no *note*
// gesture may rewrite — a channel ends where its music ends — and the one this
// gesture exists to reach. It stays a loop, five copies of `a1` being what the
// roll refuses to write.
expectResize(
	"a body's trailing rest taken off by the right end",
	"#amk 4\n#0 o4 [a1 r1]5",
	0,
	0,
	"end",
	-192,
	"0+192:$ad 192+192:$ad 384+192:$ad 576+192:$ad 768+192:$ad",
	{
		contains: "[a1]5",
		lacks: "r1",
		playsFor: 960,
	},
);

// A one-channel song, which is the only reading that catches a marker landing on
// the wrong tick: `loopTick` is the lowest tick any channel re-enters at, so a
// second channel would hold it down. The `/` stands in front of the construct
// and keeps its own tick while the rests behind it are eaten.
expectResize(
	"a left end grown past the intro marker",
	"#amk 2\n#0 o4 c4 / r4 [d4]3 e4",
	0,
	96,
	"start",
	48,
	"0+48:$a4 96+48:$a6 192+48:$a6 288+48:$a6 336+48:$a8",
	{ contains: "/ [r4 d4]3", loopsWhereItDid: true, playsFor: 384 },
);

// A rest one note short reads exactly like a rest of the right length, so only
// `playsFor` catches the pad.
expectResize(
	"a right grow past the end of the song pads the other channel",
	"#amk 2\n#0 o4 [c4]2\n#1 o4 c2",
	0,
	0,
	"end",
	48,
	"0+48:$a4 96+48:$a4",
	{
		contains: "r2",
		playsFor: 192,
	},
);

// A body two voices play, grown from the recalling end: each voice's music moves
// by its **own** passes, which is what `grown` is a map for.
expectResize(
	"a cross-channel body grown from the recalling channel",
	"#amk 2\n#0 o4 (1)[c4 d4] e4\n#1 o4 (1)2",
	1,
	0,
	"end",
	48,
	"0+48:$a4 48+48:$a6 144+48:$a4 192+48:$a6",
	{ contains: "r4", others: "0+48:$a4 48+48:$a6 144+48:$a8 |  |  |  |  |  | ", playsFor: 288 },
);

// The rest comes out of the brackets and goes in front of them, which is the
// left grow's own edits run backwards.
expectResize(
	"a left end shrunk, the first pass standing still",
	"#amk 2\n#0 o4 [r4 c4]2 d4",
	0,
	0,
	"start",
	-48,
	"48+48:$a4 96+48:$a4 144+48:$a6",
	{
		contains: ["r4 [", "c4]2"],
		lacks: "r4 c4",
		playsFor: 192,
	},
);

// A subloop cannot be split past its first pass, having no name to call it back
// by — and its body still resizes, which is a different question.
expectResize("a subloop's right end", "#amk 2\n#0 o4 [[c4 r4]]2 d4", 0, 0, "end", -48, "0+48:$a4 48+48:$a4 96+48:$a6", {
	contains: "[[c4]]2",
	playsFor: 144,
});

// A construct inside another body has no song-time position to move, which is
// what refuses its left end — its right end is a plain body-length change, and
// stretching the note at that end already writes one.
expectResize(
	"a nested body's right end",
	"#amk 2\n#0 o4 [c4 [[d4 r4]]2 e4]2",
	0,
	48,
	"end",
	-48,
	"0+48:$a4 48+48:$a6 96+48:$a6 144+48:$a8 192+48:$a4 240+48:$a6 288+48:$a6 336+48:$a8",
	{ contains: "[[d4]]2", playsFor: 384 },
);

expectResizeRefusal(
	"a right end with no rest to take from",
	"#amk 2\n#0 o4 [c4 d4]2",
	0,
	0,
	"end",
	-48,
	REFUSE_LOOP_BODY_ROOM,
);
expectResizeRefusal(
	"a command past the body's last rest",
	"#amk 2\n#0 o4 [c4 r4 v200]2 d4",
	0,
	0,
	"end",
	-48,
	REFUSE_LOOP_BODY_ROOM,
);
expectResizeRefusal(
	"a left end with nothing in front of it",
	"#amk 2\n#0 o4 [c4 d4]2",
	0,
	0,
	"start",
	48,
	REFUSE_LOOP_LEAD_ROOM,
);
expectResizeRefusal("a later pass's left end", "#amk 2\n#0 o4 r4 [c4]3", 0, 96, "start", 48, REFUSE_LOOP_LEFT_PASS);
expectResizeRefusal(
	"a later occurrence's left end",
	"#amk 2\n#0 o4 r4 (1)[c4] r4 (1)2",
	0,
	144,
	"start",
	48,
	REFUSE_LOOP_LEFT_PASS,
);
expectResizeRefusal(
	"a nested box's left end",
	"#amk 2\n#0 o4 [c4 [[d4]]2 e4]2",
	0,
	48,
	"start",
	48,
	REFUSE_NESTED_LOOP,
);

// Where a pass stands among its voice's own, which decides two things the press
// cannot read off one box: how far its far end travels per tick the body gains,
// and whether the edge it was grabbed by is a seam two passes share.
{
	const source = "#amk 2\n#0 o4 r4 (1)[c4] r4 (1)2";
	const before = build(source);
	const bar = typeof before === "string" ? "no build" : strip(source, before, 0);
	if (typeof before === "string" || typeof bar === "string") {
		check("the passes at a tick: builds", false, typeof bar === "string" ? bar : "");
	} else {
		const body = bar.frames.find((each) => each.body >= 0)!;
		const spell = (tick: number) => {
			const at = passesAt(body, 0, tick);
			return `${at.before}${at.abuts ? " abuts" : ""}`;
		};

		// `(1)[c4]` at 48, then a rest, then `(1)2` at 144 and 192.
		check("the first occurrence stands on nothing", spell(48) === "0", spell(48));
		check("a later occurrence with a rest in front of it is no seam", spell(144) === "1", spell(144));
		check("but its own second pass is one", spell(192) === "2 abuts", spell(192));
	}
}

// What a shrink may take at each end, priced the way `gapSlack` prices the rests
// in front of a construct — and what stops the walk: a command past the body's
// last rest runs after them, so their length is not free to change.
{
	const source = "#amk 2\n#0 o4 [r8 c4 r4 v200]2 d4";
	const before = build(source);
	const bar = typeof before === "string" ? "no build" : strip(source, before, 0);
	if (typeof before === "string" || typeof bar === "string") {
		check("the body's rests: builds", false, typeof bar === "string" ? bar : "");
	} else {
		const body = bar.frames[1];
		check(
			"the body's leading rest is free",
			bodyRests(bar, body, "start").ticks === 24,
			`${bodyRests(bar, body, "start").ticks}`,
		);
		check(
			"a command past its trailing rest is a barrier",
			bodyRests(bar, body, "end").ticks === 0,
			`${bodyRests(bar, body, "end").ticks}`,
		);
		check(
			"the voice's first entry is where the construct stands",
			firstPassOn(body, 0) === 0,
			`${firstPassOn(body, 0)}`,
		);
	}
}

/** The same for the pass shifts the boxes take: `channel@tick:steps`. */
function spelledShifts(shifts: readonly PassShift[]): string {
	return [...shifts]
		.sort((a, b) => a.channel - b.channel || a.tick - b.tick)
		.map((shift) => `${shift.channel}@${shift.tick}+${shift.ticks}:${shift.steps}`)
		.join(" ");
}

/** A boundary map, spelled so a check can read it. */
function spelledBounds(bounds: ReadonlyMap<number, readonly number[]>): string {
	return [...bounds]
		.sort((a, b) => a[0] - b[0])
		.map(([channel, ticks]) => `${channel}:${ticks.join(",")}`)
		.join(" ");
}

// The one piece of a resize no walk can catch: on the grabbed channel the notes
// land in the same place under either list, and only the boundary says which
// voice's tail moves by how much. A tail change steps at each pass **end**; a
// head change steps at each pass **start**, less the grabbed occurrence's own,
// its construct having been pulled back by that delta.
{
	const source = "#amk 2\n#0 o4 (1)[c4] e4\n#1 o4 (1)2";
	const before = build(source);
	const bar = typeof before === "string" ? "no build" : strip(source, before, 0);
	if (typeof before === "string" || typeof bar === "string") {
		check("the shift boundaries: builds", false, typeof bar === "string" ? bar : "");
	} else {
		const body = bar.frames[1];
		check(
			"a tail change steps at each pass end",
			spelledBounds(shiftBoundariesFor(body, "end", null)) === "0:48 1:48,96",
			spelledBounds(shiftBoundariesFor(body, "end", null)),
		);
		check(
			"a head change steps at each pass start, less the grabbed one",
			spelledBounds(shiftBoundariesFor(body, "start", { channel: 0, tick: 0 })) === "0: 1:0,48",
			spelledBounds(shiftBoundariesFor(body, "start", { channel: 0, tick: 0 })),
		);
		check(
			"and a voice with no construct moved keeps every pass start",
			spelledBounds(shiftBoundariesFor(body, "start", { channel: 1, tick: 0 })) === "0:0 1:48",
			spelledBounds(shiftBoundariesFor(body, "start", { channel: 1, tick: 0 })),
		);

		// And the same change for the **boxes** drawn on those passes, which the
		// boundary list above cannot place: a pass's edges are the boundaries
		// themselves, so a head change comes out a whole delta too far right
		// there. Invisible in a screenshot, and the difference between a loop
		// box that grows leftward under the pointer and one that runs away from
		// it.
		check(
			"a tail change moves each pass by its own voice's passes in front of it",
			spelledShifts(passShiftsFor(body, "end", null)) === "0@0+48:0 1@0+48:0 1@48+48:1",
			spelledShifts(passShiftsFor(body, "end", null)),
		);
		check(
			"a head change pulls the grabbed voice's construct back by one delta",
			spelledShifts(passShiftsFor(body, "start", { channel: 0, tick: 0 })) === "0@0+48:-1 1@0+48:0 1@48+48:1",
			spelledShifts(passShiftsFor(body, "start", { channel: 0, tick: 0 })),
		);
		check(
			"and leaves a voice whose construct did not move counting from its first pass",
			spelledShifts(passShiftsFor(body, "start", { channel: 1, tick: 0 })) === "0@0+48:0 1@0+48:-1 1@48+48:0",
			spelledShifts(passShiftsFor(body, "start", { channel: 1, tick: 0 })),
		);
	}
}

// A body that can really be resized from its left end: rests in front of the
// construct to pull it back into, and a rest at the body's head to give up. The
// case above has neither, so the clamp never lets it reach the `-1` step the
// boxes turn on.
{
	const source = "#amk 2\n#0 o4 r4 (1)[r8 c8 d4]3";
	const before = build(source);
	const bar = typeof before === "string" ? "no build" : strip(source, before, 0);
	if (typeof before === "string" || typeof bar === "string") {
		check("the left-end pass shifts: builds", false, typeof bar === "string" ? bar : "");
	} else {
		const body = bar.frames[1];
		check(
			"a head change counts every pass of the grabbed voice from one before its own",
			spelledShifts(passShiftsFor(body, "start", { channel: 0, tick: 48 })) === "0@48+96:-1 0@144+96:0 0@240+96:1",
			spelledShifts(passShiftsFor(body, "start", { channel: 0, tick: 48 })),
		);
		// The two lists agree about the marks and differ only about the boxes:
		// the notes inside pass `j` really do move by `j` deltas, and the pass
		// holding them begins one delta before that.
		check(
			"where the marks' own list steps at each pass start but the grabbed one",
			spelledBounds(shiftBoundariesFor(body, "start", { channel: 0, tick: 48 })) === "0:144,240",
			spelledBounds(shiftBoundariesFor(body, "start", { channel: 0, tick: 48 })),
		);
	}
}

// The `(n)` a construct is written with, read once so the label the roll draws
// and the head `openGap` writes a split with cannot disagree.
{
	for (const [source, want] of [
		["#amk 2\n#0 o4 (1)[c4]2 (1)3", "1 1"],
		["#amk 2\n#0 o4 [c4]2 *3", "null null"],
		["#amk 2\n#0 o4 [[c4]]2 d4", "null"],
	] as const) {
		const before = build(source);
		const bar = typeof before === "string" ? "no build" : strip(source, before, 0);
		if (typeof before === "string" || typeof bar === "string") {
			check(`a loop's label: ${source} builds`, false, typeof bar === "string" ? bar : "");
			continue;
		}

		const got = bar.items
			.filter((item) => item.kind === "construct")
			.map((item) => String(item.loop?.label ?? null))
			.join(" ");
		check(`a loop's label: ${JSON.stringify(source)}`, got === want, `want ${want}, got ${got}`);
	}
}
