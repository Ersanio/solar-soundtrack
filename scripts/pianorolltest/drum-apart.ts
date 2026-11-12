/** `pianorolltest`: a drum whose `@` is not written beside it. */

import "../localize";
import { NOTE_MIN } from "@amk/core/hardcoded-tables";
import { section } from "../harness";
import { expectEdit, noteAt } from "./support";

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
