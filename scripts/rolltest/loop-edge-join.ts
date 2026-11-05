/** `rolltest`: the loop box's edge joins a split loop back up. */

import "../localize";
import {
	type EditContext,
	isEdits,
	planGesture,
	plannedFrameTicks,
} from "../../web/src/app/editor/views/piano-roll/roll-edit";
import { buildPreview } from "../../web/src/app/editor/views/piano-roll/roll-preview";
import { laneStack } from "../../web/src/app/editor/views/piano-roll/roll-layout";
import { openGap } from "../../web/src/app/editor/views/piano-roll/roll-write/loop-edits";
import type { Strip } from "../../web/src/app/editor/views/piano-roll/roll-strip";
import { check } from "../harness";
import { apply, build, type Built, introOf, playable, strip, tailsOf } from "./support";
import { expectGap, grabEdge } from "./loop-edge-gap";

// --- and joins the halves back up ---------------------------------------------
//
// A leftward drag that spends the whole slack puts the pass back against the
// occurrence in front of it, and two occurrences of one body touching are one
// construct written twice. `loopJoin` is the reading; each case here is the
// round trip of a split above it.

console.log("\nthe loop box's edge joins a split loop");

expectGap(
	"a split recall joined back up",
	"#amk 4\n#0 o4 (1)[c1] (1)2 r1^1^1 (1)3",
	0,
	1152,
	-576,
	"0+192:$a4 192+192:$a4 384+192:$a4 576+192:$a4 768+192:$a4 960+192:$a4",
	{ contains: "(1)[c1] (1)5", lacks: "r1", playsFor: 1152 },
);

// The half that stays keeps its own spelling: what makes the two joinable is
// that they play the same body, which says nothing about how either is written.
expectGap(
	"a declaration joined with its star",
	"#amk 2\n#0 o4 [c4 d4] r2 *2",
	0,
	192,
	-96,
	"0+48:$a4 48+48:$a6 96+48:$a4 144+48:$a6 192+48:$a4 240+48:$a6",
	{ contains: "[c4 d4]3", lacks: "*", playsFor: 288 },
);
expectGap(
	"a labeled declaration joined with its recall",
	"#amk 2\n#0 o4 (1)[c4 d4] r2 (1)2",
	0,
	192,
	-96,
	"0+48:$a4 48+48:$a6 96+48:$a4 144+48:$a6 192+48:$a4 240+48:$a6",
	{ contains: "(1)[c4 d4]3", playsFor: 288 },
);
expectGap(
	"two stars joined",
	"#amk 2\n#0 o4 [c4] * r4 *3",
	0,
	144,
	-48,
	"0+48:$a4 48+48:$a4 96+48:$a4 144+48:$a4 192+48:$a4",
	{ contains: "[c4] *4", playsFor: 240 },
);

// Joining a recall of another channel's body edits the recalling channel alone,
// as splitting one does.
expectGap(
	"a cross-channel recall joined",
	"#amk 2\n#0 o4 (1)[c4 d4] e4 r2\n#1 o4 (1) r4 (1)",
	1,
	144,
	-48,
	"0+48:$a4 48+48:$a6 96+48:$a4 144+48:$a6",
	{ contains: "(1)2" },
);

// The count is the neighbour's own run and not every earlier pass the voice
// plays: three occurrences join two of them, which `passesAt().before` cannot
// say — it would answer 3 here and write `(1)6`.
expectGap(
	"three occurrences join only the neighbour",
	"#amk 2\n#0 o4 (1)[c4] (1)2 r4 (1)3",
	0,
	192,
	-48,
	"0+48:$a4 48+48:$a4 96+48:$a4 144+48:$a4 192+48:$a4 240+48:$a4",
	{ contains: "(1)[c4] (1)5", lacks: "(1)6", playsFor: 288 },
);

// A close that stops short leaves a gap, which is still two constructs.
expectGap(
	"a partial close joins nothing",
	"#amk 4\n#0 o4 (1)[c1] (1)2 r1^1^1 (1)3",
	0,
	1152,
	-192,
	"0+192:$a4 192+192:$a4 384+192:$a4 960+192:$a4 1152+192:$a4 1344+192:$a4",
	{ contains: ["(1)2", "(1)3"], lacks: "(1)5", playsFor: 1536 },
);

// And anything with a tick of its own left standing between the two halves
// keeps them apart: the `v200` ends the slack walk holding its own tick, and a
// note ends it outright.
expectGap(
	"a command between the halves joins nothing",
	"#amk 2\n#0 o4 [c4 d4] r2 v200 r2 *2",
	0,
	288,
	-480,
	"0+48:$a4 48+48:$a6 192+48:$a4 240+48:$a6 288+48:$a4 336+48:$a6",
	{ contains: "v200 *2", lacks: "]3" },
);
expectGap(
	"a note between the halves joins nothing",
	"#amk 2\n#0 o4 [c4 d4] r4 e4 r4 *2",
	0,
	240,
	-480,
	"0+48:$a4 48+48:$a6 144+48:$a8 192+48:$a4 240+48:$a6 288+48:$a4 336+48:$a6",
	{ contains: "e4 *2", lacks: "]3" },
);

// The intro `/` is the one thing between two calls that `strip.commands` cannot
// see — `gather` raises no command for an operator — so the guard is on the
// text and not on the command list. A join written over one would carry it past
// the whole occurrence with every note still on its tick, which only `loopTick`
// catches.
expectGap(
	"the intro marker between the halves joins nothing",
	"#amk 2\n#0 o4 [c4]2 / r4 *2 e4",
	0,
	144,
	-48,
	"0+48:$a4 48+48:$a4 96+48:$a4 144+48:$a4 192+48:$a8",
	{ contains: "[c4]2 / *2", lacks: "]4", loopsWhereItDid: true, playsFor: 240 },
);

// Split and join are the one gesture in two directions, so the text that comes
// back is the text that went in, character for character — anything else is a
// spelling the second drag invented. Two documents, which `expectGap` cannot
// express.
{
	const source = "#amk 4\n#0 o4 (1)[c1] (1)5";
	const contextFor = (text: string, built: Built, bar: Strip): EditContext => ({
		source: text,
		strip: bar,
		targetAMKVersion: built.result.stats?.targetAMKVersion ?? 4,
		songTargetProgram: built.result.stats?.songTargetProgram ?? 0,
		playableTicks: playable(built),
		introTicks: introOf(built),
		channels: tailsOf(text, built),
		frame: bar.frames[0],
		inForce: built.inForce,
	});

	const before = build(source);
	const bar = typeof before === "string" ? "no build" : strip(source, before, 0);
	const out = typeof bar === "string" ? null : grabEdge(bar, 576);
	if (typeof before === "string" || typeof bar === "string" || !out) {
		check("a split joined back: builds", false, typeof bar === "string" ? bar : source);
	} else {
		const split = openGap(contextFor(source, before, bar), out.item, out.run, out.pass, 576);
		const opened = isEdits(split) ? apply(source, split) : "";
		const grown = opened === "" ? "no build" : build(opened);
		const again = typeof grown === "string" ? "no build" : strip(opened, grown, 0);
		const back = typeof again === "string" ? null : grabEdge(again, 1152);
		if (typeof grown === "string" || typeof again === "string" || !back) {
			check("a split joined back: the split builds", false, JSON.stringify(opened));
		} else {
			const join = openGap(contextFor(opened, grown, again), back.item, back.run, back.pass, -576);
			check(
				"a split joined back is the text it started as",
				isEdits(join) && apply(opened, join) === source,
				isEdits(join) ? JSON.stringify(apply(opened, join)) : join.refused,
			);
		}
	}
}

// A total past 255 is not a count any of the three spellings can carry
// (`parser.ts:2492`, `:2792`, `:2836`, AMK0116), so the gap closes and the two
// calls stand. Driven bare: a 300-pass walk is not a readable expectation.
{
	const source = "#amk 2\n#0 o4 (1)[c4] (1)200 r4 (1)100";
	const before = build(source);
	const bar = typeof before === "string" ? "no build" : strip(source, before, 0);
	if (typeof before === "string" || typeof bar === "string") {
		check("a count past 255: builds", false, typeof bar === "string" ? bar : "");
	} else {
		const found = grabEdge(bar, 9696);
		if (!found) {
			check("a count past 255: the grabbed pass names a construct", false, "nothing at 9696");
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
			const outcome = openGap(context, found.item, found.run, found.pass, -48);
			const after = isEdits(outcome) ? apply(source, outcome) : outcome.refused;
			check(
				"a count past 255 closes the gap and leaves two calls",
				after === "#amk 2\n#0 o4 (1)[c4] (1)200 (1)100",
				JSON.stringify(after),
			);
		}
	}
}

// The preview's projection: a frame-local plan is drawn once per pass, and a
// length change slides pass k by k deltas — the honest picture of requirement
// six while the pointer is still down.
{
	const source = "#amk 2\n#0 o4 [c4 d4]2 e4";
	const before = build(source);
	const bar = typeof before === "string" ? "no build" : strip(source, before, 0);
	if (typeof before === "string" || typeof bar === "string") {
		check("the projected preview: builds", false, typeof bar === "string" ? bar : "");
	} else {
		const frame = bar.frames[1];
		const plan = planGesture(
			bar,
			{ kind: "stretch", items: [frame.from + 1], edge: "end", deltaTicks: 48 },
			"insert",
			frame,
		);
		const delta = plannedFrameTicks(bar, frame, plan) - frame.ticks;
		check("a stretch prices the body's growth", delta === 48, `${delta}`);

		const passes = frame.runs
			.flatMap((run) => run.passes)
			.sort((a, b) => a.tick - b.tick)
			.map((pass, at) => ({ tick: pass.tick, ordinal: at }));
		const preview = buildPreview({
			plan,
			stack: laneStack({ lowestKey: 24, highestKey: 60 }),
			zoom: 1,
			rowHeight: 10,
			rows: 40,
			passes,
			delta,
			body: frame.body,
		});
		check(
			"the live bar is drawn once per pass, later passes slid by the growth",
			preview.live.map((each) => each.x).join(" ") === "48 192",
			preview.live.map((each) => each.x).join(" "),
		);
	}
}
