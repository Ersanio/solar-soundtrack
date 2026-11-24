/** `miditest`: what a MIDI does to a note, as the driver hears it — volume, pan, velocity, pitch bend as `$DD`, modulation as vibrato, reverb as echo, and the loop markers. */

import { DEFAULT_TRANSPOSE } from "@amk/core/hardcoded-tables";
import { check, section } from "../harness";
import { bend, cc, codes, imported, marker, midiKey, note, played, problems, smf } from "./support";

const Q = 96;
const ECHO_HAZARDS = /^SST05(04|05|06)$/;

section("effects: volume, pan, velocity");

{
	const { song } = imported(smf([[cc(0, 0, 7, 64), cc(0, 0, 11, 127), ...note(0, 0, 60, Q)]]));
	check("CC7 64 is v129", played(song, 0)[0]?.state.volume === 129, `${played(song, 0)[0]?.state.volume}`);
}

{
	const { song } = imported(smf([[cc(0, 0, 7, 127), cc(0, 0, 11, 64), ...note(0, 0, 60, Q)]]));
	check("CC11 scales it the same way", played(song, 0)[0]?.state.volume === 129);
}

{
	const events = [
		cc(0, 0, 10, 0),
		...note(0, 0, 60, Q),
		cc(Q, 0, 10, 127),
		...note(Q, 0, 62, Q),
		cc(2 * Q, 0, 10, 64),
		...note(2 * Q, 0, 64, Q),
	];
	const { song } = imported(smf([events]));
	const pans = played(song, 0).map((n) => n.state.pan);
	check("hard left is y20, hard right y0, the centre y10", pans.join(",") === "20,0,10", pans.join(","));
}

{
	const { song } = imported(smf([[...note(0, 0, 60, Q, 127), ...note(Q, 0, 62, Q, 20)]]));
	const q = played(song, 0).map((n) => n.state.quantization);
	check("velocity 127 is q7F", q[0] === 0x7f, `${q[0]?.toString(16)}`);
	check(
		"a soft note has a lower velocity nybble",
		(q[1] ?? 0) < 0x7f && (q[1] ?? 0) >> 4 === 7,
		`${q[1]?.toString(16)}`,
	);
}

{
	const events = [
		cc(0, 0, 11, 127),
		...note(0, 0, 60, 4 * Q),
		cc(Q, 0, 11, 90),
		cc(2 * Q, 0, 11, 60),
		cc(3 * Q, 0, 11, 30),
	];
	const { written, song } = imported(smf([events]));
	check(
		"a fade under a held note is a volume fade",
		/\bv\d+,\d+\b/.test(written.text) && problems(song).length === 0,
		written.text,
	);
}

section("effects: pitch bend");

{
	// Bent up two semitones at the key-on: the note is written there.
	const { song } = imported(smf([[bend(0, 0, 16383), ...note(0, 0, 60, Q)]]));
	check("a bend in force at the key-on is in the written pitch", midiKey(played(song, 0)[0]) === 62);
}

{
	// RPN 0 set to twelve semitones, then a full bend.
	const events = [cc(0, 0, 101, 0), cc(0, 0, 100, 0), cc(0, 0, 6, 12), bend(0, 0, 16383), ...note(0, 0, 60, Q)];
	const { song } = imported(smf([events]));
	check("RPN 0 sets the bend range", midiKey(played(song, 0)[0]) === 72);
}

{
	// A ramp from the centre to two semitones up over the first half of the note.
	const ramp = Array.from({ length: 9 }, (_, i) => bend(i * 6, 0, Math.min(16383, 8192 + i * 1024)));
	const { song, written } = imported(smf([[...note(0, 0, 60, 2 * Q), ...ramp]]));
	const walked = played(song, 0);
	const slide = walked.find((n) => n.bend !== null)?.bend;
	check("a bend within a note is a $DD", written.text.includes("$DD"), written.text);
	check(
		"which slides to two semitones up",
		slide?.target === 0x80 + 62 - 24 - (DEFAULT_TRANSPOSE[9] ?? 0),
		JSON.stringify(slide),
	);
	check("and raises nothing, SST0507 included", problems(song).length === 0, problems(song).join("; "));
	check(
		"the note still lasts as long",
		walked.reduce((sum, n) => sum + n.ticks, 0) === 96,
		walked.map((n) => n.ticks).join(","),
	);
}

{
	// Up and back down again within one long note.
	const up = Array.from({ length: 5 }, (_, i) => bend(i * 6, 0, 8192 + i * 2047));
	const down = Array.from({ length: 5 }, (_, i) => bend(2 * Q + i * 6, 0, 16383 - i * 2047));
	const { song, written } = imported(smf([[...note(0, 0, 60, 4 * Q), ...up, ...down]]));
	check("a bend up and back is two slides", (written.text.match(/\$DD/g) ?? []).length === 2, written.text);
	check("and raises nothing", problems(song).length === 0, problems(song).join("; "));
}

{
	// A bend wiggling on the very grid it is snapped to: no slide that cannot fit is written.
	const wiggle = Array.from({ length: 32 }, (_, i) => bend(i * 3, 0, i % 2 ? 16383 : 0));
	const { song } = imported(smf([[...note(0, 0, 60, Q), ...wiggle]]), { grid: 1 });
	check("a bend too fast to follow raises nothing", problems(song).length === 0, problems(song).join("; "));
}

section("effects: modulation");

{
	const events = [cc(0, 0, 1, 127), ...note(0, 0, 60, Q), cc(Q, 0, 1, 0), ...note(Q, 0, 62, Q)];
	const { song } = imported(smf([events]));
	const [held, free] = played(song, 0);
	check("the mod wheel up is vibrato", (held?.state.vibrato?.depth ?? 0) > 0, JSON.stringify(held?.state.vibrato));
	check(
		"and down again is none",
		free?.state.vibrato === null || free?.state.vibrato?.depth === 0,
		JSON.stringify(free?.state.vibrato),
	);
}

section("effects: reverb as echo");

{
	const bytes = smf([[cc(0, 0, 91, 80), ...note(0, 0, 60, Q)], [...note(0, 1, 48, Q)]]);
	const { song, written } = imported(bytes);
	check(
		"a reverb send writes one echo",
		(written.text.match(/\$EF/g) ?? []).length === 1 && (written.text.match(/\$F1/g) ?? []).length === 1,
	);
	check("on the channel that sends it", written.text.includes("$EF $01 "), written.text);
	check(
		"which does not run away",
		!codes(song).some((code) => ECHO_HAZARDS.test(code)) && problems(song).length === 0,
		problems(song).join("; "),
	);
	check("and gets an echo buffer", (song.result.stats?.echoBufferSize ?? 0) > 0);
	const dry = imported(bytes, { echo: false });
	check("with echo off, none", !dry.written.text.includes("$EF"));
}

section("effects: loop markers");

{
	const events = [
		...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => note(i * Q, 0, 60 + i, Q)),
		marker(4 * Q, "loopStart"),
		marker(8 * Q, "loopEnd"),
	];
	const { song } = imported(smf([events, [...note(0, 1, 48, 8 * Q)]]));
	check("the loop starts at the marker", song.timeline?.loopTick === 192, `${song.timeline?.loopTick}`);
	check("and ends at its end", song.timeline?.ticks === 384, `${song.timeline?.ticks}`);
	check(
		"a note held across the loop point is struck again there",
		played(song, 1)
			.map((n) => n.tick)
			.join(",") === "0,192",
	);
	check("and it raises nothing", problems(song).length === 0, problems(song).join("; "));
	const whole = imported(smf([events]), { loop: "song" });
	check(
		"the whole song loops when asked",
		(whole.song.timeline?.loopTick ?? 0) === 0,
		`${whole.song.timeline?.loopTick}`,
	);
}

{
	const events = [cc(0, 0, 111, 0), ...note(0, 0, 60, Q), cc(Q, 0, 111, 0), ...note(Q, 0, 62, Q)];
	const { midi } = imported(smf([events]));
	check("CC111 marks the loop start", midi.performance.loop?.start === 0);
}
