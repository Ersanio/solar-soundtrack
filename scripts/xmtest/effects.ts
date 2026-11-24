/** `xmtest`: effects — the volume column, Axy and the fine slides, Cxx and Gxx, 1xx, 2xx, 3xx and X1x as `$DD`, 4xy and the volume column's vibrato as `$DE`, 0xy in FT2's order, 7xy, E9x, Rxy, ECx, 8xx and Pxy, Kxx, Txy, and what is left out counted. */

import { check, section } from "../harness";
import { type Cell, imported, pattern, played, problems, square, xmBytes } from "./support";

const INSTRUMENTS = [{ samples: [{ pcm: square(32, 8), loopStart: 0, loopLength: 256 }] }];
const hit = (extra: Cell = {}): Cell => ({ note: "C-4", instrument: 1, ...extra });
const one = (cells: [number, number, Cell][], extra = {}) =>
	imported(xmBytes({ instruments: INSTRUMENTS, orders: [0], patterns: [pattern(cells)], ...extra }));
const volumes = (imp: ReturnType<typeof one>, from: number, count: number): number[] =>
	imp.xm.play.channels[0].volume.slice(from, from + count);
const clean = (name: string, imp: ReturnType<typeof one>): void =>
	check(`${name} raises nothing`, problems(imp.song).length === 0, problems(imp.song).join("; "));

section("effects: volume");

{
	const imp = one([
		[0, 0, hit({ volume: 0x30 })],
		[1, 0, { volume: 0x62 }],
		[2, 0, { volume: 0x93 }],
		[3, 0, { effect: "A", param: 0x20 }],
		[4, 0, { effect: "C", param: 10 }],
	]);
	check("a volume column of 0x30 is volume 32", volumes(imp, 0, 1)[0] === 32, String(volumes(imp, 0, 1)));
	check(
		"0x62 slides 2 down on each later tick",
		volumes(imp, 6, 6).join() === "32,30,28,26,24,22",
		volumes(imp, 6, 6).join(),
	);
	check(
		"0x93 slides 3 up on tick 0 only",
		volumes(imp, 12, 6).every((v) => v === 25),
		volumes(imp, 12, 6).join(),
	);
	check(
		"A20 slides 2 up on each later tick",
		volumes(imp, 18, 6).join() === "25,27,29,31,33,35",
		volumes(imp, 18, 6).join(),
	);
	check("C0A sets the volume", volumes(imp, 24, 1)[0] === 10);
	check("a slide is written as a fade", /v\d+,\d+/.test(imp.written.text), imp.written.text);
	clean("volume", imp);
}

{
	const imp = one([[0, 0, hit({ effect: "G", param: 32 })]]);
	check("G20 halves every volume", volumes(imp, 0, 1)[0] === 32, String(volumes(imp, 0, 1)));
}

section("effects: pitch");

{
	const imp = one([
		[0, 0, hit()],
		[1, 0, { effect: 1, param: 4 }],
		[2, 0, { effect: 2, param: 8 }],
		[3, 0, { effect: "X", param: 0x13 }],
	]);
	const pitch = imp.xm.play.channels[0].pitch;
	// Linear: 16 periods a tick is a quarter of a semitone.
	check(
		"1xx slides up 4 periods per unit a tick",
		Math.abs(pitch[7] - pitch[6] - 0.25) < 1e-9,
		(pitch[7] - pitch[6]).toFixed(3),
	);
	check("2xx slides down", pitch[17] < pitch[12]);
	check(
		"X13 slides up 3 periods on tick 0",
		Math.abs(pitch[18] - pitch[17] - 3 / 64) < 1e-9,
		(pitch[18] - pitch[17]).toFixed(4),
	);
	check("a slide is written as $DD", imp.written.text.includes("$DD"), imp.written.text);
	clean("slides", imp);
}

{
	const imp = one([
		[0, 0, hit()],
		[4, 0, { note: "C-5", effect: 3, param: 0x20 }],
		[5, 0, { effect: 3 }],
	]);
	check("3xx slides to its note without striking it", played(imp.song, 0).length === 1);
	check(
		"and reaches it",
		Math.abs(imp.xm.play.channels[0].pitch[35] - 12) < 1e-9,
		imp.xm.play.channels[0].pitch[35].toFixed(3),
	);
	clean("tone portamento", imp);
}

section("effects: vibrato, arpeggio and tremolo");

{
	const imp = one([[0, 0, hit({ effect: 4, param: 0x48 })]]);
	check("4xy is $DE at a rate of 8", imp.written.text.includes("$DE $00 $08 "), imp.written.text);
	const column = one([
		[0, 0, hit({ volume: 0xa4 })],
		[1, 0, { volume: 0xb8 }],
	]);
	check("the volume column's vibrato is $DE too", column.written.text.includes("$DE $00 $08 "), column.written.text);
	clean("vibrato", imp);
}

{
	const imp = one([[0, 0, hit({ effect: 0, param: 0x47 })]]);
	check(
		"047 is $FB under legato, the 7 first as FT2 plays it",
		imp.written.text.includes("$FB $03 $02 $00 $07 $04"),
		imp.written.text,
	);
	clean("arpeggio", imp);
}

{
	const imp = one([[0, 0, hit({ volume: 0x30, effect: 7, param: 0x48 })]]);
	check("7xy is $E5 in front of its note", imp.written.text.includes("$E5 $00 $08 "), imp.written.text);
	clean("tremolo", imp);
}

section("effects: retriggers, cuts and panning");

{
	const retrig = one([[0, 0, hit({ effect: "E", param: 0x93 })]]);
	check(
		"E93 strikes again every three ticks",
		played(retrig.song, 0)
			.map((n) => n.tick)
			.join() === "0,6",
		played(retrig.song, 0)
			.map((n) => n.tick)
			.join(),
	);
	const multi = one([[0, 0, hit({ volume: 0x30, effect: "R", param: 0x13 })]]);
	check(
		"R13 strikes again every three ticks, a volume lower each time",
		volumes(multi, 3, 1)[0] === 31,
		volumes(multi, 0, 6).join(),
	);
}

{
	const imp = one([
		[0, 0, hit({ effect: "E", param: 0xc2 })],
		[4, 0, hit({ effect: "K", param: 2 })],
	]);
	const volume = imp.xm.play.channels[0].volume;
	check("EC2 silences the note on its third tick", volume[1] > 0 && volume[2] === 0, volume.slice(0, 4).join());
	check(
		"K02 keys off an instrument without an envelope on its third tick",
		volume[25] > 0 && volume[26] === 0,
		volume.slice(24, 28).join(),
	);
	clean("cuts", imp);
}

{
	const imp = one([
		[0, 0, hit({ effect: 8, param: 0 })],
		[1, 0, { effect: "P", param: 0x40 }],
		[2, 0, { volume: 0xcf }],
	]);
	const pans = imp.xm.play.channels[0].pan;
	check(
		"800 is hard left, P40 slides right, a column pan of F is 240",
		pans[0] === 0 && pans[11] === 20 && pans[12] === 240,
		`${pans[0]} ${pans[11]} ${pans[12]}`,
	);
	check("hard left is y20", imp.written.text.includes("y20"), imp.written.text);
	clean("panning", imp);
}

{
	const imp = one([[0, 0, hit({ volume: 0x40, effect: "T", param: 0x21 })]]);
	check(
		"T21 is on for the three ticks after the first, then off for two",
		volumes(imp, 1, 5)
			.map((v) => (v > 0 ? 1 : 0))
			.join() === "1,1,1,0,0",
		volumes(imp, 0, 7).join(),
	);
}

{
	const imp = one([
		[0, 0, hit({ effect: 9, param: 0x08 })],
		[1, 0, hit({ effect: "E", param: 0x31 })],
		[2, 0, { effect: "L", param: 4 }],
	]);
	check(
		"a sample offset is counted",
		imp.written.warnings.some((w) => w.code === "offsets" && w.count === 1),
		JSON.stringify(imp.written.warnings),
	);
	check(
		"glissando and Lxx are counted",
		imp.xm.play.ignored.unsupported === 2,
		String(imp.xm.play.ignored.unsupported),
	);
}
