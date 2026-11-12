/** `pianorolltest`: a note drawn, and the octave it spells. */

import "../localize";
import { NOTE_MIN } from "@amk/core/hardcoded-tables";
import { section } from "../harness";
import { expectEdit } from "./support";
import { expectLoopEdit } from "./loops";

// --- a note drawn -------------------------------------------------------------

section("a note drawn");

expectEdit("a note drawn into a rest", "#amk 2\n#0 o4 c4 r2 d4", 0, () => ({
	kind: "spawn",
	startTick: 72,
	ticks: 24,
	written: NOTE_MIN + 36 + 4,
	drum: null,
}));

expectEdit("a note drawn at the end of a channel", "#amk 2\n#0 o4 c4 r4", 0, () => ({
	kind: "spawn",
	startTick: 96,
	ticks: 48,
	written: NOTE_MIN + 36 + 7,
	drum: null,
}));

// A note drawn at the octave already standing spells none of its own. What is in
// force is the previous note's own byte, carried over text that moves it nowhere.
expectEdit(
	"a note drawn at the octave already standing",
	"#amk 2\n#0 o4 c4 r2 d4",
	0,
	() => ({ kind: "spawn", startTick: 72, ticks: 24, written: NOTE_MIN + 36 + 4, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 r8 e8 r4 d4" },
);

// And a `>` between the two moves it to the octave the note is drawn at, so the
// note needs none of its own — the octave model reads the `>` exactly. `d4` is
// left alone: the `>` had already put it in the octave the run leaves.
expectEdit(
	"a note drawn past an octave shift written in the gap",
	"#amk 2\n#0 o4 c4 > r2 d4",
	0,
	() => ({ kind: "spawn", startTick: 72, ticks: 24, written: NOTE_MIN + 48 + 4, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 > r8 e8 r4 d4" },
);

// And `O` moves it too: the parser dispatches on the lowercased character
// (`parser.ts:407`, `Music.cpp:445`), so `O5` is an octave command like any
// other and the scan over the gap has to see one. Drawn at the octave the note
// before the gap left standing, which is where missing it spells nothing at all
// and hands the note to the `O5`.
expectEdit(
	"a note drawn past an upper-case octave written in the gap",
	"#amk 2\n#0 o4 c4 r4 O5 r4 d4",
	0,
	() => ({ kind: "spawn", startTick: 96, ticks: 24, written: NOTE_MIN + 36 + 4, drum: null }),
	{ contains: "o4 e8" },
);

// A run leaves its own octave standing, so the note that reads it is handed the
// one it was written under — at its own head, where the text settles anyway.
// The whole channel below would move with the drawn note otherwise.
expectEdit(
	"a note drawn an octave above the one after it",
	"#amk 2\n#0 o4 c4 r2 d4",
	0,
	() => ({ kind: "spawn", startTick: 72, ticks: 24, written: NOTE_MIN + 48, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 r8 o5 c8 r4 o4 d4" },
);

// With a `>` between the run and that note, the octave goes back straight after
// the run instead, as the original had it there, so the `>` still does its job
// rather than being left in front of an `o` that undoes it.
expectEdit(
	"a note drawn an octave above, before an octave shift",
	"#amk 2\n#0 o4 c4 r2 > d4",
	0,
	() => ({ kind: "spawn", startTick: 72, ticks: 24, written: NOTE_MIN + 48, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 r8 o5 c8 o4 r4 > d4" },
);

// A loop's body is parsed where it is written, so it reads the octave standing in
// front of it: a note drawn before the `[` puts that octave back, and the `o2` the
// porter wrote in front of the rest, now unread, goes.
expectLoopEdit(
	"a note drawn in front of a loop",
	"#amk 2\n#0 o2 r1 [c8 d8]2 e4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 96, written: NOTE_MIN + 24 + 2, drum: null }),
	"0+96:$9a 192+24:$8c 216+24:$8e 240+24:$8c 264+24:$8e 288+48:$90",
	{ mode: "overwrite", contains: "#0 o3 d2 r2 o2 [c8 d8]2 e4" },
);

// Unless the body sets its own first, and then nothing is put back — and the
// `o4` nothing read, left standing in front of the drawn note's `o3`, goes.
expectLoopEdit(
	"a note drawn in front of a loop that sets its own octave",
	"#amk 2\n#0 o4 r1 [o5 c8 d8]2 e4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 96, written: NOTE_MIN + 24 + 2, drum: null }),
	"0+96:$9a 192+24:$b0 216+24:$b2 240+24:$b0 264+24:$b2 288+48:$b4",
	{ mode: "overwrite", contains: "#0 o3 d2 r2 [o5 c8 d8]2 e4" },
);

expectEdit(
	"a note drawn an octave above one that sets its own",
	"#amk 2\n#0 o4 c4 r2 o5 d4",
	0,
	() => ({ kind: "spawn", startTick: 72, ticks: 24, written: NOTE_MIN + 48, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 r8 o5 c8 r4 o5 d4" },
);

// Nothing between the two notes to write over, so the run is inserted at the
// head of the one it is drawn in front of and the octave lands on the same
// offset, which `coalesce` joins in the order the two were read.
expectEdit(
	"a note drawn an octave above, straight in front of another",
	"#amk 2\n#0 o4 c4 d4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 48, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 o5 c4 o4 d4" },
);

// `octave` is global parser state and leaks past a `#N`, so a run with no note
// left to hand it to carries it itself — which `#1`, whose notes write no octave
// of their own, is what catches.
expectEdit(
	"a note drawn an octave above at the end of a channel",
	"#amk 2\n#0 o4 c4 r4\n#1 c4 c4 c4 c4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 48, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 o5 c4 o4\n#1 c4 c4 c4 c4" },
);

// A drum's lane is its instrument and it writes no octave at all, so there is
// nothing standing for the note after it to be given back.
expectEdit(
	"a drum drawn in front of another",
	"#amk 2\n#6 @21 c8 r8 @22 c8",
	6,
	() => ({ kind: "spawn", startTick: 24, ticks: 24, written: NOTE_MIN + 48, drum: 23 }),
	{ lacks: "o" },
);
