/**
 * PCM encoded as a `.brr` file: the 2-byte loop offset, then 9-byte blocks.
 *
 * Each block is chosen greedily, every filter at every usable shift tried and the one whose decode
 * lands nearest the input kept. Each candidate is decoded with `brr.ts`'s own arithmetic, which is
 * the DSP's (`SPC_DSP::decode_brr`), so the error measured is the error the player will make. The
 * first block and the loop block take filter 0: the first has no history to predict from, and the
 * loop block is reached from the sample's end, whose history differs from the block before it.
 */

import { BRR_BLOCK_BYTES, BRR_BLOCK_SAMPLES } from "./brr";

/** Shifts 13-15 are invalid (`decodeBrr`), so 12 is the coarsest a block may use. */
const MAX_SHIFT = 12;

/** The filter's contribution to a sample, from the two outputs before it — `decodeBrr`'s arithmetic, before the nibble is added. */
function predict(filter: number, previous1: number, previous2: number): number {
	const p1 = previous1;
	const p2 = previous2 >> 1;
	if (filter === 0) {
		return 0;
	}

	if (filter === 1) {
		return (p1 >> 1) + (-p1 >> 5);
	}

	let s = p1 - p2;
	if (filter === 2) {
		s += p2 >> 4;
		s += (p1 * -3) >> 6;
	} else {
		s += (p1 * -13) >> 7;
		s += (p2 * 3) >> 4;
	}

	return s;
}

/** What the DSP outputs for nibble `n` (-8..7) over a prediction: clamped to 16 bits, doubled and wrapped as `decodeBrr` does. */
function output(n: number, shift: number, prediction: number): number {
	let s = ((n << shift) >> 1) + prediction;
	s = s > 0x7fff ? 0x7fff : s < -0x8000 ? -0x8000 : s;
	return ((s * 2) << 16) >> 16;
}

interface Block {
	header: number;
	nibbles: number[];
	error: number;
	previous1: number;
	previous2: number;
}

function tryBlock(
	pcm: Int16Array,
	at: number,
	filter: number,
	shift: number,
	previous1: number,
	previous2: number,
	limit: number,
): Block | null {
	const nibbles: number[] = [];
	let error = 0;
	let p1 = previous1;
	let p2 = previous2;
	for (let i = 0; i < BRR_BLOCK_SAMPLES; i++) {
		const target = pcm[at + i];
		const prediction = predict(filter, p1, p2);
		// The nibble whose shifted value lands nearest, then its neighbours, since the halving and the clamp bend it.
		const guess = Math.round(((target / 2 - prediction) * 2) / (1 << shift));
		let best = 0;
		let bestValue = 0;
		let bestError = Infinity;
		for (const n of [guess - 1, guess, guess + 1]) {
			const nibble = n < -8 ? -8 : n > 7 ? 7 : n;
			const value = output(nibble, shift, prediction);
			const off = (value - target) * (value - target);
			if (off < bestError) {
				bestError = off;
				best = nibble;
				bestValue = value;
			}
		}

		error += bestError;
		if (error >= limit) {
			return null;
		}

		nibbles.push(best);
		p2 = p1;
		p1 = bestValue;
	}

	return { header: (shift << 4) | (filter << 2), nibbles, error, previous1: p1, previous2: p2 };
}

function writeBlock(out: Uint8Array, at: number, block: Block, flags: number): void {
	out[at] = block.header | flags;
	for (let i = 0; i < 8; i++) {
		out[at + 1 + i] = ((block.nibbles[2 * i] & 0x0f) << 4) | (block.nibbles[2 * i + 1] & 0x0f);
	}
}

/**
 * `pcm` as a `.brr` file. Its length is padded with silence to whole blocks; `loopStart`, a frame
 * that must start a block, makes the last block loop back there, and `null` makes a one-shot that
 * ends on a silent block so the voice does not stop mid-wave.
 */
export function encodeBrr(pcm: Int16Array, loopStart: number | null): Uint8Array {
	if (loopStart !== null && loopStart % BRR_BLOCK_SAMPLES !== 0) {
		throw new Error(`loop start ${loopStart} does not start a block`);
	}

	const frames = Math.max(BRR_BLOCK_SAMPLES, Math.ceil(pcm.length / BRR_BLOCK_SAMPLES) * BRR_BLOCK_SAMPLES);
	const padded = new Int16Array(frames);
	padded.set(pcm);
	const loopBlock = loopStart === null ? null : loopStart / BRR_BLOCK_SAMPLES;
	if (loopBlock !== null && loopBlock * BRR_BLOCK_SAMPLES >= frames) {
		throw new Error(`loop start ${loopStart} is past the sample's end`);
	}

	const blocks = frames / BRR_BLOCK_SAMPLES + (loopBlock === null ? 1 : 0);
	const out = new Uint8Array(2 + blocks * BRR_BLOCK_BYTES);
	const loopOffset = loopBlock === null ? 0 : loopBlock * BRR_BLOCK_BYTES;
	out[0] = loopOffset & 0xff;
	out[1] = loopOffset >> 8;

	let previous1 = 0;
	let previous2 = 0;
	for (let b = 0; b < frames / BRR_BLOCK_SAMPLES; b++) {
		const filters = b === 0 || b === loopBlock ? [0] : [0, 1, 2, 3];
		let best: Block | null = null;
		for (const filter of filters) {
			for (let shift = 0; shift <= MAX_SHIFT; shift++) {
				const block = tryBlock(
					padded,
					b * BRR_BLOCK_SAMPLES,
					filter,
					shift,
					previous1,
					previous2,
					best?.error ?? Infinity,
				);
				if (block && (best === null || block.error < best.error)) {
					best = block;
				}
			}
		}

		if (!best) {
			throw new Error("no block encodes");
		}

		const last = b === frames / BRR_BLOCK_SAMPLES - 1;
		writeBlock(out, 2 + b * BRR_BLOCK_BYTES, best, last && loopBlock !== null ? 0x03 : 0);
		previous1 = best.previous1;
		previous2 = best.previous2;
	}

	if (loopBlock === null) {
		// The silent end block: filter 0, shift 0, all nibbles 0, end flag.
		out[2 + (blocks - 1) * BRR_BLOCK_BYTES] = 0x01;
	}

	return out;
}

/** The bytes {@link encodeBrr} gives `frames` of PCM in ARAM, the 2-byte header left off: whole blocks, and a silent one after a one-shot. */
export function brrDataBytes(frames: number, loops: boolean): number {
	const blocks = Math.max(1, Math.ceil(frames / BRR_BLOCK_SAMPLES)) + (loops ? 0 : 1);
	return blocks * BRR_BLOCK_BYTES;
}
