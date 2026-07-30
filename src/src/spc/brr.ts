/**
 * BRR — the SNES's ADPCM sample format.
 *
 * Everything here is pure: no DOM, no fetch, no framework. It runs in Node, on
 * the main thread and inside a worklet, and `scripts/brrtest.ts` drives it
 * headlessly.
 *
 * AddmusicK itself has no BRR codec — it copies `.brr` files around as opaque
 * blobs (`globals.cpp:addSample`) and lets the DSP do the decoding. The decoder
 * here is instead a transcription of `SPC_DSP::decode_brr` from Blargg's
 * snes_spc, which is the authoritative reference for this project specifically:
 * `public/player/spc.wasm` is that same core, so matching it means the waveform
 * drawn in the sample browser is the waveform the player will produce.
 *
 * Keep it a transcription. The published coefficients are ratios (15/16, 61/32,
 * 115/64, 13/16) and there are several integer forms that hit them, but they
 * are not interchangeable — `(-(p + (p >> 1))) >> 5` and `(p * -3) >> 6` differ
 * for odd `p`, and only agree here because the stored history is always even.
 * Deriving a form from the ratios rather than copying one lands on arithmetic
 * that is right for the wrong reason.
 *
 * Format, per snes.nesdev.org/wiki/BRR_samples and
 * wiki.superfamicom.org/bit-rate-reduction-(brr):
 *
 *   A sample is a run of 9-byte blocks. Byte 0 is a header, `SSSS FFLE`:
 *
 *     bits 7-4  S  left shift applied to each nibble
 *     bits 3-2  F  filter, 0-3
 *     bit  1    L  loop — on the final block, playback jumps to the loop point
 *     bit  0    E  end — the last block of the sample
 *
 *   Bytes 1-8 hold 16 samples as signed 4-bit nibbles, high nibble first.
 *
 * A `.brr` *file* additionally carries a 2-byte little-endian loop offset ahead
 * of the block data. `parseBrr` strips it into {@link BrrSample.loopOffset}.
 */

/** Frames per BRR block. */
export const BRR_BLOCK_SAMPLES = 16;

/** Bytes per BRR block: one header plus eight of nibble pairs. */
export const BRR_BLOCK_BYTES = 9;

export class BrrError extends Error {}

export interface BrrSample {
	sampleName: string;
	/** BRR blocks with the 2-byte loop header stripped (globals.cpp:470). */
	data: Uint8Array;
	/** Byte offset of the loop point, relative to the start of `data`. */
	loopOffset: number;
}

/**
 * Why a byte run is not a usable `.brr`, or `null` if it is.
 *
 * Separate from {@link parseBrr} because the UI wants to list a bad upload with
 * the reason rather than throw it away.
 */
export function validateBrr(bytes: Uint8Array): string | null {
	if (bytes.length === 0) return "The file is empty.";
	if (bytes.length < 2 + BRR_BLOCK_BYTES) {
		return `Only ${bytes.length} bytes — too short to hold the 2-byte loop header and a single 9-byte block.`;
	}
	if ((bytes.length - 2) % BRR_BLOCK_BYTES !== 0) {
		return (
			`${bytes.length} bytes: (size - 2) must be a multiple of 9. ` +
			`Either the 2-byte loop header is missing or the file is truncated.`
		);
	}

	const loopOffset = bytes[0] | (bytes[1] << 8);
	const dataLength = bytes.length - 2;
	if (loopOffset >= dataLength) {
		return `The loop point (0x${loopOffset.toString(16).toUpperCase()}) is past the end of the ${dataLength}-byte sample.`;
	}
	if (loopOffset % BRR_BLOCK_BYTES !== 0) {
		return `The loop point (${loopOffset}) is not on a 9-byte block boundary.`;
	}
	return null;
}

/**
 * Why a filename cannot be used, or `null` if it can.
 *
 * Both rules exist because a sample name ends up inside MML, where the
 * preprocessor gets to it first. A bare `#` starts a directive
 * (`preprocess.ts`), and `;` starts a comment that `stripComments` removes
 * without checking whether it is inside quotes — so either character would be
 * silently mangled in a `#samples` block. Neither was reachable while the
 * sample list was fixed at build time.
 */
export function validateName(name: string): string | null {
	if (name.trim().length === 0) return "The name is empty.";
	if (name.includes("#")) return `"${name}" contains a '#', which MML reads as the start of a directive.`;
	if (name.includes(";")) return `"${name}" contains a ';', which MML reads as the start of a comment.`;
	if (name.includes('"')) return `"${name}" contains a quote, which would terminate the name inside #samples.`;
	return null;
}

/**
 * A zero-length sample, for a directory slot that must exist but is never keyed.
 *
 * AddmusicK's `EMPTY.brr` is a genuinely zero-byte file, and `globals.cpp:453`
 * special-cases that with `if (sample.size() != 0)` — skipping the loop-header
 * check every other sample must pass. So there is nothing to ship as an asset:
 * an empty sample is entirely synthesisable.
 *
 * The name is the caller's to choose, because which name means "empty" is a
 * convention of the compiler front-end rather than of the BRR format.
 */
export function emptySample(name: string): BrrSample {
	return { sampleName: name, data: new Uint8Array(0), loopOffset: 0 };
}

/** Splits a `.brr` file into its loop offset and block data. */
export function parseBrr(name: string, raw: Uint8Array): BrrSample {
	const problem = validateBrr(raw);
	if (problem) throw new BrrError(`Sample "${name}" is not valid: ${problem}`);
	return {
		sampleName: name,
		loopOffset: raw[0] | (raw[1] << 8),
		data: raw.subarray(2),
	};
}

/** Number of 9-byte blocks in a parsed sample. */
export function blockCount(sample: BrrSample): number {
	return Math.floor(sample.data.length / BRR_BLOCK_BYTES);
}

// ---------------------------------------------------------------------------
// Sample banks
// ---------------------------------------------------------------------------

/**
 * A `.bnk` is exactly 32 KB — the upper half of a real cartridge's ARAM, dumped.
 * `globals.cpp:575` rejects any other size outright.
 */
export const SAMPLE_BANK_BYTES = 0x8000;

/** A bank always carries a 64-entry sample directory, empty slots included. */
export const SAMPLE_BANK_SLOTS = 0x40;

/** Bytes of header ahead of the directory, discarded (`globals.cpp:577`). */
const SAMPLE_BANK_HEADER = 12;

/** ARAM address the bank image is mapped at, so addresses rebase against it. */
const SAMPLE_BANK_ORIGIN = 0x8000;

/** Why a byte run is not a usable `.bnk`, or `null` if it is. */
export function validateSampleBank(bytes: Uint8Array): string | null {
	if (bytes.length !== SAMPLE_BANK_BYTES) {
		return (
			`${bytes.length.toLocaleString()} bytes: a sample bank must be exactly ` +
			`${SAMPLE_BANK_BYTES.toLocaleString()}, being a dump of ARAM $8000-$FFFF.`
		);
	}
	return null;
}

/**
 * Splits a `.bnk` sample bank into its slots — `addSampleBank`, globals.cpp:551.
 *
 * A bank is how a song ported from another SNES game gets that game's
 * instruments: the 64 slots keep their original SRCNs, so sequence data lifted
 * from the original finds each sample exactly where it expects it. Which is why
 * this always returns {@link SAMPLE_BANK_SLOTS} entries, empty ones included —
 * dropping the blanks would renumber everything after them.
 *
 * Slot data carries **no** 2-byte loop header. AMK takes the `noLoopHeader`
 * path for banks (`globals.cpp:468-472`), reading the loop point out of the
 * directory instead, so {@link parseBrr} is not usable here.
 *
 * `names(slot)` supplies each slot's name; the convention belongs to the
 * compiler front-end, not to the format.
 */
export function parseSampleBank(bytes: Uint8Array, names: (slot: number) => string): BrrSample[] {
	const problem = validateSampleBank(bytes);
	if (problem) throw new BrrError(`Not a valid sample bank: ${problem}`);

	// Every offset below — the directory *and* the addresses in it — is relative
	// to the image with its header removed, because AMK erases those 12 bytes
	// before reading anything.
	const image = bytes.subarray(SAMPLE_BANK_HEADER);
	const word = (at: number): number => image[at] | (image[at + 1] << 8);

	const out: BrrSample[] = [];
	for (let slot = 0; slot < SAMPLE_BANK_SLOTS; slot++) {
		const name = names(slot);
		const start = word(slot * 4);
		// Deliberately computed before the rebase, exactly as `globals.cpp:584`
		// does, which makes it an offset from the sample's own start rather than
		// an address — the same thing `BrrSample.loopOffset` means.
		const loopOffset = (word(slot * 4 + 2) - start) & 0xffff;

		// A blank directory entry (`globals.cpp:587`). Real banks are rarely full.
		if (start === 0 && loopOffset === 0) {
			out.push(emptySample(name));
			continue;
		}

		let at = start - SAMPLE_BANK_ORIGIN;
		const from = at;
		// Walk block by block to the one whose header sets the end flag, keeping
		// it. A bank stores no length, so the flag is the only terminator; the
		// bounds check is ours, since a truncated or mis-addressed bank would
		// otherwise run off the image.
		while (at >= 0 && at + BRR_BLOCK_BYTES <= image.length) {
			const header = image[at];
			at += BRR_BLOCK_BYTES;
			if ((header & 1) === 1) break;
		}

		out.push(
			from >= 0 && at > from
				? { sampleName: name, data: image.subarray(from, at), loopOffset }
				: // An address outside the image is not recoverable, and an empty
					// slot is the one representation that cannot corrupt the directory.
					emptySample(name),
		);
	}

	return out;
}

/** Non-empty slots in a parsed bank, for display. */
export function usedBankSlots(slots: readonly BrrSample[]): number {
	return slots.reduce((count, slot) => (slot.data.length > 0 ? count + 1 : count), 0);
}

/**
 * Saturate to signed 16 bits — snes_spc's `CLAMP16`, which is
 * `if ((int16_t) io != io) io = (io >> 31) ^ 0x7FFF`.
 */
function clamp16(value: number): number {
	if (value > 0x7fff) return 0x7fff;
	if (value < -0x8000) return -0x8000;
	return value;
}

/**
 * Decodes a sample to PCM, one pass, ignoring the loop and end flags.
 *
 * Returns 16-bit samples at the DSP's native 32000 Hz. Pitch is not applied —
 * this is the sample as stored, not as any instrument would play it.
 *
 * The history is kept in the *doubled* domain the DSP stores it in — each entry
 * is `(int16_t)(sample * 2)` — and the older of the two is halved on the way
 * into the filter, exactly as the reference does. That doubling is also what
 * makes the history always even, which several of the shift forms quietly
 * depend on.
 */
export function decodeBrr(sample: BrrSample): Int16Array {
	const blocks = blockCount(sample);
	const out = new Int16Array(blocks * BRR_BLOCK_SAMPLES);
	const data = sample.data;

	// The two most recent outputs, newest first.
	let previous1 = 0;
	let previous2 = 0;
	let at = 0;

	for (let block = 0; block < blocks; block++) {
		const base = block * BRR_BLOCK_BYTES;
		const header = data[base];
		const shift = header >> 4;
		// Left in place rather than shifted down to 0-3, so the comparisons below
		// read the same as the reference's.
		const filter = header & 0x0c;

		for (let index = 0; index < BRR_BLOCK_SAMPLES; index++) {
			const byte = data[base + 1 + (index >> 1)];
			// High nibble first, sign-extended to -8..+7.
			const raw = index & 1 ? byte & 0x0f : byte >> 4;
			let s = raw >= 8 ? raw - 16 : raw;

			s = (s << shift) >> 1;
			// Shifts of 13-15 are invalid; the hardware collapses them to -0x800
			// for a negative nibble and 0 otherwise.
			if (shift >= 0xd) s = (s >> 25) << 11;

			const p1 = previous1;
			const p2 = previous2 >> 1;

			if (filter >= 8) {
				s += p1;
				s -= p2;
				if (filter === 8) {
					// p1 * 0.953125 - p2 * 0.46875
					s += p2 >> 4;
					s += (p1 * -3) >> 6;
				} else {
					// p1 * 0.8984375 - p2 * 0.40625
					s += (p1 * -13) >> 7;
					s += (p2 * 3) >> 4;
				}
			} else if (filter) {
				// p1 * 0.46875
				s += p1 >> 1;
				s += (-p1) >> 5;
			}

			const value = (clamp16(s) * 2) << 16 >> 16;
			previous2 = previous1;
			previous1 = value;
			out[at++] = value;
		}
	}

	return out;
}

/**
 * Reduces PCM to a min/max envelope for drawing.
 *
 * A four-second sample is 128k values; nothing in a template should ever see
 * that. Returns `buckets * 2` values as `[min, max, min, max, …]`, normalised
 * to -1..1.
 */
export function peaks(pcm: Int16Array, buckets: number): Float32Array {
	const out = new Float32Array(buckets * 2);
	if (buckets <= 0) return out;
	if (pcm.length === 0) return out;

	const width = pcm.length / buckets;
	for (let bucket = 0; bucket < buckets; bucket++) {
		const start = Math.floor(bucket * width);
		// Always cover at least one sample, so a sample shorter than `buckets`
		// still draws something instead of collapsing to a flat line.
		const end = Math.max(Math.min(Math.floor((bucket + 1) * width), pcm.length), start + 1);

		let min = 0;
		let max = 0;
		for (let index = start; index < end && index < pcm.length; index++) {
			const value = pcm[index];
			if (value < min) min = value;
			if (value > max) max = value;
		}
		out[bucket * 2] = min / 0x8000;
		out[bucket * 2 + 1] = max / 0x8000;
	}
	return out;
}
