/** `xmtest`: instruments — the volume envelope with its sustain and loop, a key off releasing it and the fadeout ending the note, the panning envelope, an instrument with no note, and the auto-vibrato as `$DE`. */

import { check, section } from "../harness";
import { type Cell, type InstrumentSpec, imported, pattern, played, problems, square, xmBytes } from "./support";

const LOOPED = { pcm: square(32, 8), loopStart: 0, loopLength: 256 };
const one = (instrument: InstrumentSpec, cells: [number, number, Cell][]) =>
	imported(xmBytes({ instruments: [instrument], orders: [0], patterns: [pattern(cells)] }));
const clean = (name: string, imp: ReturnType<typeof one>): void =>
	check(`${name} raises nothing`, problems(imp.song).length === 0, problems(imp.song).join("; "));

section("instruments: the volume envelope");

{
	// Up to 64 over 4 ticks, down to 32 by tick 12 and held there until the key off.
	const imp = one(
		{
			samples: [LOOPED],
			volumeEnvelope: {
				points: [
					[0, 0],
					[4, 64],
					[12, 32],
					[20, 0],
				],
				sustain: 2,
			},
			fadeout: 0,
		},
		[
			[0, 0, { note: "C-4", instrument: 1 }],
			[8, 0, { note: 97 }],
		],
	);
	const v = imp.xm.play.channels[0].volume;
	check("the envelope rises from 0 to the full volume", v[0] === 0 && v[4] === 64 && v[2] === 32, v.slice(0, 6).join());
	check("and holds at its sustain point", v[12] === 32 && v[47] === 32, `${v[12]} ${v[47]}`);
	check("a key off lets it run on to 0", v[56] === 0 && v[50] > 0 && v[50] < 32, v.slice(48, 58).join());
	const walked = played(imp.song, 0);
	check(
		"the note ends where the envelope reaches 0",
		walked.length === 1 && walked[0].ticks <= 57 * 2,
		String(walked[0]?.ticks),
	);
	clean("a volume envelope", imp);
}

{
	const imp = one(
		{
			samples: [LOOPED],
			volumeEnvelope: {
				points: [
					[0, 64],
					[4, 16],
					[8, 64],
				],
				loop: [0, 2],
			},
		},
		[[0, 0, { note: "C-4", instrument: 1 }]],
	);
	const v = imp.xm.play.channels[0].volume;
	check("a loop repeats the envelope", v[4] === 16 && v[8] === 64 && v[12] === 16, v.slice(0, 14).join());
	clean("a looped envelope", imp);
}

{
	const imp = one(
		{
			samples: [LOOPED],
			volumeEnvelope: {
				points: [
					[0, 64],
					[10, 64],
				],
				sustain: 1,
			},
			fadeout: 4096,
		},
		[
			[0, 0, { note: "C-4", instrument: 1 }],
			[1, 0, { note: 97 }],
		],
	);
	const v = imp.xm.play.channels[0].volume;
	check(
		"the fadeout takes 32768 to 0 at 4096 a tick, from the key off's own tick",
		v[5] === 64 && v[6] === 56 && v[13] === 0,
		v
			.slice(5, 16)
			.map((x) => x.toFixed(0))
			.join(),
	);
	clean("a fadeout", imp);
}

{
	const imp = one(
		{
			samples: [{ ...LOOPED, volume: 40 }],
			volumeEnvelope: {
				points: [
					[0, 64],
					[2, 0],
				],
			},
		},
		[
			[0, 0, { note: "C-4", instrument: 1 }],
			[2, 0, { instrument: 1 }],
		],
	);
	const v = imp.xm.play.channels[0].volume;
	check("an instrument with no note restarts its envelope", v[3] === 0 && v[12] === 40, `${v[3]} ${v[12]}`);
	check("and strikes nothing", played(imp.song, 0).length === 1);
}

section("instruments: panning and auto-vibrato");

{
	const imp = one(
		{
			samples: [{ ...LOOPED, panning: 128 }],
			panEnvelope: {
				points: [
					[0, 0],
					[8, 64],
				],
			},
		},
		[[0, 0, { note: "C-4", instrument: 1 }]],
	);
	const pans = imp.xm.play.channels[0].pan;
	check(
		"the panning envelope sweeps from left to right",
		pans[0] === 0 && pans[4] === 128 && pans[8] === 255,
		`${pans[0]} ${pans[4]} ${pans[8]}`,
	);
	clean("a panning envelope", imp);
}

{
	const imp = one({ samples: [LOOPED], autoVibrato: { depth: 8, rate: 16 } }, [[0, 0, { note: "C-4", instrument: 1 }]]);
	check("the auto-vibrato is $DE", /\$DE \$00 \$08 \$[0-9A-F]{2}/.test(imp.written.text), imp.written.text);
	clean("an auto-vibrato", imp);
}
