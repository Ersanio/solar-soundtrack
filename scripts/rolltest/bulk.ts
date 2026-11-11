/** `rolltest`: the bulk gestures — legato and quantize — over a selection. */

import "../localize";
import { section } from "../harness";
import { expectEdit, noteAt } from "./support";

section("bulk");
expectEdit("legato closes the rests", "#amk 2\n#0 o4 c8 r8 d8 r8", 0, (bar) => ({
	kind: "legato",
	items: [noteAt(bar, 0), noteAt(bar, 1)],
}));

expectEdit("quantize pulls a note onto the beat", "#amk 2\n#0 o4 c8 r=4 d8 r4", 0, (bar) => ({
	kind: "quantize",
	items: [noteAt(bar, 1)],
	snap: 48,
}));

expectEdit("glue joins two touching notes", "#amk 2\n#0 o4 c8 c8 r4", 0, (bar) => ({
	kind: "glue",
	items: [noteAt(bar, 0), noteAt(bar, 1)],
}));

// A run transposed together must not write a restore after every note that the
// next note's own octave undoes on the spot.
expectEdit(
	"a run moved an octave writes one octave, not one per note",
	"#amk 2\n#0 o4 l4 c d e f",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0), noteAt(bar, 1), noteAt(bar, 2), noteAt(bar, 3)],
		deltaTicks: 0,
		deltaKeys: 12,
		copy: false,
	}),
	{ contains: "o5 c d e f", lacks: "o4 o5" },
);

// Deleting the first note puts a rest where it stood, and the two have to be one
// edit: an insertion inside a range being removed is merged rather than refused.
expectEdit("the first note of a channel deleted", "#amk 2\n#0 o4 l4 c d e", 0, (bar) => ({
	kind: "delete",
	items: [noteAt(bar, 0)],
}));

expectEdit("a whole selection moves as one edit list", "#amk 2\n#0 o4 r4 c8 d8 e8 f8 r1", 0, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 0), noteAt(bar, 1), noteAt(bar, 2), noteAt(bar, 3)],
	deltaTicks: 48,
	deltaKeys: 0,
	copy: false,
}));
