/** `modtest`: samples made ready for BRR — the loop moved onto a block at every factor, a short loop laid end to end until it fills one, a one-shot's length, the planned frames matching what is planned, the factor that fits a room, and a library file played in a sample's place. */

import {
	type TrackerSample,
	copiesOf,
	fitFactor,
	fundamentalHz,
	libraryFactor,
	planSample,
	plannedFrames,
} from "@amk/import/tracker";
import { parseBrr } from "@amk/spc/brr";
import { brrDataBytes, encodeBrrWithHeadroom } from "@amk/spc/brr-encode";
import { check, section } from "../harness";
import { C2, centsOff, imported, modBytes, pattern, period, played, pluck, problems, square } from "./support";

/** An uploaded library file a module sample can be played on. */
const libraryBrr = parseBrr(
	"Lib.brr",
	encodeBrrWithHeadroom(
		Int16Array.from(square(16, 4), (v) => v * 256),
		0,
	).bytes,
);

const sample = (pcm: Int8Array, loopStart = 0, loopLength = 0): TrackerSample => ({
	index: 1,
	name: "",
	pcm: Int16Array.from(pcm, (v) => v * 256),
	baseHz: 8287,
	loopStart,
	loopLength,
});

section("samples: loops on blocks");

const looped = sample(new Int8Array([...pluck(1000), ...square(50, 6)]), 1000, 300);
for (const factor of [1, 0.75, 0.5, 0.33, 0.2]) {
	const plan = planSample(looped, factor);
	check(
		`at ${factor} the loop starts on a block and runs whole blocks to the end`,
		plan.loopStart !== null && plan.loopStart % 16 === 0 && (plan.pcm.length - plan.loopStart) % 16 === 0,
		`${plan.loopStart} of ${plan.pcm.length}`,
	);
	check(
		`at ${factor} the factor the loop's rounding makes is the one the loop was resampled by`,
		Math.abs((plan.pcm.length - (plan.loopStart ?? 0)) / 300 - plan.factor) < 1e-9 &&
			Math.abs(plan.factor - factor) < 16 / 300,
		String(plan.factor),
	);
	const planned = plannedFrames(looped, factor);
	check(`at ${factor} plannedFrames says what planSample makes`, planned.frames === plan.pcm.length && planned.loops);
}

{
	// A loop that would resample to under a block is laid end to end until it fills one, at its own factor.
	const chip = sample(square(8, 4), 0, 8);
	const plan = planSample(chip, 0.25);
	check(
		"an 8-frame loop at 0.25 becomes one 16-frame block",
		plan.pcm.length === 16 && plan.loopStart === 0,
		String(plan.pcm.length),
	);
	check("and its factor stays 0.25: eight repeats of the loop", plan.factor === 0.25, String(plan.factor));
}

{
	// A 1-frame loop holding a long sample's last value keeps the sample at its factor.
	const held = sample(new Int8Array([...pluck(30000), 40]), 30000, 1);
	const plan = planSample(held, 0.5);
	check(
		"a 1-frame loop after 30000 frames at 0.5 plans about 15000 frames",
		plan.factor === 0.5 && plan.pcm.length < 15100 && plan.loopStart === plan.pcm.length - 16,
		`${plan.pcm.length} at ${plan.factor}`,
	);
}

{
	const once = sample(pluck(999));
	const plan = planSample(once, 0.5);
	check(
		"a one-shot keeps every frame it has at its factor",
		plan.loopStart === null && plan.pcm.length === 500,
		String(plan.pcm.length),
	);
	check(
		"a one-shot resampled keeps its level",
		Math.max(...plan.pcm.map(Math.abs)) > 0.8 * 100 * 256,
		String(Math.max(...plan.pcm.map(Math.abs))),
	);
}

{
	// A square resampled at 1 keeps its loop seam: the last frame leads into the first without a jump.
	const plan = planSample(sample(square(32, 8), 0, 256), 1);
	check(
		"at factor 1 a whole loop is copied as it is",
		plan.pcm.length === 256 && plan.pcm[0] === 80 * 256 && plan.pcm[16] === -80 * 256,
		`${plan.pcm[0]} ${plan.pcm[16]}`,
	);
}

section("samples: fitting a room");

{
	const samples = [sample(pluck(20000)), looped, sample(square(64, 200), 0, 6400)];
	const bytes = (factor: number): number =>
		samples.reduce((sum, s) => {
			const plan = plannedFrames(s, factor);
			return sum + brrDataBytes(plan.frames, plan.loops);
		}, 0);
	const room = 12_000;
	const factor = fitFactor(samples, room, brrDataBytes);
	check("the factor found fits the room", bytes(factor) <= room, `${bytes(factor)} at ${factor}`);
	check("and a little more would not", bytes(factor * 1.02) > room, `${bytes(factor * 1.02)}`);
	check("samples that fit whole are left at 1", fitFactor(samples, 1_000_000, brrDataBytes) === 1);
}

section("samples: the optimized stock set");

{
	const bytes = modBytes({
		samples: [{ pcm: square(32, 8), loopStart: 0, loopLength: 32 }],
		orders: [0],
		patterns: [pattern([[0, 0, { period: C2, sample: 1 }]])],
	});
	const plain = imported(bytes);
	const optimized = imported(bytes, { optimized: true });
	check(
		"the option writes #optimized in #default's place",
		optimized.written.text.includes("\n\t#optimized\n") && !optimized.written.text.includes("#default"),
	);
	check(
		"and the song still raises nothing",
		problems(optimized.song).length === 0,
		problems(optimized.song).join("; "),
	);
	check(
		"it leaves the song's own samples more room",
		optimized.song.freeBytes > plain.song.freeBytes,
		`${optimized.song.freeBytes} vs ${plain.song.freeBytes}`,
	);
}

section("samples: a one-shot's end");

{
	const flat = sample(new Int8Array(400).fill(40));
	const plan = planSample(flat, 1);
	check("a one-shot fades to silence at its end", plan.pcm[plan.pcm.length - 1] === 0, String(plan.pcm.at(-1)));
	check(
		"over its last 32 frames, the rest untouched",
		plan.pcm[plan.pcm.length - 33] === 40 * 256 && plan.pcm[plan.pcm.length - 32] < 40 * 256,
		`${plan.pcm[plan.pcm.length - 33]} ${plan.pcm[plan.pcm.length - 32]}`,
	);
	const short = planSample(sample(new Int8Array(40).fill(40)), 1);
	check("a short one keeps all but its last quarter", short.pcm[29] === 40 * 256 && short.pcm[39] === 0);
	const loop = planSample(sample(square(32, 8), 0, 256), 1);
	check("a looped sample is not faded", loop.pcm[loop.pcm.length - 1] !== 0);
}

section("samples: copies share a file");

{
	// One sample under two slots, the second at finetune 7, seven eighths of a semitone higher: one file, two instruments.
	const pcm = square(32, 8);
	const spec = (second: Int8Array) =>
		modBytes({
			samples: [
				{ pcm, loopStart: 0, loopLength: 256 },
				{ pcm: second, loopStart: 0, loopLength: 256, finetune: 7 },
			],
			orders: [0],
			patterns: [
				pattern([
					[0, 0, { period: C2, sample: 1 }],
					[0, 1, { period: C2, sample: 2 }],
				]),
			],
		});
	const shared = imported(spec(pcm));
	const other = Int8Array.from(pcm, (v, i) => (i === 0 ? v - 1 : v));
	const apart = imported(spec(other));
	check("the second slot is found to be the first's", copiesOf(shared.mod.song).get(2) === 1);
	check(
		"the dialog lists the first, with its copy",
		shared.mod.samples.length === 1 && shared.mod.samples[0].copies.join() === "2" && shared.mod.samples[0].notes === 2,
		JSON.stringify(shared.mod.samples.map((s) => ({ index: s.index, copies: s.copies, notes: s.notes }))),
	);
	const listed = /^#samples\n\{\n([^}]*)\}/m.exec(shared.written.text)?.[1] ?? "";
	check(
		"#samples lists its file once",
		(listed.match(/MOD 01\.brr/g) ?? []).length === 1 && !listed.includes("MOD 02"),
		listed,
	);
	check(
		"and #instruments gives each slot its own tuning on it",
		(shared.written.text.match(/^\t"MOD 01\.brr" \$FF/gm) ?? []).length === 2,
		shared.written.text,
	);
	check("a copy raises nothing", problems(shared.song).length === 0, problems(shared.song).join("; "));
	for (const channel of [0, 1]) {
		const walked = played(shared.song, channel)[0];
		const cents = walked ? centsOff(shared, walked, C2) : Infinity;
		check(`slot ${channel + 1} plays at its own pitch`, Math.abs(cents) <= 11, cents.toFixed(1));
	}

	check(
		"and the song keeps a copy's worth of ARAM",
		shared.song.freeBytes > apart.song.freeBytes,
		`${shared.song.freeBytes} vs ${apart.song.freeBytes}`,
	);

	// A copy follows its first slot onto a library file, under a tuning of its own.
	const library = imported(spec(pcm), { library: new Map([[1, { name: "Lib.brr", factor: 2, listed: true }]]) }, [
		libraryBrr,
	]);
	check(
		"a copy follows its first slot onto a library file",
		(library.written.text.match(/^\t"Lib\.brr" \$FF/gm) ?? []).length === 2 && !library.written.text.includes("MOD 0"),
		library.written.text,
	);
	for (const channel of [0, 1]) {
		const walked = played(library.song, channel)[0];
		const cents = walked ? centsOff(library, walked, C2) : Infinity;
		check(`and slot ${channel + 1} plays at its own pitch on it`, Math.abs(cents) <= 11, cents.toFixed(1));
	}
}

section("samples: the fundamental");

{
	const cents = (heard: number | null, wanted: number): number =>
		heard === null ? Infinity : 1200 * Math.log2(heard / wanted);
	// A hundred periods to a 1901-frame loop, so the loop's length gives the period exactly.
	const sine = Int16Array.from({ length: 1901 }, (_, i) =>
		Math.round(20000 * Math.sin((2 * Math.PI * 100 * i) / 1901)),
	);
	const sineOff = cents(fundamentalHz(sine, 0, 8363), (8363 * 100) / 1901);
	check("a looped sine's pitch is heard", Math.abs(sineOff) < 5, sineOff.toFixed(2));
	const saw = Int16Array.from({ length: 64 }, (_, i) => (i - 32) * 900);
	const sawOff = cents(fundamentalHz(saw, 0, 16000), 250);
	check("a one-cycle saw loop's", Math.abs(sawOff) < 5, sawOff.toFixed(2));
	const decaying = Int16Array.from(
		{ length: 3000 },
		(_, i) => Math.round(20000 * Math.exp(-i / 1500)) * (i % 40 < 20 ? 1 : -1),
	);
	const squareOff = cents(fundamentalHz(decaying, null, 8000), 200);
	check("a decaying one-shot square's", Math.abs(squareOff) < 5, squareOff.toFixed(2));
	let state = 7;
	const noise = Int16Array.from({ length: 4000 }, () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return (state >> 16) - 32768;
	});
	check("noise has none", fundamentalHz(noise, null, 32000) === null, String(fundamentalHz(noise, null, 32000)));
	const tuned = libraryFactor(8000, 200, 400, 0);
	check(
		"a library sample an octave above is played at half the DSP's rate",
		tuned.pitched && Math.abs(tuned.factor * 8000 - 16000) < 1e-6,
		String(tuned.factor),
	);
	const unpitched = libraryFactor(8000, null, 400, 12);
	check(
		"and one with no pitch heard at 32 kHz, raised by the semitones asked",
		!unpitched.pitched && Math.abs(unpitched.factor * 8000 - 64000) < 1e-6,
		String(unpitched.factor),
	);
}

section("samples: a library sample in a sample's place");

{
	const bytes = modBytes({
		samples: [
			{ pcm: square(32, 8), loopStart: 0, loopLength: 256 },
			{ pcm: square(20, 8), loopStart: 0, loopLength: 160 },
		],
		orders: [0],
		patterns: [
			pattern([
				[0, 0, { period: C2, sample: 1 }],
				[0, 1, { period: period(24), sample: 2 }],
				[16, 1, { period: period(19), sample: 2 }],
			]),
		],
	});
	for (const optimized of [false, true]) {
		const stock = imported(bytes, {
			optimized,
			library: new Map([[2, { name: "00 SMW @0.brr", factor: 2.3, listed: false }]]),
		});
		const listed = /^#samples\n\{\n([^}]*)\}/m.exec(stock.written.text)?.[1] ?? "";
		const group = optimized ? "#optimized" : "#default";
		check(
			`under ${group} a stock file is not listed again, and the sample's own is not written`,
			!listed.includes("SMW") && !listed.includes("MOD 02") && listed.includes("MOD 01"),
			listed,
		);
		check(
			"#instruments names the stock file",
			/^\t"00 SMW @0\.brr" \$FF \$E0 \$7F/m.test(stock.written.text),
			stock.written.text,
		);
		check(
			"it is one slot of the song's samples",
			(stock.song.result.sampleList ?? []).filter((name) => name === "00 SMW @0.brr").length === 1,
			JSON.stringify(stock.song.result.sampleList),
		);
		check(
			"and it raises nothing and assembles",
			problems(stock.song).length === 0 && stock.song.spc instanceof Uint8Array,
			problems(stock.song).join("; "),
		);
		for (const [n, semitones] of [
			[0, 24],
			[1, 19],
		]) {
			const walked = played(stock.song, 1)[n];
			const cents = walked ? centsOff(stock, walked, period(semitones)) : Infinity;
			check(`note ${n + 1} plays at the library rate's pitch`, Math.abs(cents) <= 11, cents.toFixed(1));
		}
	}

	// One uploaded file standing in for both samples: listed once, each sample its own tuning on it.
	const both = imported(
		bytes,
		{
			library: new Map([
				[1, { name: "Lib.brr", factor: 1.5, listed: true }],
				[2, { name: "Lib.brr", factor: 3, listed: true }],
			]),
		},
		[libraryBrr],
	);
	const listed = /^#samples\n\{\n([^}]*)\}/m.exec(both.written.text)?.[1] ?? "";
	check(
		"an uploaded file is listed once for two samples",
		(listed.match(/Lib\.brr/g) ?? []).length === 1 && !listed.includes("MOD"),
		listed,
	);
	const tunings = both.written.samples.map((s) => `${s.tuning.multiplier}.${s.tuning.sub}`);
	check(
		"under two instruments and two tunings",
		both.written.samples.length === 2 && tunings[0] !== tunings[1],
		tunings.join(" "),
	);
	check("with nothing to encode", both.brrs.length === 0);
	check("and it raises nothing", problems(both.song).length === 0, problems(both.song).join("; "));
	const first = played(both.song, 0)[0];
	const firstOff = first ? centsOff(both, first, C2) : Infinity;
	check("each sample plays at its library rate's pitch", Math.abs(firstOff) <= 11, firstOff.toFixed(1));
}
