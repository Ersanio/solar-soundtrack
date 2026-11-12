/** `pianorolltest`: a note carried past another, written again on the far side. */

import "../localize";
import { NOTE_MIN } from "@amk/core/hardcoded-tables";
import { expectEdit, noteAt } from "./support";

// --- a note carried *past* another ------------------------------------------
//
// The text is a sequence and a channel's positions are the running sum of its
// durations, so a note that crosses another has to be written somewhere else
// entirely: its unit comes out and it goes back in on the far side. Nothing but
// `plays what the plan said` catches a failure here — the text of a channel
// whose notes have all slid along reads perfectly well, and only walking it
// says they are on the wrong ticks.

expectEdit(
	"a note dragged right past the one after it",
	"#amk 2\n#0 o4 c8 d8 e8",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 48, deltaKeys: 0, copy: false }),
	// The whole shape of the fix in one line: `c8` is a rest where it stood, its
	// `o4` stays where `d8` still reads it, and `c8` is written again on the far
	// side. `e8` gave up all its ticks to it.
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 r8 d8 c8" },
);

// The channel keeps its length: the last note moved off the end, and the ticks it
// left are rest. Only `c8`, which it landed on, gave up any.
expectEdit(
	"a note dragged left past the one before it",
	"#amk 2\n#0 o4 c8 d8 e8",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 2)], deltaTicks: -48, deltaKeys: 0, copy: false }),
	// One `o4` for the channel, and the run writes it. Both writers have a reason
	// to put another at `d8`'s head — the run leaves an octave standing, and the
	// main loop watched the unit carrying the channel's own `o4` be removed — and
	// neither does: it is already the octave `d8` was written under.
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 e8 d8 r8" },
);

// A note still ending the channel holds its length, and then the crossing costs
// it nothing: `e8` goes to the front over `c8`, and the gap it left is a rest.
expectEdit(
	"a note dragged left past the one before it, with a note still ending the channel",
	"#amk 2\n#0 o4 c8 d8 e8 f8",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 2)], deltaTicks: -48, deltaKeys: 0, copy: false }),
	{ mode: "overwrite", playsAsLong: true },
);

expectEdit(
	"a note dragged past two of them at once",
	"#amk 2\n#0 o4 c8 d8 e8 f8 r2",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 72, deltaKeys: 0, copy: false }),
	{ mode: "overwrite", playsAsLong: true },
);

// Overwrite is where it is easy to reach, but the hole is in the writer, which
// every mode shares: a jump into free space clashes with nothing, so strict says
// yes to it too.
expectEdit(
	"a note dragged past another into free space, in strict",
	"#amk 2\n#0 o4 c8 d8 r4 e8",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 48, deltaKeys: 0, copy: false }),
	{ mode: "strict", playsAsLong: true },
);

// And insert, which pushes only what the drag lands on: a drag that clears its
// neighbour lands on nothing, so there is nothing to push and it commits the
// crossing like the other two. The hole was never in the modes — it was in the
// writer all three of them share.
expectEdit(
	"a note dragged past another into free space, inserting",
	"#amk 2\n#0 o4 c8 d8 r4 e8",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 48, deltaKeys: 0, copy: false }),
	{ mode: "insert", playsAsLong: true },
);

// Carried past another *and* past the end of the song, so the note that moved
// still has to pad every other channel out to meet it. `reach` reads the plan's
// own `touched`, which the lifting-out does not disturb — and `playsFor` is the
// only reading that catches a rest of the wrong length.
expectEdit(
	"a note carried past another and past the end of the song",
	"#amk 2\n#0 o4 c8 d8\n#1 o4 c8 d8\n",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 72, deltaKeys: 0, copy: false }),
	{ mode: "overwrite", playsFor: 96 },
);

// A crossing and a carve in the one gesture: `c8` passes over `d8` and lands on
// the head of `e4`.
expectEdit(
	"a note dragged past one note and onto the next",
	"#amk 2\n#0 o4 c8 d8 e4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 60, deltaKeys: 0, copy: false }),
	{ mode: "overwrite", playsAsLong: true },
);

// The whole selection crosses, so every one of them has to be written again.
expectEdit(
	"two notes dragged past a third together",
	"#amk 2\n#0 o4 c8 d8 e8 r2",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0), noteAt(bar, 1)],
		deltaTicks: 72,
		deltaKeys: 0,
		copy: false,
	}),
	{ mode: "overwrite", playsAsLong: true },
);

// A crossing keeps the note's own drum, since the lane is the instrument rather
// than the pitch and the `@21` travels with it.
expectEdit(
	"a drum dragged past the note after it",
	"#amk 2\n#0 o4 @21 c8 @0 o4 d8 e8",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 48, deltaKeys: 0, copy: false }),
	{ mode: "overwrite", playsAsLong: true, contains: "@21" },
);

expectEdit(
	"a note stretched into the one after it, which gives up its head",
	"#amk 2\n#0 o4 c4 d4 e4",
	0,
	(bar) => ({ kind: "stretch", items: [noteAt(bar, 0)], edge: "end", deltaTicks: 24 }),
	{ mode: "overwrite", playsAsLong: true, contains: ["c4.", "d8"] },
);

expectEdit(
	"a note stretched over the one after it, which gives up all of them",
	"#amk 2\n#0 o4 c4 d4 e4",
	0,
	(bar) => ({ kind: "stretch", items: [noteAt(bar, 0)], edge: "end", deltaTicks: 48 }),
	{ mode: "overwrite", playsAsLong: true, contains: "c2", lacks: "d" },
);

// The carve has no direction of its own — a push has to pick one and keep it,
// where this takes the ticks wherever the placed note landed on them.
expectEdit(
	"a left edge pulled back into the note before it, which gives up its tail",
	"#amk 2\n#0 o4 c4 d4 e4",
	0,
	(bar) => ({ kind: "stretch", items: [noteAt(bar, 1)], edge: "start", deltaTicks: -24 }),
	{ mode: "overwrite", playsAsLong: true, contains: ["c8", "d4."] },
);

// The `placed` set, which is `push`'s `fixed` set by another name: the two
// notes being dragged overlap nothing of each other's, and only the note they
// land on gives anything up.
expectEdit(
	"a selection dragged onto an outsider, which alone gives up ticks",
	"#amk 2\n#0 o4 c8 d8 r4 e8",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0), noteAt(bar, 1)],
		deltaTicks: 60,
		deltaKeys: 0,
		copy: false,
	}),
	{ mode: "overwrite", playsAsLong: true },
);

// The case the mode turns on: only the ticks under the note are lost, so what
// the note landed inside comes back as a head and a tail. The tail is a note
// being created — `plays what the plan said` is the proof, since the plan asks
// for two notes at that pitch and the note map has to read back as two.
expectEdit(
	"a note drawn inside a longer one, which survives either side of it",
	"#amk 2\n#0 o4 c1 d4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 4, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 c4 e4 c2 d4" },
);

// And the tail spells its own octave, because the note that split it moved the
// one in force. The note after the run reads what it always read, so nothing is
// put back at its head.
expectEdit(
	"a split whose tail has to spell the octave back",
	"#amk 2\n#0 o4 c1 d4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 48 + 7, drum: null }),
	{
		mode: "overwrite",
		playsAsLong: true,
		text: "#amk 2\n#0 o4 c4 o5 g4 o4 c2 d4",
	},
);

expectEdit(
	"a note drawn exactly over one, which gives up all its ticks",
	"#amk 2\n#0 o4 c4 d4 e4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 c4 g4 e4" },
);

// The octave put back goes at the head of the next *surviving* note. The note
// this same gesture removed is the first note item in the region, and an `o`
// written at its head is an edit inside a range being deleted — two edits over
// one run of text, which is what `planEdits` refuses outright.
expectEdit(
	"a note drawn an octave up over one, with the octave put back after it",
	"#amk 2\n#0 o4 c4 d4 e4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 48 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 c4 o5 g4 o4 e4" },
);

// A copy dropped on its own original: the original is not one of the notes the
// gesture is placing, so it is a victim like any other and gives up everything.
expectEdit(
	"a copy dropped on its own original, which it replaces",
	"#amk 2\n#0 o4 c4 d4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 0, deltaKeys: 0, copy: true }),
	{ mode: "overwrite", playsAsLong: true },
);

// The `reach` guard. Every piece a carve leaves sits at a tick the channel had
// already reached, so none of them may pad the song: the tail here ends at 288
// in a song that plays 192, and counting it would drag `#1` out to meet a note
// nothing had moved. `playsAsLong` is the only reading that catches it — the
// text of `#1` looks equally plausible either way.
expectEdit(
	"a split out past the end of the song, which does not lengthen it",
	"#amk 2\n#0 o4 c2 c1\n#1 o4 c1",
	0,
	() => ({ kind: "spawn", startTick: 120, ticks: 72, written: NOTE_MIN + 36 + 4, drum: null }),
	{ mode: "overwrite", playsAsLong: true, contains: "c8 e4. c2" },
);

// Where the run lands relative to the intro marker. The `/` stands on the
// boundary the note before the region meets it at, and the run goes after it —
// written in front, the marker would come out a whole region late and every
// channel resumes from its own on each pass.
//
// The one channel is the point: `loopTick` is the *lowest* tick any channel
// re-enters at, so a second channel marked at 96 would hold the reading down at
// 96 and hide a marker that had slipped to 144. Alone, the edited channel is
// what sets it, and the song plays for the same 192 either way — which is what
// makes this the only reading that catches it.
expectEdit(
	"a note drawn over the one after the intro marker",
	"#amk 2\n#0 o4 c4 d4 / e4 f4",
	0,
	() => ({ kind: "spawn", startTick: 96, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{
		mode: "overwrite",
		playsAsLong: true,
		loopsWhereItDid: true,
		contains: "/ g4 f4",
	},
);

// A carve through the *tail* of a note with a command written inside it is
// fine: the note keeps its start, so the ramp keeps the tick it was written at
// and only the last continuation is shortened.
expectEdit(
	"a note drawn over the tail of one with a command written inside it",
	"#amk 2\n#0 o4 c4 v200 ^4 d4",
	0,
	() => ({ kind: "spawn", startTick: 72, ticks: 48, written: NOTE_MIN + 36 + 4, drum: null }),
	{ mode: "overwrite", playsAsLong: true, contains: ["v200", "^8"] },
);

// A carve that swallows every note leaves one region over the whole channel,
// with no surviving note for the run to be written in front of and every item in
// it a unit being removed. The run goes after the last of them: at a head it
// would land strictly inside a range `removeItem` is deleting, and two edits over
// one run of text is what `planEdits` refuses. Nothing is put back after it
// either, since the run spells the octave it leaves.
expectEdit(
	"a note drawn over every note of a channel",
	"#amk 2\n#0 o4 c4 d4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 96, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 g2" },
);

// And the command written between two notes it swallows is deleted with the
// note it defined: an erased note takes its `'note-state'` declarations with
// it, and the replacement inherits nothing.
expectEdit(
	"a note drawn over every note of a channel, past a command written between them",
	"#amk 2\n#0 o4 c4 v200 d4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 96, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 g2" },
);

// Mid-channel, where the region is bounded either side, the `v200` is the second
// swallowed note's declaration and `f4` still plays under it, so the run laid
// over both notes writes it out again on its own tick — which splits the drawn
// note into a head and a `^`, and a tie is still one note.
expectEdit(
	"a note drawn over two notes with a command written between them",
	"#amk 2\n#0 o4 c4 d4 v200 e4 f4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 96, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 c4 g4 v200 ^4 f4" },
);

// The one thing that is put back when the whole channel goes: `octave` is global
// parser state and leaks past a `#N`, so a run that leaves a different one than
// the channel did says so at the end — where the block below reads it.
expectEdit(
	"a note drawn an octave up over every note of a channel",
	"#amk 2\n#0 o4 c4 v200 d4\n#1 c4 c4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 96, written: NOTE_MIN + 48 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o5 g2 o4\n#1 c4 c4" },
);

// And not where nothing after it does.
expectEdit(
	"a note drawn an octave up over every note of the song",
	"#amk 2\n#0 o4 c4 v200 d4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 96, written: NOTE_MIN + 48 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o5 g2" },
);

// Nor before a block that sets its own.
expectEdit(
	"a note dragged up at the end of a channel whose next block sets its own octave",
	"#amk 2\n#0 o4 c4 d4\n#1 o3 c2",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 1)], deltaTicks: 0, deltaKeys: 12, copy: false }),
	{ text: "#amk 2\n#0 o4 c4 o5 d4\n#1 o3 c2" },
);
