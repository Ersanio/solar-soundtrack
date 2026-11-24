/** `miditest`: a channel's chords split into parts that play one note at a time, a melody and its bass kept apart, the pedal held, and eight parts kept out of more. */

import { check, section } from "../harness";
import { cc, imported, midiKey, note, played, problems, smf } from "./support";

const Q = 96;

section("voices: chords");

{
	const chord = (tick: number, keys: number[]) => keys.flatMap((key) => note(tick, 0, key, 2 * Q));
	const { midi, song } = imported(smf([[...chord(0, [60, 64, 67]), ...chord(2 * Q, [62, 65, 69])]]));
	check("a three-note chord is three parts", midi.parts.length === 3, midi.parts.map((p) => p.id).join(", "));
	const tops = [0, 1, 2].map((channel) => played(song, channel).map(midiKey).join(","));
	check(
		"the top line is the first part, and each keeps its line",
		tops.join(" | ") === "67,69 | 64,65 | 60,62",
		tops.join(" | "),
	);
	check(
		"each part's notes follow one another",
		[0, 1, 2].every((ch) =>
			played(song, ch).every((n, i, all) => i === 0 || all[i - 1].tick + all[i - 1].ticks <= n.tick),
		),
	);
	check("and it raises nothing", problems(song).length === 0, problems(song).join("; "));
}

{
	// A melody over a held bass, both on one channel.
	const events = [...note(0, 0, 36, 4 * Q), ...[72, 74, 76, 77].flatMap((key, i) => note(i * Q, 0, key, Q))];
	const { midi, song } = imported(smf([events]));
	check("a melody over a held bass is two parts", midi.parts.length === 2);
	check(
		"the melody is the first",
		played(song, 0).map(midiKey).join(",") === "72,74,76,77",
		played(song, 0).map(midiKey).join(","),
	);
	check("the bass the second", played(song, 1).map(midiKey).join(",") === "36", played(song, 1).map(midiKey).join(","));
}

{
	// Each note overlaps the next by four ticks, as a legato line does.
	const events = [60, 62, 64, 65].flatMap((key, i) => note(i * Q, 0, key, Q + 4));
	const { midi, song } = imported(smf([events]));
	check("a legato overlap is one part", midi.parts.length === 1, midi.parts.map((p) => p.id).join(", "));
	// The last has nothing to meet, so it keeps its own length.
	check(
		"its notes are trimmed to meet",
		played(song, 0)
			.map((n) => n.ticks)
			.join(",") === "48,48,48,51",
		played(song, 0)
			.map((n) => n.ticks)
			.join(","),
	);
}

section("voices: the sustain pedal");

{
	const events = [cc(0, 0, 64, 127), ...note(0, 0, 60, 24), cc(Q * 2, 0, 64, 0)];
	const { song } = imported(smf([events]));
	check(
		"a note released under the pedal sounds until the pedal lifts",
		played(song, 0)[0]?.ticks === 96,
		`${played(song, 0)[0]?.ticks}`,
	);
}

{
	const events = [cc(0, 0, 64, 127), ...note(0, 0, 60, 24), ...note(Q, 0, 64, 24), cc(Q * 2, 0, 64, 0)];
	const { midi } = imported(smf([events]));
	check("two notes held over by the pedal overlap, so they are two parts", midi.parts.length === 2);
}

section("voices: more than eight");

{
	const keys = [48, 52, 55, 59, 60, 62, 64, 67, 71, 72];
	const { midi, written, song } = imported(smf([keys.flatMap((key) => note(0, 0, key, Q))]));
	check("ten notes at once are ten parts", midi.parts.length === 10);
	check("eight are suggested", midi.suggested.length === 8);
	check("eight are written", written.channels.length === 8 && song.result.ok, written.channels.join(", "));
}

{
	const keys = [48, 52, 55, 59, 60, 62, 64, 67, 71, 72];
	const midi = imported(smf([keys.flatMap((key) => note(0, 0, key, Q))])).midi;
	const keep = [midi.parts[9].id, midi.parts[0].id];
	const { written, song } = imported(smf([keys.flatMap((key) => note(0, 0, key, Q))]), { keep });
	check(
		"the parts kept are written in part order",
		written.channels.join(",") === `${keep[1]},${keep[0]}`,
		written.channels.join(","),
	);
	check("on #0 and #1", played(song, 0).map(midiKey).join() === "72" && played(song, 1).map(midiKey).join() === "48");
}

{
	// Two ten-note chords in turn: each part takes the same rank in every chord, so no line crosses another.
	const chords = [
		[48, 52, 55, 59, 60, 64, 67, 71, 72, 76],
		[45, 48, 52, 55, 57, 60, 64, 67, 69, 72],
	];
	const events = [0, 1, 2, 3].flatMap((bar) => chords[bar % 2].flatMap((key) => note(bar * 4 * Q, 0, key, 4 * Q)));
	const { midi } = imported(smf([events]));
	const ranked = midi.parts.every((part, rank) =>
		part.notes.every((n, i) => n.key === [...chords[i % 2]].sort((a, b) => b - a)[rank]),
	);
	check(
		"a chord's notes keep their rank from chord to chord",
		ranked,
		midi.parts.map((p) => p.notes.map((n) => n.key).join(",")).join(" | "),
	);
}

{
	// Eight pad voices outweigh a kit, but every instrument's first voice is kept before a second one.
	const pads = [48, 52, 55, 59, 60, 64, 67, 71, 72, 76].flatMap((key) => note(0, 1, key, 16 * Q));
	const kit = [0, 1, 2, 3].flatMap((i) => [...note(i * Q, 9, 36, 12), ...note(i * Q, 9, 42, 12)]);
	const { midi } = imported(smf([[...pads, ...kit, ...note(0, 0, 84, Q)]]));
	const kept = new Set(midi.suggested);
	const firsts = midi.parts.filter((p) => p.voice === 0);
	check(
		"each channel's and each kit family's first voice is suggested",
		firsts.length === 4 && firsts.every((p) => kept.has(p.id)),
		midi.suggested.join(", "),
	);
}
