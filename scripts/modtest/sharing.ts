/** `modtest`: sharing — module channels whose notes never overlap taking turns on one of AddmusicK's, each note walked at its tick and pitch, and channels that overlap kept apart. */

import { addWhileFits, fitsShared, oneEach } from "@amk/import/tracker";
import { check, section } from "../harness";
import { type Cell, C2, imported, modBytes, pattern, period, played, problems, square } from "./support";

const SAMPLES = [{ pcm: square(32, 8), loopStart: 0, loopLength: 32 }];
const note = (semitones = 12): Cell => ({ period: period(semitones), sample: 1 });
const silence: Cell = { effect: 0xc, param: 0 };

section("sharing: channels that take turns");

{
	// Channel 1 falls silent on row 16, where channel 2 comes in.
	const bytes = modBytes({
		samples: SAMPLES,
		orders: [0],
		patterns: [
			pattern([
				[0, 0, note()],
				[16, 0, silence],
				[16, 1, note(19)],
			]),
		],
	});
	const shared = imported(bytes, { keep: [0, 1], share: true });
	check(
		"two channels that take turns share #0",
		JSON.stringify(shared.written.channels) === "[[0,1]]",
		JSON.stringify(shared.written.channels),
	);
	check("its comment names both", /^#0 ; MOD channels 1, 2$/m.test(shared.written.text));
	const walked = played(shared.song, 0);
	check(
		"both notes are walked on #0 at their ticks",
		walked.map((n) => n.tick).join() === "0,192",
		walked.map((n) => n.tick).join(),
	);
	check(
		"each at its own pitch",
		walked.length === 2 && walked[1].key !== null && walked[0].key !== null && walked[1].key - walked[0].key === 7,
		walked.map((n) => n.key).join(),
	);
	check("and it raises nothing", problems(shared.song).length === 0, problems(shared.song).join("; "));

	const apart = imported(bytes, { keep: [0, 1], share: false });
	check(
		"without sharing each keeps its own",
		JSON.stringify(apart.written.channels) === "[[0],[1]]",
		JSON.stringify(apart.written.channels),
	);
}

{
	// Channel 1's looped note rings on under channel 2's.
	const { written } = imported(
		modBytes({
			samples: SAMPLES,
			orders: [0],
			patterns: [
				pattern([
					[0, 0, { period: C2, sample: 1 }],
					[16, 1, note(19)],
				]),
			],
		}),
		{ keep: [0, 1], share: true },
	);
	check(
		"channels whose notes overlap do not share",
		JSON.stringify(written.channels) === "[[0],[1]]",
		JSON.stringify(written.channels),
	);
}

section("sharing: more than eight channels");

{
	// Twelve channels, each playing through one pattern of its own and silent for the rest.
	const patterns = Array.from({ length: 12 }, (_, p) =>
		pattern([
			[0, p, note(12 + (p % 12))],
			[63, p, silence],
		]),
	);
	const bytes = modBytes({
		channels: 12,
		tag: "12CH",
		samples: SAMPLES,
		orders: patterns.map((_, p) => p),
		patterns,
	});
	const plain = imported(bytes);
	check("without sharing eight are suggested", plain.mod.suggested.length === 8, plain.mod.suggested.join());
	check("with it, all twelve", plain.mod.suggestedShared.length === 12, plain.mod.suggestedShared.join());
	const shared = imported(bytes, { keep: plain.mod.suggestedShared, share: true });
	check(
		"and they take turns on one channel",
		shared.written.channels.length === 1 && shared.written.channels[0].length === 12,
		JSON.stringify(shared.written.channels),
	);
	check("every note is walked", played(shared.song, 0).length === 12, String(played(shared.song, 0).length));
	check("it raises nothing", problems(shared.song).length === 0, problems(shared.song).join("; "));
	check("and it assembles", shared.song.spc instanceof Uint8Array, String(shared.song.spc));

	check("the packing fits", fitsShared(plain.mod, plain.mod.suggestedShared));
	check("sharing off keeps eight of them", oneEach(plain.mod, plain.mod.suggestedShared).length === 8);
	check("sharing on adds back what fits", addWhileFits(plain.mod, plain.mod.suggested).length === 12);
}
