/** `ittest`: busy, seeded ITs — twelve channels, every command and the volume column, in sample mode and with instruments, envelopes and keymaps, on linear and Amiga slides, repeats and a jump back — imported at several factors and both loop modes without raising a problem, and assembled. */

import { check, section } from "../harness";
import { type Cell, type InstrumentSpec, imported, itBytes, pluck, problems, square } from "./support";

/** A small seeded generator, so the song is the same on every run. */
function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

/** Commands a busy song uses, as `[letter, param]` builders. */
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
	(pick) => ["M", 32 + pick(33)],
	(pick) => ["N", pick(2) ? 0x01 : 0x10],
	(pick) => ["O", pick(256)],
	(pick) => ["P", pick(2) ? 0x04 : 0x40],
	(pick) => ["Q", 1 + pick(0xf4)],
	(pick) => ["R", 0x44 + pick(2)],
	(pick) => ["S", 0x80 | pick(16)],
	(pick) => ["S", 0xc0 | pick(6)],
	(pick) => ["S", 0xd0 | (1 + pick(5))],
	(pick) => ["S", 0x60 | pick(3)],
	(pick) => ["T", 80 + pick(120)],
	(pick) => ["T", pick(2) ? 0x12 : 0x02],
	(pick) => ["V", 64 + pick(65)],
	(pick) => ["W", pick(2) ? 0x01 : 0x10],
	(pick) => ["X", pick(256)],
	() => ["Y", 0x44],
];

const CHANNELS = 12;

export function busyIt(seed: number, linear: boolean, instrumentMode: boolean): Uint8Array {
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
				const volume =
					pick(3) === 0
						? [pick(65), 65 + pick(40), 128 + pick(65), 193 + pick(10), 203 + pick(10)][pick(5)]
						: undefined;
				cells.push({
					...(struck
						? { note: [254, 255, 246][pick(20)] ?? 36 + pick(60), instrument: pick(2) ? 1 + pick(4) : undefined }
						: {}),
					...(volume !== undefined ? { volume } : {}),
					...(command ? { command: command[0], param: command[1] } : {}),
				});
			}

			rows.push(cells);
		}

		patterns.push(rows);
	}

	// The last order jumps back to the second.
	patterns[3][63][CHANNELS - 1] = { command: "B", param: 1 };
	const instruments: InstrumentSpec[] = [
		{
			sample: 1,
			volumeEnvelope: {
				points: [
					[0, 64],
					[10, 32],
					[40, 48],
					[80, 0],
				],
				sustain: [1, 1],
			},
			fadeout: 256,
		},
		{
			sample: 2,
			panEnvelope: {
				points: [
					[0, -32],
					[20, 32],
					[40, -32],
				],
				loop: [0, 2],
			},
			newNoteAction: 2,
		},
		{
			keymap: Array.from({ length: 120 }, (_, n) => ({ note: n, sample: n < 60 ? 3 : 4 })),
			pitchEnvelope: {
				points: [
					[0, 0],
					[10, 4],
					[20, 0],
				],
			},
		},
		{ sample: 4, fadeout: 1024, globalVolume: 96 },
	];
	return itBytes({
		linear,
		samples: [
			{ pcm: square(32, 16), loopStart: 0, loopLength: 512, c5Speed: 8363 + pick(20000) },
			{
				pcm: [...pluck(800), ...square(40, 4)],
				loopStart: 800,
				loopLength: 160,
				c5Speed: 22050,
				autoVibrato: { speed: 20, depth: 16 },
			},
			{ pcm: pluck(1200, 24).map((v) => v * 200), sixteen: true },
			{ pcm: square(8, 32), loopStart: 0, loopLength: 64, pingPong: true, c5Speed: 4000 },
		],
		...(instrumentMode ? { instruments } : {}),
		orders: [0, 1, 2, 1, 2, 3, 255],
		patterns,
	});
}

section("stress: busy songs at several factors");

for (const seed of [1, 2, 3, 4]) {
	for (const [linear, instrumentMode] of [
		[true, false],
		[false, false],
		[true, true],
		[false, true],
	] as const) {
		const bytes = busyIt(seed, linear, instrumentMode);
		for (const factor of [1, 0.5, 0.25]) {
			for (const loop of ["jump", "song"] as const) {
				const factors = new Map([1, 2, 3, 4].map((index) => [index, factor]));
				const { song } = imported(bytes, { factors, loop, separation: 0.5 });
				check(
					`seed ${seed}, ${linear ? "linear" : "Amiga"}, ${instrumentMode ? "instruments" : "samples"}, at ${factor}, looping at the ${loop}: no problems, and it assembles`,
					song.result.ok && problems(song).length === 0 && song.spc instanceof Uint8Array,
					[...problems(song).slice(0, 4), typeof song.spc === "string" ? song.spc : ""].join("; "),
				);
			}
		}
	}
}
