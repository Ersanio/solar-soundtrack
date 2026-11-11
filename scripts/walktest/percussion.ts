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
	// says the instrument survives a `$D0` byte. Which of them counts as
	// percussion is a preference and lives in the app — `percussion.ts`, covered
	// by `charttest`.
	check(
		"the song says which instruments it sounds",
		melodic.usedInstruments.join(",") === "29",
		melodic.usedInstruments.join(","),
	);

	// A drum reached only through a `$D0` byte emits no `$DA` at all
	// (`parser.ts:1930-1956`), so a list built from instrument commands alone
	// would miss it entirely.
	check("including one no $DA ever named", melodic.usedInstruments.includes(29));

	// The walk must have no opinion about which of them is a drum. `@10` is one
	// the roll calls percussion by default and `@11` is not, and nothing here
	// may be able to tell them apart — the moment this list starts sorting them,
	// a view preference has moved into a package that states driver facts.
	const alike = build("#amk 4\n#0 @10 o4 c\n#1 @11 o4 c\n").timeline;
	check(
		"a drum and a melodic slot are listed alike",
		alike.usedInstruments.join(",") === "10,11",
		alike.usedInstruments.join(","),
	);

	// Ascending and distinct, because the control draws one chip per entry.
	const repeated = build("#amk 4\n#0 @5 o4 c @1 d @5 e\n#1 @1 o4 c\n").timeline;
	check(
		"each instrument is listed once, ascending",
		repeated.usedInstruments.join(",") === "1,5",
		repeated.usedInstruments.join(","),
	);
}
