/** `modtest`: the MOD reader — each signature's channel count, FLT8's pattern pairs, the pattern count, the sample headers' loop quirks, a file cut short, and what is refused. */

import { detectFormat } from "@amk/import/format";
import { ModError, readMod } from "@amk/import/mod";
import { channelsOfTag, readModFile } from "@amk/import/mod/file";
import { check, section } from "../harness";
import { C2, modBytes, pattern, square } from "./support";

section("reader: signatures");

for (const [tag, channels] of [
	["M.K.", 4],
	["M!K!", 4],
	["FLT4", 4],
	["6CHN", 6],
	["8CHN", 8],
	["CD81", 8],
	["OKTA", 8],
	["12CH", 12],
	["32CN", 32],
	["TDZ3", 3],
] as const) {
	check(
		`${tag} is ${channels} channels`,
		channelsOfTag(tag)?.channels === channels,
		JSON.stringify(channelsOfTag(tag)),
	);
}

check("an unknown signature names no channels", channelsOfTag("ABCD") === null && channelsOfTag("0CHN") === null);

const simple = modBytes({
	samples: [{ pcm: square(32, 8), loopStart: 0, loopLength: 32 }],
	orders: [0],
	patterns: [pattern([[0, 0, { period: C2, sample: 1 }]])],
});
check("a M.K. file is detected as a MOD", detectFormat(simple) === "mod");

const notMod = new Uint8Array(simple);
notMod.set([0x41, 0x42, 0x43, 0x44], 1080);
check("a file without a signature is not detected", detectFormat(notMod) === null);
check(
	"and reading it refuses with not-mod",
	(() => {
		try {
			readMod(notMod);
			return false;
		} catch (error) {
			return error instanceof ModError && error.code === "not-mod";
		}
	})(),
);
check(
	"a file cut before its signature is not a MOD",
	(() => {
		try {
			readMod(simple.subarray(0, 1082));
			return false;
		} catch (error) {
			return error instanceof ModError && error.code === "not-mod";
		}
	})(),
);

section("reader: patterns and orders");

{
	const file = readModFile(
		modBytes({
			channels: 8,
			samples: [{ pcm: square(32, 8), loopStart: 0, loopLength: 32 }],
			orders: [1, 0],
			patterns: [
				pattern([[0, 7, { period: C2, sample: 1 }]]),
				pattern([
					[5, 3, { period: 214, sample: 1, effect: 0xc, param: 0x20 }],
					[63, 6, { effect: 0xf, param: 3 }],
				]),
			],
		}),
	);
	check("an 8CHN file reads eight channels", file.channels === 8 && file.patterns[0][0].length === 8);
	check(
		"a cell's sample, period, effect and parameter are read from its four bytes",
		file.patterns[1][5][3].period === 214 &&
			file.patterns[1][5][3].sample === 1 &&
			file.patterns[1][5][3].effect === 0xc &&
			file.patterns[1][5][3].param === 0x20,
		JSON.stringify(file.patterns[1][5][3]),
	);
	check("orders are kept in order", file.orders.join() === "1,0");
	check("an 8CHN file is not ProTracker's", !file.amiga);
}

{
	// Pattern 2 is stored though no played order names it: an entry past the song length still counts.
	const bytes = modBytes({
		samples: [{ pcm: square(32, 8), loopStart: 0, loopLength: 32 }],
		orders: [0, 2],
		patterns: [pattern([]), pattern([]), pattern([[0, 1, { period: C2, sample: 1 }]])],
	});
	bytes[950] = 1;
	const file = readModFile(bytes);
	check(
		"the pattern count is the highest of all 128 entries",
		file.patterns.length === 3,
		String(file.patterns.length),
	);
	check("the song plays only its length's orders", file.orders.join() === "0");
	check(
		"the sample after every stored pattern is read where it is",
		file.samples[0].pcm.length === 256 && file.samples[0].pcm[0] === 80,
		String(file.samples[0].pcm[0]),
	);
}

{
	// FLT8: each logical pattern is two stored ones, channels 1-4 then 5-8, and its orders are doubled.
	const file = readModFile(
		modBytes({
			tag: "FLT8",
			channels: 8,
			storedChannels: 4,
			samples: [{ pcm: square(32, 8), loopStart: 0, loopLength: 32 }],
			orders: [0, 2],
			patterns: [
				pattern([[0, 0, { period: 428, sample: 1 }]]),
				pattern([[0, 1, { period: 404, sample: 1 }]]),
				pattern([[0, 2, { period: 381, sample: 1 }]]),
				pattern([[0, 3, { period: 360, sample: 1 }]]),
			],
		}),
	);
	check("FLT8 is eight channels", file.channels === 8);
	check("FLT8's orders are halved", file.orders.join() === "0,1", file.orders.join());
	check(
		"FLT8's second stored pattern is channels 5-8",
		file.patterns[0][0][0].period === 428 &&
			file.patterns[0][0][5].period === 404 &&
			file.patterns[1][0][2].period === 381 &&
			file.patterns[1][0][7].period === 360,
	);
}

section("reader: sample headers");

{
	const file = readModFile(
		modBytes({
			samples: [
				{ pcm: square(32, 8), name: "lead" },
				{ pcm: square(32, 8) },
				{ pcm: square(32, 8) },
				{ pcm: square(32, 8), finetune: -3, volume: 70 },
			],
			rawLoop: [
				{ start: 0, length: 1 },
				{ start: 64, length: 64 },
				{ start: 80, length: 64 },
				{ start: 0, length: 0 },
			],
			orders: [0],
			patterns: [pattern([])],
		}),
	);
	check("the name is read", file.samples[0].name === "lead");
	check("a loop of one word is no loop", file.samples[0].loopLength === 0);
	check(
		"a loop in words is read in frames",
		file.samples[1].loopStart === 128 && file.samples[1].loopLength === 128,
		JSON.stringify(file.samples[1]),
	);
	check(
		"a loop start written in bytes is halved where only the half fits",
		file.samples[2].loopStart === 80 && file.samples[2].loopLength === 128,
		`${file.samples[2].loopStart}+${file.samples[2].loopLength}`,
	);
	check("a finetune nibble is signed", file.samples[3].finetune === -3);
	check("a volume past 64 is clamped", file.samples[3].volume === 64);
	check("an empty slot has no PCM", file.samples[4].pcm.length === 0);
}

{
	const bytes = modBytes({
		samples: [{ pcm: square(32, 8) }, { pcm: square(32, 8) }],
		orders: [0],
		patterns: [pattern([])],
	});
	const file = readModFile(bytes.subarray(0, bytes.length - 100));
	check(
		"a file cut inside its sample data keeps what is there and says so",
		file.truncated && file.samples[0].pcm.length === 256 && file.samples[1].pcm.length === 156,
		`${file.samples[1].pcm.length}`,
	);
}

{
	const file = readModFile(
		modBytes({
			samples: [{ pcm: square(32, 8), loopStart: 0, loopLength: 32 }],
			orders: [0, 0],
			restart: 1,
			patterns: [pattern([])],
		}),
	);
	const stock = readModFile(
		modBytes({ samples: [{ pcm: square(32, 8) }], orders: [0], restart: 0x7f, patterns: [pattern([])] }),
	);
	check("a restart inside the song is kept", file.restart === 1);
	check("a restart of 127 is the song's start", stock.restart === 0);
	check("a 4-channel M.K. file in Amiga range is ProTracker's", stock.amiga);
}
