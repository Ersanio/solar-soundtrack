/** `miditest`: drums — channel 10, a GS rhythm part and XG's drum bank read as kits, kit families split apart, every GM key played on a stock drum or the bongo, and the porter's drum map. */

import { GM_DRUMS } from "@amk/import/midi/gm";
import { check, section } from "../harness";
import { cc, imported, midiKey, note, played, problems, program, smf, sysex } from "./support";

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
	const { midi, written } = imported(smf([[...note(0, 9, 36, Q), ...note(Q, 9, 100, Q)]]));
	check(
		"a key no drum stands in for is counted",
		written.warnings.some((w) => w.code === "unmapped-drums" && w.count === 1),
	);
	check("and is not among the drum keys", [...midi.drumKeys].join(";") === "36,1");
}

section("drums: the porter's drum map");

{
	const events = [0, 1, 2, 3].flatMap((i) => [...note(i * Q, 9, i % 2 ? 38 : 36, 12), ...note(i * Q, 9, 42, 12)]);
	const bytes = smf([events]);
	const stock = imported(bytes);
	const counted = [...stock.midi.drumKeys].sort((a, b) => a[0] - b[0]).join(";");
	check("drum keys count the hits on each key", counted === "36,2;38,2;42,4", counted);

	const snare = imported(bytes, { drums: new Map([[38, { instrument: 26 }]]) });
	check(
		"the snare on @26 is walked as @26, the kick still @21",
		played(snare.song, 0)
			.map((n) => n.percussion)
			.join(",") === "0,5,0,5",
	);

	const pitched = imported(bytes, { drums: new Map([[36, { instrument: 12, key: 48 }]]) });
	const kicks = played(pitched.song, 0).filter((n) => n.percussion === null);
	check(
		"the kick on @12 at a pitch is walked there",
		kicks.length === 2 && kicks.every((n) => n.state.instrument === 12 && midiKey(n) === 48),
		JSON.stringify(kicks.map((n) => [n.state.instrument, midiKey(n)])),
	);
	check("and raises nothing", problems(pitched.song).length === 0, problems(pitched.song).join("; "));
	check(
		"the parts are the same whatever the map",
		JSON.stringify(pitched.written.channels) === JSON.stringify(stock.written.channels),
	);

	const high = imported(bytes, { drums: new Map([[42, { instrument: 8, key: 100 }]]) });
	check(
		"a sound pitched past its instrument's range is folded",
		high.written.warnings.some((w) => w.code === "folded"),
	);
	check("and raises nothing", problems(high.song).length === 0, problems(high.song).join("; "));
}
