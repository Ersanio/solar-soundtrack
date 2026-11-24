/** `modtest`: a pass through an order that comes round again in the same state written once as a label loop and called after, with every note still walked where the MOD plays it. */

import { check, section } from "../harness";
import { type Cell, C2, PERIODS, imported, modBytes, pattern, played, problems, square } from "./support";

const SAMPLES = [
	{ pcm: square(32, 8), loopStart: 0, loopLength: 256 },
	{ pcm: square(16, 16), loopStart: 0, loopLength: 256 },
];

/** A bar of eighths on two channels. */
function riff(offset: number): Cell[][] {
	const cells: [number, number, Cell][] = [];
	for (let row = 0; row < 64; row += 4) {
		cells.push([row, 0, { period: PERIODS[12 + ((row / 4 + offset) % 12)], sample: 1 }]);
		cells.push([row + 2, 1, { period: C2, sample: 2 }]);
	}

	return pattern(cells);
}

section("loops: repeated orders");

{
	const orders = [0, 1, 0, 0, 1, 0];
	const imp = imported(modBytes({ samples: SAMPLES, orders, patterns: [riff(0), riff(5)] }));
	const text = imp.written.text;
	check("a repeated order is defined once as a label loop", text.includes("(1)["), text.slice(0, 1200));
	check("and called after", /\(1\)2?(\s|$)/.test(text.replace(/\(1\)\[/g, "")));
	check("orders that come round consecutively are played with a count", /\(\d+\)(\[[^\]]*\])?2(\s|$)/.test(text), text);
	check("a song of loops raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));

	// Every note the MOD strikes, walked at its tick on the pitch the MOD gives it.
	for (const channel of [0, 1]) {
		const walked = played(imp.song, channel);
		const expected = imp.mod.play.channels[channel].keyOn.flatMap((on, t) => (on ? [t * 2] : []));
		check(
			`channel ${channel + 1}: every key-on walked at its tick through the calls`,
			walked.map((n) => n.tick).join() === expected.join(),
			`${walked.length} walked, ${expected.length} struck`,
		);
	}

	const keys = played(imp.song, 0).map((n) => n.key);
	const pass = keys.slice(0, 16);
	check(
		"each pass through order 0 plays the same keys",
		[2, 3, 5].every((p) => keys.slice(p * 16, p * 16 + 16).join() === pass.join()),
	);
}

{
	// A note held over the end of one pass into the next: that pass opens on a tie, so it is not a loop's body.
	const held = pattern([[60, 0, { period: C2, sample: 1 }]]);
	const imp = imported(
		modBytes({ samples: SAMPLES, orders: [0, 1, 1], patterns: [held, pattern([[8, 0, { period: 214, sample: 1 }]])] }),
	);
	check("a pass that opens on a tie is written out", !/\(\d+\)\[\^/.test(imp.written.text), imp.written.text);
	check("and raises nothing", problems(imp.song).length === 0, problems(imp.song).join("; "));
}
