/** `rolltest`: the loop box's ends resize the loop. */

import "../localize";
import { NOTE_MIN } from "@amk/core/hardcoded-tables";
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
import { check } from "../harness";
import {
	apply,
	build,
	type Built,
	type Expectation,
	expectEdit,
	introOf,
	listOf,
	noteAt,
	playable,
	strip,
	tailsOf,
} from "./support";
import { expectLoopEdit, walked, walkedOthers } from "./loops";
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

console.log("\nthe loop box's ends resize the loop");

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

expectEdit(
	"a note dragged up a semitone",
	"#amk 2\n#0 o4 c4 d4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 0, deltaKeys: 1, copy: false }),
	{ contains: "c+4" },
);

// The octave a note was written under is the one in force at it, so an edit that
// stays inside that octave says nothing about octaves at all.
expectEdit(
	"a drag inside the octave writes no octave",
	"#amk 2\n#0 o4 l4 c d e f",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 0, deltaKeys: 2, copy: false }),
	{ contains: "l4 d d e f", lacks: "o4 d" },
);

expectEdit(
	"a note dragged into the next octave, with the octave put back",
	"#amk 2\n#0 o4 c4 d4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 0, deltaKeys: 12, copy: false }),
	{ contains: "o5 c4 o4" },
);

// A unit carrying its own leading `o` is the one shape where `item.octave` is
// not what *enters* the unit — it is what that `o` put in force, and the rewrite
// splices it away. So the two readings agree at 4 here while a `<` sits between
// them, and dropping the `o` as redundant would hand `d+4` and `e4` both to the
// shift. Only `played` sees it: the text reads perfectly either way.
expectEdit(
	"a repitch under a shift keeps the octave its unit carried",
	"#amk 2\n#0 o4 c4 < o4 d4 e4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 1)], deltaTicks: 0, deltaKeys: 1, copy: false }),
	{ text: "#amk 2\n#0 o4 c4 < o4 d+4 e4" },
);

// The mirror of it on the other side of the unit. `exitOctaveFor` answers null
// where the next note will set its own, which says the trailing `o` may go with
// the rewrite — and there is no rewrite where the pitch and length are both
// unchanged, so the `o3` stands and `running` must say 3 rather than `c4`'s own
// 5. Reading it as 5 makes `d4`'s new octave the one already in force, so
// `noteText` spells nothing, `spliceRange` finds the text already there, and the
// drag commits nothing at all. Nothing follows `d4` to read an octave put back
// after it, so none is, and the `o3` it read is left unread and goes.
expectEdit(
	"a note dragged past the octave the note before it left standing",
	"#amk 2\n#0 o5 c4 o3 r4 d4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 1)], deltaTicks: 0, deltaKeys: 24, copy: false }),
	{ text: "#amk 2\n#0 o5 c4 r4 o5 d4" },
);

expectEdit("a note dragged later, taking the time out of the rest after it", "#amk 2\n#0 o4 c4 r4 d4", 0, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 1)],
	deltaTicks: -24,
	deltaKeys: 0,
	copy: false,
}));

expectEdit("a note stretched, pushing the one after it", "#amk 2\n#0 o4 c4 d4 e4", 0, (bar) => ({
	kind: "stretch",
	items: [noteAt(bar, 0)],
	edge: "end",
	deltaTicks: 48,
}));

expectEdit(
	"a note stretched past a whole note, written as a tie",
	"#amk 2\n#0 o4 c4 r1 r1 d4",
	0,
	(bar) => ({ kind: "stretch", items: [noteAt(bar, 0)], edge: "end", deltaTicks: 240 }),
	{ contains: "^" },
);

expectEdit("a note shortened, which lengthens the rest after it", "#amk 2\n#0 o4 c4 r4 d4", 0, (bar) => ({
	kind: "stretch",
	items: [noteAt(bar, 0)],
	edge: "end",
	deltaTicks: -24,
}));

// A unit swallows the `o` written beside its head and the one written after its
// tail (`roll-strip.ts:growUnits`), so removing one removes what put the octave
// in force for every note after it. The octave goes back at the head of the note
// that reads it, and only where the one standing is not already the one wanted —
// which is what this first case pins, since `o4` still stands over `e4`.
expectEdit("a note deleted", "#amk 2\n#0 o4 c4 d4 e4", 0, (bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }), {
	text: "#amk 2\n#0 o4 c4 r4 e4",
});

expectEdit(
	"a note deleted from under the octave the note after it reads",
	"#amk 2\n#1 l8\n@8\ny10\nq4f\n\n r4. o2 a8 d8 o3 d8\n",
	1,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0)] }),
	{ contains: "o2 d8" },
);

// The `o3` here is `c4`'s own trailing octave restore — the `r4` between it and
// `d4` keeps `d4`'s left scan off it — and it is inside `c4`'s unit and goes
// with it.
expectEdit(
	"a note deleted with the octave written after it",
	"#amk 2\n#0 o5 c4 o3 r4 d4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0)] }),
	{ contains: "o3 d4" },
);

// Once, however many notes went: it is the note that reads the octave that asks
// for it, rather than each note that dropped one.
expectEdit(
	"two notes deleted in front of one that reads their octave",
	"#amk 2\n#0 o4 c4 o5 d4 o6 e4 f4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1), noteAt(bar, 2)] }),
	{ contains: "o6 f4", lacks: "o6 o6" },
);

expectEdit(
	"two notes deleted with one left standing between them",
	"#amk 2\n#0 o4 c4 o5 d4 e4 o6 f4 g4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1), noteAt(bar, 3)] }),
	// Each deleted note's `o` is still read by the note after it, so it stays.
	{ text: "#amk 2\n#0 o4 c4 o5 r4 e4 o6 r4 g4" },
);

expectEdit(
	"a note deleted where the note after it writes its own octave",
	"#amk 2\n#0 o4 c4 o5 d4 o3 e4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ lacks: "o5" },
);

// `octave` is global parser state and leaks past a `#N`, so a channel with no
// note left to hand its octave to keeps it where the last unit was — otherwise
// the `f4`s below move down two octaves, which is what "leaves the other
// channels alone" catches. The notes' ticks stay as rest: the channel keeps its
// length.
expectEdit(
	"notes deleted off the end of a channel the block below reads the octave of",
	"#amk 2\n#0 o4 c4 o5 d4 o6 e4\n#1 f4 f4 f4\n",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1), noteAt(bar, 2)] }),
	{ text: "#amk 2\n#0 o4 c4 r2 o6\n#1 f4 f4 f4\n", playsAsLong: true },
);

expectEdit(
	"every note in a channel deleted",
	"#amk 2\n#0 o4 c4 o5 d4 o6 e4\n#1 f4 f4 f4\n",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0), noteAt(bar, 1), noteAt(bar, 2)] }),
	{ text: "#amk 2\n#0 r2. o6\n#1 f4 f4 f4\n", playsAsLong: true },
);

// A song's only note deleted leaves its rest, so the song still compiles and the
// roll can go on editing it.
expectEdit(
	"a song's only note deleted",
	"#amk 2\n#0 o4 c4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0)] }),
	{
		text: "#amk 2\n#0 r4",
		playsAsLong: true,
	},
);

// The shortest channel keeps its length, so the song does not stop early and
// take the other channel's last note with it.
expectEdit(
	"the shortest channel's last note deleted",
	"#amk 2\n#0 o4 c4 d4 e4\n#1 o3 c4 d4 e4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 2)] }),
	{ text: "#amk 2\n#0 o4 c4 d4 r4\n#1 o3 c4 d4 e4", playsAsLong: true },
);

// A gap is realised over **runs** of rests rather than over one rest at a time,
// so a note deleted from between two of them leaves the one rest they now are.
// `note rest note rest` is the commonest shape a channel has, and every case
// here is checked by compiling and walking the result rather than by the text
// alone: `r4.` and `r4 r8` sound identical and only the text tells them apart.
expectEdit(
	"a note deleted from between two rests",
	"#amk 2\n#0 o4 c8 r8 d8 r8 e8",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c8 r4. e8" },
);

// Touching already, and still one rest afterwards: the run is being rewritten
// either way, and leaving `r4 r8` behind is the thing this is for.
expectEdit(
	"two rests already touching in a gap being rewritten",
	"#amk 2\n#0 o4 c8 r8 r8 d8 e8",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c8 r4. e8" },
);

// A run stops at anything read at a tick, and the deleted note becomes rest where
// it stood: the `v200` stays on the tick it ran at, which is where the command
// lane shows it, and the note's rest joins the one after it.
expectEdit(
	"a command written between the two rests",
	"#amk 2\n#0 o4 c8 r8 v200 d8 r8 e8",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c8 r8 v200 r4 e8" },
);

// The intro marker most of all: every channel resumes from its own on each pass
// (`parser.ts:parseIntro`), so a `/` swallowed into a merged rest moves the
// whole song's loop point — which is what `loopsWhereItDid` catches and what
// reading the text could not. One channel, because `loopTick` is the lowest tick
// any channel re-enters at, so a second one marked on the old tick hides a move.
expectEdit(
	"the intro marker written between the two rests",
	"#amk 2\n#0 o4 c8 r8 / d8 r8 e8",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c8 r8 / r4 e8", loopsWhereItDid: true },
);

// A deleted note in front of the marker: its rest stays in front of it.
expectEdit(
	"a note deleted in front of the intro marker",
	"#amk 2\n#0 o4 r4 / e2 c4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0)] }),
	{ text: "#amk 2\n#0 o4 r4 / r2 c4", loopsWhereItDid: true },
);

// And a channel's first note: what was written after it keeps its tick, rather
// than the rest going in behind it and pulling it to the top of the channel.
expectEdit(
	"a channel's first note deleted, with a tempo written after it",
	"#amk 2\n#0 o4 c4 t60 d4 e4\n#1 o4 c4 d4 e4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0)] }),
	{ text: "#amk 2\n#0 o4 r4 t60 d4 e4\n#1 o4 c4 d4 e4" },
);

expectEdit(
	"a channel's first note deleted, with the intro marker after it",
	"#amk 2\n#0 o4 c2 / c2",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0)] }),
	{ text: "#amk 2\n#0 o4 r2 / c2", loopsWhereItDid: true },
);

// Two notes deleted either side of a command: each becomes rest on its own side.
expectEdit(
	"two notes deleted either side of a tempo change",
	"#amk 2\n#0 o4 c4 d4 t80 e4 f4 g4\n#1 o4 c1^4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1), noteAt(bar, 2)] }),
	{ text: "#amk 2\n#0 o4 c4 r4 t80 r4 f4 g4\n#1 o4 c1^4" },
);

// A command the same delete drops is gone, so the rests either side of it are
// one rest.
expectEdit(
	"rests joined across a command the same delete drops",
	"#amk 2\n#0 o4 c4 r4 @3 d4 r4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c4 r2." },
);

// A note deleted from between two touching ones: its rest is spliced where it
// stood, so the spacing around it is the porter's own.
expectEdit(
	"a note deleted from between two it touches",
	"#amk 2\n#0 o4 a1a1a1",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{
		text: "#amk 2\n#0 o4 a1r1a1",
	},
);

// And a gap whose ticks do not change is not rewritten at all, so two rests the
// porter wrote touching are only ever joined by a gesture that had to move them.
expectEdit(
	"two rests the porter wrote touching in a gap that does not move",
	"#amk 2\n#0 o4 c4 r4 r4 d4 e4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 2)], deltaTicks: 48, deltaKeys: 0, copy: false }),
	{ text: "#amk 2\n#0 o4 c4 r4 r4 d4 r4 e4" },
);

// The tail keeps the channel's length, so a note deleted from it is rest where it
// stood, and the rests either side of it are one rest.
expectEdit(
	"the last note deleted from between two trailing rests",
	"#amk 2\n#0 o4 c8 r8 d8 r8\n#1 o4 c2",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c8 r4.\n#1 o4 c2", playsAsLong: true },
);

expectEdit(
	"trailing rests the porter wrote touching",
	"#amk 2\n#0 o4 c8 d8 r8 r8\n#1 o4 c2",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0)] }),
	{ contains: "r8 r8" },
);

// `octave` is global parser state and leaks past a `#N`, so the last note off a
// channel leaves its own `o` where it was, `#1` reading it — which stands between
// the two pieces a merged tail joins, and an `o` among rests says nothing about
// time. `#1` writes no octave of its own, so "leaves the other channels alone" is
// what catches it going astray.
expectEdit(
	"the octave a deleted last note left, across a merged tail",
	"#amk 2\n#0 o4 c8 r8 o5 d8 r8\n#1 c8 c8 c8 c8",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c8 r4. o5\n#1 c8 c8 c8 c8" },
);

// A run comes to one rest however long it is, tied from common lengths where they
// add up (`spellRest`) rather than written as a tick count.
expectEdit(
	"a run of three rests becoming one",
	"#amk 2\n#0 o4 c8 r8 d8 r8 e8 r8 f8",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1), noteAt(bar, 2)] }),
	{ text: "#amk 2\n#0 o4 c8 r2^8 f8" },
);

expectEdit(
	"a merged rest with no single length of its own",
	"#amk 2\n#0 o4 c4 d16 r4 e4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c4 r4^16 e4" },
);

expectEdit("a note drawn into a rest", "#amk 2\n#0 o4 c4 r2 d4", 0, () => ({
	kind: "spawn",
	startTick: 72,
	ticks: 24,
	written: NOTE_MIN + 36 + 4,
	drum: null,
}));

expectEdit("a note drawn at the end of a channel", "#amk 2\n#0 o4 c4 r4", 0, () => ({
	kind: "spawn",
	startTick: 96,
	ticks: 48,
	written: NOTE_MIN + 36 + 7,
	drum: null,
}));

// A note drawn at the octave already standing spells none of its own. What is in
// force is the previous note's own byte, carried over text that moves it nowhere.
expectEdit(
	"a note drawn at the octave already standing",
	"#amk 2\n#0 o4 c4 r2 d4",
	0,
	() => ({ kind: "spawn", startTick: 72, ticks: 24, written: NOTE_MIN + 36 + 4, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 r8 e8 r4 d4" },
);

// And a `>` between the two moves it to the octave the note is drawn at, so the
// note needs none of its own — the octave model reads the `>` exactly. `d4` is
// left alone: the `>` had already put it in the octave the run leaves.
expectEdit(
	"a note drawn past an octave shift written in the gap",
	"#amk 2\n#0 o4 c4 > r2 d4",
	0,
	() => ({ kind: "spawn", startTick: 72, ticks: 24, written: NOTE_MIN + 48 + 4, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 > r8 e8 r4 d4" },
);

// And `O` moves it too: the parser dispatches on the lowercased character
// (`parser.ts:461`, `Music.cpp:445`), so `O5` is an octave command like any
// other and the scan over the gap has to see one. Drawn at the octave the note
// before the gap left standing, which is where missing it spells nothing at all
// and hands the note to the `O5`.
expectEdit(
	"a note drawn past an upper-case octave written in the gap",
	"#amk 2\n#0 o4 c4 r4 O5 r4 d4",
	0,
	() => ({ kind: "spawn", startTick: 96, ticks: 24, written: NOTE_MIN + 36 + 4, drum: null }),
	{ contains: "o4 e8" },
);

// A run leaves its own octave standing, so the note that reads it is handed the
// one it was written under — at its own head, where the text settles anyway.
// The whole channel below would move with the drawn note otherwise.
expectEdit(
	"a note drawn an octave above the one after it",
	"#amk 2\n#0 o4 c4 r2 d4",
	0,
	() => ({ kind: "spawn", startTick: 72, ticks: 24, written: NOTE_MIN + 48, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 r8 o5 c8 r4 o4 d4" },
);

// With a `>` between the run and that note, the octave goes back straight after
// the run instead, as the original had it there, so the `>` still does its job
// rather than being left in front of an `o` that undoes it.
expectEdit(
	"a note drawn an octave above, before an octave shift",
	"#amk 2\n#0 o4 c4 r2 > d4",
	0,
	() => ({ kind: "spawn", startTick: 72, ticks: 24, written: NOTE_MIN + 48, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 r8 o5 c8 o4 r4 > d4" },
);

// A loop's body is parsed where it is written, so it reads the octave standing in
// front of it: a note drawn before the `[` puts that octave back, and the `o2` the
// porter wrote in front of the rest, now unread, goes.
expectLoopEdit(
	"a note drawn in front of a loop",
	"#amk 2\n#0 o2 r1 [c8 d8]2 e4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 96, written: NOTE_MIN + 24 + 2, drum: null }),
	"0+96:$9a 192+24:$8c 216+24:$8e 240+24:$8c 264+24:$8e 288+48:$90",
	{ mode: "overwrite", contains: "#0 o3 d2 r2 o2 [c8 d8]2 e4" },
);

// Unless the body sets its own first, and then nothing is put back — and the
// `o4` nothing read, left standing in front of the drawn note's `o3`, goes.
expectLoopEdit(
	"a note drawn in front of a loop that sets its own octave",
	"#amk 2\n#0 o4 r1 [o5 c8 d8]2 e4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 96, written: NOTE_MIN + 24 + 2, drum: null }),
	"0+96:$9a 192+24:$b0 216+24:$b2 240+24:$b0 264+24:$b2 288+48:$b4",
	{ mode: "overwrite", contains: "#0 o3 d2 r2 [o5 c8 d8]2 e4" },
);

expectEdit(
	"a note drawn an octave above one that sets its own",
	"#amk 2\n#0 o4 c4 r2 o5 d4",
	0,
	() => ({ kind: "spawn", startTick: 72, ticks: 24, written: NOTE_MIN + 48, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 r8 o5 c8 r4 o5 d4" },
);

// Nothing between the two notes to write over, so the run is inserted at the
// head of the one it is drawn in front of and the octave lands on the same
// offset, which `coalesce` joins in the order the two were read.
expectEdit(
	"a note drawn an octave above, straight in front of another",
	"#amk 2\n#0 o4 c4 d4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 48, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 o5 c4 o4 d4" },
);

// `octave` is global parser state and leaks past a `#N`, so a run with no note
// left to hand it to carries it itself — which `#1`, whose notes write no octave
// of their own, is what catches.
expectEdit(
	"a note drawn an octave above at the end of a channel",
	"#amk 2\n#0 o4 c4 r4\n#1 c4 c4 c4 c4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 48, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 o5 c4 o4\n#1 c4 c4 c4 c4" },
);

// A drum's lane is its instrument and it writes no octave at all, so there is
// nothing standing for the note after it to be given back.
expectEdit(
	"a drum drawn in front of another",
	"#amk 2\n#6 @21 c8 r8 @22 c8",
	6,
	() => ({ kind: "spawn", startTick: 24, ticks: 24, written: NOTE_MIN + 48, drum: 23 }),
	{ lacks: "o" },
);

expectEdit("a drum moved to another lane", "#amk 2\n#6 @21 c8 @22 c8", 6, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 0)],
	deltaTicks: 0,
	deltaKeys: 0,
	copy: false,
}));

// `leadsAUnit` takes an `o` and a percussion `@` alike, so a drum's unit reaches
// back over its `@` and on to the octave in front of it — and a drum is written
// `@21 c<length>`, which has nowhere to put one. The octave has to survive the
// rewrite anyway: it is what the notes after the drum are standing in.
expectEdit(
	"a drum rewritten under an octave its unit reached back over",
	"#amk 2\n#0 o5 c4 o3 @21 c4 d4",
	0,
	(bar) => ({ kind: "stretch", items: [noteAt(bar, 1)], edge: "end", deltaTicks: 24 }),
	{ text: "#amk 2\n#0 o5 c4 o3 @21 c4. d4" },
);

expectEdit(
	"a mid-note ramp keeps its place when the note is stretched",
	"#amk 2\n#0 o4 c4 v200 ^8 r4 d4",
	0,
	(bar) => ({ kind: "stretch", items: [noteAt(bar, 0)], edge: "end", deltaTicks: 24 }),
	{ contains: "v200" },
);

expectEdit(
	"a pitch drag does not spell a length in",
	"#amk 2\n#0 o4 l4 c d",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 0, deltaKeys: 2, copy: false }),
	{ contains: "d d", lacks: "d4 d" },
);
