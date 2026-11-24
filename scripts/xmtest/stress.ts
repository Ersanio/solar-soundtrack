/** `xmtest`: busy, seeded XMs — twelve channels, every effect, the volume column, instruments with envelopes, fadeouts, keymaps and auto-vibrato, repeats and a jump back — imported at several factors, on both frequency tables and both loop modes, without raising a problem, and assembled. */

import { check, section } from "../harness";
import { type Cell, imported, pluck, problems, square, xmBytes } from "./support";

/** A small seeded generator, so the song is the same on every run. */
function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

/** Effects a busy song uses, as `[effect, parameter]` builders. */
const EFFECTS: ((pick: (n: number) => number) => [number | string, number] | null)[] = [
	() => null,
	(pick) => [0, 0x37 + pick(2)],
	(pick) => [1, 1 + pick(8)],
	(pick) => [2, 1 + pick(8)],
	(pick) => [3, 4 + pick(16)],
	(pick) => [4, ((1 + pick(15)) << 4) | (1 + pick(15))],
	(pick) => [5, pick(2) ? 0x20 : 0x02],
	(pick) => [6, pick(2) ? 0x10 : 0x01],
	(pick) => [7, 0x44 + pick(2)],
	(pick) => [8, pick(256)],
	(pick) => [9, 1 + pick(4)],
	(pick) => ["A", pick(2) ? 0x04 : 0x40],
	(pick) => ["C", pick(65)],
	(pick) => ["E", 0x10 | (1 + pick(15))],
	(pick) => ["E", 0x20 | (1 + pick(15))],
	(pick) => ["E", 0x50 | pick(16)],
	(pick) => ["E", 0x90 | (1 + pick(3))],
	(pick) => ["E", 0xa0 | (1 + pick(8))],
	(pick) => ["E", 0xc0 | pick(6)],
	(pick) => ["E", 0xd0 | (1 + pick(5))],
	(pick) => ["F", 2 + pick(8)],
	(pick) => ["F", 80 + pick(120)],
	(pick) => ["G", 32 + pick(33)],
	(pick) => ["H", pick(2) ? 0x01 : 0x10],
	(pick) => ["K", pick(6)],
	(pick) => ["P", pick(2) ? 0x04 : 0x40],
	(pick) => ["R", 0x11 + pick(0xe0)],
	(pick) => ["T", 0x11 + pick(0x33)],
	(pick) => ["X", 0x11 + pick(0x1f)],
];

const CHANNELS = 12;

export function busyXm(seed: number, linear: boolean): Uint8Array {
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

				const effect = EFFECTS[pick(EFFECTS.length)](pick);
				const struck = pick(3) !== 0;
				const volume =
					pick(3) === 0
						? [0x10 + pick(65), 0x60 + pick(16), 0x80 + pick(32), 0xb0 + pick(16), 0xc0 + pick(16), 0xf0 + pick(16)][
								pick(6)
							]
						: 0;
				cells.push({
					...(struck ? { note: pick(20) === 0 ? 97 : 25 + pick(60), instrument: pick(2) ? 1 + pick(4) : 0 } : {}),
					...(volume ? { volume } : {}),
					...(effect ? { effect: effect[0], param: effect[1] } : {}),
				});
			}

			rows.push(cells);
		}

		patterns.push(rows);
	}

	// The last order jumps back to the second.
	patterns[3][63][CHANNELS - 1] = { effect: "B", param: 1 };
	return xmBytes({
		channels: CHANNELS,
		linear,
		instruments: [
			{ samples: [{ pcm: square(32, 16), loopStart: 0, loopLength: 512, finetune: pick(256) - 128 }] },
			{
				samples: [{ pcm: [...pluck(800), ...square(40, 4)], loopStart: 800, loopLength: 160, relativeNote: 12 }],
				volumeEnvelope: {
					points: [
						[0, 64],
						[10, 32],
						[40, 48],
						[80, 0],
					],
					sustain: 1,
				},
				fadeout: 1024,
			},
			{
				samples: [
					{ pcm: pluck(1200, 24).map((v) => v * 200), sixteen: true },
					{ pcm: square(8, 32), loopStart: 0, loopLength: 64, pingPong: true },
				],
				keymap: Array.from({ length: 96 }, (_, i) => (i < 48 ? 0 : 1)),
				panEnvelope: {
					points: [
						[0, 0],
						[20, 64],
						[40, 0],
					],
					loop: [0, 2],
				},
			},
			{
				samples: [{ pcm: square(16, 16), loopStart: 0, loopLength: 256, relativeNote: -12 }],
				autoVibrato: { depth: 4, rate: 20 },
			},
		],
		orders: [0, 1, 2, 1, 2, 3],
		patterns,
	});
}

section("stress: busy songs at several factors");

for (const seed of [1, 2, 3, 4, 5]) {
	for (const linear of [true, false]) {
		const bytes = busyXm(seed, linear);
		for (const factor of [1, 0.5, 0.25]) {
			for (const loop of ["jump", "song"] as const) {
				const factors = new Map([1, 2, 3, 4, 5].map((index) => [index, factor]));
				const { song } = imported(bytes, { factors, loop, separation: 0.5 });
				check(
					`seed ${seed}, ${linear ? "linear" : "Amiga"}, at ${factor}, looping at the ${loop}: no problems, and it assembles`,
					song.result.ok && problems(song).length === 0 && song.spc instanceof Uint8Array,
					[...problems(song).slice(0, 4), typeof song.spc === "string" ? song.spc : ""].join("; "),
				);
			}
		}
	}
}
