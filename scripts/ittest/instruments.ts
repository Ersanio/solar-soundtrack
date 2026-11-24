/** `ittest`: instruments — the volume envelope with its sustain loop released by a note off, the fadeout, a looped envelope, the panning and pitch envelopes, the instrument's and sample's global volumes, a sample's auto-vibrato, and a New Note Action counted. */

import { check, section } from "../harness";
import { type Cell, type InstrumentSpec, imported, itBytes, pattern, played, problems, square } from "./support";

const LOOPED = { pcm: square(32, 8), loopStart: 0, loopLength: 256 };
const one = (instrument: InstrumentSpec, cells: [number, number, Cell][], sample = LOOPED) =>
	imported(itBytes({ instruments: [instrument], samples: [sample], orders: [0], patterns: [pattern(cells)] }));
const clean = (name: string, imp: ReturnType<typeof one>): void =>
	check(`${name} raises nothing`, problems(imp.song).length === 0, problems(imp.song).join("; "));

section("instruments: the volume envelope");

{
	const imp = one(
		{
			volumeEnvelope: {
				points: [
					[0, 0],
					[4, 64],
					[12, 32],
					[20, 0],
				],
				sustain: [2, 2],
			},
			fadeout: 0,
		},
		[
			[0, 0, { note: "C-5", instrument: 1 }],
			[8, 0, { note: "===" }],
		],
	);
	const v = imp.it.play.channels[0].volume;
	check("the envelope rises from 0 to the full volume", v[0] === 0 && v[4] === 64 && v[2] === 32, v.slice(0, 6).join());
	check("and holds at its sustain point", v[12] === 32 && v[47] === 32, `${v[12]} ${v[47]}`);
	check(
		"a note off lets it run on to 0, which ends the note",
		v[50] > 0 && v[50] < 32 && v[57] === 0,
		v.slice(48, 58).join(),
	);
	check("the note is struck once", played(imp.song, 0).length === 1);
	clean("a volume envelope", imp);
}

{
	const imp = one(
		{
			volumeEnvelope: {
				points: [
					[0, 64],
					[4, 16],
					[8, 64],
				],
				loop: [0, 2],
			},
		},
		[[0, 0, { note: "C-5", instrument: 1 }]],
	);
	const v = imp.it.play.channels[0].volume;
	check(
		"a loop repeats the envelope, its end and its start a tick each",
		v[4] === 16 && v[8] === 64 && v[9] === 64 && v[13] === 16,
		v.slice(0, 14).join(),
	);
	clean("a looped envelope", imp);
}

{
	const imp = one({ fadeout: 128 }, [
		[0, 0, { note: "C-5", instrument: 1 }],
		[1, 0, { note: "===" }],
	]);
	const v = imp.it.play.channels[0].volume;
	check(
		"without an envelope a note off fades the note out at 128 of 1024 a tick",
		v[5] === 64 && v[6] === 56 && v[13] === 0,
		v.slice(5, 15).join(),
	);
	clean("a fadeout", imp);
}

{
	const imp = one({ globalVolume: 64 }, [[0, 0, { note: "C-5", instrument: 1 }]], {
		...LOOPED,
		globalVolume: 32,
	} as typeof LOOPED);
	check(
		"the instrument's and the sample's global volumes multiply",
		imp.it.play.channels[0].volume[0] === 16,
		String(imp.it.play.channels[0].volume[0]),
	);
}

section("instruments: panning, pitch and auto-vibrato");

{
	const imp = one(
		{
			panEnvelope: {
				points: [
					[0, -32],
					[8, 32],
				],
			},
		},
		[[0, 0, { note: "C-5", instrument: 1 }]],
	);
	const pans = imp.it.play.channels[0].pan;
	check(
		"the panning envelope sweeps from left to right",
		pans[0] === 0 && pans[4] === 128 && pans[8] === 255,
		`${pans[0]} ${pans[4]} ${pans[8]}`,
	);
	clean("a panning envelope", imp);
}

{
	const imp = one(
		{
			pitchEnvelope: {
				points: [
					[0, 0],
					[4, 8],
				],
			},
		},
		[[0, 0, { note: "C-5", instrument: 1 }]],
	);
	const pitch = imp.it.play.channels[0].pitch;
	check(
		"the pitch envelope bends the note, half a semitone a step",
		pitch[0] === 0 && Math.abs(pitch[4] - 4) < 1e-9,
		`${pitch[0]} ${pitch[4]}`,
	);
	check("and is written as $DD", imp.written.text.includes("$DD"), imp.written.text);
	clean("a pitch envelope", imp);
}

{
	const imp = imported(
		itBytes({
			samples: [{ ...LOOPED, autoVibrato: { speed: 16, depth: 32 } }],
			orders: [0],
			patterns: [pattern([[0, 0, { note: "C-5", instrument: 1 }]])],
		}),
	);
	check("a sample's auto-vibrato is $DE", /\$DE \$00 \$08 \$[0-9A-F]{2}/.test(imp.written.text), imp.written.text);
	clean("an auto-vibrato", imp);
}

{
	const imp = one({ newNoteAction: 1 }, [
		[0, 0, { note: "C-5", instrument: 1 }],
		[4, 0, { note: "D-5", instrument: 1 }],
	]);
	check(
		"a note that would keep the last sounding is counted",
		imp.it.play.ignored.unsupported === 1,
		String(imp.it.play.ignored.unsupported),
	);
	check("and the new note cuts it", played(imp.song, 0).length === 2);
}
