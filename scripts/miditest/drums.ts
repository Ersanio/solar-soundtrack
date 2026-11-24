/** `miditest`: drums — channel 10, a GS rhythm part and XG's drum bank read as kits, kit families split apart, and every GM key played on a stock drum or the bongo. */

import { GM_DRUMS } from "@amk/import/midi/gm";
import { check, section } from "../harness";
import { cc, imported, note, played, problems, program, smf, sysex } from "./support";

const Q = 96;

section("drums: which channel is a kit");

{
	const { midi } = imported(smf([[...note(0, 9, 36, Q)]]));
	check("channel 10 is a kit", midi.parts[0]?.drums === true);
}

{
	// GS: part 3 (block 13) used for rhythm, then part 10 (block 10) turned back to normal.
	const { midi } = imported(
		smf([
			[
				sysex(0, [0x41, 0x10, 0x42, 0x12, 0x40, 0x13, 0x15, 0x01, 0x17, 0xf7]),
				sysex(0, [0x41, 0x10, 0x42, 0x12, 0x40, 0x10, 0x15, 0x00, 0x1b, 0xf7]),
				...note(0, 2, 36, Q),
				...note(0, 9, 60, Q),
			],
		]),
	);
	check("a GS rhythm part is a kit", midi.parts.find((p) => p.channel === 2)?.drums === true);
	check("a GS normal part 10 is not", midi.parts.find((p) => p.channel === 9)?.drums === false);
}

{
	const { midi } = imported(smf([[cc(0, 4, 0, 127), program(0, 4, 0), ...note(0, 4, 38, Q)]]));
	check("XG's drum bank is a kit", midi.parts[0]?.drums === true);
}

section("drums: families");

{
	// Kick, snare and hi-hat on every beat, struck together.
	const events = [0, 1, 2, 3].flatMap((i) => [...note(i * Q, 9, i % 2 ? 38 : 36, 12), ...note(i * Q, 9, 42, 12)]);
	const { midi, song } = imported(smf([events]));
	check(
		"kick and snare are one part, the hi-hat another",
		midi.parts.map((p) => p.family).join(",") === "kick-snare,cymbals",
	);
	check(
		"the kick and snare are walked as @21 and @27",
		played(song, 0)
			.map((n) => n.percussion)
			.join(",") === "0,6,0,6",
	);
	check(
		"the hi-hat as @23",
		played(song, 1)
			.map((n) => n.percussion)
			.join(",") === "2,2,2,2",
	);
	check("and it raises nothing", problems(song).length === 0, problems(song).join("; "));
}

{
	const events = [...note(0, 9, 36, 12), ...note(0, 9, 38, 12)];
	const { midi } = imported(smf([events]));
	check(
		"a kick and snare struck together split the family",
		midi.parts.length === 2 && midi.parts.every((p) => p.family === "kick-snare"),
	);
}

section("drums: every key");

{
	const keys = [...GM_DRUMS.keys()];
	const { midi, song } = imported(smf([keys.flatMap((key, i) => note(i * 24, 9, key, 12))]), { grid: 1 });
	const walked = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((ch) => played(song, ch));
	check("every mapped key compiles", song.result.ok && problems(song).length === 0, problems(song).join("; "));
	check("every hit is walked", walked.length === keys.length, `${walked.length} of ${keys.length}`);
	check(
		"each is a stock drum or the bongo at a pitch",
		walked.every((n) => n.percussion !== null || n.state.instrument === 12),
		JSON.stringify(
			walked.filter((n) => n.percussion === null && n.state.instrument !== 12).map((n) => n.state.instrument),
		),
	);
	check("three families", new Set(midi.parts.map((p) => p.family)).size === 3);
}

{
	const { written } = imported(smf([[...note(0, 9, 36, Q), ...note(Q, 9, 100, Q)]]));
	check(
		"a key no drum stands in for is counted",
		written.warnings.some((w) => w.code === "unmapped-drums" && w.count === 1),
	);
}
