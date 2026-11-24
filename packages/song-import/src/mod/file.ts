/**
 * A ProTracker-family `.mod` file, read into its samples, its order list and its patterns of cells.
 *
 * The layout and the quirks follow OpenMPT's `Load_mod.cpp`/`MODTools.cpp`: the signature at 1080
 * names the channel count, the pattern count is the highest of all 128 order entries, a loop under
 * four bytes is no loop, and a loop start some trackers wrote in bytes is halved where only the half
 * fits. A file without a signature (a 15-sample Soundtracker module) is refused: nothing in it can be
 * sniffed, and `detectFormat` trusts signatures rather than names.
 */

/** Why a file could not be read at all. */
export type ModErrorCode = "not-mod";

export class ModError extends Error {
	constructor(readonly code: ModErrorCode) {
		super(code);
	}
}

/** One of the 31 sample slots. `pcm` is empty for an unused slot. */
export interface ModSample {
	/** 1-31, as a cell names it. */
	index: number;
	name: string;
	pcm: Int8Array;
	/** -8..7, in eighths of a semitone. */
	finetune: number;
	/** 0-64. */
	volume: number;
	/** In frames; `loopLength` 0 means the sample plays once. */
	loopStart: number;
	loopLength: number;
}

export interface ModCell {
	/** 0 for none, else 1-31. */
	sample: number;
	/** The Amiga period, 0 for no note. */
	period: number;
	effect: number;
	param: number;
}

export interface ModFile {
	title: string;
	/** The four signature bytes, as text. */
	tag: string;
	channels: number;
	/** The orders the song plays, each a pattern index. */
	orders: number[];
	/** Byte 951: the order the song restarts at, where a tracker set one. */
	restart: number;
	/** Pattern, then row (64), then channel. */
	patterns: ModCell[][][];
	samples: ModSample[];
	/** The sample data ran past the end of the file; what was there is kept. */
	truncated: boolean;
	/** A 4-channel ProTracker file whose notes stay in the Amiga's range: its period limits and quirks apply. */
	amiga: boolean;
}

const HEADER_BYTES = 1084;
const SAMPLE_HEADER = 20;
const SAMPLE_BYTES = 30;
const SONG_LENGTH = 950;
const ORDER_LIST = 952;
const TAG = 1080;
const ROWS = 64;

/** The periods ProTracker's finetune-0 table reaches, widened by its finetuned tables (OpenMPT's Amiga limits). */
const AMIGA_LOW = 108;
const AMIGA_HIGH = 907;

function text(bytes: Uint8Array, at: number, length: number): string {
	let out = "";
	for (let i = 0; i < length && at + i < bytes.length; i++) {
		const c = bytes[at + i];
		if (c === 0) {
			break;
		}

		out += c < 0x20 || c > 0x7e ? " " : String.fromCharCode(c);
	}

	return out.trimEnd();
}

const isDigit = (c: string): boolean => c >= "0" && c <= "9";

/** The channel count a signature names, and whether its patterns are Startrekker's FLT8 pairs; `null` for none. */
export function channelsOfTag(tag: string): { channels: number; flt8: boolean } | null {
	if (["M.K.", "M!K!", "M&K!", "PATT", "NSMS", "LARD", "FEST", "N.T.", "FLT4", "EXO4"].includes(tag)) {
		return { channels: 4, flt8: false };
	}

	if (["OKTA", "OCTA", "WARD", "CD81"].includes(tag)) {
		return { channels: 8, flt8: false };
	}

	if (tag === "CD61") {
		return { channels: 6, flt8: false };
	}

	if (tag === "FLT8" || tag === "EXO8") {
		return { channels: 8, flt8: true };
	}

	if (tag.endsWith("CHN") && tag[0] >= "1" && tag[0] <= "9") {
		return { channels: Number(tag[0]), flt8: false };
	}

	if ((tag.endsWith("CH") || tag.endsWith("CN")) && tag[0] >= "1" && tag[0] <= "9" && isDigit(tag[1])) {
		return { channels: Number(tag.slice(0, 2)), flt8: false };
	}

	if (tag.startsWith("TDZ") && tag[3] >= "1" && tag[3] <= "9") {
		return { channels: Number(tag[3]), flt8: false };
	}

	return null;
}

/** Whether `bytes` carry a MOD signature. */
export function isMod(bytes: Uint8Array): boolean {
	return bytes.length >= HEADER_BYTES && channelsOfTag(text(bytes, TAG, 4)) !== null;
}

function readCell(bytes: Uint8Array, at: number): ModCell {
	if (at + 4 > bytes.length) {
		return { sample: 0, period: 0, effect: 0, param: 0 };
	}

	const [b0, b1, b2, b3] = [bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]];
	const period = ((b0 & 0x0f) << 8) | b1;
	return { sample: (b0 & 0xf0) | (b2 >> 4), period: period === 0xfff ? 0 : period, effect: b2 & 0x0f, param: b3 };
}

/** Reads a MOD file. Throws {@link ModError} where it has no signature. */
export function readModFile(bytes: Uint8Array): ModFile {
	if (bytes.length < HEADER_BYTES) {
		throw new ModError("not-mod");
	}

	const tag = String.fromCharCode(...bytes.subarray(TAG, TAG + 4));
	const kind = channelsOfTag(tag);
	if (!kind) {
		throw new ModError("not-mod");
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const headers = Array.from({ length: 31 }, (_, i) => {
		const at = SAMPLE_HEADER + i * SAMPLE_BYTES;
		const nibble = bytes[at + 24] & 0x0f;
		return {
			name: text(bytes, at, 22),
			length: view.getUint16(at + 22) * 2,
			finetune: nibble >= 8 ? nibble - 16 : nibble,
			volume: Math.min(64, bytes[at + 25]),
			loopStart: view.getUint16(at + 26) * 2,
			loopLength: view.getUint16(at + 28) * 2,
		};
	});

	const songLength = Math.max(1, Math.min(128, bytes[SONG_LENGTH]));
	const raw = Array.from(bytes.subarray(ORDER_LIST, ORDER_LIST + 128));
	const stored = kind.flt8 ? 4 : kind.channels;
	const patternBytes = ROWS * stored * 4;
	const sampleBytes = headers.reduce((sum, h) => sum + h.length, 0);
	// Every one of the 128 entries counts, as trackers store patterns no order plays; where the file is
	// too short for that, only the orders the song plays.
	const countOf = (orders: number[]): number => Math.max(...orders.filter((o) => o < 128)) + 1;
	let storedPatterns = countOf(raw);
	if (HEADER_BYTES + storedPatterns * patternBytes + sampleBytes > bytes.length) {
		storedPatterns = Math.min(storedPatterns, countOf(raw.slice(0, songLength)));
	}

	if (kind.flt8 && storedPatterns % 2 === 1) {
		storedPatterns++;
	}

	const storedAt = (pattern: number, row: number, channel: number): number =>
		HEADER_BYTES + pattern * patternBytes + (row * stored + channel) * 4;
	const patterns: ModCell[][][] = [];
	const logical = kind.flt8 ? storedPatterns / 2 : storedPatterns;
	for (let p = 0; p < logical; p++) {
		const rows: ModCell[][] = [];
		for (let row = 0; row < ROWS; row++) {
			const cells: ModCell[] = [];
			for (let channel = 0; channel < kind.channels; channel++) {
				cells.push(
					kind.flt8
						? readCell(bytes, storedAt(2 * p + (channel >> 2), row, channel & 3))
						: readCell(bytes, storedAt(p, row, channel)),
				);
			}

			rows.push(cells);
		}

		patterns.push(rows);
	}

	const orders = raw
		.slice(0, songLength)
		.map((o) => (kind.flt8 ? o >> 1 : o))
		.filter((o) => o < patterns.length);

	let at = HEADER_BYTES + storedPatterns * patternBytes;
	let truncated = false;
	const samples: ModSample[] = headers.map((h, i) => {
		const available = Math.max(0, Math.min(h.length, bytes.length - at));
		if (available < h.length) {
			truncated = true;
		}

		const pcm = new Int8Array(bytes.buffer, bytes.byteOffset + Math.min(at, bytes.length), available).slice();
		at += h.length;
		let loopStart = h.loopStart;
		let loopLength = h.loopLength;
		// Some trackers wrote the loop start in bytes: halve it where only the half fits (Load_mod.cpp).
		if (loopLength > 2 && loopStart + loopLength > h.length && loopStart / 2 + loopLength <= h.length) {
			loopStart = loopStart / 2;
		}

		loopStart = Math.min(loopStart, Math.max(0, pcm.length - 1));
		loopLength = Math.min(loopLength, pcm.length - loopStart);
		if (loopLength < 4 || pcm.length < 2) {
			loopStart = 0;
			loopLength = 0;
		}

		return {
			index: i + 1,
			name: h.name,
			pcm: pcm.length <= 2 ? new Int8Array(0) : pcm,
			finetune: h.finetune,
			volume: h.volume,
			loopStart,
			loopLength,
		};
	});

	const amigaTag = tag === "M.K." || tag === "M!K!" || tag === "PATT";
	const amiga =
		amigaTag &&
		kind.channels === 4 &&
		patterns.every((rows) =>
			rows.every((cells) =>
				cells.every((cell) => cell.period === 0 || (cell.period >= AMIGA_LOW && cell.period <= AMIGA_HIGH)),
			),
		);

	const restart = bytes[951] < orders.length ? bytes[951] : 0;
	return {
		title: text(bytes, 0, 20),
		tag,
		channels: kind.channels,
		orders,
		restart,
		patterns,
		samples,
		truncated,
		amiga,
	};
}
