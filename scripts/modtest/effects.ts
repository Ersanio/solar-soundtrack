/** `modtest`: effects — vibrato as `$DE` and `$DF`, slides as `$DD`, volume as `v` through a square root and slides as fades, a cut, panning narrowed by the separation, a sample's end, and the effects left out counted. */

import { NOTE_MIN } from "@amk/core/hardcoded-tables";
import { check, section } from "../harness";
import {
	type Cell,
	C2,
	PERIODS,
	centsOff,
	imported,
	modBytes,
	pattern,
	played,
	pluck,
	problems,
	square,
} from "./support";

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
	const imp = one(
		[
			[0, 0, note({ effect: 0xc, param: 0x10 })],
			[4, 0, note({ effect: 0xc, param: 0x40 })],
			[8, 0, note()],
		],
		{ separation: 1 },
	);
	const volumes = played(imp.song, 0).map((n) => n.state.volume);
	// Hard left, where the pan takes nothing away: a quarter of the MOD's volume is half the
	// driver's, which squares it.
	check("C10 is v128 and C40 is v255", volumes[0] === 128 && volumes[1] === 255, volumes.join());
	check("a note with its sample takes the sample's volume", volumes[2] === 255);
	const centred = played(one([[0, 0, note({ effect: 0xc, param: 0x40 })]], { separation: 0 }).song, 0);
	// Centred, `PanValues` gives each side $51 of $7F, so the volume is scaled by $7F / ($51 + $51).
	check(
		"centred, C40 is scaled so both sides sum as one hard over: v226",
		centred[0]?.state.volume === 226,
		String(centred[0]?.state.volume),
	);
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
	// Three quarters on the left: y13 gives $6E against $29 (73%), y14 $73 against $1E (79%).
	check(
		"half the separation is three quarters, through the pan curve",
		pans(0.5).join() === "13,10,7",
		pans(0.5).join(),
	);
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

section("effects: arpeggio");

{
	// Struck with 037 for two rows, held for two, then the next note.
	const imp = one([
		[0, 0, note({ effect: 0x0, param: 0x37 })],
		[1, 0, { effect: 0x0, param: 0x37 }],
		[4, 0, note({ period: 214 })],
	]);
	const text = imp.written.text;
	const walked = played(imp.song, 0);
	const steps = walked[0]?.arpeggioSteps ?? [];
	check("0xy is $FB with the note and its two steps, each a MOD tick", text.includes("$FB $03 $02 $00 $03 $07"), text);
	check(
		"legato is toggled on before the key-on and off again before the note ends",
		text.split("$F4 $01").length === 3 && text.includes("$F4 $01 $FB $03"),
		text,
	);
	check("where the arpeggio stops, the note holds itself", text.includes("$FB $01 $02 $00"), text);
	check("and the arpeggio is off before the next note", text.includes("$FB $00 $00 $F4 $01"));
	check(
		"the walk plays the note's steps: the note, a third and a fifth above, round again",
		steps.slice(0, 6).join() === "0,3,7,0,3,7",
		steps.join(),
	);
	check("the arpeggio returns to the note and holds there", steps.at(-1) === 0, steps.join());
	check(
		"the next note is struck as itself",
		walked[1]?.arpeggioSteps === null,
		JSON.stringify(walked[1]?.arpeggioSteps),
	);
	check("an arpeggio raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
}

{
	// An arpeggio a sample cannot reach past o6 a is left out, and counted.
	const imp = one([[0, 0, note({ period: 113, effect: 0x0, param: 0xff })]], { factors: new Map([[1, 1]]) });
	check(
		"an arpeggio past what the sample plays is counted and left out",
		imp.written.warnings.some((w) => w.code === "arpeggio") || imp.written.text.includes("$FB $03"),
		JSON.stringify(imp.written.warnings),
	);
	check("and raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
}

section("effects: tremolo");

{
	const imp = one([
		[0, 0, note({ effect: 0xc, param: 0x20 })],
		[1, 0, { effect: 0x7, param: 0x48 }],
		[4, 0, note({ effect: 0xc, param: 0x20 })],
	]);
	const text = imp.written.text;
	const before =
		/\$E5 \$00 \$([0-9A-F]{2}) \$([0-9A-F]{2})[^\n]*?\bq7F\b[^\n]*?\b[a-g]/.exec(text) ??
		/\$E5 \$00 \$([0-9A-F]{2}) \$([0-9A-F]{2})/.exec(text);
	check("7xy is $E5 in front of the note's key-on, at twice the MOD's speed", before?.[1] === "08", text);
	check(
		"its amplitude stays below $C6, where the read-ahead would take it for a tie",
		parseInt(before?.[2] ?? "FF", 16) <= 0xc5,
	);
	const volumes = played(imp.song, 0).map((n) => n.state.volume ?? 0);
	check("the note is raised to the top of the swing the tremolo takes down", volumes[0] > volumes[1], volumes.join());
	check("the next note without one turns it off with $FD", text.includes("$FD"), text);
	check("a tremolo raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
}

section("effects: fine tune");

{
	// A sample over three octaves at a low factor: the tuning leaves its notes a few cents flat or sharp.
	const cells: [number, number, Cell][] = PERIODS.map((p, row) => [row, 0, { period: p, sample: 1 }]);
	const imp = one(cells, { factors: new Map([[1, 0.3]]) });
	const walked = played(imp.song, 0);
	const fine = walked[0]?.state.fineTune ?? 0;
	const mean = (shift: number): number =>
		walked.reduce(
			(sum, n, i) => sum + Math.abs(centsOff(imp, { ...n, state: { ...n.state, fineTune: shift } }, PERIODS[i])),
			0,
		) / walked.length;
	check(
		"a channel's notes take an $EE fine tune",
		/\$EE \$[0-9A-F]{2}/.test(imp.written.text) && fine > 0,
		String(fine),
	);
	check(
		"which brings them nearer their pitch on the whole than none",
		mean(fine) < mean(0),
		`${mean(fine).toFixed(2)} cents against ${mean(0).toFixed(2)}`,
	);
	check("a fine tune raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
}
