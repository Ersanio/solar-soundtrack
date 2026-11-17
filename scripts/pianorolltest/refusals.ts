/** `pianorolltest`: the gestures the roll refuses outright. */

import "../localize";
import { NOTE_MIN } from "@amk/core/hardcoded-tables";
import {
	REFUSE_CLASH,
	REFUSE_INSIDE,
	REFUSE_NO_DRUM,
	REFUSE_RAMP,
	REFUSE_RANGE,
	REFUSE_ROOM,
} from "../../web/src/app/editor/views/piano-roll/roll-edit";
import { section } from "../harness";
import { expectRefused, noteAt } from "./support";

section("refusals");
expectRefused(
	"a note dragged onto its neighbour, strictly",
	"#amk 2\n#0 o4 c4 d4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0)],
		deltaTicks: 24,
		deltaKeys: 0,
		copy: false,
	}),
	"strict",
	REFUSE_CLASH,
);

// The gesture the mode inverts: this is what `insert` pushes through, in the
// stretch case above.
expectRefused(
	"a note stretched into its neighbour, strictly",
	"#amk 2\n#0 o4 c4 d4 e4",
	0,
	(bar) => ({
		kind: "stretch",
		items: [noteAt(bar, 0)],
		edge: "end",
		deltaTicks: 24,
	}),
	"strict",
);

// The one place overwrite is the stricter of the two: both notes are the
// gesture's own, so neither may eat the other and the overlap stands. Insert
// compounds the pushes here instead.
expectRefused(
	"two touching notes stretched into each other, overwriting",
	"#amk 2\n#0 o4 c8 d8 r2",
	0,
	(bar) => ({
		kind: "stretch",
		items: [noteAt(bar, 0), noteAt(bar, 1)],
		edge: "end",
		deltaTicks: 24,
	}),
	"overwrite",
);

// The other end of the same note is refused, and the reason is the command
// rather than the carve: the note would keep the ticks it kept but start later,
// so the `v200` written inside it would fire later than it was written to.
expectRefused(
	"a note drawn over the head of one with a command written inside it",
	"#amk 2\n#0 o4 c4 v200 ^4 d4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 24, written: NOTE_MIN + 36 + 4, drum: null }),
	"overwrite",
	REFUSE_INSIDE,
);

// The one refusal whose reason really is the length: the note is being cut to
// less than the ticks its first segment already holds, so the `v200` written
// after them has nowhere left inside the note to fire.
expectRefused(
	"a note with a command inside it shortened to less than its head",
	"#amk 2\n#0 o4 c4 v200 ^4 d4",
	0,
	(bar) => ({
		kind: "stretch",
		items: [noteAt(bar, 0)],
		edge: "end",
		deltaTicks: -72,
	}),
	"overwrite",
	REFUSE_RAMP,
);

expectRefused(
	"quantize pulling two notes onto one beat, overwriting",
	"#amk 2\n#0 o4 c16 d16 r2",
	0,
	(bar) => ({ kind: "quantize", items: [noteAt(bar, 0), noteAt(bar, 1)], snap: 48 }),
	"overwrite",
);

expectRefused("a note dragged onto the one before it with nowhere to push", "#amk 2\n#0 o4 c4 d4", 0, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 1)],
	deltaTicks: -24,
	deltaKeys: 0,
	copy: false,
}));

// Both notes are the gesture's own, so neither can be shoved out of the other's
// way and the overlap stands.
expectRefused("quantize pulling two notes onto one beat", "#amk 2\n#0 o4 c16 d16 r2", 0, (bar) => ({
	kind: "quantize",
	items: [noteAt(bar, 0), noteAt(bar, 1)],
	snap: 48,
}));

expectRefused(
	"a note dragged off the bottom of the driver's range",
	"#amk 2\n#0 o1 c4 d4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0)],
		deltaTicks: 0,
		deltaKeys: -12,
		copy: false,
	}),
	"insert",
	REFUSE_RANGE,
);

// The driver's drums are `@21`-`@29`, so a drum dragged past either end has nowhere to be.
expectRefused(
	"a drum dragged past the driver's last drum",
	"#amk 2\n#6 @29 c8 @21 c8",
	6,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0), noteAt(bar, 1)],
		deltaTicks: 0,
		deltaKeys: 0,
		deltaDrums: 1,
		copy: false,
	}),
	"insert",
	REFUSE_NO_DRUM,
);

expectRefused(
	"a stretch with nowhere to push",
	"#amk 2\n#0 o4 c4 d4",
	0,
	(bar) => ({
		kind: "stretch",
		items: [noteAt(bar, 1)],
		edge: "start",
		deltaTicks: -48,
	}),
	"insert",
	REFUSE_ROOM,
);

expectRefused("a note shortened past the command written inside it", "#amk 2\n#0 o4 c4 v200 ^8 d4", 0, (bar) => ({
	kind: "stretch",
	items: [noteAt(bar, 0)],
	edge: "end",
	deltaTicks: -60,
}));

// Carrying a note past another takes its whole unit out and writes it again on
// the far side, and the command written inside this one sits in that unit. It
// would go with it, and which side of the note it belongs on afterwards is not
// something a drag says — so the crossing is refused rather than guessed at.
expectRefused(
	"a note with a command inside it dragged past another",
	"#amk 2\n#0 o4 c8 v200 ^8 d8 e8",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 72, deltaKeys: 0, copy: false }),
	"overwrite",
);
