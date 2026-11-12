/** `pianorolltest`: a note drawn past the end of the song, and the channels padded to meet it. */

import "../localize";
import { NOTE_MIN } from "@amk/core/hardcoded-tables";
import { section } from "../harness";
import { expectEdit, noteAt } from "./support";

section("past the end of the song");

// A note past the shortest channel is written, compiled and never heard — see
// `padChannels` for why. Every channel that would cut the song short is padded
// out to meet it instead, and `playsFor` is the only reading that catches a rest
// of the wrong length: the text looks equally plausible either way, and `others`
// cannot see a rest at all.

expectEdit(
	"a note drawn past the end of the song",
	"#amk 2\n#0 o4 c4 d4\n#1 o4 e4 f4\n",
	0,
	() => ({ kind: "spawn", startTick: 96, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 d4 g4\n#1 o4 e4 f4\nr4\n", playsFor: 144 },
);

// Adding a rest to the end of a channel needs no note map and no agreement with
// the walk, so a channel `channelStrip` will not build a strip for is padded
// like any other — and most real songs have one.
expectEdit(
	"the channel holding the song back is one the roll cannot edit",
	"#amk 2\n#0 o4 c4 d4\n#1 o4 [e4]2\n",
	0,
	() => ({ kind: "spawn", startTick: 96, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 d4 g4\n#1 o4 [e4]2\nr4\n", playsFor: 144 },
);

// The push cascade counts too: `f4` is shoved out past the end by the note drawn
// in front of it, and a note the gesture moved there is one the gesture is
// answerable for. Without this it would go quiet where it had been sounding.
expectEdit(
	"a note pushed past the end of the song",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n#1 o4 c1\n",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ contains: "#1 o4 c1\nr4", playsFor: 240 },
);

// The rests go on the end, so the `/` every channel re-enters at does not move.
expectEdit(
	"padding a channel does not move the loop point",
	"#amk 2\n#0 o4 c4 d4 / e4 f4\n#1 o4 c1\n",
	0,
	() => ({ kind: "spawn", startTick: 192, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ contains: "#1 o4 c1\nr4", playsFor: 240, loopsWhereItDid: true },
);

// A channel that already ends on a rest has that rest lengthened, so padding it
// twice does not leave two rests side by side. `channelTicks` reads the padded
// voice itself, since an over-pad would only stop it being the shortest.
expectEdit(
	"padding a channel that already ends on a rest",
	"#amk 2\n#0 o4 c4 d4\n#1 o4 c4 r4\n",
	0,
	() => ({ kind: "spawn", startTick: 96, ticks: 48, written: NOTE_MIN + 36 + 4, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 d4 e4\n#1 o4 c4 r2\n", playsFor: 144, channelTicks: [1, 144] },
);

// A note drawn whose run leaves a rest beside one it never reached takes that one
// in too, so the two are written as the one rest they are.
expectEdit(
	"a note carried past another, its rest beside an untouched one",
	"#amk 4\n#0 o4 l8 o3 f2 o3 f8. r16 o4 b4 a r16 o3 f+16 r4 o5 c=60 o3 f+4.\n",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 4)], deltaTicks: -48, deltaKeys: 24, copy: false }),
	{ mode: "overwrite", lacks: "r8 r16", playsAsLong: true },
);

// A channel with no ticks is holding nothing back — `index.ts:44` passes over it
// — so giving it ticks it never had is not what drawing a note asked for.
expectEdit(
	"a channel with no ticks of its own is not padded",
	"#amk 2\n#0 o4 c4 d4\n#1 v200\n",
	0,
	() => ({ kind: "spawn", startTick: 96, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 d4 g4\n#1 v200\n", playsFor: 144 },
);

// And one already past where the note reaches needs nothing either. It stays the
// long channel, which is the ordinary shape `SST0502` reports.
expectEdit(
	"a channel already past the new end is not padded",
	"#amk 2\n#0 o4 c4 d4\n#1 o4 c1 c1\n",
	0,
	() => ({ kind: "spawn", startTick: 96, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 d4 g4\n#1 o4 c1 c1\n", playsFor: 144 },
);

// The channel drawn on already runs past the song, so its own length does not
// move: the note is written into the rest it lands in and the padding answers to
// where the *note* reaches, not to where that channel ends.
expectEdit(
	"a note drawn past the end of the song into a channel that already runs past it",
	"#amk 2\n#0 o4 c2 r1\n#1 o4 c2\n",
	0,
	() => ({ kind: "spawn", startTick: 144, ticks: 48, written: NOTE_MIN + 36 + 2, drum: null }),
	{ text: "#amk 2\n#0 o4 c2 r4 d4 r2\n#1 o4 c2\nr2\n", playsFor: 192 },
);

// Nothing was moved, so nothing reaches past the end and the song keeps its
// length — a channel already running long stays long rather than dragging every
// other one out to its tail.
expectEdit(
	"a note deleted from a channel that runs past the song does not lengthen it",
	"#amk 2\n#0 o4 c2 d2 e2 f2\n#1 o4 c2\n",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 2)] }),
	{ playsAsLong: true },
);
