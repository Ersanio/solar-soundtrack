/** `pianorolltest`: what a drag carries with the notes it moves. */

import "../localize";
import { REFUSE_RANGE, REFUSE_ROOM } from "../../web/src/app/editor/views/piano-roll/roll-edit";
import { section } from "../harness";
import { expectCarried, expectEdit, noteAt } from "./support";

section("what a drag carries");

// `Plan.touched` is what the roll draws in the preview and leaves out of the
// song's own bars, so these pin whether a dragged note is drawn once or twice.

expectCarried(
	"a dragged note",
	"#amk 2\n#0 o4 c4 r4 d4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0)],
		deltaTicks: 24,
		deltaKeys: 0,
		copy: false,
	}),
	[0],
);

// A note carried past another is written again on the far side, and it is still
// the note the porter has hold of. Which is why the lifting-out happens in
// `planEdits` and not in `planGesture`: the plan is what the roll draws, so a
// note demoted a step earlier would carry `from: -1` here, the song's own bar
// for it would stay on screen under the drag, and every crossing would look like
// a copy being made.
expectCarried(
	"a note carried past another is still carried",
	"#amk 2\n#0 o4 c8 d8 e8",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0)],
		deltaTicks: 48,
		deltaKeys: 0,
		copy: false,
	}),
	[0],
	null,
	"overwrite",
);

// A copy has no original to leave out, so `Ctrl`+drag keeps both bars on screen.
expectCarried(
	"a copied note",
	"#amk 2\n#0 o4 c4 r4 r4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0)],
		deltaTicks: 48,
		deltaKeys: 0,
		copy: true,
	}),
	[-1],
);

// A refusal that still knows where the note was going keeps it, so the bar stays
// under the pointer, red, until it is let go.
expectCarried(
	"a push with nowhere to go",
	"#amk 2\n#0 o4 c4 d4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 1)],
		deltaTicks: -24,
		deltaKeys: 0,
		copy: false,
	}),
	[1],
	REFUSE_ROOM,
);

// And one that does not: a pitch past the driver's range has no lane, so there
// is nowhere to draw it and every bar goes back where it was.
expectCarried(
	"a note dragged out of range",
	"#amk 2\n#0 o1 c4 d4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0)],
		deltaTicks: 0,
		deltaKeys: -12,
		copy: false,
	}),
	[],
	REFUSE_RANGE,
);

// And the copy written out, walked like any other gesture.
expectEdit("a note copied rather than moved", "#amk 2\n#0 o4 c4 r4 r4", 0, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 0)],
	deltaTicks: 48,
	deltaKeys: 0,
	copy: true,
}));

// `Ctrl`+drag and `Ctrl`+B both copy the whole **selection**, so a region takes
// as many notes at once as the porter had chosen. One note per region would
// refuse the commonest shape there is — a run of notes copied a bar right.
expectEdit(
	"a run of notes copied together",
	"#amk 2\n#0 o4 c4 d4 r4 r4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0), noteAt(bar, 1)],
		deltaTicks: 96,
		deltaKeys: 0,
		copy: true,
	}),
	{ contains: ["c4", "d4"] },
);

// The run carries the octave from note to note, so the second copy spells its
// own `o` and going back down spells one again.
expectEdit(
	"copies an octave apart each spell their own octave",
	"#amk 2\n#0 o4 c4 o5 c4 r4 r4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0), noteAt(bar, 1)],
		deltaTicks: 96,
		deltaKeys: 0,
		copy: true,
	}),
	{ contains: ["o5 c4"] },
);

// A drum leaves the octave standing rather than replacing it, so the note after
// a copied drum is spelled against whatever the run last put in force.
expectEdit(
	"a run holding a drum copied together",
	"#amk 2\n#0 o4 @21 c4 @0 o4 d4 r4 r4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0), noteAt(bar, 1)],
		deltaTicks: 96,
		deltaKeys: 0,
		copy: true,
	}),
	{ contains: ["@21"] },
);
