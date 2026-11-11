/** `rolltest`: overwrite mode — the notes already there give up the ticks. */

import "../localize";
import { section } from "../harness";
import { expectEdit, noteAt } from "./support";

// --- overwrite mode: the notes already there give up the ticks -------------
//
// Every case here pins `playsAsLong`, and that is the point of the mode rather
// than a detail of it: a carve only ever takes ticks that were already the
// channel's, so the song has to be exactly as long afterwards. A carve that
// lengthened the song would mean `reach` had counted a note nothing moved.

section("overwrite");
expectEdit(
	"a note dragged onto the one after it, which gives up its head",
	"#amk 2\n#0 o4 c4 d4 e4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 24, deltaKeys: 0, copy: false }),
	{ mode: "overwrite", playsAsLong: true, contains: "d8" },
);

expectEdit(
	"a note dragged over one that gives up all of them",
	"#amk 2\n#0 o4 c4 d4 e4 f4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 48, deltaKeys: 0, copy: false }),
	{ mode: "overwrite", playsAsLong: true, lacks: "d" },
);
