/** `ittest`: effects — the volume column, Dxy and its fine slides, Mxx and Nxy, Vxx and Wxy, E, F and G as `$DD`, H, U and the column's vibrato as `$DE`, J, R, Q and I, the cuts and the note off, Xxx, S8x and Pxy, and what is left out counted. */

import { check, section } from "../harness";
import { type Cell, imported, itBytes, pattern, played, problems, square } from "./support";

const SAMPLES = [{ pcm: square(32, 8), loopStart: 0, loopLength: 256 }];
const hit = (extra: Cell = {}): Cell => ({ note: "C-5", instrument: 1, ...extra });
const one = (cells: [number, number, Cell][], extra = {}) =>
	imported(itBytes({ samples: SAMPLES, orders: [0], patterns: [pattern(cells)], ...extra }));
const volumes = (imp: ReturnType<typeof one>, from: number, count: number): number[] =>
	imp.it.play.channels[0].volume.slice(from, from + count);
const clean = (name: string, imp: ReturnType<typeof one>): void =>
	check(`${name} raises nothing`, problems(imp.song).length === 0, problems(imp.song).join("; "));

section("effects: volume");

{
	const imp = one([
		[0, 0, hit({ volume: 40 })],
		[1, 0, { command: "D", param: 0x02 }],
		[2, 0, { command: "D", param: 0x3f }],
		[3, 0, { command: "D", param: 0xf4 }],
		[4, 0, { command: "D", param: 0x00 }],
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
	check(
		"D00 does what the last D did",
		volumes(imp, 24, 6).every((v) => v === 25),
		volumes(imp, 24, 6).join(),
	);
	check("a slide is written as a fade", /v\d+,\d+/.test(imp.written.text), imp.written.text);
	clean("volume slides", imp);
}

{
	const imp = one([
		[0, 0, hit({ volume: 72 })],
		[1, 0, { volume: 92 }],
	]);
	// 72 is fine volume up by 7 (65-74), 92 a slide up by 7 on each later tick (85-94).
	check("the column's fine volume up", volumes(imp, 0, 1)[0] === 64, String(volumes(imp, 0, 1)));
	const column = one([
		[0, 0, hit({ volume: 30 })],
		[1, 0, { volume: 87 }],
	]);
	check("the column's volume slide up", volumes(column, 6, 3).join() === "30,32,34", volumes(column, 6, 3).join());
}

{
	const imp = one([
		[0, 0, hit({ command: "M", param: 32 })],
		[1, 0, { command: "N", param: 0x01 }],
	]);
	check("M20 halves the volume", volumes(imp, 0, 1)[0] === 32, String(volumes(imp, 0, 1)));
	check("N01 slides the channel volume down", volumes(imp, 6, 3).join() === "32,31,30", volumes(imp, 6, 3).join());
	const global = one([
		[0, 0, hit({ command: "V", param: 64 })],
		[1, 0, { command: "W", param: 0x01 }],
	]);
	check(
		"V40 halves the global volume, W01 slides it down",
		volumes(global, 0, 1)[0] === 32 && volumes(global, 7, 1)[0] === 31.5,
		volumes(global, 6, 3).join(),
	);
}

{
	const imp = one([[0, 0, hit({ command: "I", param: 0x21 })]]);
	check(
		"I21 is two ticks on, one off",
		volumes(imp, 0, 6)
			.map((v) => (v > 0 ? 1 : 0))
			.join() === "1,1,0,1,1,0",
		volumes(imp, 0, 6).join(),
	);
}

section("effects: pitch");

{
	const imp = one([
		[0, 0, hit()],
		[1, 0, { command: "E", param: 0x04 }],
		[2, 0, { command: "F", param: 0xf2 }],
		[3, 0, { command: "F", param: 0xe2 }],
	]);
	const pitch = imp.it.play.channels[0].pitch;
	// Linear: E04 is 16 of 768 an octave a tick, a quarter of a semitone.
	check(
		"E04 slides down a quarter of a semitone a tick",
		Math.abs(pitch[7] - pitch[6] + 0.25) < 1e-9,
		(pitch[7] - pitch[6]).toFixed(4),
	);
	check("FF2 slides up 8 on tick 0 only", Math.abs(pitch[12] - pitch[11] - 8 / 64) < 1e-9 && pitch[13] === pitch[12]);
	check("FE2 slides up 2", Math.abs(pitch[18] - pitch[17] - 2 / 64) < 1e-9);
	check("a slide is written as $DD", imp.written.text.includes("$DD"), imp.written.text);
	clean("slides", imp);
}

{
	const imp = one([
		[0, 0, hit()],
		[4, 0, { note: "C-6", command: "G", param: 0x20 }],
		[5, 0, { command: "G" }],
	]);
	check("G slides to its note without striking it", played(imp.song, 0).length === 1);
	check(
		"and reaches it",
		Math.abs(imp.it.play.channels[0].pitch[35] - 12) < 1e-9,
		imp.it.play.channels[0].pitch[35].toFixed(3),
	);
	clean("tone portamento", imp);
}

section("effects: vibrato, arpeggio, tremolo and retrigger");

{
	const vibrato = one([[0, 0, hit({ command: "H", param: 0x48 })]]);
	const fine = one([[0, 0, hit({ command: "U", param: 0x48 })]]);
	const extent = (imp: ReturnType<typeof one>): number =>
		parseInt(/\$DE \$00 \$[0-9A-F]{2} \$([0-9A-F]{2})/.exec(imp.written.text)?.[1] ?? "0", 16);
	check("H48 is $DE at a rate of 8", vibrato.written.text.includes("$DE $00 $08 "), vibrato.written.text);
	check(
		"U48 swings a quarter of H48",
		Math.abs(extent(fine) * 4 - extent(vibrato)) <= extent(vibrato) / 10,
		`${extent(fine)} ${extent(vibrato)}`,
	);
	const column = one([
		[0, 0, hit({ command: "H", param: 0x40 })],
		[1, 0, { volume: 206 }],
	]);
	check(
		"the column's vibrato is $DE too, at the speed H last set",
		column.written.text.includes("$DE"),
		column.written.text,
	);
	clean("vibrato", vibrato);
}

{
	const imp = one([[0, 0, hit({ command: "J", param: 0x47 })]]);
	check("J47 is $FB under legato", imp.written.text.includes("$FB $03 $02 $00 $04 $07"), imp.written.text);
	clean("arpeggio", imp);
}

{
	const imp = one([[0, 0, hit({ volume: 32, command: "R", param: 0x48 })]]);
	check("R48 is $E5 in front of its note", imp.written.text.includes("$E5 $00 $08 "), imp.written.text);
	clean("tremolo", imp);
}

{
	const imp = one([[0, 0, hit({ command: "Q", param: 0x03 })]]);
	check(
		"Q03 strikes again every three ticks",
		played(imp.song, 0)
			.map((n) => n.tick)
			.join() === "0,6",
		played(imp.song, 0)
			.map((n) => n.tick)
			.join(),
	);
	const fall = one([[0, 0, hit({ volume: 40, command: "Q", param: 0x23 })]]);
	check("Q23 takes 2 off the volume each time", volumes(fall, 3, 1)[0] === 38, volumes(fall, 0, 6).join());
}

section("effects: cuts and panning");

{
	const imp = one([
		[0, 0, hit({ command: "S", param: 0xc2 })],
		[4, 0, hit()],
		[5, 0, { note: "^^^" }],
		[8, 0, hit()],
		[9, 0, { note: "===" }],
	]);
	const sample = imp.it.play.channels[0].sample;
	check("SC2 cuts the note on its third tick", sample[1] === 1 && sample[2] === 0, sample.slice(0, 4).join());
	check("^^^ cuts the note at its row", sample[29] === 1 && sample[30] === 0);
	check("a note off in sample mode stops a sample with no sustain loop", sample[53] === 1 && sample[54] === 0);
	clean("cuts", imp);
}

{
	const imp = one([
		[0, 0, hit({ command: "X", param: 0 })],
		[1, 0, hit({ command: "S", param: 0x8f })],
		[2, 0, { command: "P", param: 0x40 }],
	]);
	const pans = imp.it.play.channels[0].pan;
	check(
		"X00 is hard left, S8F hard right, P40 slides left",
		pans[0] === 0 && pans[6] === 255 && pans[17] < 255,
		`${pans[0]} ${pans[6]} ${pans[17]}`,
	);
	check(
		"hard left is y20 and hard right y0",
		imp.written.text.includes("y20") && imp.written.text.includes("y0"),
		imp.written.text,
	);
	const narrow = one([[0, 0, hit({ command: "X", param: 0 })]], { separation: 64 });
	check(
		"a separation of 64 halves the spread",
		narrow.it.play.channels[0].pan[0] === 64,
		String(narrow.it.play.channels[0].pan[0]),
	);
	clean("panning", imp);
}

{
	const imp = one([
		[0, 0, hit({ command: "O", param: 0x08 })],
		[1, 0, hit({ command: "Y", param: 0x44 })],
	]);
	check(
		"a sample offset is counted",
		imp.written.warnings.some((w) => w.code === "offsets" && w.count === 1),
		JSON.stringify(imp.written.warnings),
	);
	check("panbrello is counted", imp.it.play.ignored.unsupported === 1);
}
