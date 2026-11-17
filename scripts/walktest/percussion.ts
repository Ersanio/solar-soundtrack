/** `walktest`: percussion follows the channel it is written on. */

import "../localize";
import { check, section } from "../harness";
import { build } from "./support";

// ---------------------------------------------------------------------------
section("percussion follows the channel it is written on");
// ---------------------------------------------------------------------------
{
	// `parser.ts:2748-2754` clears the instrument after the first remapped note,
	// except on the SFX channels. So the same three notes are one drum and two
	// pitched notes on #0, and three drums on #6 — which is the behaviour a
	// source-level pass would have to re-derive and this one gets for free.
	const melodic = build("#amk 4\n#0 @29 o2 a1 b2 c3\n").timeline;
	const drums = build("#amk 4\n#0 o4 c1 c2 c3\n#6 @29 o2 a1 b2 c3\n").timeline.notes.filter((n) => n.channel === 6);

	check(
		"on #0 a drum is followed by pitched notes",
		melodic.notes.length === 3 &&
			melodic.notes[0].percussion === 8 &&
			melodic.notes[1].percussion === null &&
			melodic.notes[2].percussion === null,
		melodic.notes.map((n) => `$${n.note.toString(16)}`).join(" "),
	);
	check(
		"and those notes keep the drum's own instrument",
		melodic.notes[1].state.instrument === 29,
		`instrument ${String(melodic.notes[1].state.instrument)}`,
	);
	check(
		"on #6 every note is the drum",
		drums.length === 3 && drums.every((n) => n.percussion === 8),
		drums.map((n) => `$${n.note.toString(16)}`).join(" "),
	);
	// Those three assertions are the *entire* foundation the roll's lane rule
	// stands on: it places a note by the instrument in force, and this is what
	// says the instrument survives a `$D0` byte. Which instruments get a lane is
	// the roll's call — `percussion.ts`, covered by `charttest`.
}
