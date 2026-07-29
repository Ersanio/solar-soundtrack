/**
 * Checks the BRR container handling and the decoder.
 *
 * The decoder has no reference implementation in the vendored sources —
 * AddmusicK treats `.brr` files as opaque blobs — so it is pinned two ways:
 *
 *   - **Exactly**, for filter 0 and for the invalid shifts. With no filter the
 *     output is a closed form of the nibble, the shift and the clamp, so every
 *     one of those paths can be asserted to the sample.
 *   - **Against the published ratios**, for filters 1-3. The documented
 *     coefficients (15/16, 61/32 and -15/16, 115/64 and -13/16) are recomputed
 *     in floating point and compared with a tolerance of a few LSB. That is
 *     tight enough to catch a wrong coefficient — a mistyped filter is wrong by
 *     percent, not by one bit — while allowing the integer rounding the
 *     hardware actually does.
 *
 * What this does not prove is the absolute sign convention against real
 * hardware; `audiotest` covers that end of it by rendering real songs through
 * the emulator and hearing them come out non-silent.
 *
 *   npm run brrtest
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	BRR_BLOCK_BYTES,
	BRR_BLOCK_SAMPLES,
	blockCount,
	decodeBrr,
	parseBrr,
	peaks,
	validateBrr,
	validateName,
} from "../src/spc/brr";

const PUBLIC = join(import.meta.dirname, "..", "public");

let failures = 0;
function check(name: string, condition: boolean, detail = ""): void {
	if (condition) console.log(`  ok    ${name}`);
	else {
		failures++;
		console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
	}
}

/** Builds a one-block `.brr` file, loop header included. */
function block(shift: number, filter: number, nibbles: number[], flags = 0): Uint8Array {
	const raw = new Uint8Array(2 + BRR_BLOCK_BYTES);
	raw[0] = 0;
	raw[1] = 0;
	raw[2] = (shift << 4) | (filter << 2) | flags;
	for (let index = 0; index < BRR_BLOCK_SAMPLES; index += 2) {
		raw[3 + (index >> 1)] = ((nibbles[index] & 0x0f) << 4) | (nibbles[index + 1] & 0x0f);
	}
	return raw;
}

const clamp16 = (v: number): number => (v > 0x7fff ? 0x7fff : v < -0x8000 ? -0x8000 : v);
const wrap16 = (v: number): number => (v << 16) >> 16;

// ---------------------------------------------------------------------------

console.log("\nthe container is validated before it is trusted");
{
	check("an empty file is rejected", validateBrr(new Uint8Array(0)) !== null);
	check("a file too short for one block is rejected", validateBrr(new Uint8Array(8)) !== null);
	check("a length that is not 2 + 9n is rejected", validateBrr(new Uint8Array(2 + 9 + 3)) !== null);
	check("a valid one-block file passes", validateBrr(block(0, 0, new Array(16).fill(0))) === null);

	const pastEnd = block(0, 0, new Array(16).fill(0));
	pastEnd[0] = 0xff;
	check("a loop point past the end is rejected", validateBrr(pastEnd) !== null);

	const misaligned = new Uint8Array(2 + BRR_BLOCK_BYTES * 2);
	misaligned[0] = 4; // not a multiple of 9
	check("a loop point off the block grid is rejected", validateBrr(misaligned) !== null);

	const parsed = parseBrr("t.brr", block(0, 0, new Array(16).fill(0)));
	check("parseBrr strips the 2-byte header", parsed.data.length === BRR_BLOCK_BYTES, `${parsed.data.length}`);
	check("parseBrr reads the loop offset", parsed.loopOffset === 0);
}

console.log("\nnames that MML could not survive are rejected");
{
	check("a '#' is rejected", validateName("kick#1.brr") !== null);
	check("a ';' is rejected", validateName("kick;1.brr") !== null);
	check('a \'"\' is rejected', validateName('kick".brr') !== null);
	check("an empty name is rejected", validateName("   ") !== null);
	check("a stock name with '@' and spaces is fine", validateName("00 SMW @0.brr") === null);
	check("a path-prefixed name is fine", validateName("drums/kick.brr") === null);
}

console.log("\nfilter 0 decodes to a closed form");
{
	// Every nibble value, so sign extension is covered at both ends.
	const nibbles = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
	for (const shift of [0, 1, 4, 8, 12]) {
		const pcm = decodeBrr(parseBrr("t.brr", block(shift, 0, nibbles)));
		let ok = true;
		let detail = "";
		for (let index = 0; index < BRR_BLOCK_SAMPLES; index++) {
			const raw = nibbles[index];
			const signed = raw >= 8 ? raw - 16 : raw;
			const expected = wrap16(clamp16((signed << shift) >> 1) * 2);
			if (pcm[index] !== expected) {
				ok = false;
				detail = `nibble ${signed} at shift ${shift}: got ${pcm[index]}, expected ${expected}`;
				break;
			}
		}
		check(`shift ${shift} matches (nibble << shift) >> 1, doubled`, ok, detail);
	}
}

console.log("\nthe invalid shifts collapse the way the hardware does");
{
	for (const shift of [13, 14, 15]) {
		const pcm = decodeBrr(parseBrr("t.brr", block(shift, 0, [0, 1, 7, 8, 9, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])));
		// Non-negative nibbles give 0; negative ones give -2048, doubled to -4096.
		const ok =
			pcm[0] === 0 && pcm[1] === 0 && pcm[2] === 0 && pcm[3] === -4096 && pcm[4] === -4096 && pcm[5] === -4096;
		check(`shift ${shift} yields 0 or -4096, never overflow`, ok, `[${pcm.slice(0, 6).join(", ")}]`);
	}
}

console.log("\nfilters 1-3 match their published coefficients");
{
	// Ratios are halved because the decoder carries its history doubled.
	const ratios: Record<number, [number, number]> = {
		1: [15 / 32, 0],
		2: [61 / 64, -15 / 32],
		3: [115 / 128, -13 / 32],
	};

	// A ramp that swings both ways, so the history is never trivially zero.
	const nibbles = [7, 6, 4, 1, 15, 13, 10, 8, 9, 11, 14, 2, 5, 7, 3, 0];
	const TOLERANCE = 4; // in the doubled domain, i.e. two LSB of the real sample

	for (const filter of [1, 2, 3] as const) {
		const shift = 8;
		const pcm = decodeBrr(parseBrr("t.brr", block(shift, filter, nibbles)));
		const [r1, r2] = ratios[filter];

		let worst = 0;
		let at = -1;
		let p1 = 0;
		let p2 = 0;
		for (let index = 0; index < BRR_BLOCK_SAMPLES; index++) {
			const raw = nibbles[index];
			const signed = raw >= 8 ? raw - 16 : raw;
			const reference = wrap16(clamp16(Math.round(((signed << shift) >> 1) + p1 * r1 + p2 * r2)) * 2);
			const delta = Math.abs(pcm[index] - reference);
			if (delta > worst) {
				worst = delta;
				at = index;
			}
			p2 = p1;
			p1 = pcm[index];
		}
		check(
			`filter ${filter} tracks ${filter === 1 ? "15/16" : filter === 2 ? "61/32, -15/16" : "115/64, -13/16"} within ${TOLERANCE}`,
			worst <= TOLERANCE,
			`worst deviation ${worst} at sample ${at}`,
		);
	}

	// A filter is only worth checking if the test could tell them apart at all.
	const a = decodeBrr(parseBrr("t.brr", block(8, 1, nibbles)));
	const b = decodeBrr(parseBrr("t.brr", block(8, 2, nibbles)));
	const c = decodeBrr(parseBrr("t.brr", block(8, 3, nibbles)));
	check("the three filters produce different output", !a.every((v, i) => v === b[i]) && !b.every((v, i) => v === c[i]));
}

console.log("\nit matches snes_spc's decode_brr exactly");
{
	// A second, independent transcription of `SPC_DSP::decode_brr` — written in
	// the C++'s own shape, sign-extending through a 16-bit word and keeping the
	// filter as `header & 0x0C`. Deliberately not the same expression of it as
	// `brr.ts`, so a typo in one does not reproduce in the other.
	const reference = (data: Uint8Array): Int16Array => {
		const blocks = Math.floor(data.length / BRR_BLOCK_BYTES);
		const out = new Int16Array(blocks * BRR_BLOCK_SAMPLES);
		let prev1 = 0;
		let prev2 = 0;
		let at = 0;

		for (let b = 0; b < blocks; b++) {
			const base = b * BRR_BLOCK_BYTES;
			const header = data[base];
			for (let i = 0; i < BRR_BLOCK_SAMPLES; i++) {
				const byte = data[base + 1 + (i >> 1)];
				const nyb = i & 1 ? byte & 0x0f : byte >> 4;
				// (int16_t) nybbles >> 12
				let s = (((nyb << 12) << 16) >> 16) >> 12;

				const shift = header >> 4;
				s = (s << shift) >> 1;
				if (shift >= 0xd) s = (s >> 25) << 11;

				const filter = header & 0x0c;
				const p1 = prev1;
				const p2 = prev2 >> 1;
				if (filter >= 8) {
					s += p1;
					s -= p2;
					if (filter === 8) {
						s += p2 >> 4;
						s += (p1 * -3) >> 6;
					} else {
						s += (p1 * -13) >> 7;
						s += (p2 * 3) >> 4;
					}
				} else if (filter) {
					s += p1 >> 1;
					s += (-p1) >> 5;
				}

				// CLAMP16 then (int16_t)(s * 2)
				if (s > 0x7fff) s = 0x7fff;
				else if (s < -0x8000) s = -0x8000;
				const value = ((s * 2) << 16) >> 16;

				prev2 = prev1;
				prev1 = value;
				out[at++] = value;
			}
		}
		return out;
	};

	// Deterministic pseudo-random blocks, so a failure is reproducible.
	let seed = 0x1337;
	const next = (): number => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed >>> 16;
	};

	let mismatches = 0;
	let detail = "";
	for (let trial = 0; trial < 400 && mismatches === 0; trial++) {
		// Six blocks, so the filter history carries across block boundaries.
		const raw = new Uint8Array(2 + BRR_BLOCK_BYTES * 6);
		for (let b = 0; b < 6; b++) {
			const at = 2 + b * BRR_BLOCK_BYTES;
			// Every shift 0-15 and every filter 0-3 gets exercised across trials.
			raw[at] = (((trial + b) % 16) << 4) | (((trial + b) % 4) << 2);
			for (let k = 1; k < BRR_BLOCK_BYTES; k++) raw[at + k] = next() & 0xff;
		}
		const mine = decodeBrr(parseBrr("t.brr", raw));
		const theirs = reference(raw.subarray(2));
		for (let i = 0; i < mine.length; i++) {
			if (mine[i] !== theirs[i]) {
				mismatches++;
				detail = `trial ${trial}, sample ${i}: got ${mine[i]}, snes_spc gives ${theirs[i]}`;
				break;
			}
		}
	}
	check("400 randomised multi-block samples decode identically", mismatches === 0, detail);

	// Several of the reference's shift forms are only equivalent to the ratios
	// they document because the stored history is always even. It is even
	// because each entry is `(int16_t)(s * 2)` and wrapping preserves parity —
	// but that is exactly the kind of invariant that quietly stops holding.
	let allEven = true;
	for (let shift = 0; shift < 16 && allEven; shift++) {
		for (let filter = 0; filter < 4 && allEven; filter++) {
			const raw = new Uint8Array(2 + BRR_BLOCK_BYTES);
			raw[2] = (shift << 4) | (filter << 2);
			for (let k = 1; k < BRR_BLOCK_BYTES; k++) raw[2 + k] = next() & 0xff;
			for (const value of decodeBrr(parseBrr("t.brr", raw))) {
				if (value % 2 !== 0) allEven = false;
			}
		}
	}
	check("every decoded sample is even, as the filter forms assume", allEven);
}

console.log("\nthe twenty bundled samples decode");
{
	const manifest = JSON.parse(readFileSync(join(PUBLIC, "driver", "manifest.json"), "utf8")) as {
		sampleGroups: Record<string, string[]>;
	};
	const names = manifest.sampleGroups.default;
	check("the default group has 20 names", names.length === 20, `${names.length}`);

	let allValid = true;
	let allSized = true;
	let allAudible = true;
	let quiet = "";
	for (const name of names) {
		const raw = new Uint8Array(readFileSync(join(PUBLIC, "driver", "samples", name)));
		if (validateBrr(raw) !== null) {
			allValid = false;
			quiet = `${name}: ${validateBrr(raw)}`;
			break;
		}
		const sample = parseBrr(name, raw);
		const pcm = decodeBrr(sample);
		if (pcm.length !== blockCount(sample) * BRR_BLOCK_SAMPLES) allSized = false;
		let peak = 0;
		for (const value of pcm) peak = Math.max(peak, Math.abs(value));
		if (peak === 0) {
			allAudible = false;
			quiet = name;
		}
	}
	check("every bundled sample passes validation", allValid, quiet);
	check("decoded length is blocks x 16 for all of them", allSized);
	check("none of them decode to pure silence", allAudible, quiet);
}

console.log("\npeaks reduces without lying");
{
	const sample = parseBrr("t.brr", block(10, 0, [7, 8, 7, 8, 7, 8, 7, 8, 7, 8, 7, 8, 7, 8, 7, 8]));
	const pcm = decodeBrr(sample);

	const envelope = peaks(pcm, 8);
	check("it returns two values per bucket", envelope.length === 16, `${envelope.length}`);

	let inRange = true;
	let ordered = true;
	for (let bucket = 0; bucket < 8; bucket++) {
		const min = envelope[bucket * 2];
		const max = envelope[bucket * 2 + 1];
		if (min < -1 || max > 1) inRange = false;
		if (min > max) ordered = false;
	}
	check("every value is within -1..1", inRange);
	check("min never exceeds max", ordered);

	// More buckets than samples must still draw something.
	const wide = peaks(pcm, 64);
	let anyNonZero = false;
	for (const value of wide) if (value !== 0) anyNonZero = true;
	check("more buckets than samples still produces signal", anyNonZero);

	check("no samples gives no geometry", peaks(new Int16Array(0), 8).every((v) => v === 0));
	check("zero buckets is handled", peaks(pcm, 0).length === 0);
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
