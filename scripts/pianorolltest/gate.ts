/** `pianorolltest`: what the strip will and will not read. */

import "../localize";
import { section } from "../harness";
import { expectEdit, expectNoStrip, noteAt } from "./support";

// --- what the strip will and will not read ---------------------------------

section("the gate");
expectNoStrip("a triplet", "#amk 2\n#0 o4 {c8 d8 e8} f4", 0, "{ }");
expectNoStrip("a replacement", '#amk 2\n"x=c4"\n#0 o4 x d4', 0, "replacement");
expectNoStrip("a tempo ratio", "#amk 2\n#halvetempo\n#0 o4 c4 d4", 0, "divides its tempo");
// An unterminated `$E6 $00` opens a subloop nothing closes: no run, nothing to
// frame, and a sentence of its own. The note in front is what lets it compile.
expectNoStrip(
	"an unterminated subloop",
	"#amk 2\n#0 o4 e4 $E6 $00 c4 d4",
	0,
	"opens a subloop ($E6 $00) that nothing closes",
);
// A crossed loop and subloop compiles (`Music.cpp:1208-1290` guards nesting,
// not crossing) and the driver plays neither construct as written — `walktest`
// pins what really runs, and the strip refuses the shape by its runs.
expectNoStrip(
	"a crossed loop and subloop",
	"#amk 2\n#0 o4 [c4 $E6 $00 d4]2 e4 $E6 $01",
	0,
	"a loop and a subloop cross on this channel",
);
// A `&` is an operator, so `gather` raises no command for it and the scanner
// cannot say which channel it is on — one anywhere refuses all eight, which the
// second case is what pins. A channel using the `$DD` form it compiles to is
// editable, which the "a pitch slide" section below is what pins.
expectNoStrip("a legacy pitch slide", "#amk 2\n#0 o4 c4 & d4", 0, "`&`");
expectNoStrip("a legacy pitch slide on another channel", "#amk 2\n#0 o4 c4 & d4\n#1 o4 e4 f4", 1, "`&`");
// `<` and `>` are safe and must **not** be refused: a note's octave comes from
// its own written byte rather than from a running sum, so either note here
// repitches without disturbing the other. Dropped to the octave standing before
// the `>`, which only it read, the note has the `>` taken out rather than an `o`
// written after it.
expectEdit(
	"a note beside an octave shift",
	"#amk 2\n#0 o4 c4 > d4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 1)], deltaTicks: 0, deltaKeys: -12, copy: false }),
	{ text: "#amk 2\n#0 o4 c4 d4" },
);

// And where a note after it still reads the `>`, the octave goes back after the
// moved note.
expectEdit(
	"a note beside an octave shift another note reads",
	"#amk 2\n#0 o4 c4 > d4 e4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 1)], deltaTicks: 0, deltaKeys: -12, copy: false }),
	{ text: "#amk 2\n#0 o4 c4 d4 o5 e4" },
);

// A porter's octave an edit leaves unread is taken out, so no `o` stands in front
// of another that undoes it.
expectEdit(
	"a channel's opening octave left unread by its first note",
	"#amk 2\n#0 o4 l8 e1",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 0, deltaKeys: -12, copy: false }),
	{ text: "#amk 2\n#0 l8 o3 e1" },
);

// And dragged back, with nothing to put in its place, the note reads the octave
// standing, so the round trip writes no `o` it does not need.
expectEdit(
	"a note dragged down and back",
	"#amk 2\n#0 r2 o3 g8",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 0, deltaKeys: 5, copy: false }),
	{ text: "#amk 2\n#0 r2 c8" },
);

// A remote definition can only sit above the first `#N` (Music.cpp:1015), so its
// `[ ]` gathers on the starting channel — but the body runs only where the `$FC`
// fires it, and channel 0 must stay editable.
expectEdit(
	"a channel under a remote code definition",
	"#amk 2\n(!1)[$F4 $02]\n#0 o4 c4 (!1, 1, 8) d4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 1)], deltaTicks: 0, deltaKeys: 2, copy: false }),
	{ contains: ["(!1)[$F4 $02]", "(!1, 1, 8)"] },
);
// A `[ ]` up there that no `(!n)` armed is the starting channel's own music — a
// zero-tick body of commands, framed like any other loop, and the channel edits.
expectEdit(
	"a channel with a loop above the first marker",
	"#amk 2\n[$F4 $02]2\n#0 o4 c4 d4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 1)], deltaTicks: 0, deltaKeys: 2, copy: false }),
	{ contains: ["[$F4 $02]2", "e4"] },
);
// A `*` recalling a remote definition's body replays remote code, which the
// roll leaves alone in both directions.
expectNoStrip(
	"a * recalling a remote definition",
	"#amk 2\n(!1)[$F4 $02]\n#0 o4 c4 *2 d4 (!1, 1, 8)",
	0,
	"remote code body",
);

// A channel longer than the shortest is the commonest shape a song has, and the
// walk cuts the pass at the shortest — so this must be editable, not refused.
expectEdit("a channel past the end of the pass", "#amk 2\n#0 o4 c4 d4 e4 f4\n#1 o4 g4", 0, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 3)],
	deltaTicks: 0,
	deltaKeys: 2,
	copy: false,
}));
