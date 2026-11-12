/** `pianorolltest`: a note deleted, and the rest and octave it leaves. */

import "../localize";
import { section } from "../harness";
import { expectEdit, noteAt } from "./support";

// --- a note deleted -----------------------------------------------------------

section("a note deleted");

// A unit swallows the `o` written beside its head and the one written after its
// tail (`roll-strip.ts:growUnits`), so removing one removes what put the octave
// in force for every note after it. The octave goes back at the head of the note
// that reads it, and only where the one standing is not already the one wanted —
// which is what this first case pins, since `o4` still stands over `e4`.
expectEdit("a note deleted", "#amk 2\n#0 o4 c4 d4 e4", 0, (bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }), {
	text: "#amk 2\n#0 o4 c4 r4 e4",
});

expectEdit(
	"a note deleted from under the octave the note after it reads",
	"#amk 2\n#1 l8\n@8\ny10\nq4f\n\n r4. o2 a8 d8 o3 d8\n",
	1,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0)] }),
	{ contains: "o2 d8" },
);

// The `o3` here is `c4`'s own trailing octave restore — the `r4` between it and
// `d4` keeps `d4`'s left scan off it — and it is inside `c4`'s unit and goes
// with it.
expectEdit(
	"a note deleted with the octave written after it",
	"#amk 2\n#0 o5 c4 o3 r4 d4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0)] }),
	{ contains: "o3 d4" },
);

// Once, however many notes went: it is the note that reads the octave that asks
// for it, rather than each note that dropped one.
expectEdit(
	"two notes deleted in front of one that reads their octave",
	"#amk 2\n#0 o4 c4 o5 d4 o6 e4 f4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1), noteAt(bar, 2)] }),
	{ contains: "o6 f4", lacks: "o6 o6" },
);

expectEdit(
	"two notes deleted with one left standing between them",
	"#amk 2\n#0 o4 c4 o5 d4 e4 o6 f4 g4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1), noteAt(bar, 3)] }),
	// Each deleted note's `o` is still read by the note after it, so it stays.
	{ text: "#amk 2\n#0 o4 c4 o5 r4 e4 o6 r4 g4" },
);

expectEdit(
	"a note deleted where the note after it writes its own octave",
	"#amk 2\n#0 o4 c4 o5 d4 o3 e4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ lacks: "o5" },
);

// `octave` is global parser state and leaks past a `#N`, so a channel with no
// note left to hand its octave to keeps it where the last unit was — otherwise
// the `f4`s below move down two octaves, which is what "leaves the other
// channels alone" catches. The notes' ticks stay as rest: the channel keeps its
// length.
expectEdit(
	"notes deleted off the end of a channel the block below reads the octave of",
	"#amk 2\n#0 o4 c4 o5 d4 o6 e4\n#1 f4 f4 f4\n",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1), noteAt(bar, 2)] }),
	{ text: "#amk 2\n#0 o4 c4 r2 o6\n#1 f4 f4 f4\n", playsAsLong: true },
);

expectEdit(
	"every note in a channel deleted",
	"#amk 2\n#0 o4 c4 o5 d4 o6 e4\n#1 f4 f4 f4\n",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0), noteAt(bar, 1), noteAt(bar, 2)] }),
	{ text: "#amk 2\n#0 r2. o6\n#1 f4 f4 f4\n", playsAsLong: true },
);

// A song's only note deleted leaves its rest, so the song still compiles and the
// roll can go on editing it.
expectEdit(
	"a song's only note deleted",
	"#amk 2\n#0 o4 c4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0)] }),
	{
		text: "#amk 2\n#0 r4",
		playsAsLong: true,
	},
);

// The shortest channel keeps its length, so the song does not stop early and
// take the other channel's last note with it.
expectEdit(
	"the shortest channel's last note deleted",
	"#amk 2\n#0 o4 c4 d4 e4\n#1 o3 c4 d4 e4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 2)] }),
	{ text: "#amk 2\n#0 o4 c4 d4 r4\n#1 o3 c4 d4 e4", playsAsLong: true },
);

// A gap is realised over **runs** of rests rather than over one rest at a time,
// so a note deleted from between two of them leaves the one rest they now are.
// `note rest note rest` is the commonest shape a channel has, and every case
// here is checked by compiling and walking the result rather than by the text
// alone: `r4.` and `r4 r8` sound identical and only the text tells them apart.
expectEdit(
	"a note deleted from between two rests",
	"#amk 2\n#0 o4 c8 r8 d8 r8 e8",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c8 r4. e8" },
);

// Touching already, and still one rest afterwards: the run is being rewritten
// either way, and leaving `r4 r8` behind is the thing this is for.
expectEdit(
	"two rests already touching in a gap being rewritten",
	"#amk 2\n#0 o4 c8 r8 r8 d8 e8",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c8 r4. e8" },
);

// A run stops at anything read at a tick, and the deleted note becomes rest where
// it stood: the `v200` stays on the tick it ran at, which is where the command
// lane shows it, and the note's rest joins the one after it.
expectEdit(
	"a command written between the two rests",
	"#amk 2\n#0 o4 c8 r8 v200 d8 r8 e8",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c8 r8 v200 r4 e8" },
);

// The intro marker most of all: every channel resumes from its own on each pass
// (`parser.ts:parseIntro`), so a `/` swallowed into a merged rest moves the
// whole song's loop point — which is what `loopsWhereItDid` catches and what
// reading the text could not. One channel, because `loopTick` is the lowest tick
// any channel re-enters at, so a second one marked on the old tick hides a move.
expectEdit(
	"the intro marker written between the two rests",
	"#amk 2\n#0 o4 c8 r8 / d8 r8 e8",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c8 r8 / r4 e8", loopsWhereItDid: true },
);

// A deleted note in front of the marker: its rest stays in front of it.
expectEdit(
	"a note deleted in front of the intro marker",
	"#amk 2\n#0 o4 r4 / e2 c4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0)] }),
	{ text: "#amk 2\n#0 o4 r4 / r2 c4", loopsWhereItDid: true },
);

// And a channel's first note: what was written after it keeps its tick, rather
// than the rest going in behind it and pulling it to the top of the channel.
expectEdit(
	"a channel's first note deleted, with a tempo written after it",
	"#amk 2\n#0 o4 c4 t60 d4 e4\n#1 o4 c4 d4 e4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0)] }),
	{ text: "#amk 2\n#0 o4 r4 t60 d4 e4\n#1 o4 c4 d4 e4" },
);

expectEdit(
	"a channel's first note deleted, with the intro marker after it",
	"#amk 2\n#0 o4 c2 / c2",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0)] }),
	{ text: "#amk 2\n#0 o4 r2 / c2", loopsWhereItDid: true },
);

// Two notes deleted either side of a command: each becomes rest on its own side.
expectEdit(
	"two notes deleted either side of a tempo change",
	"#amk 2\n#0 o4 c4 d4 t80 e4 f4 g4\n#1 o4 c1^4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1), noteAt(bar, 2)] }),
	{ text: "#amk 2\n#0 o4 c4 r4 t80 r4 f4 g4\n#1 o4 c1^4" },
);

// A command the same delete drops is gone, so the rests either side of it are
// one rest.
expectEdit(
	"rests joined across a command the same delete drops",
	"#amk 2\n#0 o4 c4 r4 @3 d4 r4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c4 r2." },
);

// A note deleted from between two touching ones: its rest is spliced where it
// stood, so the spacing around it is the porter's own.
expectEdit(
	"a note deleted from between two it touches",
	"#amk 2\n#0 o4 a1a1a1",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{
		text: "#amk 2\n#0 o4 a1r1a1",
	},
);

// And a gap whose ticks do not change is not rewritten at all, so two rests the
// porter wrote touching are only ever joined by a gesture that had to move them.
expectEdit(
	"two rests the porter wrote touching in a gap that does not move",
	"#amk 2\n#0 o4 c4 r4 r4 d4 e4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 2)], deltaTicks: 48, deltaKeys: 0, copy: false }),
	{ text: "#amk 2\n#0 o4 c4 r4 r4 d4 r4 e4" },
);

// The tail keeps the channel's length, so a note deleted from it is rest where it
// stood, and the rests either side of it are one rest.
expectEdit(
	"the last note deleted from between two trailing rests",
	"#amk 2\n#0 o4 c8 r8 d8 r8\n#1 o4 c2",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c8 r4.\n#1 o4 c2", playsAsLong: true },
);

expectEdit(
	"trailing rests the porter wrote touching",
	"#amk 2\n#0 o4 c8 d8 r8 r8\n#1 o4 c2",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0)] }),
	{ contains: "r8 r8" },
);

// `octave` is global parser state and leaks past a `#N`, so the last note off a
// channel leaves its own `o` where it was, `#1` reading it — which stands between
// the two pieces a merged tail joins, and an `o` among rests says nothing about
// time. `#1` writes no octave of its own, so "leaves the other channels alone" is
// what catches it going astray.
expectEdit(
	"the octave a deleted last note left, across a merged tail",
	"#amk 2\n#0 o4 c8 r8 o5 d8 r8\n#1 c8 c8 c8 c8",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c8 r4. o5\n#1 c8 c8 c8 c8" },
);

// A run comes to one rest however long it is, tied from common lengths where they
// add up (`spellRest`) rather than written as a tick count.
expectEdit(
	"a run of three rests becoming one",
	"#amk 2\n#0 o4 c8 r8 d8 r8 e8 r8 f8",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1), noteAt(bar, 2)] }),
	{ text: "#amk 2\n#0 o4 c8 r2^8 f8" },
);

expectEdit(
	"a merged rest with no single length of its own",
	"#amk 2\n#0 o4 c4 d16 r4 e4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c4 r4^16 e4" },
);
