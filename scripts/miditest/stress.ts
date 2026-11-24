/** `miditest`: a busy, seeded song — chords, bends, controller sweeps, a kit, tempo changes and a loop — imported at every grid without raising a problem. */

import { check, section } from "../harness";
import { type Ev, bend, cc, imported, marker, note, problems, program, smf, tempo } from "./support";

/** A small seeded generator, so the song is the same on every run. */
function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

function busySong(seed: number, ppq: number): Uint8Array {
	const next = random(seed);
	const pick = (n: number): number => Math.floor(next() * n);
	const bars = 8;
	const bar = ppq * 4;
	const conductor: Ev[] = [
		tempo(0, 90 + pick(100)),
		tempo(bar * 3 + pick(ppq), 70 + pick(160)),
		marker(bar * 2, "loopStart"),
	];
	const tracks: Ev[][] = [conductor];
	for (let channel = 0; channel < 5; channel++) {
		const events: Ev[] = [
			program(0, channel, pick(128)),
			cc(0, channel, 7, 40 + pick(88)),
			cc(0, channel, 10, pick(128)),
		];
		if (pick(2)) {
			events.push(cc(0, channel, 91, 30 + pick(90)));
		}

		let tick = pick(ppq);
		while (tick < bars * bar) {
			const length = Math.max(1, Math.round(ppq * [0.25, 0.5, 1, 1.5, 2, 4][pick(6)] + (pick(9) - 4)));
			const voices = 1 + (pick(4) === 0 ? pick(3) : 0);
			const root = 36 + pick(48);
			for (let v = 0; v < voices; v++) {
				events.push(...note(tick, channel, root + v * 4, length, 20 + pick(108)));
			}

			if (pick(4) === 0) {
				// A bend within the note: up, and sometimes back.
				for (let i = 0; i <= 8; i++) {
					events.push(bend(tick + Math.floor((i * length) / 16), channel, Math.min(16383, 8192 + i * pick(1024))));
				}

				events.push(bend(tick + length, channel, 8192));
			}

			if (pick(5) === 0) {
				events.push(cc(tick, channel, 1, pick(128)));
			}

			if (pick(5) === 0) {
				for (let i = 0; i < 6; i++) {
					events.push(cc(tick + Math.floor((i * length) / 6), channel, 11, 127 - i * 15));
				}
			}

			tick += pick(3) === 0 ? length + pick(ppq) : length;
		}

		tracks.push(events);
	}

	const kit: Ev[] = [];
	for (let tick = 0; tick < bars * bar; tick += ppq / 2) {
		kit.push(...note(tick, 9, [36, 38, 42, 46, 49, 45, 54, 75][pick(8)], ppq / 8 + pick(ppq / 4), 40 + pick(88)));
		if (pick(3) === 0) {
			kit.push(...note(tick, 9, 42, ppq / 8));
		}
	}

	tracks.push(kit);
	return smf(tracks, 1, ppq);
}

section("stress: busy songs at every grid");

for (const seed of [1, 2, 3, 4, 5, 6]) {
	const ppq = [96, 120, 480, 192, 384, 960][seed - 1];
	const bytes = busySong(seed, ppq);
	for (const grid of [1, 2, 3, 4, 6, 12]) {
		for (const loop of ["markers", "song"] as const) {
			const { song } = imported(bytes, { grid, loop });
			check(
				`seed ${seed} at ${ppq} a quarter, a grid of ${grid}, looping ${loop}: no problems`,
				song.result.ok && problems(song).length === 0,
				problems(song).slice(0, 4).join("; "),
			);
		}
	}
}
