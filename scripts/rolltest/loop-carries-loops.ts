/** `rolltest`: a loop carries the loops written inside it. */

import "../localize";
import {
	type EditContext,
	type Gesture,
	isEdits,
	planFrames,
	planGesture,
	REFUSE_RANGE,
	REFUSE_SPLIT,
	spansFrames,
} from "../../web/src/app/editor/views/piano-roll/roll-edit";
import { planEdits, planGroupEdits } from "../../web/src/app/editor/views/piano-roll/roll-write/plan-edits";
import { framesInside, type Strip, type StripFrame } from "../../web/src/app/editor/views/piano-roll/roll-strip";
import { check } from "../harness";
import { apply, build, expectRefused, introOf, noteAt, playable, strip, tailsOf } from "./support";
import { expectLoopEdit, walked } from "./loops";

// --- a loop carries the loops written inside it -------------------------------
//
// A loop box's rule transposes the body, and a loop written between those
// brackets plays only where this one plays — so it is part of the same group and
// moves with it. The group is widened at the press (`framesInside`), planned once
// per frame (`planFrames`) and written as one commit (`planGroupEdits`); only a
// gesture that moves no tick may do it, a frame's ticks being its own.

/** The playable note indices of a frame — the scan the press makes. */
export function notesIn(bar: Strip, frame: StripFrame): number[] {
	const found: number[] = [];
	for (let index = frame.from; index < frame.to; index++) {
		const item = bar.items[index];
		if (item.kind === "note" && item.instances.length > 0) {
			found.push(index);
		}
	}

	return found;
}

/** The group a press on a body's box installs: its notes and every nested body's. */
function bodyGroup(bar: Strip, body: number): number[] {
	const frame = bar.frames.find((each) => each.body === body) ?? bar.frames[0];
	return [frame, ...framesInside(bar, frame)].flatMap((each) => notesIn(bar, each));
}

check(
	"only a gesture that moves no tick may span frames",
	spansFrames({ kind: "delete", items: [] }) &&
		spansFrames({ kind: "move", items: [], deltaTicks: 0, deltaKeys: 7, copy: false }) &&
		!spansFrames({ kind: "move", items: [], deltaTicks: 48, deltaKeys: 0, copy: false }) &&
		!spansFrames({ kind: "stretch", items: [], edge: "end", deltaTicks: 24 }),
);

// A subloop inside a loop. `+5` keeps every result a natural, so the text can be
// pinned exactly; the body is 192 ticks and plays three times.
expectLoopEdit(
	"a loop transposed carries the subloop written inside it",
	"#amk 2\n#0 o4 [ c4 [[d4]]2 e4 ]3",
	0,
	(bar) => ({
		kind: "move",
		items: bodyGroup(bar, bar.frames[1].body),
		deltaTicks: 0,
		deltaKeys: 5,
		copy: false,
	}),
	"0+48:$a9 48+48:$ab 96+48:$ab 144+48:$ad 192+48:$a9 240+48:$ab 288+48:$ab 336+48:$ad 384+48:$a9 432+48:$ab 480+48:$ab 528+48:$ad",
	{ contains: "[ f4 [[g4]]2 a4 ]3", playsAsLong: true },
);

// The other nesting direction, which the parser allows — `parseLoopStart`
// refuses a `[` only on channel 8, and the driver's `$E9` call frame and `$E6`
// sub frame are separate registers. What is inside what is a fact about the
// text, so the frames read it the same way round. The body is 144 ticks.
expectLoopEdit(
	"a subloop transposed carries the loop written inside it",
	"#amk 2\n#0 o4 [[ c4 [ d4 ]2 ]]3",
	0,
	(bar) => ({
		kind: "move",
		items: bodyGroup(bar, bar.frames[1].body),
		deltaTicks: 0,
		deltaKeys: 5,
		copy: false,
	}),
	"0+48:$a9 48+48:$ab 96+48:$ab 144+48:$a9 192+48:$ab 240+48:$ab 288+48:$a9 336+48:$ab 384+48:$ab",
	{ contains: "[[ f4 [ g4 ]2 ]]3", playsAsLong: true },
);

// The inner box grabbed instead: its own group and nothing above it.
expectLoopEdit(
	"and the inner box moves only its own body",
	"#amk 2\n#0 o4 [ c4 [[d4]]2 e4 ]3",
	0,
	(bar) => ({
		kind: "move",
		items: bodyGroup(bar, bar.frames[2].body),
		deltaTicks: 0,
		deltaKeys: 5,
		copy: false,
	}),
	"0+48:$a4 48+48:$ab 96+48:$ab 144+48:$a8 192+48:$a4 240+48:$ab 288+48:$ab 336+48:$a8 384+48:$a4 432+48:$ab 480+48:$ab 528+48:$a8",
	{ contains: "[ c4 [[g4]]2 e4 ]3", playsAsLong: true },
);

// Span containment and not a walk of construct addresses: the `(1)2` written
// inside the subloop plays a body declared **outside** it, whose text sounds in
// other places in the song as well. `framesInside` does not name it, so the
// group does not hold `c4` and the transpose leaves it exactly where it was.
{
	const source = "#amk 2\n#0 o4 (1)[ c4 ]2 [[ d4 (1)2 ]]3";
	const before = build(source);
	const bar = typeof before === "string" ? before : strip(source, before, 0);
	check(
		"a body merely called from inside another is not inside it",
		typeof bar !== "string" && framesInside(bar, bar.frames[1]).length === 0,
		typeof bar === "string" ? bar : JSON.stringify(bar.frames.map((each) => each.span)),
	);
}

expectLoopEdit(
	"and a transpose leaves that called body alone",
	"#amk 2\n#0 o4 (1)[ c4 ]2 [[ d4 (1)2 ]]3",
	0,
	(bar) => ({
		kind: "move",
		items: bodyGroup(bar, bar.frames[1].body),
		deltaTicks: 0,
		deltaKeys: 5,
		copy: false,
	}),
	"0+48:$a4 48+48:$a4 96+48:$ab 144+48:$a4 192+48:$a4 240+48:$ab 288+48:$a4 336+48:$a4 384+48:$ab 432+48:$a4 480+48:$a4",
	{ contains: ["(1)[ c4 ]2", "[[ g4 (1)2 ]]3"], playsAsLong: true },
);

// The pad belongs to the gesture and not to either frame: both reach past `#1`'s
// 384 ticks — the outer to 576 and the subloop to 528 — and two frames each
// padding `#1` out to their own reach writes the rest twice, `coalesce` running
// inside a plan rather than across them. `playsFor` cannot see it: an over-padded
// `#1` stops being the shortest channel and the song's figure does not move. Its
// own tick count is the reading, and a rest of the wrong length reads exactly
// like a rest of the right one in the text.
expectLoopEdit(
	"a nested transpose pads the song once, not once per frame",
	"#amk 2\n#0 o4 [ c4 [[d4]]2 e4 ]3\n#1 o4 g1 g1",
	0,
	(bar) => ({
		kind: "move",
		items: bodyGroup(bar, bar.frames[1].body),
		deltaTicks: 0,
		deltaKeys: 5,
		copy: false,
	}),
	"0+48:$a9 48+48:$ab 96+48:$ab 144+48:$ad 192+48:$a9 240+48:$ab 288+48:$ab 336+48:$ad 384+48:$a9 432+48:$ab 480+48:$ab 528+48:$ad",
	{ contains: "[ f4 [[g4]]2 a4 ]3", playsFor: 576, channelTicks: [1, 576] },
);

// A group spanning frames is only allowed to move where it moves no tick.
expectRefused(
	"a widened loop group dragged sideways",
	"#amk 2\n#0 o4 [ c4 [[d4]]2 e4 ]3",
	0,
	(bar) => ({
		kind: "move",
		items: bodyGroup(bar, bar.frames[1].body),
		deltaTicks: 48,
		deltaKeys: 0,
		copy: false,
	}),
	"insert",
	REFUSE_SPLIT,
);

// One frame refused refuses the lot: `o6 a` is `$C5`, the top byte the driver
// plays, so a semitone up is out of range for the subloop's frame and fine for
// the outer one — and the outer frame's edits are thrown away with the rest.
{
	const source = "#amk 2\n#0 o4 [ c4 [[ o6 a4 ]]2 ]3";
	const before = build(source);
	const bar = typeof before === "string" ? before : strip(source, before, 0);
	if (typeof before === "string" || typeof bar === "string") {
		check("a group with one frame out of range: builds", false, typeof bar === "string" ? bar : "no build");
	} else {
		const outcome = planGroupEdits(
			{
				source,
				strip: bar,
				targetAMKVersion: before.result.stats?.targetAMKVersion ?? 4,
				songTargetProgram: before.result.stats?.songTargetProgram ?? 0,
				playableTicks: playable(before),
				introTicks: introOf(before),
				channels: tailsOf(source, before),
				frame: bar.frames[1],
				inForce: before.inForce,
			},
			planFrames(
				bar,
				{
					kind: "move",
					items: bodyGroup(bar, bar.frames[1].body),
					deltaTicks: 0,
					deltaKeys: 1,
					copy: false,
				},
				"insert",
				1,
			),
		);
		check(
			"one frame out of range refuses the whole group",
			!isEdits(outcome) && outcome.refused === REFUSE_RANGE,
			isEdits(outcome) ? `wrote ${outcome.length} edits` : outcome.refused,
		);
	}
}

// Cross-channel: a `(n)` declared on one channel and recalled from another is
// one body both voices play, and an edit from either end rewrites it for both.
// The helper's one-channel oracle cannot say that, so both walks are pinned by
// hand here.
{
	const cross = (
		name: string,
		channel: number,
		gesture: (bar: Strip) => Gesture,
		wantZero: string,
		wantOne: string,
		contains: string,
	): void => {
		const source = "#amk 2\n#0 o4 (1)[c4 d4]2 e4\n#1 o4 (1)3 f4";
		const before = build(source);
		const bar = typeof before === "string" ? "no build" : strip(source, before, channel);
		if (typeof before === "string" || typeof bar === "string") {
			check(`${name}: builds`, false, typeof bar === "string" ? bar : "");
			return;
		}

		const made = gesture(bar);
		const first = "items" in made && made.items.length > 0 ? made.items[0] : undefined;
		const frame = bar.frames[first !== undefined ? (bar.items[first]?.frame ?? 0) : 0];
		const context: EditContext = {
			source,
			strip: bar,
			targetAMKVersion: before.result.stats?.targetAMKVersion ?? 4,
			songTargetProgram: before.result.stats?.songTargetProgram ?? 0,
			playableTicks: playable(before),
			introTicks: introOf(before),
			channels: tailsOf(source, before),
			frame,
			inForce: before.inForce,
		};
		const outcome = planEdits(context, planGesture(bar, made, "insert", frame));
		if (!isEdits(outcome)) {
			check(`${name}: writes`, false, outcome.refused);
			return;
		}

		const after = apply(source, outcome);
		const rebuilt = build(after);
		if (typeof rebuilt === "string") {
			check(`${name}: recompiles`, false, `${rebuilt} ${JSON.stringify(after)}`);
			return;
		}

		check(`${name}: writes ${contains}`, after.includes(contains), JSON.stringify(after));
		check(
			`${name}: both voices play the change`,
			walked(rebuilt, 0) === wantZero && walked(rebuilt, 1) === wantOne,
			`#0 ${walked(rebuilt, 0)}\n        #1 ${walked(rebuilt, 1)}\n        text ${JSON.stringify(after)}`,
		);
	};

	// From the recalling channel: the strip's body frame is #0's text, and the
	// splice lands there. The moved note's furthest pass — #1's third — was past
	// the cut, and a moved instance is made audible: #0 is padded out to it, the
	// same reading a root note moved in a long channel's tail gets.
	cross(
		"a body edited from the channel that recalls it",
		1,
		(bar) => ({ kind: "move", items: [noteAt(bar, 2)], deltaTicks: 0, deltaKeys: 2, copy: false }),
		"0+48:$a4 48+48:$a8 96+48:$a4 144+48:$a8 192+48:$a8",
		"0+48:$a4 48+48:$a8 96+48:$a4 144+48:$a8 192+48:$a4 240+48:$a8",
		"(1)[c4 e4]2",
	);

	// From the declaring channel: the recalling voice's passes move with it.
	cross(
		"a body edited from the channel that declares it",
		0,
		(bar) => ({ kind: "move", items: [noteAt(bar, 1)], deltaTicks: 0, deltaKeys: 2, copy: false }),
		"0+48:$a6 48+48:$a6 96+48:$a6 144+48:$a6 192+48:$a8",
		"0+48:$a6 48+48:$a6 96+48:$a6 144+48:$a6 192+48:$a6",
		"(1)[d4 d4]2",
	);
}

// A cross-channel length change: every voice that plays the body grows by its
// own passes' worth, so neither is padded out to meet the other — `grown` is
// what keeps the pad's hands off a channel that is already moving.
{
	const source = "#amk 2\n#0 o4 (1)[c4]2 d4\n#1 o4 (1)2 e4";
	const before = build(source);
	const bar = typeof before === "string" ? "no build" : strip(source, before, 0);
	if (typeof before === "string" || typeof bar === "string") {
		check("a cross-channel stretch: builds", false, typeof bar === "string" ? bar : "");
	} else {
		const frame = bar.frames[1];
		const context: EditContext = {
			source,
			strip: bar,
			targetAMKVersion: before.result.stats?.targetAMKVersion ?? 4,
			songTargetProgram: before.result.stats?.songTargetProgram ?? 0,
			playableTicks: playable(before),
			introTicks: introOf(before),
			channels: tailsOf(source, before),
			frame,
			inForce: before.inForce,
		};
		const outcome = planEdits(
			context,
			planGesture(bar, { kind: "stretch", items: [frame.from], edge: "end", deltaTicks: 48 }, "insert", frame),
		);
		if (!isEdits(outcome)) {
			check("a cross-channel stretch: writes", false, outcome.refused);
		} else {
			const after = apply(source, outcome);
			const rebuilt = build(after);
			check(
				"a cross-channel stretch grows both voices and pads neither",
				typeof rebuilt !== "string" &&
					!after.includes("r") &&
					walked(rebuilt, 0) === "0+96:$a4 96+96:$a4 192+48:$a6" &&
					walked(rebuilt, 1) === "0+96:$a4 96+96:$a4 192+48:$a8",
				typeof rebuilt === "string"
					? rebuilt
					: `#0 ${walked(rebuilt, 0)} #1 ${walked(rebuilt, 1)} ${JSON.stringify(after)}`,
			);
		}
	}
}
