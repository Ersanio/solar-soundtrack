/** `miditest`: time — every division lands on the driver's 48 ticks a quarter, each snap grid rounds as it says, and a tempo change is a `t` at its tick. */

import { tempoFor } from "@amk/import/midi/write-mml";
import { check, section } from "../harness";
import { imported, note, played, problems, smf, tempo } from "./support";

const spans = (notes: readonly { tick: number; ticks: number }[]): string =>
	notes.map((n) => `${n.tick}+${n.ticks}`).join(" ");

section("timing: divisions");

for (const ppq of [96, 480, 960]) {
	const { song } = imported(
		smf([[...note(0, 0, 60, ppq), ...note(ppq, 0, 62, ppq), ...note(3 * ppq, 0, 64, ppq / 2)]], 1, ppq),
	);
	const notes = played(song, 0);
	check(`${ppq} ticks a quarter`, spans(notes) === "0+48 48+48 144+24", spans(notes));
}

{
	// 25 frames of 40 ticks: 1000 ticks a second, so 500 is a quarter at 120 BPM.
	const division = ((256 - 25) << 8) | 40;
	const { song, written } = imported(smf([[...note(0, 0, 60, 500), ...note(500, 0, 62, 500)]], 1, division));
	const notes = played(song, 0);
	check("SMPTE time is played at 120 BPM", spans(notes) === "0+48 48+48" && /\bt48\b/.test(written.text), spans(notes));
	check(
		"and says so",
		written.warnings.some((w) => w.code === "smpte"),
	);
}

section("timing: the snap grid");

for (const [grid, expected] of [
	[1, 5],
	[2, 6],
	[3, 6],
	[4, 4],
	[6, 6],
	[12, 0],
] as const) {
	// Tick 10 at 96 a quarter is 5 driver ticks in.
	const { song } = imported(smf([[...note(10, 0, 60, 86), ...note(96, 0, 62, 96)]]), { grid });
	const first = played(song, 0)[0];
	check(`a grid of ${grid} ticks puts 5 on ${expected}`, first?.tick === expected, `${first?.tick}`);
	check(`and raises nothing at ${grid}`, problems(song).length === 0, problems(song).join("; "));
}

section("timing: tempo");

check("120 BPM is t48", tempoFor(500_000).tempo === 48);
check("150 BPM is t60", tempoFor(400_000).tempo === 60);
check("a tempo past t254 is clamped", tempoFor(60_000_000 / 1000).tempo === 254 && tempoFor(60_000_000 / 1000).clamped);

{
	const { song } = imported(
		smf([
			[tempo(0, 120), tempo(384, 150)],
			[...note(0, 0, 60, 384), ...note(384, 0, 62, 384)],
		]),
	);
	const changes = (song.timeline?.tempoChanges ?? []).map((c) => [c.tick, c.tempo]);
	check(
		"a tempo change is walked at its tick",
		changes.some(([tick]) => tick === 0) && changes.some(([tick]) => tick === 192) && changes.length === 2,
		JSON.stringify(changes),
	);
}

{
	// The change lands inside a note on the first channel, which is tied across it.
	const { song, written } = imported(smf([[tempo(0, 120), tempo(48, 90)], note(0, 0, 60, 192)]));
	const notes = played(song, 0);
	check("a tempo inside a note ties the note across it", notes.length === 1 && notes[0].ticks === 96, written.text);
	check(
		"and the tempo is walked there",
		(song.timeline?.tempoChanges ?? []).some((c) => c.tick === 24),
		JSON.stringify(song.timeline?.tempoChanges.map((c) => [c.tick, c.tempo])),
	);
}

{
	const { written } = imported(smf([[tempo(0, 1000)], note(0, 0, 60, 96)]));
	check(
		"a clamped tempo is reported",
		written.warnings.some((w) => w.code === "tempo-clamped" && w.tempo === 254),
	);
}

section("timing: the song's end");

{
	const { song } = imported(smf([[...note(0, 0, 60, 96)], [...note(0, 1, 48, 300)]]));
	check("every channel ends on the bar after the last note", song.timeline?.ticks === 192, `${song.timeline?.ticks}`);
	check("so none ends early", problems(song).length === 0, problems(song).join("; "));
}
