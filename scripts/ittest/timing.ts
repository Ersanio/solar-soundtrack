/** `ittest`: timing on the walk — twelve driver ticks a row at speed 6, Axx, Txx and its slides, Bxx as the loop point, Cxx, SBx, SEx, S6x and SDx, a short pattern, and the order markers. */

import { check, section } from "../harness";
import { type Cell, imported, itBytes, pattern, played, problems, square } from "./support";

const SAMPLES = [{ pcm: square(32, 8), loopStart: 0, loopLength: 256 }];
const hit = (extra: Cell = {}): Cell => ({ note: "C-5", instrument: 1, ...extra });
const song = (patterns: Cell[][][], orders = [0], extra = {}) =>
	imported(itBytes({ samples: SAMPLES, orders, patterns, ...extra }));
const ticks = (imp: ReturnType<typeof song>, channel = 0): number[] => played(imp.song, channel).map((n) => n.tick);

section("timing: speed and tempo");

{
	const imp = song([pattern([0, 4, 8, 12].map((row) => [row, 0, hit()] as [number, number, Cell]))]);
	check("speed 6 is twelve driver ticks a row", ticks(imp).join() === "0,48,96,144", ticks(imp).join());
	check("and the song raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
}

{
	const imp = song([
		pattern([
			[0, 0, hit({ command: "A", param: 3 })],
			[1, 0, hit()],
			[16, 0, hit({ command: "T", param: 150 })],
		]),
	]);
	check("A03 makes a row three ticks", ticks(imp)[1] === 6, ticks(imp).join());
	check("T96 (150 BPM) is t60 at its row", /\bt60\b/.test(imp.written.text), imp.written.text.slice(0, 400));
}

{
	const imp = song([pattern([[0, 0, hit({ command: "T", param: 0x14 })]])]);
	const bpms = imp.it.play.tempos.map((t) => t.bpm);
	check("T14 slides the tempo up 4 on each later tick", bpms.slice(0, 4).join() === "125,129,133,137", bpms.join());
}

section("timing: jumps, breaks and loops");

{
	const imp = song(
		[
			pattern([[0, 0, hit()]]),
			pattern([
				[0, 0, hit()],
				[10, 0, { command: "B", param: 1 }],
			]),
		],
		[0, 1],
	);
	check(
		"a jump back to the second order is the loop point",
		imp.it.play.loopTick === 64 * 6,
		String(imp.it.play.loopTick),
	);
	check("a song with a loop point raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
}

{
	const imp = song(
		[
			pattern([
				[0, 0, hit()],
				[3, 0, { command: "C", param: 16 }],
			]),
			pattern([[16, 0, hit()]]),
		],
		[0, 1],
	);
	check("C10 (16) breaks to row 16 of the next order", ticks(imp).join() === `0,${4 * 12}`, ticks(imp).join());
}

{
	const imp = song([
		pattern([
			[0, 0, hit({ command: "S", param: 0xb0 })],
			[1, 0, hit({ command: "S", param: 0xb2 })],
			[2, 0, hit()],
		]),
	]);
	check(
		"SB0 then SB2 plays the two rows three times",
		ticks(imp).slice(0, 7).join() === "0,12,24,36,48,60,72",
		ticks(imp).join(),
	);
}

{
	const delay = song([
		pattern([
			[0, 0, hit({ command: "S", param: 0xe2 })],
			[1, 0, hit()],
		]),
	]);
	check("SE2 plays its row three times, its note once", ticks(delay).join() === "0,36", ticks(delay).join());
	const fine = song([
		pattern([
			[0, 0, hit({ command: "S", param: 0x63 })],
			[1, 0, hit()],
		]),
	]);
	check("S63 adds three ticks to its row", ticks(fine).join() === "0,18", ticks(fine).join());
}

{
	const imp = song([
		pattern([
			[0, 0, hit({ command: "S", param: 0xd3 })],
			[1, 0, hit({ command: "S", param: 0xd6 })],
		]),
	]);
	check("SD3 strikes three ticks late", ticks(imp)[0] === 6, ticks(imp).join());
	check("SD6 at speed 6 is counted", imp.it.play.ignored.unsupported === 1);
}

{
	const imp = imported(
		itBytes({
			samples: SAMPLES,
			orders: [0, 254, 1, 255, 0],
			patterns: [pattern([[0, 0, hit()]]), pattern([[0, 0, hit()]])],
			rows: [16, 64],
		}),
	);
	check(
		"a 16-row pattern, 254 skipped, 255 ending the song",
		ticks(imp).join() === `0,${16 * 12}` && imp.it.play.ticks === 80 * 6,
		`${ticks(imp).join()} ${imp.it.play.ticks}`,
	);
}
