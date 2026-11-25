/** What every importer writes the same way: the tempo byte for a BPM, `y` for a balance, a polyline simplified to ramps, and text fit for a `#spc` tag. */

/** `PanValues` (`main.asm:3486`): a side's level at each `y`, the left reading `y` and the right `20 - y`. */
export const PAN_VALUES: readonly number[] = [
	0x00, 0x01, 0x03, 0x07, 0x0d, 0x15, 0x1e, 0x29, 0x34, 0x42, 0x51, 0x5e, 0x67, 0x6e, 0x73, 0x77, 0x7a, 0x7c, 0x7d,
	0x7e, 0x7f,
];

/**
 * The `y` whose share of the level on the left, through `PanValues`'s curve, is nearest `left` (0 hard
 * right, 1 hard left). AddmusicK's 20 is hard left.
 */
export function yForBalance(left: number): number {
	let best = 10;
	let distance = Infinity;
	for (let y = 0; y <= 20; y++) {
		const d = Math.abs(PAN_VALUES[y] / (PAN_VALUES[y] + PAN_VALUES[20 - y]) - left);
		if (d < distance) {
			best = y;
			distance = d;
		}
	}

	return best;
}

/** The longest `#title`/`#author` the ID666 tag holds. */
const TAG_LIMIT = 32;

/** `t` for a quarter-note BPM: BPM × 0.4096 − 1 (`units.ts`, `bpm`), clamped to t1-t254. */
export function tempoForBpm(bpm: number): { tempo: number; bpm: number; clamped: boolean } {
	const exact = Math.round(bpm * 0.4096) - 1;
	const tempo = Math.min(254, Math.max(1, exact));
	return { tempo, bpm, clamped: tempo !== exact };
}

/** A name as a `#spc` tag takes it: no quotes or backslashes, printable ASCII, at most 32 characters; `null` when nothing is left. */
export function tagText(value: string | null): string | null {
	if (value === null) {
		return null;
	}

	const clean = value
		.replace(/["\\]/g, "")
		.replace(/[^\x20-\x7e]/g, "")
		.trim();
	return clean === "" ? null : clean.slice(0, TAG_LIMIT).trim();
}

/** Ramer–Douglas–Peucker over a polyline. */
export function simplify<P extends { tick: number; value: number }>(points: readonly P[], tolerance: number): P[] {
	if (points.length <= 2) {
		return [...points];
	}

	const first = points[0];
	const last = points[points.length - 1];
	let worst = 0;
	let at = 0;
	for (let i = 1; i < points.length - 1; i++) {
		const span = last.tick - first.tick;
		const expected =
			span === 0 ? first.value : first.value + ((points[i].tick - first.tick) / span) * (last.value - first.value);
		const off = Math.abs(points[i].value - expected);
		if (off > worst) {
			worst = off;
			at = i;
		}
	}

	if (worst <= tolerance) {
		return [first, last];
	}

	const left = simplify(points.slice(0, at + 1), tolerance);
	return [...left.slice(0, -1), ...simplify(points.slice(at), tolerance)];
}
