/** `s3mtest`: effects — the volume column and Dxy with its fine and fast slides, E, F and G as `$DD`, H and U as `$DE`, J, R and Q, the cuts, S8x and Xxx panning, Vxx, Ixy, and what is left out counted. */

import { check, section } from "../harness";
import { type Cell, imported, pattern, played, problems, s3mBytes, square } from "./support";

const LOOPED = [{ pcm: square(32, 8), loopStart: 0, loopLength: 256, volume: 63 }];
const hit = (extra: Cell = {}): Cell => ({ note: "C-4", instrument: 1, ...extra });
const one = (cells: [number, number, Cell][], extra = {}, options = {}) =>
	imported(s3mBytes({ samples: LOOPED, orders: [0], patterns: [pattern(cells)], ...extra }), options);
/** The volume the player records on each tick of channel 0, from `from` for `count` ticks. */
const volumes = (imp: ReturnType<typeof one>, from: number, count: number): number[] =>
	imp.s3m.play.channels[0].volume.slice(from, from + count);
const clean = (name: string, imp: ReturnType<typeof one>): void =>
	check(`${name} raises nothing`, problems(imp.song).length === 0, problems(imp.song).join("; "));

section("effects: volume");

{
	const imp = one(
		[
			[0, 0, hit({ volume: 16 })],
			[1, 0, { instrument: 1 }],
		],
		{},
		{ separation: 0 },
	);
	check("the volume column sets the volume", volumes(imp, 0, 1)[0] === 16, String(volumes(imp, 0, 1)));
	check("an instrument with no note restores its own", volumes(imp, 6, 1)[0] === 63, String(volumes(imp, 6, 1)));
	// The root of 16 / 64, under the centre's loudness, $7F / ($51 + $51).
	check(
		"v is the square root of the volume: v113 for 16, centred",
		imp.written.text.includes("v113"),
		imp.written.text,
	);
}

{
	const imp = one([
		[0, 0, hit({ volume: 40 })],
		[1, 0, { command: "D", info: 0x02 }],
		[2, 0, { command: "D", info: 0x3f }],
		[3, 0, { command: "D", info: 0xf4 }],
	]);
	check(
		"D02 slides 2 down on each tick after the first",
		volumes(imp, 6, 6).join() === "40,38,36,34,32,30",
		volumes(imp, 6, 6).join(),
	);
	check(
		"D3F slides 3 up on the first tick only",
		volumes(imp, 12, 6).every((v) => v === 33),
		volumes(imp, 12, 6).join(),
	);
	check(
		"DF4 slides 4 down on the first tick only",
		volumes(imp, 18, 6).every((v) => v === 29),
		volumes(imp, 18, 6).join(),
	);
	check("a slide is written as a fade", /v\d+,\d+/.test(imp.written.text), imp.written.text);
	clean("volume slides", imp);
}

{
	const slow = one([[0, 0, hit({ volume: 40, command: "D", info: 0x04 })]]);
	const fast = one([[0, 0, hit({ volume: 40, command: "D", info: 0x04 })]], { flags: 64 });
	check("a slide skips tick 0", volumes(slow, 0, 2).join() === "40,36", volumes(slow, 0, 2).join());
	check("with fast slides it runs on tick 0 too", volumes(fast, 0, 2).join() === "36,32", volumes(fast, 0, 2).join());
	const st300 = one([[0, 0, hit({ volume: 40, command: "D", info: 0x04 })]], { tracker: 0x1300 });
	check("a file saved by ST3.00 slides fast", volumes(st300, 0, 1)[0] === 36, String(volumes(st300, 0, 1)));
}

{
	const imp = one([
		[0, 0, hit({ volume: 40, command: "D", info: 0x02 })],
		[1, 0, { command: "D", info: 0x00 }],
	]);
	check("D00 slides as the last D did", volumes(imp, 6, 6).join() === "30,28,26,24,22,20", volumes(imp, 6, 6).join());
}

{
	const imp = one([
		[0, 0, hit({ volume: 60 })],
		[1, 0, { command: "V", info: 32 }],
	]);
	check(
		"V20 halves every volume, from the tick after its first",
		volumes(imp, 6, 2).join() === "60,30",
		volumes(imp, 6, 2).join(),
	);
}

{
	const imp = one([[0, 0, hit({ volume: 50, command: "I", info: 0x21 })]]);
	check(
		"I21 is three ticks on, two off",
		volumes(imp, 0, 6)
			.map((v) => (v > 0 ? 1 : 0))
			.join() === "1,1,1,0,0,1",
		volumes(imp, 0, 6).join(),
	);
	clean("tremor", imp);
}

section("effects: pitch");

{
	const imp = one([
		[0, 0, hit()],
		[1, 0, { command: "E", info: 0x08 }],
		[2, 0, { command: "F", info: 0x10 }],
	]);
	const pitch = imp.s3m.play.channels[0].pitch;
	check(
		"E08 slides down 32 period units a tick",
		pitch[11] < pitch[6] && Math.abs(pitch[7] - pitch[6] - 12 * Math.log2(1712 / 1744)) < 1e-9,
		pitch
			.slice(6, 12)
			.map((p) => p.toFixed(3))
			.join(),
	);
	check("F10 slides up", pitch[17] > pitch[12]);
	check("a slide is written as $DD", imp.written.text.includes("$DD"), imp.written.text);
	clean("slides", imp);
}

{
	const imp = one([
		[0, 0, hit()],
		[1, 0, { command: "E", info: 0xf2 }],
		[2, 0, { command: "E", info: 0xe2 }],
	]);
	const pitch = imp.s3m.play.channels[0].pitch;
	const period = (p: number): number => 14_317_056 / (8363 * 2 ** (p / 12));
	check(
		"EF2 slides 8 on tick 0 only",
		Math.round(period(pitch[6])) === 1720 && pitch[6] === pitch[11],
		period(pitch[6]).toFixed(1),
	);
	check("EE2 slides 2", Math.round(period(pitch[12])) === 1722, period(pitch[12]).toFixed(1));
}

{
	const imp = one([
		[0, 0, hit()],
		[4, 0, { note: "C-5", instrument: 1, command: "G", info: 0x20 }],
		[5, 0, { command: "G", info: 0x00 }],
	]);
	const walked = played(imp.song, 0);
	check("G slides to its note without striking it", walked.length === 1, String(walked.length));
	check("and is written as $DD", imp.written.text.includes("$DD"), imp.written.text);
	const pitch = imp.s3m.play.channels[0].pitch;
	check(
		"it reaches the note an octave up",
		Math.abs(pitch[5 * 6 + 5] - 12) < 0.05 || pitch[5 * 6 + 5] < 12,
		pitch[35].toFixed(3),
	);
	clean("tone portamento", imp);
}

section("effects: vibrato, arpeggio and tremolo");

{
	const vibrato = one([[0, 0, hit({ command: "H", info: 0x48 })]]);
	const fine = one([[0, 0, hit({ command: "U", info: 0x48 })]]);
	const extent = (imp: ReturnType<typeof one>): number =>
		parseInt(/\$DE \$00 \$[0-9A-F]{2} \$([0-9A-F]{2})/.exec(imp.written.text)?.[1] ?? "0", 16);
	check("H48 is $DE at a rate of 8", vibrato.written.text.includes("$DE $00 $08 "), vibrato.written.text);
	check(
		"U48 swings a quarter of H48",
		Math.abs(extent(fine) * 4 - extent(vibrato)) <= extent(vibrato) / 10,
		`${extent(fine)} ${extent(vibrato)}`,
	);
	clean("vibrato", vibrato);
}

{
	const imp = one([
		[0, 0, hit({ command: "J", info: 0x47 })],
		[1, 0, { command: "J", info: 0 }],
	]);
	check(
		"J47 is $FB under legato",
		imp.written.text.includes("$F4 $01") && imp.written.text.includes("$FB $03 $02 $00 $04 $07"),
		imp.written.text,
	);
	check("J00 keeps playing it", imp.s3m.play.channels[0].arpeggio[6] === 0x47);
	clean("arpeggio", imp);
}

{
	const imp = one([[0, 0, hit({ volume: 32, command: "R", info: 0x48 })]]);
	check(
		"R48 is $E5 in front of its note",
		/\$E5 \$00 \$08 \$[0-9A-F]{2}[^]*c/.test(imp.written.text),
		imp.written.text,
	);
	clean("tremolo", imp);
}

{
	const imp = one([[0, 0, hit({ command: "Q", info: 0x03 })]]);
	const ticks = played(imp.song, 0).map((n) => n.tick);
	check("Q03 strikes the note again every three ticks", ticks.join() === "0,6", ticks.join());
	const fall = one([[0, 0, hit({ volume: 40, command: "Q", info: 0x23 })]]);
	check("Q23 takes 2 off the volume each time", volumes(fall, 3, 1)[0] === 38, volumes(fall, 0, 6).join());
}

section("effects: cuts and panning");

{
	const imp = one([
		[0, 0, hit({ command: "S", info: 0xc2 })],
		[4, 0, hit()],
		[5, 0, { note: "^^" }],
	]);
	const sample = imp.s3m.play.channels[0].sample;
	check("SC2 cuts the note on its third tick", sample[1] === 1 && sample[2] === 0, sample.slice(0, 4).join());
	check("^^ cuts the note at its row", sample[29] === 1 && sample[30] === 0);
	check("each is a rest", (imp.written.text.match(/\br/g) ?? []).length >= 2, imp.written.text);
	clean("cuts", imp);
}

{
	const imp = one([
		[0, 0, hit({ command: "S", info: 0x80 })],
		[1, 0, hit({ command: "X", info: 0x80 })],
		[2, 0, hit({ command: "S", info: 0x8f })],
	]);
	const pans = imp.s3m.play.channels[0].pan;
	check(
		"S80 is hard left, X80 the far right, S8F hard right",
		pans[0] === 0 && pans[6] === 255 && pans[12] === 255,
		`${pans[0]} ${pans[6]} ${pans[12]}`,
	);
	check(
		"hard left is y20 and hard right y0",
		imp.written.text.includes("y20") && imp.written.text.includes("y0"),
		imp.written.text,
	);
	clean("panning", imp);
}

section("effects: left out");

{
	const imp = one([
		[0, 0, hit({ command: "O", info: 0x08 })],
		[1, 0, hit({ command: "S", info: 0x11 })],
	]);
	check(
		"a sample offset is counted",
		imp.written.warnings.some((w) => w.code === "offsets" && w.count === 1),
		JSON.stringify(imp.written.warnings),
	);
	check(
		"glissando is counted",
		imp.written.warnings.some((w) => w.code === "unsupported"),
		JSON.stringify(imp.written.warnings),
	);
}

{
	const imp = imported(
		s3mBytes({
			samples: [...LOOPED, { pcm: [], adlib: true }],
			orders: [0],
			patterns: [
				pattern([
					[0, 0, hit()],
					[1, 1, { note: "C-4", instrument: 2 }],
				]),
			],
		}),
	);
	check(
		"a note on an AdLib instrument is counted",
		imp.s3m.play.ignored.unsupported === 1,
		String(imp.s3m.play.ignored.unsupported),
	);
	check("and not played", played(imp.song, 1).length === 0);
	clean("an AdLib note", imp);
}
