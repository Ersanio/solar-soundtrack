/** `modtest`: samples made ready for BRR — the loop moved onto a block at every factor, a short loop laid end to end until it fills one, a one-shot's length, the planned frames matching what is planned, and the factor that fits a room. */

import { type TrackerSample, copiesOf, fitFactor, planSample, plannedFrames } from "@amk/import/tracker";
import { brrDataBytes } from "@amk/spc/brr-encode";
import { check, section } from "../harness";
import { C2, centsOff, imported, modBytes, pattern, played, pluck, problems, square } from "./support";

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
}
