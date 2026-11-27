/** `modtest`: time — two driver ticks to a MOD tick, speed and BPM, and the order list's flow through Bxx, Dxx, E6x, EEx and EDx, each held to the ticks the walk plays its notes at. */

import { check, section } from "../harness";
import { type Cell, C2, imported, modBytes, pattern, played, problems, square } from "./support";

const SAMPLES = [{ pcm: square(32, 8), loopStart: 0, loopLength: 32 }];
const note = (extra: Cell = {}): Cell => ({ period: C2, sample: 1, ...extra });
const ticksOf = (bytes: Uint8Array): number[] => played(imported(bytes).song, 0).map((n) => n.tick);

section("timing: rows, speed and BPM");

{
	const imp = imported(
		modBytes({
			samples: SAMPLES,
			orders: [0],
			patterns: [
				pattern([
					[0, 0, note()],
					[4, 0, note()],
					[9, 0, note()],
				]),
			],
		}),
	);
	const ticks = played(imp.song, 0).map((n) => n.tick);
	check("at speed 6 a row is twelve driver ticks", ticks.join() === "0,48,108", ticks.join());
	check("125 BPM is t50", /\bt50\b/.test(imp.written.text));
	check("a plain song raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
	const last = played(imp.song, 0).at(-1);
	check(
		"the last note lasts to the pattern's end",
		last !== undefined && last.tick + last.ticks === 64 * 12,
		JSON.stringify(last?.ticks),
	);
}

check(
	"F03 makes a row three MOD ticks",
	ticksOf(
		modBytes({
			samples: SAMPLES,
			orders: [0],
			patterns: [
				pattern([
					[0, 0, note({ effect: 0xf, param: 3 })],
					[4, 0, note()],
				]),
			],
		}),
	).join() === "0,24",
);

{
	const imp = imported(
		modBytes({
			samples: SAMPLES,
			orders: [0],
			patterns: [
				pattern([
					[0, 0, note()],
					[8, 0, note({ effect: 0xf, param: 150 })],
				]),
			],
		}),
	);
	check("F96 (150 BPM) is a t60 at its row", /\bt60\b/.test(imp.written.text), imp.written.text.slice(-300));
	check(
		"the walk takes the tempo at the row's tick",
		(imp.song.timeline?.tempoChanges ?? []).some((t) => t.tick === 96 && t.tempo === 60),
		JSON.stringify(imp.song.timeline?.tempoChanges),
	);
	check("a tempo change raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
}

section("timing: the order list's flow");

{
	// Order 1 jumps back to itself at its last row: the song loops from order 1.
	const bytes = modBytes({
		samples: SAMPLES,
		orders: [0, 1],
		patterns: [
			pattern([[0, 0, note()]]),
			pattern([
				[0, 0, note({ period: 214 })],
				[0, 1, note()],
				[63, 1, { effect: 0xb, param: 1 }],
			]),
		],
	});
	const imp = imported(bytes);
	check("a Bxx back is the song's loop point", imp.mod.play.loopTick === 64 * 6 && imp.mod.play.ticks === 128 * 6);
	check(
		"the loop point is a / in every channel",
		imp.written.channels.length === 2 &&
			(imp.written.text.match(/^\/|\n\/| \//g) ?? []).length >= imp.written.channels.length,
		imp.written.text,
	);
	check("the walk loops there", imp.song.timeline?.loopTick === 64 * 12, String(imp.song.timeline?.loopTick));
	check("a loop raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
	const whole = imported(bytes, { loop: "song" });
	check("looping the whole song writes no /", !/(^|\s)\/(\s|$)/.test(whole.written.text));
}

check(
	"D16 breaks to row 16 of the next order (BCD)",
	ticksOf(
		modBytes({
			samples: SAMPLES,
			orders: [0, 1],
			patterns: [
				pattern([
					[0, 0, note()],
					[3, 1, { effect: 0xd, param: 0x16 }],
				]),
				pattern([
					[15, 0, note({ period: 214 })],
					[16, 0, note({ period: 240 })],
				]),
			],
		}),
	).join() === "0,48",
);

check(
	"E60 and E62 play the rows between them three times",
	ticksOf(
		modBytes({
			samples: SAMPLES,
			orders: [0],
			patterns: [
				pattern([
					[0, 1, { effect: 0xe, param: 0x60 }],
					[1, 0, note()],
					[2, 1, { effect: 0xe, param: 0x62 }],
				]),
			],
		}),
	).join() === "12,48,84",
);

check(
	"EE2 plays its row three times over",
	ticksOf(
		modBytes({
			samples: SAMPLES,
			orders: [0],
			patterns: [
				pattern([
					[0, 0, note({ effect: 0xe, param: 0xe2 })],
					[1, 0, note({ period: 214 })],
				]),
			],
		}),
	).join() === "0,36",
);

check(
	"ED3 strikes its note three MOD ticks into the row",
	ticksOf(
		modBytes({
			samples: SAMPLES,
			orders: [0],
			patterns: [
				pattern([
					[0, 0, note()],
					[2, 0, note({ period: 214, effect: 0xe, param: 0xd3 })],
				]),
			],
		}),
	).join() === "0,30",
);
