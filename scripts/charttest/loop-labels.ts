/** `charttest`: the label on a selected loop. */

import "../localize";
import {
	DECLARED_TINT,
	type LoopRegionBox,
	buildLoopLabels,
} from "../../web/src/app/editor/views/piano-roll/roll-marks";
import { check, section } from "../harness";

section("the label on a selected loop");
{
	// None of this is visible in a screenshot either: a label drawn for a body
	// nothing selected, or for a `*` that names no body, reads as the roll
	// claiming a loop is called something it is not.
	const box = (id: string, channel: number, body: number, tick: number, w: number, h: number): LoopRegionBox => ({
		id,
		x: tick,
		w,
		y: 0,
		h,
		ticks: w,
		declared: true,
		fill: "fill-ch-0",
		tint: DECLARED_TINT,
		opacity: 1,
		channel,
		body,
		tick,
	});

	const labels = (request: {
		regions: LoopRegionBox[];
		channel?: number;
		selected?: number[];
		names?: [number, number][];
	}) =>
		buildLoopLabels({
			regions: request.regions,
			channel: request.channel ?? 0,
			selected: new Set(request.selected ?? []),
			labelAt: (body) => new Map(request.names ?? []).get(body) ?? null,
		});

	const wide = [box("a", 0, 1000, 0, 80, 40), box("b", 0, 1000, 96, 80, 40)];

	check("an unselected body carries no label", labels({ regions: wide, names: [[1000, 1]] }).length === 0);
	check(
		"a selected body labels every one of its boxes",
		labels({ regions: wide, selected: [1000], names: [[1000, 1]] })
			.map((each) => `${each.text}@${each.x}`)
			.join(" ") === "1@3 1@99",
		JSON.stringify(labels({ regions: wide, selected: [1000], names: [[1000, 1]] })),
	);
	// A `*` or a bare `[ ]` names no body, and `labelAt` is what says so — which
	// is why the question is asked per construct rather than per body.
	check("a construct that names no body shows nothing", labels({ regions: wide, selected: [1000] }).length === 0);
	check(
		"and only the channel being edited has a selection to show one for",
		labels({ regions: [box("c", 1, 1000, 0, 80, 40)], selected: [1000], names: [[1000, 1]] }).length === 0,
	);

	// A box too small says nothing rather than something cut, which is the line
	// `fitBarContent` takes for a bar's own name.
	check(
		"a box too narrow for the plate drops it",
		labels({ regions: [box("d", 0, 1000, 0, 12, 40)], selected: [1000], names: [[1000, 1]] }).length === 0,
	);
	check(
		"and one too short",
		labels({ regions: [box("e", 0, 1000, 0, 80, 8)], selected: [1000], names: [[1000, 1]] }).length === 0,
	);

	// The plate is a construct's name, not a note's and not a row's, so it is the
	// same size however far the roll is zoomed in or how tall its rows are.
	const narrow = labels({ regions: [box("f", 0, 1000, 0, 80, 40)], selected: [1000], names: [[1000, 1]] });
	const zoomed = labels({ regions: [box("f", 0, 1000, 0, 800, 200)], selected: [1000], names: [[1000, 1]] });
	check(
		"the plate is the same size at every zoom and row height",
		narrow[0].w === zoomed[0].w && narrow[0].h === zoomed[0].h,
		`${narrow[0].w}x${narrow[0].h} vs ${zoomed[0].w}x${zoomed[0].h}`,
	);
	check("and it sits in the box's top-left corner", zoomed[0].x === 3 && zoomed[0].y === 3, JSON.stringify(zoomed[0]));
}
