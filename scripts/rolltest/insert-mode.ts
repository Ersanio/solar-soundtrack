/** `rolltest`: insert mode — the notes in the way move aside. */

import "../localize";
import { NOTE_MIN } from "@amk/core/hardcoded-tables";
import { section } from "../harness";
import { expectEdit, noteAt } from "./support";

// --- insert mode: the notes in the way move aside --------------------------

section("insert");
expectEdit("a note dragged onto the one after it, pushing it right", "#amk 2\n#0 o4 c4 d4 e4", 0, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 0)],
	deltaTicks: 24,
	deltaKeys: 0,
	copy: false,
}));

expectEdit("a note dragged onto the one before it, pushing it left", "#amk 2\n#0 o4 r4 c4 d4", 0, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 1)],
	deltaTicks: -24,
	deltaKeys: 0,
	copy: false,
}));

// The cascade's `fixed` set: the selection shoves the outsider and keeps its
// own spacing, rather than one of its notes moving the next.
expectEdit("a selection dragged onto an outsider pushes only the outsider", "#amk 2\n#0 o4 c8 d8 r4 e8", 0, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 0), noteAt(bar, 1)],
	deltaTicks: 60,
	deltaKeys: 0,
	copy: false,
}));

// In the octave already in force, so what is pinned here is the push rather
// than the spelling of a note that also has to carry an `o`.
expectEdit("a note drawn over the one after it, pushing it right", "#amk 2\n#0 o4 c4 r8 d4", 0, () => ({
	kind: "spawn",
	startTick: 48,
	ticks: 48,
	written: NOTE_MIN + 36 + 4,
	drum: null,
}));

expectEdit("a note stretched, pushing the one after it", "#amk 2\n#0 o4 c4 d4 e4", 0, (bar) => ({
	kind: "stretch",
	items: [noteAt(bar, 0)],
	edge: "end",
	deltaTicks: 48,
}));
