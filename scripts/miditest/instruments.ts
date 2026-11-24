/** `miditest`: every GM program on a reachable stock instrument, a part played where its instrument plays true, and the porter's choice of instrument written. */

import { DEFAULT_TRANSPOSE } from "@amk/core/hardcoded-tables";
import { GM_PROGRAMS } from "@amk/import/midi/gm";
import { keyRange } from "@amk/import/midi/write-mml";
import { check, section } from "../harness";
import { TABLES, imported, midiKey, note, played, problems, program, smf } from "./support";

section("instruments: the GM table");

check("128 programs", GM_PROGRAMS.length === 128);
check(
	"each is @0-@18 or a drum, never the unreachable @19 or @20",
	GM_PROGRAMS.every((n) => (n >= 0 && n <= 18) || (n >= 21 && n <= 29)),
);

section("instruments: range");

for (const instrument of [...new Set(GM_PROGRAMS)].filter((n) => n <= 18)) {
	const gm = GM_PROGRAMS.indexOf(instrument);
	// Every key from below the lowest an instrument plays to above the highest.
	const events = [program(0, 0, gm), ...Array.from({ length: 88 }, (_, i) => note(i * 24, 0, 21 + i, 24)).flat()];
	const { song } = imported(smf([events]), { grid: 1 });
	check(
		`@${instrument} takes the whole keyboard, folded into range`,
		song.result.ok && problems(song).length === 0,
		problems(song).slice(0, 3).join("; "),
	);
	const range = keyRange(instrument, TABLES);
	const keys = played(song, 0).map(midiKey);
	check(
		`@${instrument}'s notes are all within ${range.low}-${range.high}`,
		keys.every((key) => key !== null && key >= range.low && key <= range.high),
		keys.join(","),
	);
}

{
	// A bass line two octaves above where @8 plays true is moved down whole, not folded note by note.
	const events = [program(0, 0, 32), ...[72, 76, 79, 84].flatMap((key, i) => note(i * 96, 0, key, 96))];
	const { song, written } = imported(smf([events]));
	const keys = played(song, 0).map(midiKey);
	check("a part out of its instrument's range is moved by octaves", keys.join(",") === "48,52,55,60", keys.join(","));
	check(
		"and that is reported",
		written.warnings.some((w) => w.code === "shifted" && w.octaves === -2),
	);
}

section("instruments: the porter's choice");

{
	const bytes = smf([[program(0, 0, 0), ...note(0, 0, 60, 96)]]);
	const plain = imported(bytes);
	check("a piano is @9", played(plain.song, 0)[0]?.state.instrument === 9);
	const chosen = imported(bytes, { instruments: new Map([[plain.midi.parts[0].id, 6]]) });
	check("a chosen instrument replaces it", played(chosen.song, 0)[0]?.state.instrument === 6);
	check("at the same pitch", midiKey(played(chosen.song, 0)[0]) === 60 && DEFAULT_TRANSPOSE[6] === 0);
}

{
	// A program change halfway: the part plays both instruments, each where it was set.
	const events = [program(0, 0, 0), ...note(0, 0, 60, 96), program(96, 0, 56), ...note(96, 0, 62, 96)];
	const { song } = imported(smf([events]));
	check(
		"a program change mid-part changes the instrument there",
		played(song, 0)
			.map((n) => n.state.instrument)
			.join(",") === "9,6",
	);
}
