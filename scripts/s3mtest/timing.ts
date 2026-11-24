/** `s3mtest`: timing on the walk — twelve driver ticks a row at speed 6, Axx, Txx as `t`, Bxx as the loop point, Cxx in BCD, SBx's pattern loop, SEx's row repeats and SDx's late note. */

import { check, section } from "../harness";
import { type Cell, imported, pattern, played, problems, s3mBytes, square } from "./support";

const LOOPED = [{ pcm: square(32, 8), loopStart: 0, loopLength: 256 }];
const hit = (extra: Cell = {}): Cell => ({ note: "C-4", instrument: 1, ...extra });
const song = (patterns: Cell[][][], orders = [0], extra = {}) =>
	imported(s3mBytes({ samples: LOOPED, orders, patterns, ...extra }));
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
			[0, 0, hit({ command: "A", info: 3 })],
			[1, 0, hit()],
			[2, 0, hit({ command: "A", info: 0 })],
			[3, 0, hit()],
		]),
	]);
	check("A03 makes a row three ticks, and A00 changes nothing", ticks(imp).join() === "0,6,12,18", ticks(imp).join());
}

{
	const imp = song([
		pattern([
			[0, 0, hit()],
			[16, 0, hit({ command: "T", info: 150 })],
			[17, 0, { command: "T", info: 0x20 }],
		]),
	]);
	const text = imp.written.text;
	check("the song opens at the header's tempo, t50 for 125 BPM", /\bt50\b/.test(text), text.slice(0, 400));
	check(
		"T96 (150 BPM) is t60 at its row, and T20 is ignored",
		/\bt60\b/.test(text) && imp.s3m.play.tempos.length === 2,
		text,
	);
}

section("timing: jumps and breaks");

{
	const imp = song(
		[
			pattern([[0, 0, hit()]]),
			pattern([
				[0, 0, hit()],
				[10, 0, { command: "B", info: 1 }],
			]),
		],
		[0, 1],
	);
	check(
		"a jump back to the second order is the loop point",
		imp.s3m.play.loopTick === 64 * 6,
		String(imp.s3m.play.loopTick),
	);
	check("and the song ends after the jump's row", imp.s3m.play.ticks === (64 + 11) * 6, String(imp.s3m.play.ticks));
	check("a song with a loop point raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
}

{
	const imp = song(
		[
			pattern([
				[0, 0, hit()],
				[3, 0, { command: "C", info: 0x16 }],
			]),
			pattern([[16, 0, hit()]]),
		],
		[0, 1],
	);
	check("C16 in BCD breaks to row 16 of the next order", ticks(imp).join() === `0,${4 * 12}`, ticks(imp).join());
}

{
	const imp = song(
		[
			pattern([
				[0, 0, hit()],
				[3, 0, { command: "C", info: 0x1a }],
			]),
			pattern([[0, 0, hit()]]),
		],
		[0, 1],
	);
	check("a break that is not BCD is ignored", imp.s3m.play.ticks === 128 * 6, String(imp.s3m.play.ticks));
}

section("timing: loops, repeats and delays");

{
	const imp = song([
		pattern([
			[0, 0, hit({ command: "S", info: 0xb0 })],
			[1, 0, hit({ command: "S", info: 0xb2 })],
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
	const imp = song([
		pattern([
			[0, 0, hit({ command: "S", info: 0xe2 })],
			[1, 0, hit()],
		]),
	]);
	check("SE2 plays its row three times, its note once", ticks(imp).join() === "0,36", ticks(imp).join());
}

{
	const imp = song([
		pattern([
			[0, 0, hit({ command: "S", info: 0xd3 })],
			[1, 0, hit({ command: "S", info: 0xd6 })],
		]),
	]);
	check("SD3 strikes three ticks late", ticks(imp)[0] === 6, ticks(imp).join());
	check(
		"SD6 at speed 6 never strikes, and is counted",
		ticks(imp).length === 1 && imp.s3m.play.ignored.unsupported === 1,
	);
}
