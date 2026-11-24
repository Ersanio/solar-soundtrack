/** `miditest`: a multi-track song imported whole — it compiles clean, and every note the file plays is walked at its tick and pitch. */

import { check, info, section } from "../harness";
import { imported, midiKey, note, played, problems, program, smf, tempo, trackName } from "./support";

section("end to end: a four-part song");

const Q = 96;
const conductor = [trackName(0, "Test Song"), tempo(0, 120)];
const melody = [
	trackName(0, "Lead"),
	program(0, 0, 73),
	...[72, 74, 76, 77, 79, 77, 76, 74].flatMap((key, i) => note(i * Q, 0, key, Q)),
];
const bass = [
	trackName(0, "Bass"),
	program(0, 1, 33),
	...[48, 48, 43, 43].flatMap((key, i) => note(i * 2 * Q, 1, key, 2 * Q)),
];
const kit = [...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => note(i * Q, 9, i % 2 === 0 ? 36 : 38, Q / 4))];
const { midi, written, song } = imported(smf([conductor, melody, bass, kit]));

info(written.text);
check("it compiles", song.result.ok, problems(song).join("; "));
check("it raises nothing", problems(song).length === 0, problems(song).join("; "));
check("three parts, all kept", midi.parts.length === 3 && written.channels.length === 3, written.channels.join(", "));
check(
	"the title is the conductor track's name",
	song.result.stats?.tags?.title === "Test Song",
	JSON.stringify(song.result.stats?.tags),
);

const lead = played(song, 0);
check(
	"the lead is walked note for note",
	lead.length === 8 &&
		lead.every((n, i) => n.tick === i * 48 && n.ticks === 48 && midiKey(n) === [72, 74, 76, 77, 79, 77, 76, 74][i]),
	lead.map((n) => `${n.tick}+${n.ticks}:${midiKey(n)}`).join(" "),
);
const low = played(song, 1);
check(
	"the bass is walked note for note",
	low.length === 4 && low.every((n, i) => n.tick === i * 96 && midiKey(n) === [48, 48, 43, 43][i]),
	low.map((n) => `${n.tick}+${n.ticks}:${midiKey(n)}`).join(" "),
);
const drums = played(song, 2);
check(
	"the kit is walked as drums",
	drums.length === 8 && drums.every((n, i) => n.percussion === (i % 2 === 0 ? 0 : 6)),
	drums.map((n) => `${n.tick}:${n.percussion}`).join(" "),
);
