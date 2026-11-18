/** `charttest`: the loop regions behind the bars. */

import "../localize";
import type { LoopRun, WalkNote } from "@amk/spc/song-walk";
import { laneStack } from "../../web/src/app/editor/views/piano-roll/roll-layout";
import {
	DECLARED_TINT,
	type LoopRegionBox,
	RECALLED_TINT,
	buildLoopRegions,
} from "../../web/src/app/editor/views/piano-roll/roll-marks";
import { MUTED_OPACITY } from "../../web/src/app/editor/views/piano-roll/roll-metrics";
import { check, section } from "../harness";

section("the loop regions behind the bars");
{
	// The declared/recalled reading is invisible in a screenshot the same way the
	// minimap's key is: a recall classified as a declaration draws the dashed box
	// on a pass whose text is somewhere else, and the only tell is a porter
	// editing "the loop" where nothing is written. So is the box's reach: bounded
	// to the rows the pass's own notes span, since a stack-high wash is the shape
	// that had two channels' loops brightening each other where they crossed.
	const ZOOM = 1;
	const ROW = 14;
	const stack = laneStack({ lowestKey: 24, highestKey: 35 });
	const context = {
		noisy: new Set<number>(),
		written: new Map<number, number>(),
	};

	/** A pitched note as the walk would report it; only the fields the regions read. */
	const note = (channel: number, key: number, tick: number, ticks: number): WalkNote => ({
		origins: [],
		drumFrom: null,
		bend: null,
		bendFrom: null,
		channel,
		tick,
		ticks,
		gateTicks: ticks,
		vibratoTicks: 0,
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
			waitTime: 2,
			velocity: 0xff,
			vibrato: null,
			tremolo: false,
			noise: null,
			transpose: 0,
			tune: 0,
			fineTune: 0,
			sampleLoaded: false,
			arpeggio: false,
			remotePitch: false,
			tempo: 0,
			globalVolume: null,
		},
	});

	const run = (
		channel: number,
		kind: "call" | "sub",
		from: number,
		body: { start: number; end: number },
		passes: { tick: number; ticks: number }[],
	): LoopRun => ({ channel, kind, from, body, count: passes.length, passes });

	const regions = (request: {
		loops: LoopRun[];
		notes?: WalkNote[];
		mapped?: number[];
		audible?: [number, boolean][];
		from?: number;
		to?: number;
		ticks?: number;
	}) =>
		buildLoopRegions({
			loops: request.loops,
			notes: request.notes ?? [],
			stack,
			context,
			from: request.from ?? 0,
			to: request.to ?? 10000,
			zoom: ZOOM,
			rowHeight: ROW,
			ticks: request.ticks ?? 0,
			audible: new Map(request.audible ?? []),
			mapped: new Set(request.mapped ?? []),
		});

	const spelled = (list: readonly LoopRegionBox[]) =>
		list.map((r) => `${r.declared ? "D" : "r"}@${r.x}+${r.w}`).join(" ");

	// A `[c8 d8]2` and a `(1)2` recall of it: the declaration's $E9 is the one
	// address the command map does not name. One note in each pass gives every
	// region rows to stand on.
	const declRun = run(0, "call", 900, { start: 1000, end: 1010 }, [
		{ tick: 0, ticks: 48 },
		{ tick: 48, ticks: 48 },
	]);
	const recallRun = run(0, "call", 500, { start: 1000, end: 1010 }, [
		{ tick: 120, ticks: 48 },
		{ tick: 168, ticks: 48 },
	]);
	const everyPass = [note(0, 28, 0, 24), note(0, 28, 48, 24), note(0, 28, 120, 24), note(0, 28, 168, 24)];
	const plain = regions({ loops: [declRun, recallRun], notes: everyPass, mapped: [500] });
	check(
		"the declaration's first pass alone is declared; every recall pass is a recall",
		spelled(plain) === "D@0+48 r@48+48 r@120+48 r@168+48",
		spelled(plain),
	);
	check(
		"a declared pass is the solider wash and a recall the fainter, in the channel's colour",
		plain[0].tint === DECLARED_TINT &&
			plain.slice(1).every((r) => r.tint === RECALLED_TINT) &&
			DECLARED_TINT > RECALLED_TINT &&
			plain.every((r) => r.fill === "fill-ch-0"),
		plain.map((r) => `${r.fill}/${r.tint}`).join(","),
	);
	check("every region's id is its own", new Set(plain.map((r) => r.id)).size === plain.length);
	// What the edge-as-handle press reads off a region: which voice, which body
	// — `Strip.frames` names a frame by it — and the pass's own start, the
	// origin a group dragged from that pass projects through.
	check(
		"a region names its voice, its body and its pass",
		plain.every((r) => r.channel === 0 && r.body === 1000) && plain.map((r) => r.tick).join(" ") === "0 48 120 168",
		plain.map((r) => `${r.channel}/${r.body}@${r.tick}`).join(" "),
	);

	// A subloop consults enclosure, not the command map — both its $E6 arms are
	// always mapped, and at the top level its first pass is still the text.
	const subRun = run(0, "sub", 700, { start: 702, end: 720 }, [
		{ tick: 0, ticks: 24 },
		{ tick: 24, ticks: 24 },
	]);
	const sub = regions({
		loops: [subRun],
		notes: [note(0, 28, 0, 24), note(0, 28, 24, 24)],
		mapped: [700],
	});
	check("a top-level subloop's first pass is declared", spelled(sub) === "D@0+24 r@24+24", spelled(sub));

	// `[ [[c]]2 ]2`: the subloop reopened by the outer loop's second pass is a
	// recall through and through — its text played back at pass one already.
	const outer = run(0, "call", 1105, { start: 1000, end: 1100 }, [
		{ tick: 0, ticks: 72 },
		{ tick: 72, ticks: 72 },
	]);
	const innerFirst = run(0, "sub", 1050, { start: 1010, end: 1050 }, [
		{ tick: 0, ticks: 24 },
		{ tick: 24, ticks: 24 },
	]);
	const innerSecond = run(0, "sub", 1050, { start: 1010, end: 1050 }, [
		{ tick: 72, ticks: 24 },
		{ tick: 96, ticks: 24 },
	]);
	const nested = regions({
		loops: [outer, innerFirst, innerSecond],
		notes: [
			note(0, 28, 0, 24),
			note(0, 28, 24, 24),
			note(0, 28, 48, 24),
			note(0, 28, 72, 24),
			note(0, 28, 96, 24),
			note(0, 28, 120, 24),
		],
		mapped: [1050],
	});
	check(
		"a subloop inside a loop is declared only inside the declared outer pass",
		spelled(nested) === "D@0+72 r@72+72 D@0+24 r@24+24 r@72+24 r@96+24",
		spelled(nested),
	);

	// The box is the rows the pass's own notes span — no other channel's, and
	// not the stack's height, which is what keeps two channels' loops from
	// stacking their washes where they cross.
	const low = stack.rowOfKey.get(26)!;
	const high = stack.rowOfKey.get(30)!;
	const boxed = regions({
		loops: [declRun],
		notes: [note(0, 26, 0, 24), note(0, 30, 24, 24), note(0, 28, 60, 24), note(1, 35, 0, 24)],
	});
	check(
		"the box spans the pass's own notes and no other channel's",
		boxed[0]?.y === Math.min(low, high) * ROW - 2 && boxed[0]?.h === (Math.abs(high - low) + 1) * ROW + 4,
		JSON.stringify(boxed[0]),
	);
	check("a pass with one note boxes that note's row alone", boxed[1]?.h === ROW + 4, JSON.stringify(boxed[1]));
	check("a pass with no notes is not drawn", regions({ loops: [declRun] }).length === 0);

	// Muted with the channel's bars, at the roll's own value, wash included.
	const muted = regions({ loops: [declRun], notes: everyPass, audible: [[0, false]] });
	check(
		"a silenced channel's regions dim with its bars",
		muted.length > 0 &&
			muted.every(
				(r) => r.opacity === MUTED_OPACITY && r.tint === (r.declared ? DECLARED_TINT : RECALLED_TINT) * MUTED_OPACITY,
			),
		muted.map((r) => `${r.opacity}/${r.tint}`).join(" "),
	);

	// The mark window's own clipping, and the pass cut `buildMarks` takes.
	const windowed = regions({
		loops: [declRun, recallRun],
		notes: everyPass,
		mapped: [500],
		from: 130,
		to: 150,
	});
	check("a pass outside the window is not drawn", spelled(windowed) === "r@120+48", spelled(windowed));
	const cut = regions({ loops: [declRun, recallRun], notes: everyPass, mapped: [500], ticks: 140 });
	check(
		"a pass past the pass cut never plays and is not drawn; one the cut lands in is clipped to it",
		spelled(cut) === "D@0+48 r@48+48 r@120+20",
		spelled(cut),
	);

	// What the press measures its ends against: the pass **as drawn**, so a
	// handle never answers "resize" where no edge is on screen.
	check(
		"a region carries the pass's drawn length, clipped where the cut lands in it",
		plain.map((r) => r.ticks).join(" ") === "48 48 48 48" && cut.map((r) => r.ticks).join(" ") === "48 48 20",
		`${plain.map((r) => r.ticks).join(" ")} / ${cut.map((r) => r.ticks).join(" ")}`,
	);
}
