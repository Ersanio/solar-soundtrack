/** `rolltest`: the selection survives an edit. */

import "../localize";
import { commandAt } from "@amk/tokens";
import {
	type EditContext,
	type EditMode,
	type Gesture,
	isEdits,
	planFrames,
} from "../../web/src/app/editor/views/piano-roll/roll-edit";
import { noteLengthEdit } from "../../web/src/app/output/command-inspector/note-length/length-rows";
import { anchorsFor, notesAtAnchors } from "../../web/src/app/editor/views/piano-roll/roll-selection";
import { planGroupEdits } from "../../web/src/app/editor/views/piano-roll/roll-write/plan-edits";
import type { Strip } from "../../web/src/app/editor/views/piano-roll/roll-strip";
import { check } from "../harness";
import { apply, build, introOf, playable, strip, tailsOf } from "./support";
import { notesIn } from "./loop-carries-loops";

// --- the selection survives an edit -----------------------------------------

// A set of indices means something for exactly as long as the strip it indexes
// into stands, so a gesture anchors what is selected on the frame and ordinal
// its plan gives each note (`roll-selection.ts`) and picks them out again in the
// strip the commit builds. The round trip is what is pinned here; that the plan
// and the written text agree about the order is pinned on every case above.

/**
 * The notes a selection comes back as, spelled as the text the commit wrote.
 *
 * A string is a refusal or a failure to rebuild — a channel the roll would have
 * no strip for, and so nothing to put a selection back on.
 */
function carriedSelection(
	source: string,
	channel: number,
	gesture: (bar: Strip) => Gesture,
	chosen: (bar: Strip) => readonly number[],
	mode: EditMode,
): readonly string[] | string {
	const before = build(source);
	if (typeof before === "string") {
		return before;
	}

	const bar = strip(source, before, channel);
	if (typeof bar === "string") {
		return bar;
	}

	const made = gesture(bar);
	const first = "items" in made && made.items.length > 0 ? made.items[0] : undefined;
	const held = first !== undefined ? (bar.items[first]?.frame ?? 0) : 0;
	const context: EditContext = {
		source,
		strip: bar,
		targetAMKVersion: before.result.stats?.targetAMKVersion ?? 4,
		songTargetProgram: before.result.stats?.songTargetProgram ?? 0,
		playableTicks: playable(before),
		introTicks: introOf(before),
		channels: tailsOf(source, before),
		frame: bar.frames[held],
		inForce: before.inForce,
	};

	const parts = planFrames(bar, made, mode, held);
	const outcome = planGroupEdits(context, parts);
	if (!isEdits(outcome)) {
		return outcome.refused;
	}

	const anchors = anchorsFor(bar, parts, new Set(chosen(bar)));
	const after = apply(source, outcome);
	const rebuilt = build(after);
	if (typeof rebuilt === "string") {
		return rebuilt;
	}

	const again = strip(after, rebuilt, channel);
	if (typeof again === "string") {
		return again;
	}

	return [...notesAtAnchors(again, anchors)]
		.sort((a, b) => a - b)
		.map((index) => after.slice(again.items[index].unitSpan.start, again.items[index].unitSpan.end).trim());
}

function expectSelection(
	name: string,
	source: string,
	channel: number,
	gesture: (bar: Strip) => Gesture,
	chosen: (bar: Strip) => readonly number[],
	wanted: readonly string[],
	mode: EditMode = "insert",
): void {
	const got = carriedSelection(source, channel, gesture, chosen, mode);
	check(
		name,
		Array.isArray(got) && got.join(" | ") === wanted.join(" | "),
		Array.isArray(got) ? `want ${wanted.join(" | ")}\n        got  ${got.join(" | ")}` : String(got),
	);
}

{
	const four = "#amk 2\n#0 o4 c8 d8 e8 f8";

	// The gesture's own note and the ones it pushed out of the way both come
	// back: a stretch moves its neighbours, and a selected note it reached is
	// still the note the porter has hold of.
	expectSelection(
		"a stretch keeps the notes it was made on",
		four,
		0,
		() => ({ kind: "stretch", items: [1], edge: "end", deltaTicks: 24 }),
		() => [0, 1, 2],
		["o4 c8", "d4", "e8"],
	);

	// The discriminator for the whole currency. `c8` crosses `d8` and carves the
	// two notes after it, so it comes back as the frame's *third* note where it
	// went in as the first — and index 0 now names the rest left behind. Only the
	// plan's ordinal follows the note itself.
	expectSelection(
		"a note carried past another is still the note that was picked",
		four,
		0,
		() => ({ kind: "move", items: [0], deltaTicks: 60, deltaKeys: 0, copy: false }),
		() => [0, 1],
		// `c8`'s `o4` stays in front of the rest it left, where `d8` reads it.
		["d8", "c8"],
		"overwrite",
	);

	// A note the plan does not carry has gone, and takes its outline with it.
	expectSelection(
		"a deleted note is not put back",
		four,
		0,
		() => ({ kind: "delete", items: [1] }),
		() => [0, 1, 2],
		["o4 c8", "e8"],
	);

	// A drum is confirmed by its `@` alone. Its letter says nothing — a drawn one
	// is handed the row's own `c` whatever the text carries — so a pitch compared
	// there would turn every percussion anchor away.
	expectSelection(
		"a drum comes back on its instrument",
		"#amk 2\n#0 o4 @21 c8 @23 c8 e8",
		0,
		() => ({ kind: "stretch", items: [2], edge: "end", deltaTicks: 24 }),
		() => [0, 1],
		["o4 @21 c8", "@23 c8"],
	);

	// The inspector's own half rests on a different claim, and it is the whole of
	// why that half carries no anchors: a panel's splice rewrites one command's
	// text, so the channel comes back with the same items in the same order and
	// the indices the roll already holds still name the notes they named.
	{
		const song = "#amk 2\n#0 o4 c8 d8 e8";
		const spelled = (bar: Strip): string => bar.items.map((item) => `${item.kind}:${item.written}`).join(" ");
		const before = build(song);
		const bar = typeof before === "string" ? before : strip(song, before, 0);
		const note = typeof before === "string" ? null : commandAt(before.index.commands, song.indexOf("d8"));
		const edit = note && noteLengthEdit(song, note, 0, 4);
		const after = edit ? apply(song, [edit]) : song;
		const rebuilt = build(after);
		const again = typeof rebuilt === "string" ? rebuilt : strip(after, rebuilt, 0);

		check("a note's length is written into its own text", after === "#amk 2\n#0 o4 c8 d4 e8", JSON.stringify(after));
		check(
			"and the channel comes back with the same items at the same indices",
			typeof bar !== "string" && typeof again !== "string" && spelled(bar) === spelled(again),
			typeof bar === "string" || typeof again === "string" ? "no strip" : `${spelled(bar)} -> ${spelled(again)}`,
		);
	}

	// A body is its own frame and its notes are numbered within it, so an anchor
	// carries the frame's index too.
	{
		const looped = "#amk 2\n#0 o4 [ c8 d8 ]2 e8";
		const body = (bar: Strip): readonly number[] => notesIn(bar, bar.frames[1]);
		expectSelection(
			"a note inside a loop body keeps its place",
			looped,
			0,
			(bar) => ({ kind: "move", items: [body(bar)[1]], deltaTicks: 0, deltaKeys: 2, copy: false }),
			(bar) => body(bar),
			["c8", "e8"],
		);
	}
}
