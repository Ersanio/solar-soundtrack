/** `modtest`: samples made ready for BRR — the loop moved onto a block at every factor, a tiny loop widened to one, a one-shot's length, the planned frames matching what is planned, and the factor that fits a room. */

import { fitFactor, planSample, plannedFrames } from "@amk/import/mod";
import type { ModSample } from "@amk/import/mod/file";
import { brrDataBytes } from "@amk/spc/brr-encode";
import { check, section } from "../harness";
import { pluck, square } from "./support";

const sample = (pcm: Int8Array, loopStart = 0, loopLength = 0): ModSample => ({
	index: 1,
	name: "",
	pcm,
	finetune: 0,
	volume: 64,
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
	// A loop that would resample to under a block is widened to one: sixteen frames, the factor raised.
	const chip = sample(square(8, 4), 0, 8);
	const plan = planSample(chip, 0.25);
	check(
		"an 8-frame loop at 0.25 becomes one 16-frame block",
		plan.pcm.length === 16 && plan.loopStart === 0,
		String(plan.pcm.length),
	);
	check("and its factor is 2", plan.factor === 2, String(plan.factor));
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
