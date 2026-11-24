/** `s3mtest`: busy, seeded S3Ms — twelve channels, every effect, the volume column, repeats and a jump back — imported at several factors and both loop modes without raising a problem, and assembled. */

import { check, section } from "../harness";
import { type Cell, imported, noteAt, pluck, problems, s3mBytes, square } from "./support";

/** A small seeded generator, so the song is the same on every run. */
function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

/** Commands a busy song uses, as `[letter, info]` builders. */
const COMMANDS: ((pick: (n: number) => number) => [string, number] | null)[] = [
	() => null,
	(pick) => ["D", pick(2) ? 1 + pick(8) : (1 + pick(8)) << 4],
	(pick) => ["D", pick(2) ? 0xf0 | (1 + pick(14)) : ((1 + pick(14)) << 4) | 0x0f],
	() => ["D", 0],
	(pick) => ["E", 1 + pick(16)],
	(pick) => ["F", pick(2) ? 1 + pick(16) : 0xf1 + pick(14)],
	(pick) => ["G", 4 + pick(32)],
	(pick) => ["H", ((1 + pick(15)) << 4) | (1 + pick(15))],
	(pick) => ["U", ((1 + pick(15)) << 4) | (1 + pick(15))],
	(pick) => ["I", 0x11 + pick(0x33)],
	(pick) => ["J", 0x37 + pick(2)],
	(pick) => ["K", 1 + pick(4)],
	(pick) => ["L", (1 + pick(4)) << 4],
	(pick) => ["O", pick(256)],
	(pick) => ["Q", 1 + pick(0xf4)],
	(pick) => ["R", 0x44 + pick(2)],
	(pick) => ["S", 0x80 | pick(16)],
	(pick) => ["S", 0xc0 | pick(6)],
	(pick) => ["S", 0xd0 | (1 + pick(5))],
	(pick) => ["S", 0x20 | pick(16)],
	(pick) => ["X", pick(0x81)],
	(pick) => ["A", 2 + pick(8)],
	(pick) => ["T", 80 + pick(120)],
	(pick) => ["V", 32 + pick(33)],
];

const CHANNELS = 12;

export function busyS3m(seed: number): Uint8Array {
	const next = random(seed);
	const pick = (n: number): number => Math.floor(next() * n);
	const patterns: Cell[][][] = [];
	for (let p = 0; p < 4; p++) {
		const rows: Cell[][] = [];
		for (let row = 0; row < 64; row++) {
			const cells: Cell[] = [];
			for (let channel = 0; channel < CHANNELS; channel++) {
				if (pick(3) !== 0) {
					cells.push({});
					continue;
				}

				const command = COMMANDS[pick(COMMANDS.length)](pick);
				const struck = pick(3) !== 0;
				cells.push({
					...(struck
						? { note: pick(20) === 0 ? 254 : noteAt(24 + pick(60)), instrument: pick(2) ? 1 + pick(4) : 0 }
						: {}),
					...(pick(3) === 0 ? { volume: pick(65) } : {}),
					...(command ? { command: command[0], info: command[1] } : {}),
				});
			}

			rows.push(cells);
		}

		patterns.push(rows);
	}

	// The last order jumps back to the second.
	patterns[3][63][CHANNELS - 1] = { command: "B", info: 2 };
	return s3mBytes({
		channels: CHANNELS,
		samples: [
			{ pcm: square(32, 16), loopStart: 0, loopLength: 512, c2spd: 8363 + pick(4000) },
			{ pcm: [...pluck(800), ...square(40, 4)], loopStart: 800, loopLength: 160, volume: 40 + pick(24), c2spd: 22050 },
			{ pcm: pluck(1200, 24).map((v) => v * 200), sixteen: true },
			{ pcm: square(8, 2), loopStart: 0, loopLength: 16, c2spd: 4000 },
		],
		orders: [0, 254, 1, 2, 1, 2, 3, 255],
		patterns,
	});
}

section("stress: busy songs at several factors");

for (const seed of [1, 2, 3, 4, 5]) {
	const bytes = busyS3m(seed);
	for (const factor of [1, 0.5, 0.25]) {
		for (const loop of ["jump", "song"] as const) {
			for (const separation of [1, 0.25]) {
				const factors = new Map([1, 2, 3, 4].map((index) => [index, factor]));
				const { song } = imported(bytes, { factors, loop, separation });
				check(
					`seed ${seed} at ${factor}, looping at the ${loop}, separation ${separation}: no problems, and it assembles`,
					song.result.ok && problems(song).length === 0 && song.spc instanceof Uint8Array,
					[...problems(song).slice(0, 4), typeof song.spc === "string" ? song.spc : ""].join("; "),
				);
			}
		}
	}
}
