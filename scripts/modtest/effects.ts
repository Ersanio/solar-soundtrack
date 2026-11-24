/** `modtest`: effects — vibrato as `$DE` and `$DF`, slides as `$DD`, volume as `v` through a square root and slides as fades, a cut, panning narrowed by the separation, a sample's end, and the effects left out counted. */

import { NOTE_MIN } from "@amk/core/hardcoded-tables";
import { check, section } from "../harness";
import { type Cell, C2, imported, modBytes, pattern, played, pluck, problems, square } from "./support";

const LOOPED = [{ pcm: square(32, 8), loopStart: 0, loopLength: 256 }];
const note = (extra: Cell = {}): Cell => ({ period: C2, sample: 1, ...extra });
const one = (cells: [number, number, Cell][], options = {}) =>
	imported(modBytes({ samples: LOOPED, orders: [0], patterns: [pattern(cells)] }), options);

section("effects: vibrato");

{
	const imp = one([
		[0, 0, note()],
		[1, 0, { effect: 0x4, param: 0x48 }],
		[2, 0, { effect: 0x4, param: 0x00 }],
		[3, 0, {}],
	]);
	const text = imp.written.text;
	// Speed 4 steps the MOD's phase 16 of 256 a MOD tick: 8 a driver tick.
	check(
		"4xy turns vibrato on at its row, at twice its speed",
		/[a-g^]\S* \$DE \$00 \$08 \$[0-9A-F]{2}/.test(text),
		text,
	);
	check("a row without it turns it off", text.includes("$DF ^"));
	const walked = played(imp.song, 0);
	check("the note is struck once and tied through", walked.length === 1, String(walked.length));
	check("vibrato raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));

	const at = (period: number): number => {
		const hex = /\$DE \$00 \$[0-9A-F]{2} \$([0-9A-F]{2})/.exec(
			one([[0, 0, note({ period, effect: 0x4, param: 0x48 })]]).written.text,
		)?.[1];
		return hex ? parseInt(hex, 16) : 0;
	};

	check(
		"a depth swings a low note's period less in pitch than a high one's",
		at(856) < at(214),
		`${at(856)} ${at(214)}`,
	);
}

section("effects: slides");

{
	// 3xx glides from C-2 to C-3 (214) at 8 a tick: 214 periods over 27 ticks.
	const imp = one([
		[0, 0, note()],
		[1, 0, { period: 214, effect: 0x3, param: 0x08 }],
		[2, 0, { effect: 0x3, param: 0x00 }],
		[3, 0, { effect: 0x3, param: 0x00 }],
		[4, 0, { effect: 0x3, param: 0x00 }],
		[5, 0, { effect: 0x3, param: 0x00 }],
		[6, 0, { effect: 0x3, param: 0x00 }],
	]);
	const walked = played(imp.song, 0);
	const key = walked[0]?.key ?? 0;
	const target = /\$DD \$00 \$[0-9A-F]{2} \$([0-9A-F]{2})/g;
	const targets = [...imp.written.text.matchAll(target)].map((m) => parseInt(m[1], 16) - NOTE_MIN);
	check("3xx does not strike its note", walked.length === 1, String(walked.length));
	check("3xx is written as $DD slides ending an octave up", targets.at(-1) === key + 12, `${key} → ${targets.join()}`);
	check("a tone portamento raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
}

{
	const imp = one([
		[0, 0, note()],
		[4, 0, { effect: 0x1, param: 0x10 }],
		[5, 0, { effect: 0x1, param: 0x10 }],
		[8, 0, { effect: 0xe, param: 0x2f }],
	]);
	check("1xx and E2x are written as slides", (imp.written.text.match(/\$DD/g) ?? []).length >= 2, imp.written.text);
	check("slides up and down raise nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
}

section("effects: volume");

{
	const imp = one([
		[0, 0, note({ effect: 0xc, param: 0x10 })],
		[4, 0, note({ effect: 0xc, param: 0x40 })],
		[8, 0, note()],
	]);
	const volumes = played(imp.song, 0).map((n) => n.state.volume);
	// A quarter of the MOD's volume is half the driver's, which squares it.
	check("C10 is v128 and C40 is v255", volumes[0] === 128 && volumes[1] === 255, volumes.join());
	check("a note with its sample takes the sample's volume", volumes[2] === 255);
}

{
	const imp = one([
		[0, 0, note()],
		[1, 0, { effect: 0xa, param: 0x04 }],
		[2, 0, { effect: 0xa, param: 0x04 }],
		[3, 0, { effect: 0xa, param: 0x04 }],
		[4, 0, { effect: 0xa, param: 0x04 }],
	]);
	check("a slide over rows is a fade, written as vD,N", /v\d+,\d+/.test(imp.written.text), imp.written.text);
	check("a volume slide raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
}

{
	const imp = one([
		[0, 0, note({ effect: 0xe, param: 0xc3 })],
		[4, 0, note()],
	]);
	const walked = played(imp.song, 0);
	check("EC3 ends its note three MOD ticks in", walked[0]?.ticks === 6, String(walked[0]?.ticks));
	check("and the next note is struck where it was", walked[1]?.tick === 48);
}

{
	const imp = imported(
		modBytes({
			samples: [{ pcm: pluck(1000), loopLength: 0 }],
			orders: [0],
			patterns: [pattern([[0, 0, note()]])],
		}),
	);
	const walked = played(imp.song, 0);
	// 1000 frames at C-2's 8287 Hz is 121 ms; a MOD tick at 125 BPM is 20 ms.
	check("a one-shot ends where its sample does", walked[0]?.ticks === 14, String(walked[0]?.ticks));
}

section("effects: panning");

{
	const pans = (separation: number): number[] => {
		const imp = imported(
			modBytes({
				samples: LOOPED,
				orders: [0],
				patterns: [
					pattern([
						[0, 0, note()],
						[0, 1, note()],
						[4, 0, note({ effect: 0x8, param: 0x80 })],
					]),
				],
			}),
			{ separation },
		);
		return [...played(imp.song, 0).map((n) => n.state.pan ?? -1), ...played(imp.song, 1).map((n) => n.state.pan ?? -1)];
	};

	check(
		"the Amiga's first channel is hard left and its second hard right",
		pans(1).join() === "20,10,0",
		pans(1).join(),
	);
	check("half the separation is halfway", pans(0.5).join() === "15,10,5", pans(0.5).join());
	check("no separation is mono", pans(0).join() === "10,10,10", pans(0).join());
}

section("effects: what is left out");

{
	const imp = one([
		[0, 0, note({ effect: 0x9, param: 0x01 })],
		[4, 0, { effect: 0xe, param: 0x31 }],
	]);
	check(
		"9xx is counted, and its note played from the start",
		imp.written.warnings.some((w) => w.code === "offsets" && w.count === 1) && played(imp.song, 0).length === 1,
		JSON.stringify(imp.written.warnings),
	);
	check(
		"E3x glissando is counted as unsupported",
		imp.written.warnings.some((w) => w.code === "unsupported" && w.count === 1),
		JSON.stringify(imp.written.warnings),
	);
}
