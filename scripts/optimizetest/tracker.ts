/** `optimizetest`: seeded tracker modules written flat and optimized as the Import dialog does — smaller, playing the same, raising no problem, every channel open in the roll, and in time. */

import { check, info, section } from "../harness";
import { type Cell, PERIODS, encoded, modBytes, pluck, problems, song, square } from "../modtest/support";
import { readMod } from "@amk/import/mod";
import { writeTracker } from "@amk/import/tracker";
import { optimize, refusedChannels, sameNotes } from "./support";

function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

/** A module the way a tracker song is made: a few riffs per channel, played again across patterns, with fades and slides between. */
function riffMod(seed: number): Uint8Array {
	const next = random(seed);
	const pick = (n: number): number => Math.floor(next() * n);
	const riff = (): (Cell | null)[] =>
		Array.from({ length: 16 }, () => {
			if (pick(3) === 0) {
				return null;
			}

			const effects: [number, number][] = [
				[0, 0],
				[0xa, 0x04],
				[0xc, 32 + pick(32)],
				[0x1, 2],
				[0x4, 0x44],
			];
			const [effect, param] = effects[pick(effects.length)];
			return { period: PERIODS[pick(PERIODS.length)], sample: 1 + pick(3), effect, param };
		});
	const riffs = Array.from({ length: 4 }, () => Array.from({ length: 3 }, riff));
	const patterns: Cell[][][] = [];
	for (let p = 0; p < 3; p++) {
		const rows: Cell[][] = [];
		for (let row = 0; row < 64; row++) {
			rows.push(riffs.map((own, channel) => own[(Math.floor(row / 16) + p + channel) % 3][row % 16] ?? {}));
		}

		patterns.push(rows);
	}

	return modBytes({
		samples: [
			{ pcm: square(32, 16), loopStart: 0, loopLength: 512 },
			{ pcm: new Int8Array([...pluck(800), ...square(40, 4)]), loopStart: 800, loopLength: 160, volume: 48 },
			{ pcm: pluck(1200, 24) },
		],
		orders: [0, 1, 0, 2, 1, 2, 0],
		patterns,
	});
}

section("tracker: seeded modules written flat and optimized");

for (const seed of [1, 2, 3, 4]) {
	const mod = readMod(riffMod(seed));
	const written = writeTracker(mod, {
		keep: mod.suggested,
		factors: new Map(),
		separation: 0.5,
		loop: "jump",
		sampleName: (index) => `MOD ${String(index).padStart(2, "0")}.brr`,
		fallbackTitle: null,
		passLoops: false,
	});
	const brrs = encoded(mod, written);
	const names = brrs.map((b) => b.sampleName);
	const started = performance.now();
	const result = optimize(written.text, { extra: names });
	const ms = performance.now() - started;
	info(`seed ${seed}: ${result.before} -> ${result.after} bytes in ${Math.round(ms)} ms`);

	check(
		`seed ${seed}: at least a quarter smaller`,
		result.after <= result.before * 0.75,
		`${result.before} -> ${result.after}`,
	);
	const diff = sameNotes(written.text, result.text, names);
	check(`seed ${seed}: plays the same`, diff === null, diff ?? "");
	const built = song(result.text, brrs);
	check(
		`seed ${seed}: raises no problem and assembles`,
		problems(built).length === 0 && built.spc instanceof Uint8Array,
		problems(built).slice(0, 4).join("; "),
	);
	check(
		`seed ${seed}: every channel opens in the roll`,
		refusedChannels(result.text, names).length === 0,
		refusedChannels(result.text, names).join("; "),
	);
	check(`seed ${seed}: within two seconds`, ms < 2000, `${Math.round(ms)} ms`);
}
