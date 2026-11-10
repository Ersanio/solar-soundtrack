/** `rolltest`: the loop box's edge opens a gap. */

import "../localize";
import type { LoopRun } from "@amk/spc/song-walk";
import {
	type EditContext,
	isEdits,
	REFUSE_NESTED_LOOP,
	REFUSE_SUB_SPLIT,
} from "../../web/src/app/editor/views/piano-roll/roll-edit";
import { gapSlack, openGap } from "../../web/src/app/editor/views/piano-roll/roll-write/loop-edits";
import type { Strip } from "../../web/src/app/editor/views/piano-roll/roll-strip";
import { check } from "../harness";
import { apply, build, type Expectation, introOf, listOf, playable, strip, tailsOf } from "./support";
import { walked, walkedOthers } from "./loops";

// --- the loop box's edge opens a gap -----------------------------------------
//
// Dragging a box's edge moves that pass occurrence in song time: rests open at
// the boundary in front of it, splitting the recall's count where the grab was
// mid-run, and everything on that voice from the split onward slides together.
// `openGap` is the whole write; `gapSlack` is the shared clamp a leftward drag
// and the commit both go through.

console.log("\nthe loop box's edge opens a gap");

/** The press's own resolution: the construct item and the run pass starting at `grab`. */
export function grabEdge(bar: Strip, grab: number): { item: number; run: LoopRun; pass: number } | null {
	for (let index = 0; index < bar.items.length; index++) {
		const item = bar.items[index];
		if (item.kind !== "construct") {
			continue;
		}

		const frame = bar.frames.find((each) => each.body === item.address);
		const covers = item.instances.some((instance) => instance.tick <= grab && grab < instance.tick + item.ticks);
		if (!frame || !covers) {
			continue;
		}

		for (const run of frame.runs) {
			const pass = run.channel === bar.channel ? run.passes.findIndex((p) => p.tick === grab) : -1;
			if (pass >= 0) {
				return { item: index, run, pass };
			}
		}
	}

	return null;
}

/**
 * The edge dragged: the construct whose pass starts at `grab` moved by `delta`
 * ticks, written by `openGap`, applied, recompiled, and held to `plays` — the
 * edited voice's whole walk — with the other voices' walks pinned unchanged.
 */
export function expectGap(
	name: string,
	source: string,
	channel: number,
	grab: number,
	delta: number,
	plays: string,
	expectation: Expectation = {},
): void {
	const before = build(source);
	if (typeof before === "string") {
		check(`${name}: compiles to begin with`, false, before);
		return;
	}

	const bar = strip(source, before, channel);
	if (typeof bar === "string") {
		check(`${name}: the channel can be edited`, false, bar);
		return;
	}

	const found = grabEdge(bar, grab);
	if (!found) {
		check(`${name}: the grabbed pass names a construct`, false, `nothing starts a pass at ${grab}`);
		return;
	}

	const context: EditContext = {
		source,
		strip: bar,
		targetAMKVersion: before.result.stats?.targetAMKVersion ?? 4,
		songTargetProgram: before.result.stats?.songTargetProgram ?? 0,
		playableTicks: playable(before),
		introTicks: introOf(before),
		channels: tailsOf(source, before),
		frame: bar.frames[0],
		inForce: before.inForce,
	};
	const outcome = openGap(context, found.item, found.run, found.pass, delta);
	if (!isEdits(outcome)) {
		check(`${name}: the gap can be written`, false, outcome.refused);
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

	check(
		`${name}: leaves the other channels alone`,
		walkedOthers(before, channel) === walkedOthers(rebuilt, channel),
		`${walkedOthers(before, channel)} -> ${walkedOthers(rebuilt, channel)}`,
	);

	if (expectation.playsFor !== undefined) {
		check(
			`${name}: plays for ${expectation.playsFor} ticks`,
			playable(rebuilt) === expectation.playsFor,
			`${playable(before)} -> ${playable(rebuilt)} ticks`,
		);
	}

	// The one reading that catches an intro `/` carried across a construct: every
	// note is still on its tick, and only the marker has moved.
	if (expectation.loopsWhereItDid === true) {
		check(
			`${name}: loops back where it did`,
			before.timeline.loopTick === rebuilt.timeline.loopTick,
			`${before.timeline.loopTick} -> ${rebuilt.timeline.loopTick}`,
		);
	}

	for (const wanted of listOf(expectation.contains)) {
		check(`${name}: writes ${wanted}`, after.includes(wanted), JSON.stringify(after));
	}

	for (const unwanted of listOf(expectation.lacks)) {
		check(`${name}: does not write ${unwanted}`, !after.includes(unwanted), JSON.stringify(after));
	}
}

/** The edge drag `openGap` turns away, in the sentence it must give. */
function expectGapRefusal(
	name: string,
	source: string,
	channel: number,
	grab: number,
	delta: number,
	refusal: string,
): void {
	const before = build(source);
	const bar = typeof before === "string" ? "no build" : strip(source, before, channel);
	if (typeof before === "string" || typeof bar === "string") {
		check(`${name}: builds`, false, typeof bar === "string" ? bar : "");
		return;
	}

	const found = grabEdge(bar, grab);
	if (!found) {
		check(`${name}: the grabbed pass names a construct`, false, `nothing starts a pass at ${grab}`);
		return;
	}

	const context: EditContext = {
		source,
		strip: bar,
		targetAMKVersion: before.result.stats?.targetAMKVersion ?? 4,
		songTargetProgram: before.result.stats?.songTargetProgram ?? 0,
		playableTicks: playable(before),
		introTicks: introOf(before),
		channels: tailsOf(source, before),
		frame: bar.frames[0],
		inForce: before.inForce,
	};
	const outcome = openGap(context, found.item, found.run, found.pass, delta);
	check(
		`${name}: refused as "${refusal}"`,
		!isEdits(outcome) && outcome.refused === refusal,
		isEdits(outcome) ? "was written" : outcome.refused,
	);
}

// The headline shape, in the porter's own spelling: `(1)5` grabbed at its third
// pass and dragged three whole notes right splits into `(1)2 r1^1^1 (1)3` —
// the first two passes hold still, the gap is rests, and the last three slide.
expectGap(
	"a recall split around a gap",
	"#amk 4\n#0 o4 (1)[c1] (1)5",
	0,
	576,
	576,
	"0+192:$a4 192+192:$a4 384+192:$a4 1152+192:$a4 1344+192:$a4 1536+192:$a4",
	{ contains: "(1)2 r1^1^1 (1)3", playsFor: 1728 },
);

// A declaration split writes its own recall for the moved passes: `*` where it
// has no label — which recalls the loop it directly follows, `prevLoop` being
// set by nothing but a `[` (parser.ts:2469) — and the label where it has one.
expectGap(
	"a declaration split with *",
	"#amk 2\n#0 o4 [c4 d4]3",
	0,
	96,
	96,
	"0+48:$a4 48+48:$a6 192+48:$a4 240+48:$a6 288+48:$a4 336+48:$a6",
	{ contains: "[c4 d4] r2 *2", playsFor: 384 },
);
expectGap(
	"a labeled declaration split with its label",
	"#amk 2\n#0 o4 (1)[c4 d4]3",
	0,
	96,
	96,
	"0+48:$a4 48+48:$a6 192+48:$a4 240+48:$a6 288+48:$a4 336+48:$a6",
	{ contains: "(1)[c4 d4] r2 (1)2", playsFor: 384 },
);

// A `*` recall splits into two `*`s, both still bound to the same declaration —
// the rests between them declare nothing.
expectGap(
	"a * recall split",
	"#amk 2\n#0 o4 [c4] *4",
	0,
	96,
	48,
	"0+48:$a4 48+48:$a4 144+48:$a4 192+48:$a4 240+48:$a4",
	{ contains: "* r4 *3", playsFor: 288 },
);

// Grabbing the first pass moves the whole occurrence: the rest goes in front of
// the construct, and everything after it — the tail note included — slides.
expectGap(
	"the whole construct moved right",
	"#amk 2\n#0 o4 [c4 d4]2 e4",
	0,
	0,
	48,
	"48+48:$a4 96+48:$a6 144+48:$a4 192+48:$a6 240+48:$a8",
	{ contains: "o4 r4 [c4 d4]2", playsFor: 288 },
);

// Leftward only closes free space: the drag clamps at the rests in front, so a
// pull far past them writes exactly the slack and no more.
expectGap(
	"a leftward drag clamped at the rests in front",
	"#amk 2\n#0 o4 r4 [c4 d4]2",
	0,
	48,
	-480,
	"0+48:$a4 48+48:$a6 96+48:$a4 144+48:$a6",
	{ lacks: "r4", playsFor: 192 },
);

// A rest larger than the pull is shortened rather than deleted.
expectGap("a rest shortened by a leftward drag", "#amk 2\n#0 o4 r2 [c4]2", 0, 96, -48, "48+48:$a4 96+48:$a4", {
	contains: "r4 [",
	lacks: "r2",
});

// The slack ends at a command: the rest after the `v200` may go — the command
// stands before it and keeps its tick — and nothing earlier may.
{
	const source = "#amk 2\n#0 o4 r4 v200 r4 [c4 d4]2";
	const before = build(source);
	const bar = typeof before === "string" ? "no build" : strip(source, before, 0);
	if (typeof before === "string" || typeof bar === "string") {
		check("the slack stops at a command: builds", false, typeof bar === "string" ? bar : "");
	} else {
		const found = grabEdge(bar, 96);
		check(
			"the slack stops at a command",
			found !== null && gapSlack(bar, found.item) === 48,
			found ? `${gapSlack(bar, found.item)}` : "no construct",
		);
	}
}

expectGap(
	"a leftward drag stops short of a command",
	"#amk 2\n#0 o4 r4 v200 r4 [c4 d4]2",
	0,
	96,
	-480,
	"48+48:$a4 96+48:$a6 144+48:$a4 192+48:$a6",
	{ contains: "v200 [c4" },
);

// A subloop's later passes cannot split — `]]1` is not even spellable, its
// byte being the `$E6 $00` open arm — but the whole occurrence still moves.
expectGapRefusal("a subloop grabbed mid-run", "#amk 2\n#0 o4 [[c4]]3 d4", 0, 48, 48, REFUSE_SUB_SPLIT);
expectGap(
	"a whole subloop moved right",
	"#amk 2\n#0 o4 [[c4]]3 d4",
	0,
	0,
	48,
	"48+48:$a4 96+48:$a4 144+48:$a4 192+48:$a6",
	{ contains: "r4 [[c4]]3", playsFor: 240 },
);

// A construct inside another loop's body plays wherever the outer loop does —
// there is no song-time text position to move it to.
expectGapRefusal("a nested subloop's box", "#amk 2\n#0 o4 [c4 [[d4]]2 e4]2", 0, 48, 48, REFUSE_NESTED_LOOP);

// Splitting a recall of another channel's body edits the recalling channel's
// text alone — and where the moved passes reach past the song, the declaring
// channel is padded out to hear them, as any reach-extending gesture pads.
expectGap(
	"a cross-channel recall split",
	"#amk 2\n#0 o4 (1)[c4 d4] e4\n#1 o4 (1)2",
	1,
	96,
	48,
	"0+48:$a4 48+48:$a6 144+48:$a4 192+48:$a6",
	{ contains: ["(1) r4 (1)", "r2"], playsFor: 240 },
);

// A gap of nothing writes nothing, and a mid-run grab has no space to close.
{
	const source = "#amk 2\n#0 o4 (1)[c4] (1)3";
	const before = build(source);
	const bar = typeof before === "string" ? "no build" : strip(source, before, 0);
	if (typeof before === "string" || typeof bar === "string") {
		check("a zero gap: builds", false, typeof bar === "string" ? bar : "");
	} else {
		const found = grabEdge(bar, 96);
		if (!found) {
			check("a zero gap: the grabbed pass names a construct", false, "nothing at 96");
		} else {
			const context: EditContext = {
				source,
				strip: bar,
				targetAMKVersion: before.result.stats?.targetAMKVersion ?? 4,
				songTargetProgram: before.result.stats?.songTargetProgram ?? 0,
				playableTicks: playable(before),
				introTicks: introOf(before),
				channels: tailsOf(source, before),
				frame: bar.frames[0],
				inForce: before.inForce,
			};
			const zero = openGap(context, found.item, found.run, found.pass, 0);
			const closed = openGap(context, found.item, found.run, found.pass, -48);
			check("a zero gap writes nothing", isEdits(zero) && zero.length === 0, "");
			check(
				"a mid-run grab has no space to close",
				isEdits(closed) && closed.length === 0,
				isEdits(closed) ? `${closed.length} edits` : closed.refused,
			);
		}
	}
}
