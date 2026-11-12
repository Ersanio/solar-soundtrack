/** `pianorolltest`: opening a channel the song does not have yet. */

import "../localize";
import { NOTE_MIN } from "@amk/core/hardcoded-tables";
import { REFUSE_CROWDED, REFUSE_INSIDE } from "../../web/src/app/editor/views/piano-roll/roll-edit";
import { section } from "../harness";
import { expectEdit, expectNoStrip, expectRefused, noteAt } from "./support";

section("opening a channel");

// The whole text, because everything about the block is the point: the `#N`, the
// five defaults, the blank line above it, the rest that carries the note out to
// its tick, the rest that runs the channel out to the song's own 192 — and that
// the note does not repeat the `o4` the block just wrote.
expectEdit(
	"a note drawn on a channel the song has not declared",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n",
	5,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 4, drum: null }),
	{
		text: "#amk 2\n#0 o4 c4 d4 e4 f4\n\n#5 o4 q7F @0 v255 y10\nr4 e4 r2\n",
		playsAsLong: true,
		// A song with no `/` gives the channel none either.
		lacks: "/",
	},
);

// The channel is already open, so no second `#5` and no defaults over the top of
// the `v200` the porter wrote — but it is still empty, so it is still filled out.
expectEdit(
	"a note drawn on a channel that is declared but holds no music",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n#5 v200\n",
	5,
	() => ({ kind: "spawn", startTick: 0, ticks: 48, written: NOTE_MIN + 36, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 d4 e4 f4\n#5 v200\no4 c4 r2.\n", playsAsLong: true },
);

// A `;` runs to the end of its line, so a run written on the same line would be
// read as part of the comment and the note would never compile.
expectEdit(
	"a note drawn on a channel whose block ends in a comment",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n#5 v200 ; the bass comes in later",
	5,
	() => ({ kind: "spawn", startTick: 0, ticks: 48, written: NOTE_MIN + 36, drum: null }),
	{ contains: "later\no4 c4 r2.", playsAsLong: true },
);

// The opening's `@0` and the drum's own `@21` both, and the note on its lane.
expectEdit(
	"a drum drawn on a channel the song has not declared",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n",
	6,
	() => ({ kind: "spawn", startTick: 0, ticks: 24, written: NOTE_MIN + 24, drum: 21 }),
	{ contains: "#6 o4 q7F @0 v255 y10\n@21 c8 r2..", playsAsLong: true },
);

// A note drawn past the end pads by nothing on its own channel and takes every
// other one out to meet it, so the song lengthens from 192 to 216 rather than
// leaving the note out past its own end unheard.
//
// The two insertions land on the same offset here — `#0`'s text ends where an
// undeclared `#5`'s block would be written — so this is also what pins their
// order: the rest belongs to `#0`, and the other way round it is `#5`'s.
expectEdit(
	"a note drawn past the end of the song on a channel the song has not declared",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n",
	5,
	() => ({ kind: "spawn", startTick: 168, ticks: 48, written: NOTE_MIN + 36, drum: null }),
	{
		text: "#amk 2\n#0 o4 c4 d4 e4 f4\nr8\n\n#5 o4 q7F @0 v255 y10\nr2.. c4\n",
		playsFor: 216,
	},
);

// `@` switches instrument tuning on under Addmusic 4.05 rather than saying what
// is already true, so the opening leaves it out.
expectEdit(
	"a channel opened on a target where an `@` is not a no-op",
	"#am4\n#0 o4 c4 d4 e4 f4\n",
	5,
	() => ({ kind: "spawn", startTick: 0, ticks: 48, written: NOTE_MIN + 36, drum: null }),
	{ contains: "#5 o4 q7F v255 y10\nc4 r2.", lacks: "@0", playsAsLong: true },
);

// Every channel resumes from its own `/` on each pass round the loop, so a
// channel opened without one restarts at its top instead — and one whose marker
// is on the wrong tick is worse, because it drags the whole song's loop point
// down with it. `loopsWhereItDid` is what pins that; the text alone could not.
// The song here runs `c4 d4 / e4 f4`: 192 ticks, and the intro ends at 96.

// The tick falls inside the rest that fills the channel out, so it is two rests.
expectEdit(
	"a channel opened in a song with an intro, with the marker landing in a rest",
	"#amk 2\n#0 o4 c4 d4 / e4 f4\n",
	5,
	() => ({ kind: "spawn", startTick: 0, ticks: 48, written: NOTE_MIN + 36, drum: null }),
	{
		text: "#amk 2\n#0 o4 c4 d4 / e4 f4\n\n#5 o4 q7F @0 v255 y10\nc4 r4 / r2\n",
		playsAsLong: true,
		loopsWhereItDid: true,
	},
);

// And on a boundary, where nothing has to be split at all.
expectEdit(
	"a channel opened in a song with an intro, with the marker landing on a note's end",
	"#amk 2\n#0 o4 c4 d4 / e4 f4\n",
	5,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 4, drum: null }),
	{
		text: "#amk 2\n#0 o4 c4 d4 / e4 f4\n\n#5 o4 q7F @0 v255 y10\nr4 e4 / r2\n",
		playsAsLong: true,
		loopsWhereItDid: true,
	},
);

// Inside the note, which is written as a head and a `^` continuation: still one
// note, because a tie emits `$C6` and the driver carries the note through it.
// `plays what the plan said` is what proves that — the plan asks for one note of
// 48 ticks at tick 72, and the note map has to read back as one.
expectEdit(
	"a channel opened in a song with an intro, with the marker landing inside the note",
	"#amk 2\n#0 o4 c4 d4 / e4 f4\n",
	5,
	() => ({ kind: "spawn", startTick: 72, ticks: 48, written: NOTE_MIN + 36 + 4, drum: null }),
	{
		text: "#amk 2\n#0 o4 c4 d4 / e4 f4\n\n#5 o4 q7F @0 v255 y10\nr4. e8 / ^8 r4.\n",
		playsAsLong: true,
		loopsWhereItDid: true,
	},
);

// A second note goes into the rests the first one was filled out with, and must
// not eat them: the tail region carries `ticks: -1` for "may be any length", and
// reading that as nothing to fill took the channel back to where the new note
// stopped — and the whole song with it. The sources here are what the three
// cases above write.
expectEdit(
	"a second note drawn into the rests a channel was opened with",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n\n#5 o4 q7F @0 v255 y10\nr4 e4 r2\n",
	5,
	() => ({ kind: "spawn", startTick: 120, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{
		text: "#amk 2\n#0 o4 c4 d4 e4 f4\n\n#5 o4 q7F @0 v255 y10\nr4 e4 r8 g4 r8\n",
		playsAsLong: true,
	},
);

// With an intro the `/` stands between two rests, so the region holds more than
// one and only the rest the note falls inside is rewritten — everything between
// them, the marker included, stays on its own tick.
expectEdit(
	"a second note drawn after the `/` a channel was opened with",
	"#amk 2\n#0 o4 c4 d4 / e4 f4\n\n#5 o4 q7F @0 v255 y10\nc4 r4 / r2\n",
	5,
	() => ({ kind: "spawn", startTick: 120, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{
		text: "#amk 2\n#0 o4 c4 d4 / e4 f4\n\n#5 o4 q7F @0 v255 y10\nc4 r4 / r8 g4 r8\n",
		playsAsLong: true,
		loopsWhereItDid: true,
	},
);

expectEdit(
	"a second note drawn before the `/` a channel was opened with",
	"#amk 2\n#0 o4 c4 d4 / e4 f4\n\n#5 o4 q7F @0 v255 y10\nc4 r4 / r2\n",
	5,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{
		text: "#amk 2\n#0 o4 c4 d4 / e4 f4\n\n#5 o4 q7F @0 v255 y10\nc4 g4 / r2\n",
		playsAsLong: true,
		loopsWhereItDid: true,
	},
);

// A note that starts in one rest and ends in another would have to move the run
// written between them, and only the porter knows which side it belongs on.
expectRefused(
	"a note drawn across the `/` a channel was opened with",
	"#amk 2\n#0 o4 c4 d4 / e4 f4\n\n#5 o4 q7F @0 v255 y10\nc4 r4 / r2\n",
	5,
	() => ({ kind: "spawn", startTick: 72, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	"insert",
	REFUSE_CROWDED,
);

// A `t` the run is laid over is read at a tick like a `v` is, so the run writes it out again on that
// tick and the drawn note is split around it — the tempo changes where it always did.
expectEdit(
	"a note drawn over two notes with a tempo written between them",
	"#amk 2\n#0 o4 c4 d4 t60 e4 f4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 96, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", text: "#amk 2\n#0 o4 c4 g4 t60 ^4 f4" },
);

// The intro marker likewise, so the song loops back where it did.
expectEdit(
	"a note drawn over the intro marker",
	"#amk 2\n#0 o4 c4 d4 / e4 f4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 96, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", text: "#amk 2\n#0 o4 c4 g4 / ^4 f4", loopsWhereItDid: true },
);

// And where the note begins inside the one before the marker, the marker standing in front of the
// first note it erases is taken over too, rather than left where the run now begins.
expectEdit(
	"a note drawn from inside one note across the intro marker",
	"#amk 2\n#0 o4 c4 d4 / e4 f4",
	0,
	() => ({ kind: "spawn", startTick: 72, ticks: 96, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", loopsWhereItDid: true },
);

// The run is written after what stands in front of the notes it erases, so an octave shift there is
// left in place: taken out, the run would enter in the wrong octave and the song after it with it.
expectEdit(
	"notes copied back over an octave shift in front of the intro marker",
	"#amk 2\n#0 o5 b2.^2. < c4. / d+6 e8. b32 c+1 f1^8.",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 1), noteAt(bar, 2), noteAt(bar, 3)],
		deltaTicks: -12,
		deltaKeys: 5,
		copy: true,
	}),
	{ mode: "overwrite", loopsWhereItDid: true },
);

// A note dragged over the marker is written again where it now plays, split around it.
expectEdit(
	"a note dragged across the intro marker",
	"#amk 2\n#0 o5 l16 f16 r8 / r2.^8.",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 96, deltaKeys: 0, copy: false }),
	{ mode: "overwrite", loopsWhereItDid: true },
);

// What says nothing about time stays put: a comment and an `l` are left where they were written,
// every length the run writes being its own.
expectEdit(
	"a note drawn over a comment",
	"#amk 2\n#0 o4 c4 d4 ; hi\n e4 f4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 96, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", text: "#amk 2\n#0 o4 c4 ; hi\n g2 f4" },
);

expectEdit(
	"a note drawn over a default length",
	"#amk 2\n#0 o4 c4 d4 l16 e4 f4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 96, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", text: "#amk 2\n#0 o4 c4 l16 g2 f4" },
);

// An octave shift is taken out, and the run puts back the octave the original had after it, so
// `f4` still plays an octave up.
expectEdit(
	"a note drawn over an octave shift",
	"#amk 2\n#0 o4 c4 d4 > e4 f4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 96, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", text: "#amk 2\n#0 o4 c4 g2 o5 f4" },
);

// A switch-off is never shown in force at a note, so a note playing without it proves nothing and
// it stays — taking it away would leave the vibrato on.
expectEdit(
	"a note deleted with a vibrato switch-off written in front of it",
	"#amk 2\n#0 o4 $DE $00 $10 $40 c4 $DF d4 e4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 $DE $00 $10 $40 c4 $DF r4 e4" },
);

// Nor is a `$F4` toggle: its nine switches share a slot without replacing one another.
expectEdit(
	"a note deleted with a toggle written in front of it",
	"#amk 2\n#0 o4 r4 $F4 $01 c4 $F4 $03 d4 e4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0)] }),
	{ text: "#amk 2\n#0 o4 r4 $F4 $01 r4 $F4 $03 d4 e4" },
);

// And where no run is being laid, the note being removed becomes rest around the command inside
// it: `e4` still plays under this `v200`, so it stays, on the tick it ran at.
expectEdit(
	"a note deleted with a command inside it that something still plays under",
	"#amk 2\n#0 o4 c4 d4 v200 ^4 e4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ mode: "overwrite", text: "#amk 2\n#0 o4 c4 r4 v200 r4 e4" },
);

// Glue is different: the first note grows over the second's ticks, so the command inside the second
// would have to move off its tick, and nothing can say which side of the note it belongs on.
expectRefused(
	"two notes glued, the second with a command inside it",
	"#amk 2\n#0 o4 c4 d4 v200 ^4 e4",
	0,
	(bar) => ({ kind: "glue", items: [noteAt(bar, 0), noteAt(bar, 1)] }),
	"overwrite",
	REFUSE_INSIDE,
);

// Only an item wholly covered is asked the question at all: this one reaches half a rest, so the
// rest keeps its `v200` whatever anything else plays. It stands inside the run being laid, so the
// run writes it out again on its tick rather than refusing the gesture.
expectEdit(
	"a note drawn over one note and half the rest that follows it",
	"#amk 2\n#0 o4 c4 v200 r4 d4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 72, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 g4 v200 ^8 r8 d4" },
);

// `detectStartingChannel` probes the text for `#0` first, so writing one would
// take `c4 d4` off channel 1 and put it on the channel being drawn on. The songs
// here are `#am4` because AddmusicK refuses notes outside a channel altogether
// (AMK0140, `parser.ts:2714`), which is what makes this shape a legacy one.
expectNoStrip(
	"a channel below the lowest the song declares, with music above the first `#N`",
	"#am4\no4 c4 d4\n#1 o4 e4 f4",
	0,
	"above the first",
);

// The same song from the other side: `#5` never wins the probe, so nothing moves.
expectEdit(
	"a channel above the lowest the song declares, with music above the first `#N`",
	"#am4\no4 c4 d4\n#1 o4 e4 f4",
	5,
	() => ({ kind: "spawn", startTick: 0, ticks: 48, written: NOTE_MIN + 36, drum: null }),
	{ contains: "#5 o4 q7F v255 y10", playsAsLong: true },
);

// No marker at all means the starting channel is 0 by fallback, and a `#3`
// written anywhere takes every note the song has over to channel 3.
expectNoStrip("a channel opened in a song with no `#N` at all", "#am4\no4 c4 d4", 3, "above the first");
