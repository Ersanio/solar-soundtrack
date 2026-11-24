/** `miditest`: parts that never sound at once sharing a channel — when the porter asks for it, never for parts that overlap, and with every note still walked where the file plays it. */

import { CHANNEL_LIMIT, fits, packChannels } from "@amk/import/midi";
import { check, section } from "../harness";
import { type Ev, imported, midiKey, note, played, problems, program, smf } from "./support";

const Q = 96;
const BAR = 4 * Q;

/** A part on its own MIDI channel that plays a quarter note on each beat of the bars given. */
function playsIn(channel: number, gm: number, key: number, bars: readonly number[]): Ev[] {
	return [
		program(0, channel, gm),
		...bars.flatMap((b) => [0, 1, 2, 3].flatMap((beat) => note(b * BAR + beat * Q, channel, key, Q))),
	];
}

section("sharing: parts that take turns");

{
	// A piano in bars 1 and 3, a trumpet in bars 2 and 4: they never sound together.
	const bytes = smf([[...playsIn(0, 0, 60, [0, 2]), ...playsIn(1, 56, 67, [1, 3])]]);
	const shared = imported(bytes, { share: true });
	check(
		"two parts that take turns share #0",
		shared.written.channels.length === 1 && shared.written.channels[0].length === 2,
		JSON.stringify(shared.written.channels),
	);
	const walked = played(shared.song, 0);
	check(
		"the walk plays both on #0, each in its own bars",
		walked.length === 16 &&
			walked.every(
				(n, i) =>
					n.tick === i * 48 &&
					n.ticks === 48 &&
					n.state.instrument === (Math.floor(i / 4) % 2 === 0 ? 9 : 6) &&
					midiKey(n) === (Math.floor(i / 4) % 2 === 0 ? 60 : 67),
			),
		walked.map((n) => `${n.tick}:@${n.state.instrument}:${midiKey(n)}`).join(" "),
	);
	check("and it raises nothing", problems(shared.song).length === 0, problems(shared.song).join("; "));

	const apart = imported(bytes, { share: false });
	check("without sharing, each has a channel", apart.written.channels.length === 2);
}

{
	// The same two parts, but the trumpet comes in a beat before the piano stops.
	const bytes = smf([[...playsIn(0, 0, 60, [0]), ...note(3 * Q, 1, 67, 2 * Q), ...playsIn(1, 56, 67, [2])]]);
	const { written } = imported(bytes, { share: true });
	check("parts that overlap do not share", written.channels.length === 2, JSON.stringify(written.channels));
}

{
	// A legato hand-over: the second part comes in four ticks before the first lets go.
	const bytes = smf([[...note(0, 0, 60, Q + 4), ...note(Q, 1, 64, Q)]]);
	const { written, song } = imported(bytes, { share: true });
	const walked = played(song, 0);
	check("a legato hand-over shares", written.channels.length === 1);
	check(
		"and both notes are walked, the first trimmed to meet the second",
		walked.map((n) => `${n.tick}+${n.ticks}`).join(" ") === "0+48 48+48",
		walked.map((n) => `${n.tick}+${n.ticks}`).join(" "),
	);
}

{
	// A drum hit inside a held note would cut it short, so a kit and a pad that overlap stay apart.
	const bytes = smf([[...note(0, 0, 60, BAR), ...note(Q, 9, 36, 6)]]);
	const { written } = imported(bytes, { share: true });
	check("a drum hit inside a held note does not share", written.channels.length === 2);
}

section("sharing: more parts than channels");

{
	// Twelve parts in four sections of three: three channels hold them all.
	const tracks = [0, 1, 2, 3].map((sectionIndex) =>
		[0, 1, 2].flatMap((v) =>
			playsIn(sectionIndex * 3 + v + (sectionIndex * 3 + v >= 9 ? 1 : 0), v * 8, 60 + v * 4, [sectionIndex]),
		),
	);
	const bytes = smf(tracks);
	const { midi, written, song } = imported(bytes, { share: true });
	check("twelve parts are kept", midi.suggestedShared.length === 12, midi.suggestedShared.join(", "));
	check("on three channels", written.channels.length === 3, JSON.stringify(written.channels));
	check("every note is walked", [0, 1, 2].reduce((sum, ch) => sum + played(song, ch).length, 0) === 48);
	check("and it raises nothing", problems(song).length === 0, problems(song).join("; "));

	const nine = midi.parts.slice(0, 9).map((p) => p.id);
	check("sharing lets a ninth part in", fits(midi.parts, nine, midi.clash, CHANNEL_LIMIT));
	check("one a channel, eight is the most", midi.suggested.length === CHANNEL_LIMIT);
}

{
	// Ten parts that all play at once still need ten channels, so sharing keeps eight.
	const keys = [48, 52, 55, 59, 60, 62, 64, 67, 71, 72];
	const { midi, written } = imported(smf([keys.flatMap((key) => note(0, 0, key, Q))]), { share: true });
	check("parts that all overlap keep eight", midi.suggestedShared.length === 8 && written.channels.length === 8);
	check(
		"and pack one a channel",
		packChannels(midi.parts, midi.suggestedShared, midi.clash).every((channel) => channel.length === 1),
	);
}
