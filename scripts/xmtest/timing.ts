/** `xmtest`: timing on the walk — twelve driver ticks a row at speed 6, Fxx as speed and BPM, Bxx as the loop point, Dxx in BCD, E6x, EEx and EDx, a short pattern, and the restart order. */

import { check, section } from "../harness";
import { type Cell, imported, pattern, played, problems, square, xmBytes } from "./support";

const INSTRUMENTS = [{ samples: [{ pcm: square(32, 8), loopStart: 0, loopLength: 256 }] }];
const hit = (extra: Cell = {}): Cell => ({ note: "C-4", instrument: 1, ...extra });
const song = (patterns: Cell[][][], orders = [0], extra = {}) =>
	imported(xmBytes({ instruments: INSTRUMENTS, orders, patterns, ...extra }));
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
			[0, 0, hit({ effect: "F", param: 3 })],
			[1, 0, hit()],
			[16, 0, hit({ effect: "F", param: 150 })],
		]),
	]);
	check("F03 makes a row three ticks", ticks(imp)[1] === 6, ticks(imp).join());
	check("F96 (150 BPM) is t60 at its row", /\bt60\b/.test(imp.written.text), imp.written.text.slice(0, 400));
}

section("timing: jumps, breaks and loops");

{
	const imp = song(
		[
			pattern([[0, 0, hit()]]),
			pattern([
				[0, 0, hit()],
				[10, 0, { effect: "B", param: 1 }],
			]),
		],
		[0, 1],
	);
	check(
		"a jump back to the second order is the loop point",
		imp.xm.play.loopTick === 64 * 6,
		String(imp.xm.play.loopTick),
	);
	check("a song with a loop point raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
}

{
	const imp = song(
		[
			pattern([
				[0, 0, hit()],
				[3, 0, { effect: "D", param: 0x16 }],
			]),
			pattern([[16, 0, hit()]]),
		],
		[0, 1],
	);
	check("D16 in BCD breaks to row 16 of the next order", ticks(imp).join() === `0,${4 * 12}`, ticks(imp).join());
}

{
	const imp = song([
		pattern([
			[0, 0, hit({ effect: "E", param: 0x60 })],
			[1, 0, hit({ effect: "E", param: 0x62 })],
			[2, 0, hit()],
		]),
	]);
	check(
		"E60 then E62 plays the two rows three times",
		ticks(imp).slice(0, 7).join() === "0,12,24,36,48,60,72",
		ticks(imp).join(),
	);
}

{
	const imp = song([
		pattern([
			[0, 0, hit({ effect: "E", param: 0xe2 })],
			[1, 0, hit()],
		]),
	]);
	check("EE2 plays its row three times, its note once", ticks(imp).join() === "0,36", ticks(imp).join());
}

{
	const imp = song([
		pattern([
			[0, 0, hit({ effect: "E", param: 0xd3 })],
			[1, 0, hit({ effect: "E", param: 0xd6 })],
		]),
	]);
	check("ED3 strikes three ticks late", ticks(imp)[0] === 6, ticks(imp).join());
	check(
		"ED6 at speed 6 never strikes, and is counted",
		ticks(imp).length === 1 && imp.xm.play.ignored.unsupported === 1,
	);
}

{
	const imp = imported(
		xmBytes({
			instruments: INSTRUMENTS,
			orders: [0, 1],
			patterns: [pattern([[0, 0, hit()]]), pattern([[0, 0, hit()]])],
			rows: [16, 64],
			restart: 1,
		}),
	);
	check("a 16-row pattern is 16 rows", ticks(imp).join() === `0,${16 * 12}`, ticks(imp).join());
	check("the song loops to the restart order", imp.xm.play.loopTick === 16 * 6, String(imp.xm.play.loopTick));
}
