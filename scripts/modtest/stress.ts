/** `modtest`: busy, seeded MODs — eight channels, every effect, repeats, a jump back — imported at several factors and both loop modes without raising a problem, and assembled; and twelve channels shared onto eight. */

import { check, section } from "../harness";
import { type Cell, PERIODS, imported, modBytes, pluck, problems, square } from "./support";

/** A small seeded generator, so the song is the same on every run. */
function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

/** Effects a busy song uses, as `[effect, parameter]` builders. */
const EFFECTS: ((pick: (n: number) => number) => [number, number])[] = [
	() => [0, 0],
	(pick) => [0x0, 0x37 + pick(2)],
	(pick) => [0x1, 1 + pick(8)],
	(pick) => [0x2, 1 + pick(8)],
	(pick) => [0x3, 4 + pick(16)],
	(pick) => [0x4, ((1 + pick(15)) << 4) | (1 + pick(15))],
	(pick) => [0x5, pick(2) ? 0x20 : 0x02],
	(pick) => [0x6, pick(2) ? 0x10 : 0x01],
	(pick) => [0x7, 0x44 + pick(2)],
	(pick) => [0x8, pick(256)],
	(pick) => [0x9, 1 + pick(4)],
	(pick) => [0xa, pick(2) ? 0x04 : 0x40],
	(pick) => [0xc, pick(65)],
	(pick) => [0xe, 0x10 | (1 + pick(15))],
	(pick) => [0xe, 0x20 | (1 + pick(15))],
	(pick) => [0xe, 0x80 | pick(16)],
	(pick) => [0xe, 0x90 | (1 + pick(3))],
	(pick) => [0xe, 0xa0 | (1 + pick(8))],
	(pick) => [0xe, 0xb0 | (1 + pick(8))],
	(pick) => [0xe, 0xc0 | pick(6)],
	(pick) => [0xe, 0xd0 | (1 + pick(5))],
	(pick) => [0xf, 2 + pick(8)],
	(pick) => [0xf, 80 + pick(120)],
];

/**
 * A busy song on `channels`. Past eight, every channel from the fifth sits out alternate patterns,
 * silenced on their first row, so pairs of them can share.
 */
function busyMod(seed: number, channels = 8): Uint8Array {
	const next = random(seed);
	const pick = (n: number): number => Math.floor(next() * n);
	const patterns: Cell[][][] = [];
	for (let p = 0; p < 4; p++) {
		const rows: Cell[][] = [];
		for (let row = 0; row < 64; row++) {
			const cells: Cell[] = [];
			for (let channel = 0; channel < channels; channel++) {
				if (channels > 8 && channel >= 4 && (channel + p) % 2 !== 0) {
					cells.push(row === 0 ? { effect: 0xc, param: 0 } : {});
					continue;
				}

				if (pick(3) !== 0) {
					cells.push({});
					continue;
				}

				const [effect, param] = EFFECTS[pick(EFFECTS.length)](pick);
				const struck = pick(3) !== 0;
				cells.push({
					period: struck ? PERIODS[pick(PERIODS.length)] : 0,
					sample: struck && pick(2) ? 1 + pick(4) : 0,
					effect,
					param,
				});
			}

			rows.push(cells);
		}

		patterns.push(rows);
	}

	// The last order jumps back to the second.
	patterns[3][63][7] = { effect: 0xb, param: 1 };
	return modBytes({
		channels,
		tag: channels === 8 ? undefined : `${channels}CH`,
		samples: [
			{ pcm: square(32, 16), loopStart: 0, loopLength: 512, finetune: pick(16) - 8 },
			{ pcm: new Int8Array([...pluck(800), ...square(40, 4)]), loopStart: 800, loopLength: 160, volume: 40 + pick(24) },
			{ pcm: pluck(1200, 24) },
			{ pcm: square(8, 2), loopStart: 0, loopLength: 16 },
		],
		orders: [0, 1, 2, 1, 2, 3],
		patterns,
	});
}

section("stress: busy songs at several factors");

for (const seed of [1, 2, 3, 4, 5]) {
	const bytes = busyMod(seed);
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

{
	// A sample dropped: its notes are counted, and the rest of the song still raises nothing.
	const { song, written } = imported(busyMod(6), { factors: new Map([[2, "drop"]]) });
	check(
		"a dropped sample's notes are counted",
		written.warnings.some((w) => w.code === "dropped-notes" && w.sample === 2 && w.count > 0),
		JSON.stringify(written.warnings),
	);
	check("and its instrument is not written", !written.samples.some((s) => s.index === 2));
	check(
		"a song with a sample dropped raises nothing",
		problems(song).length === 0,
		problems(song).slice(0, 4).join("; "),
	);
}

section("stress: busy twelve-channel songs sharing eight");

for (const seed of [1, 2, 3]) {
	const bytes = busyMod(seed, 12);
	const mod = imported(bytes).mod;
	for (const factor of [1, 0.25]) {
		for (const loop of ["jump", "song"] as const) {
			const factors = new Map([1, 2, 3, 4].map((index) => [index, factor]));
			const { song, written } = imported(bytes, { keep: mod.suggestedShared, share: true, factors, loop });
			check(
				`seed ${seed} at ${factor}, looping at the ${loop}: more than eight kept, no problems, and it assembles`,
				written.channels.flat().length > 8 &&
					written.channels.length <= 8 &&
					song.result.ok &&
					problems(song).length === 0 &&
					song.spc instanceof Uint8Array,
				[
					JSON.stringify(written.channels),
					...problems(song).slice(0, 4),
					typeof song.spc === "string" ? song.spc : "",
				].join("; "),
			);
		}
	}
}
