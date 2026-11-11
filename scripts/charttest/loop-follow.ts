/** `charttest`: the loop boxes following a gesture. */

import "../localize";
import type { BodyRows, PassShift } from "../../web/src/app/editor/views/piano-roll/roll-edit";
import {
	type LoopRegionBox,
	RECALLED_TINT,
	followLoopRegions,
} from "../../web/src/app/editor/views/piano-roll/roll-marks";
import { loopBox } from "../../web/src/app/editor/views/piano-roll/roll-metrics";
import { check, section } from "../harness";

section("the loop boxes following a gesture");
{
	// A box that stays where the compiled song put it while the notes it is drawn
	// round move out from under it says the loop is somewhere it is not, and
	// every number here is invisible in a screenshot: a box a delta too far
	// right, one that swallows the gap being opened in front of it, or one whose
	// outer loop no longer holds it, all read as the roll being slightly out
	// rather than as a bug.
	const ROWH = 10;
	const at = (channel: number, body: number, tick: number, ticks: number, low: number, high: number) => ({
		id: `${body}:${tick}:${channel}`,
		x: tick,
		w: ticks,
		...loopBox(low, high, ROWH),
		declared: false,
		fill: "fill-ch-0",
		tint: RECALLED_TINT,
		opacity: 1,
		channel,
		body,
		tick,
		ticks,
	});
	const shift = (channel: number, body: number, tick: number, ticks: number, steps: number) => ({
		body,
		channel,
		tick,
		ticks,
		steps,
	});

	const follow = (request: {
		regions: LoopRegionBox[];
		rows?: BodyRows[];
		boundaries?: [number, number[]][];
		delta?: number;
		passes?: PassShift[];
	}) =>
		followLoopRegions({
			regions: request.regions,
			rows: request.rows ?? [],
			boundaries: request.boundaries ? new Map(request.boundaries) : null,
			delta: request.delta ?? 0,
			passes: request.passes ?? [],
			zoom: 1,
			rowHeight: ROWH,
		});

	const across = (list: readonly LoopRegionBox[]) => list.map((r) => `${r.x}+${r.w}`).join(" ");
	const down = (list: readonly LoopRegionBox[]) => list.map((r) => `${r.y}+${r.h}`).join(" ");

	// A body of two passes at 0 and 96, a second body after it, and a third
	// enclosing both passes — the three things a change can be to a box.
	const passOne = at(0, 1000, 0, 96, 20, 22);
	const passTwo = at(0, 1000, 96, 96, 20, 22);
	const after = at(0, 2000, 300, 48, 20, 22);
	const around = at(0, 3000, 0, 300, 18, 24);
	const scene = [passOne, passTwo, after, around];
	const tailPasses = [shift(0, 1000, 0, 96, 0), shift(0, 1000, 96, 96, 1)];
	const tailBounds: [number, number[]][] = [[0, [96, 192]]];

	check("with nothing held the boxes are the very list they were built as", follow({ regions: scene }) === scene);

	const tail = follow({ regions: scene, delta: 24, boundaries: tailBounds, passes: tailPasses });
	check(
		"a tail change moves the changed body's passes by their own steps and lengthens each",
		across(tail).startsWith("0+120 120+120 "),
		across(tail),
	);
	check(
		"a box after the change slides by every boundary behind it and keeps its width",
		across(tail).includes(" 348+48 "),
		across(tail),
	);
	// The two boxes whose right edges sit on the same tick and want opposite
	// answers, told apart by which of them holds the pass that boundary is for.
	check("a box holding the change widens by every pass it holds", across(tail).endsWith(" 0+348"), across(tail));
	const tailInner = follow({
		regions: [at(0, 4000, 48, 48, 20, 21), ...scene],
		delta: 24,
		boundaries: tailBounds,
		passes: tailPasses,
	});
	check(
		"and a body sitting at the changed body's tail is carried along without growing",
		across(tailInner).startsWith("48+48 "),
		across(tailInner),
	);

	// A gap opens in front of one pass. Nothing's length changes, so there are no
	// pass shifts at all and every box takes the marks' rule — the pass in front
	// of the split must not stretch to swallow the gap.
	const split = [at(0, 1000, 0, 48, 20, 22), at(0, 1000, 48, 48, 20, 22), at(0, 1000, 96, 48, 20, 22)];
	const slid = follow({ regions: split, delta: 24, boundaries: [[0, [48]]] });
	check(
		"a slide moves the grabbed pass and everything after it, and stretches nothing",
		across(slid) === "0+48 72+48 120+48",
		across(slid),
	);

	// A body of the same shape on a channel the change never reaches.
	const elsewhere = follow({
		regions: [...scene, at(1, 5000, 0, 96, 20, 22)],
		delta: 24,
		boundaries: tailBounds,
		passes: tailPasses,
	});
	check(
		"a box on a voice the change does not reach stands still",
		across(elsewhere).endsWith(" 0+96"),
		across(elsewhere),
	);

	// A box of another body starting on a changed pass's own tick: same channel,
	// same tick, and it must not be handed that pass's answer.
	const twinned = follow({
		regions: [at(0, 6000, 0, 48, 20, 22)],
		delta: 24,
		boundaries: tailBounds,
		passes: tailPasses,
	});
	check(
		"and one merely starting where a changed pass does is not mistaken for it",
		across(twinned) === "0+48",
		across(twinned),
	);

	check(
		"a shrink past nothing floors the box at a pixel rather than turning it inside out",
		across(follow({ regions: [at(0, 1000, 0, 96, 20, 22)], delta: -600, passes: [shift(0, 1000, 0, 96, 0)] })) ===
			"0+1",
		across(follow({ regions: [at(0, 1000, 0, 96, 20, 22)], delta: -600, passes: [shift(0, 1000, 0, 96, 0)] })),
	);

	// A pass the song ends inside is drawn clipped, and it grows by the delta it
	// is given rather than by the ticks the cut took off it: the commit pads the
	// other channels, so the song really does get that much longer.
	const clipped = follow({
		regions: [at(0, 1000, 96, 20, 20, 22)],
		delta: 24,
		passes: [shift(0, 1000, 96, 96, 1)],
	});
	check(
		"a pass the cut clipped grows by the delta, not by what the cut took",
		across(clipped) === "120+44",
		across(clipped),
	);

	// The identity a press, a label and `track` all resolve against.
	check(
		"the follow leaves the song's own id, tick, ticks, body and channel alone",
		tail.every((box, index) => {
			const song = scene[index];
			return (
				box.id === song.id &&
				box.tick === song.tick &&
				box.ticks === song.ticks &&
				box.body === song.body &&
				box.channel === song.channel
			);
		}),
	);

	// A transpose moves no tick at all, so only the rows answer.
	const up = follow({ regions: scene, rows: [{ body: 1000, low: 16, high: 18 }] });
	check("a transposed body's boxes take the rows its notes now span", down(up).startsWith("158+34 158+34 "), down(up));
	check("a box that is not its own is left alone", down(up).includes(" 198+34 "), down(up));
	check("and the loop it plays inside grows to keep it in", down(up).endsWith(" 158+94"), down(up));
	// Grow only: the built span has already swallowed the inner rows and cannot
	// give them back, so a body moved inwards leaves its outer box as it was.
	const middle = follow({ regions: scene, rows: [{ body: 1000, low: 20, high: 21 }] });
	check("and never shrinks around one that moved inwards", down(middle).endsWith(" 178+74"), down(middle));
	// The other direction: the changed body is the outer one, and the plan knows
	// only the notes of its own frame, so its box has to grow to keep the
	// subloop's — one pass over what each box holds, both ways round.
	const outer = follow({ regions: [around, at(0, 1000, 24, 48, 20, 22)], rows: [{ body: 3000, low: 10, high: 11 }] });
	check(
		"a changed body's own box still holds the bodies playing inside it",
		down(outer) === "98+134 198+34",
		down(outer),
	);

	// Two bodies moved by the one gesture, which is what a loop box's rule is
	// once the group has been widened over the loop written inside the body.
	// Each box takes its own plan's rows, and the outer plan leaves the inner
	// body's notes out — the union is what puts them back, so the union is the
	// right answer rather than either plan on its own.
	const nested = follow({
		regions: [around, at(0, 1000, 24, 48, 20, 22)],
		rows: [
			{ body: 3000, low: 10, high: 11 },
			{ body: 1000, low: 12, high: 14 },
		],
	});
	check("both bodies of a widened group take their own plan's rows", down(nested) === "98+54 118+34", down(nested));

	// Three deep in one pass: enclosure is tested on the song's own ticks and
	// tick containment is transitive, so the outermost box holds the innermost
	// directly and no walk down the nesting is needed to reach it.
	const deep = follow({
		regions: [around, at(0, 1000, 24, 96, 20, 22), at(0, 2500, 36, 24, 21, 22)],
		rows: [
			{ body: 3000, low: 10, high: 11 },
			{ body: 1000, low: 12, high: 13 },
			{ body: 2500, low: 14, high: 15 },
		],
	});
	check("a body three deep is reached by every box above it", down(deep) === "98+64 118+44 138+24", down(deep));
}
