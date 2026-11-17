/** `pianorolltest`: a note dragged or stretched, and the octave and rests around it. */

import "../localize";
import { section } from "../harness";
import { expectEdit, noteAt } from "./support";

// --- a note dragged or stretched ----------------------------------------------

section("a note dragged or stretched");

expectEdit(
	"a note dragged up a semitone",
	"#amk 2\n#0 o4 c4 d4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 0, deltaKeys: 1, copy: false }),
	{ contains: "c+4" },
);

// The octave a note was written under is the one in force at it, so an edit that
// stays inside that octave says nothing about octaves at all.
expectEdit(
	"a drag inside the octave writes no octave",
	"#amk 2\n#0 o4 l4 c d e f",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 0, deltaKeys: 2, copy: false }),
	{ contains: "l4 d d e f", lacks: "o4 d" },
);

expectEdit(
	"a note dragged into the next octave, with the octave put back",
	"#amk 2\n#0 o4 c4 d4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 0, deltaKeys: 12, copy: false }),
	{ contains: "o5 c4 o4" },
);

// A unit carrying its own leading `o` is the one shape where `item.octave` is
// not what *enters* the unit — it is what that `o` put in force, and the rewrite
// splices it away. So the two readings agree at 4 here while a `<` sits between
// them, and dropping the `o` as redundant would hand `d+4` and `e4` both to the
// shift. Only `played` sees it: the text reads perfectly either way.
expectEdit(
	"a repitch under a shift keeps the octave its unit carried",
	"#amk 2\n#0 o4 c4 < o4 d4 e4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 1)], deltaTicks: 0, deltaKeys: 1, copy: false }),
	{ text: "#amk 2\n#0 o4 c4 < o4 d+4 e4" },
);

// The mirror of it on the other side of the unit. `exitOctaveFor` answers null
// where the next note will set its own, which says the trailing `o` may go with
// the rewrite — and there is no rewrite where the pitch and length are both
// unchanged, so the `o3` stands and `running` must say 3 rather than `c4`'s own
// 5. Reading it as 5 makes `d4`'s new octave the one already in force, so
// `noteText` spells nothing, `spliceRange` finds the text already there, and the
// drag commits nothing at all. Nothing follows `d4` to read an octave put back
// after it, so none is, and the `o3` it read is left unread and goes.
expectEdit(
	"a note dragged past the octave the note before it left standing",
	"#amk 2\n#0 o5 c4 o3 r4 d4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 1)], deltaTicks: 0, deltaKeys: 24, copy: false }),
	{ text: "#amk 2\n#0 o5 c4 r4 o5 d4" },
);

expectEdit(
	"a note dragged earlier, taking the time out of the rest before it",
	"#amk 2\n#0 o4 c4 r4 d4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 1)], deltaTicks: -24, deltaKeys: 0, copy: false }),
	{ text: "#amk 2\n#0 o4 c4 r8 d4 r8" },
);

expectEdit(
	"a note stretched past a whole note, written as a tie",
	"#amk 2\n#0 o4 c4 r1 r1 d4",
	0,
	(bar) => ({ kind: "stretch", items: [noteAt(bar, 0)], edge: "end", deltaTicks: 240 }),
	{ contains: "^" },
);

expectEdit("a note shortened, which lengthens the rest after it", "#amk 2\n#0 o4 c4 r4 d4", 0, (bar) => ({
	kind: "stretch",
	items: [noteAt(bar, 0)],
	edge: "end",
	deltaTicks: -24,
}));

// A drum's lane is its instrument, so a drag to another lane rewrites its `@`.
expectEdit(
	"a drum moved to another lane",
	"#amk 2\n#6 @21 c8 @22 c8",
	6,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 0, deltaKeys: 0, deltaDrums: 2, copy: false }),
	{ text: "#amk 2\n#6 @23 c8 @22 c8" },
);

// Two drums moved together go the same number of instruments, as two notes go the same semitones.
expectEdit(
	"two drums moved to other lanes together",
	"#amk 2\n#6 @21 c8 @22 c8",
	6,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0), noteAt(bar, 1)],
		deltaTicks: 0,
		deltaKeys: 0,
		deltaDrums: 3,
		copy: false,
	}),
	{ text: "#amk 2\n#6 @24 c8 @25 c8" },
);

// The pitched note after a drum plays that drum's sample, so it plays the new one's after the move.
expectEdit(
	"a drum with a pitched note after it moved to another lane",
	"#amk 2\n#0 @21 o4 c8 c8",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 0, deltaKeys: 0, deltaDrums: 4, copy: false }),
	{ text: "#amk 2\n#0 o4 @25 c8 c8" },
);

// `leadsAUnit` takes an `o` and a percussion `@` alike, so a drum's unit reaches
// back over its `@` and on to the octave in front of it — and a drum is written
// `@21 c<length>`, which has nowhere to put one. The octave has to survive the
// rewrite anyway: it is what the notes after the drum are standing in.
expectEdit(
	"a drum rewritten under an octave its unit reached back over",
	"#amk 2\n#0 o5 c4 o3 @21 c4 d4",
	0,
	(bar) => ({ kind: "stretch", items: [noteAt(bar, 1)], edge: "end", deltaTicks: 24 }),
	{ text: "#amk 2\n#0 o5 c4 o3 @21 c4. d4" },
);

expectEdit(
	"a mid-note ramp keeps its place when the note is stretched",
	"#amk 2\n#0 o4 c4 v200 ^8 r4 d4",
	0,
	(bar) => ({ kind: "stretch", items: [noteAt(bar, 0)], edge: "end", deltaTicks: 24 }),
	{ contains: "v200" },
);

expectEdit(
	"a pitch drag does not spell a length in",
	"#amk 2\n#0 o4 l4 c d",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 0, deltaKeys: 2, copy: false }),
	{ contains: "d d", lacks: "d4 d" },
);
