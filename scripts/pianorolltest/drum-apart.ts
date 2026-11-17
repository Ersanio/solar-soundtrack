/** `pianorolltest`: a drum whose `@` is not written beside it, and the row a press finds a drum's notes on. */

import "../localize";
import { NOTE_MIN } from "@amk/core/hardcoded-tables";
import { type PlaceContext, rollShape } from "../../web/src/app/editor/views/piano-roll/percussion";
import { laneStack } from "../../web/src/app/editor/views/piano-roll/roll-layout";
import { rowOf } from "../../web/src/app/editor/views/piano-roll/roll-marks";
import { rowOfItem } from "../../web/src/app/editor/views/piano-roll/roll-preview";
import { check, section } from "../harness";
import { build, expectEdit, noteAt, strip } from "./support";

// --- a drum whose `@` is not written beside it --------------------------------
//
// A rest does not consume the drum remap, so `@21 r4 d4` plays `d4` as the drum. The strip reads
// the drum off the walk rather than off the unit, so the plan names it and "plays what the plan
// said" holds for every gesture below.
section("a drum written apart from its note");

const APART = "#amk 2\n#0 o4 c4 @21 r4 d4 e4";

expectEdit("a note moved beside a drum written apart", APART, 0, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 0)],
	deltaTicks: 0,
	deltaKeys: 1,
	copy: false,
}));

// Deleting the drum takes its `@` with it, or `e4` would play it instead.
expectEdit("a drum written apart deleted", APART, 0, (bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }), {
	text: "#amk 2\n#0 o4 c4 r2 e4",
});

// A note drawn between the `@` and its drum would take the drum: the `@` goes to the drum's head.
expectEdit(
	"a note drawn between a drum and its `@`",
	APART,
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", text: "#amk 2\n#0 o4 c4 g4 @21 d4 e4" },
);

// A drum moved to another lane is written beside its new `@`, and the old one goes.
expectEdit("a drum written apart moved to another lane", APART, 0, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 1)],
	deltaTicks: 0,
	deltaKeys: 1,
	copy: false,
}));

// --- a bar is pressed on the row it is drawn on -------------------------------
//
// The marks place a note by the byte the walk read (`rowOf`), and a press finds a strip item on the
// row of the drum it carries (`rowOfItem`). A note the two disagree about is drawn where nothing can
// grab it, and grabbed on a row where nothing is drawn, with nothing on screen to say so. Each song
// is one way a note comes to play a drum's sample, or a drum without an `@` beside it.
section("a drum's notes are pressed on the row they are drawn on");

/** Every note of `channel` the walk reached, as the row it is drawn on and the row a press finds it on. */
function rowsOf(source: string, channel: number): { kinds: string[]; agree: boolean; detail: string } | string {
	const built = build(source);
	if (typeof built === "string") {
		return built;
	}

	const bar = strip(source, built, channel);
	if (typeof bar === "string") {
		return bar;
	}

	const context: PlaceContext = {
		noisy: new Set(),
		written: new Map((built.result.noteMap ?? []).map((entry) => [entry.address, entry.written])),
	};
	const shape = rollShape(built.timeline.notes, context);
	const stack = laneStack({ ...shape, all: false });
	const kinds: string[] = [];
	const pairs: string[] = [];
	let agree = true;
	for (const item of bar.items) {
		const note = item.kind === "note" ? item.instances[0]?.note : null;
		if (!note) {
			continue;
		}

		const drawn = rowOf(note, stack, context);
		const pressed = rowOfItem(item, stack);
		agree &&= drawn >= 0 && drawn === pressed;
		kinds.push(stack.lanes[drawn]?.kind ?? "none");
		pairs.push(`${drawn}/${pressed}`);
	}

	return { kinds, agree, detail: `drawn/pressed ${pairs.join(" ")}, ${kinds.join(" ")}` };
}

for (const [name, source, channel, kinds] of [
	// Only the first note after a drum `@` is remapped on `#0`-`#5` (`parser.ts:2743-2754`); the one
	// after it plays the drum's sample at the pitch written, and is a key.
	["a pitched note after a drum", "#amk 2\n#0 @21 o4 c4 c4", 0, "drum key"],
	["a drum written apart, then a pitched note", APART, 0, "key drum key"],
	// The remap reaches the first note in the body, which has no `@` in its frame (`remapFed`).
	["a body head fed by a drum loaded before its `[`", "#amk 2\n#0 @21 [o4 c4 c4]2", 0, "drum key"],
	// `#6` and `#7` keep the remap for every note, so every one is a drum.
	["every note on #6", "#amk 2\n#6 @29 o2 a1 b2 c3", 6, "drum drum drum"],
	["a melodic slot", "#amk 2\n#0 @10 o4 c4 d4", 0, "key key"],
] as const) {
	const rows = rowsOf(source, channel);
	if (typeof rows === "string") {
		check(`${name}: builds a strip`, false, rows);
		continue;
	}

	check(`${name}: drawn and pressed on one row`, rows.agree, rows.detail);
	check(`${name}: on the lanes the bytes say`, rows.kinds.join(" ") === kinds, rows.detail);
}
