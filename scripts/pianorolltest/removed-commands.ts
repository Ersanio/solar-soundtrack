/** `pianorolltest`: a removed item's commands are kept where something still plays under them. */

import "../localize";
import { NOTE_MIN } from "@amk/core/hardcoded-tables";
import { expectEdit, noteAt } from "./support";

// --- a removed item's commands are kept where something still plays under them ---------------------
//
// A `'note-state'` command written to run just before an item the gesture removes — its
// declaration — is dropped only where nothing in the edited song sounds under it. A surviving note
// counts and so does one the gesture is drawing, so the spot keeps its dynamics and what changed is
// which note sits there. The gesture is no part of the question: a Backspace and a note drawn over
// the top get the same answer.
//
// A kept command is left exactly where it was written. Only a run laid over the text that holds it
// has to move it, and there it is written out again on its own tick — which splits the note it
// lands inside into a head and a `^`.
//
// Song-wide commands, `o`/`l`, the intro `/` and the prefix of a channel's first item are outside
// the rule and always stay put, and an item only partly covered keeps everything.

// The reporting song: the drawn note begins on `y0`'s own tick and sounds under it, so `y0` stays
// exactly where it was written. The rest before it is not reached and keeps its bytes.
expectEdit(
	"a note drawn over the whole of one whose declaration stands at its head",
	"#amk 2\n\n#3 q7F\nl32 @17\no5 v85y20r16y0a^=1",
	3,
	() => ({ kind: "spawn", startTick: 12, ticks: 24, written: NOTE_MIN + 48 + 10, drum: null }),
	{
		mode: "overwrite",
		playsFor: 36,
		text: "#amk 2\n\n#3 q7F\nl32 @17\no5 v85y20r16y0 a+8",
	},
);

// The symmetry the rule is for. Backspace on the last note leaves nothing to sound under its
// `v200`, so the command goes with it, and the note's ticks stay as rest...
expectEdit(
	"a note deleted with nothing left to sound under its declaration",
	"#amk 2\n#0 o4 c4 v200 d4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c4 r4" },
);

// ...and Backspace on the same note with one after it keeps the `v200` exactly where it was
// written, because `e4` still plays under it. The gesture is the same; the song is what differs.
expectEdit(
	"a note deleted with one after it still sounding under its declaration",
	"#amk 2\n#0 o4 c4 v200 d4 e4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ playsAsLong: true, text: "#amk 2\n#0 o4 c4 v200 r4 e4" },
);

// And the same note drawn over rather than deleted: one answer, not two.
expectEdit(
	"a note drawn over one whose declaration something after it still sounds under",
	"#amk 2\n#0 o4 c4 v200 d4 e4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 c4 v200 g4 e4" },
);

// The mirror shape: the erased note's neighbour is a rest with a declaration of
// its own, and the run stops short of both. The `v200` is the rest's, not the
// erased note's, and the rest was never reached.
expectEdit(
	"a note drawn over the whole of one, leaving the rest after it its declaration",
	"#amk 2\n#0 o4 c4 v200 r4 d4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 g4 v200 r4 d4" },
);

// A rest is asked the same question as a note — read off tick geometry rather than the carve, since
// `plan.erased` never names a rest — and here `d4` still plays under the `v200`, so it stays and the
// note drawn over the rest begins on its tick and sounds under it too.
expectEdit(
	"a note drawn over the whole of a rest with a declaration at its head",
	"#amk 2\n#0 o4 c4 v200 r4 d4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 c4 v200 g4 d4" },
);

// And a rest whose `v200` really does reach nothing: the run starts before the command's own tick,
// so the note drawn over it does not begin under it and there is nothing after it that does.
expectEdit(
	"a note drawn over a rest and the note in front of it, taking the rest's declaration",
	"#amk 2\n#0 o4 c4 v200 r4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 96, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 g2" },
);

// A `t` acts on the song and not on the note in front of it, so it is never a declaration to drop —
// and the `y0` beside it is one `e4` still plays under.
expectEdit(
	"a note drawn over the whole of one with a tempo at its head",
	"#amk 2\n#0 o4 c4 t60 y0 d4 e4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, contains: ["t60", "y0"] },
);

// The slot changing hands is where a command stops reaching, and the walk is what says so rather
// than a table restated here: `e4` plays under the `y15`, not the `y0`, so deleting `d4` takes the
// `y0` and leaves the `y15` alone.
expectEdit(
	"a note deleted whose declaration is replaced before the next note",
	"#amk 2\n#0 o4 c4 y0 d4 y15 e4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ playsAsLong: true, text: "#amk 2\n#0 o4 c4 r4 y15 e4" },
);

// The channel's first item keeps its prefix even erased: what stands above the
// first note or rest is the channel's setup rather than its declaration.
expectEdit(
	"a note drawn over the whole of a channel's first note, under its setup",
	"#amk 2\n#0 v200 c4 d4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, contains: "v200" },
);

// Two erased notes, two declarations, both still reaching `f4`. The `v200` stands on the tick the
// run begins at and stays put; the `y15` stands inside it and is written out again there.
expectEdit(
	"a note drawn over two notes that each carry a declaration",
	"#amk 2\n#0 c4 v200 d4 y15 e4 f4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 96, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 c4 v200 g4 y15 ^4 f4" },
);

// Two of them inside the one run, so the drawn note is split twice — and `played` folds the ties
// back, which is what says the three pieces are still one note of 144 ticks.
expectEdit(
	"a note drawn over three notes that each carry a declaration",
	"#amk 2\n#0 c4 v200 d4 y15 e4 v100 f4 g4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 144, written: NOTE_MIN + 36 + 7, drum: null }),
	{
		mode: "overwrite",
		playsAsLong: true,
		text: "#amk 2\n#0 c4 v200 g4 y15 ^4 v100 ^4 g4",
	},
);

// The gate is coverage, not the spawn gesture: a note dragged wholly onto another removes it the
// same way, and its `v200` is kept for the same reason — `e4` still plays under it.
expectEdit(
	"a note dragged wholly onto the next, which carries a declaration",
	"#amk 2\n#0 o4 c4 v200 d4 e4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0)],
		deltaTicks: 48,
		deltaKeys: 0,
		copy: false,
	}),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 r4 o4 c4 v200 e4" },
);

// A command written *inside* a note — between its head and a `^` continuation — stays on its tick
// when the note becomes rest around it, unless nothing plays under it once the note is gone. Here
// nothing does, so it goes, and the two pieces of rest are one.
expectEdit(
	"a note deleted with a command inside it that reaches nothing",
	"#amk 2\n#0 o4 c4 d4 v200 ^4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c4 r2" },
);

// The same note with a run being laid over its ticks: the run writes the command out again on its
// own tick, so the drawn note is split there.
expectEdit(
	"a note drawn over one with a command inside it",
	"#amk 2\n#0 o4 c4 d4 v200 ^4 e4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 96, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 c4 g4 v200 ^4 e4" },
);

// A command in a channel the walk could not reach is never dropped: `walkSong` ends the pass at the
// shortest channel, so `#0`'s `d4` has no note to check against and "nothing sounds under it" is a
// thing this cannot know. `#1` is what holds the pass short.
expectEdit(
	"a note deleted past the end of the pass, with a declaration at its head",
	"#amk 2\n#0 o4 c4 v200 d4\n#1 o4 c4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c4 v200 r4\n#1 o4 c4" },
);
