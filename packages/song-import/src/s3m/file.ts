/**
 * A Scream Tracker 3 module (`.s3m`), read into its samples, its order list and its patterns of cells.
 *
 * The layout follows OpenMPT's `Load_s3m.cpp` and ST3's own `TECH.DOC`: a 96-byte header with
 * `SCRM` at 44, the order list, then parapointers (offsets over 16) to each instrument and each
 * pattern. A pattern is 64 packed rows: a byte naming a channel and what follows (32 a note and an
 * instrument, 64 a volume, 128 a command and its info), and a 0 ending the row. Channel settings
 * under 16 are PCM channels (0-7 left, 8-15 right); AdLib channels and disabled ones are left out.
 * The panning follows OpenMPT rather than ST3 on a Sound Blaster, which pans by channel alone: the
 * channel's side, then the header's pan table where byte 53 is 252, all centred in a mono song.
 */

/** Why a file could not be read at all. */
export type S3mErrorCode = "not-s3m";

export class S3mError extends Error {
	constructor(readonly code: S3mErrorCode) {
		super(code);
	}
}

/** One instrument slot. `pcm` is empty for an unused slot or an AdLib instrument. */
export interface S3mSample {
	/** 1-99, as a cell names it. */
	index: number;
	name: string;
	/** An AdLib (OPL2) instrument: no PCM, its notes counted rather than played. */
	adlib: boolean;
	/** 16-bit; an 8-bit sample is scaled by 256, a stereo one mixed to mono. */
	pcm: Int16Array;
	/** The rate C-4 plays the sample at. */
	c2spd: number;
	/** 0-63. */
	volume: number;
	/** In frames; `loopLength` 0 means the sample plays once. */
	loopStart: number;
	loopLength: number;
}

export interface S3mCell {
	/** 255 for none, 254 for a cut, else octave << 4 | semitone. */
	note: number;
	/** 0 for none, else 1-99. */
	instrument: number;
	/** 255 for none, else 0-64. */
	volume: number;
	/** 0 for none, 1 for A to 26 for Z. */
	command: number;
	info: number;
}

export interface S3mFile {
	title: string;
	/** The tracker that saved it: `0x13xx` for ST3, `0x32xx` for Impulse Tracker and so on. */
	tracker: number;
	/** The PCM channels kept, in their order in the file. */
	channels: number;
	/** Each channel's pan, 0 (left) to 255 (right). */
	pans: number[];
	/** The order list as stored: pattern indices, 254 to skip and 255 to end. */
	orders: number[];
	/** Pattern, then row (64), then kept channel; `null` where a row leaves the channel alone. */
	patterns: (S3mCell | null)[][][];
	samples: S3mSample[];
	/** 0-64. */
	globalVolume: number;
	speed: number;
	tempo: number;
	/** Volume slides run on tick 0 too: header flag 64, or a file saved by ST3.00. */
	fastSlides: boolean;
	/** Periods held to the Amiga's range: header flag 16. */
	amigaLimits: boolean;
	/** ST2's vibrato, twice as deep: header flag 1. */
	oldVibrato: boolean;
	/** The sample data ran past the end of the file; what was there is kept. */
	truncated: boolean;
}

const HEADER_BYTES = 0x60;
const SAMPLE_HEADER = 0x50;
const ROWS = 64;
const SIGNATURE = 0x2c;

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

/** Whether `bytes` carry an S3M signature. */
export function isS3m(bytes: Uint8Array): boolean {
	return (
		bytes.length >= HEADER_BYTES &&
		bytes[SIGNATURE] === 0x53 &&
		bytes[SIGNATURE + 1] === 0x43 &&
		bytes[SIGNATURE + 2] === 0x52 &&
		bytes[SIGNATURE + 3] === 0x4d
	);
}

const emptyCell = (): S3mCell => ({ note: 255, instrument: 0, volume: 255, command: 0, info: 0 });

function readPattern(bytes: Uint8Array, at: number, map: readonly number[], channels: number): (S3mCell | null)[][] {
	const rows: (S3mCell | null)[][] = Array.from({ length: ROWS }, () => new Array<S3mCell | null>(channels).fill(null));
	if (at === 0 || at + 2 > bytes.length) {
		return rows;
	}

	let p = at + 2;
	for (let row = 0; row < ROWS && p < bytes.length;) {
		const what = bytes[p++];
		if (what === 0) {
			row++;
			continue;
		}

		const cell = emptyCell();
		if (what & 32) {
			cell.note = bytes[p++] ?? 255;
			cell.instrument = bytes[p++] ?? 0;
		}

		if (what & 64) {
			cell.volume = bytes[p++] ?? 255;
		}

		if (what & 128) {
			cell.command = bytes[p++] ?? 0;
			cell.info = bytes[p++] ?? 0;
		}

		const channel = map[what & 31];
		if (channel >= 0) {
			rows[row][channel] = cell;
		}
	}

	return rows;
}

/** Reads an S3M file. Throws {@link S3mError} where it has no signature. */
export function readS3mFile(bytes: Uint8Array): S3mFile {
	if (!isS3m(bytes)) {
		throw new S3mError("not-s3m");
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const u16 = (at: number): number => (at + 2 <= bytes.length ? view.getUint16(at, true) : 0);
	const u32 = (at: number): number => (at + 4 <= bytes.length ? view.getUint32(at, true) : 0);
	const orderCount = u16(0x20);
	const instrumentCount = u16(0x22);
	const patternCount = u16(0x24);
	const flags = u16(0x26);
	const tracker = u16(0x28);
	const unsigned = u16(0x2a) !== 1;
	const stereo = (bytes[0x33] & 0x80) !== 0;

	// The PCM channels, numbered in file order; each pattern channel maps to one of them or none.
	const map: number[] = [];
	const sides: number[] = [];
	for (let i = 0; i < 32; i++) {
		const setting = bytes[0x40 + i];
		if (setting < 16) {
			map.push(sides.length);
			sides.push(i);
		} else {
			map.push(-1);
		}
	}

	const orders = Array.from({ length: orderCount }, (_, i) => bytes[HEADER_BYTES + i] ?? 255);
	const instrumentAt = HEADER_BYTES + orderCount;
	const patternAt = instrumentAt + instrumentCount * 2;
	const panAt = patternAt + patternCount * 2;
	const pans = sides.map((i) => {
		if (!stereo) {
			return 128;
		}

		const entry = bytes[0x35] === 252 ? (bytes[panAt + i] ?? 0) : 0;
		if (entry & 0x20) {
			return (entry & 0x0f) * 17;
		}

		return bytes[0x40 + i] < 8 ? 3 * 17 : 12 * 17;
	});

	let truncated = false;
	const samples: S3mSample[] = [];
	for (let i = 0; i < instrumentCount; i++) {
		const at = u16(instrumentAt + i * 2) * 16;
		const type = bytes[at] ?? 0;
		const sample: S3mSample = {
			index: i + 1,
			name: text(bytes, at + 0x30, 28),
			adlib: type >= 2,
			pcm: new Int16Array(0),
			c2spd: 8363,
			volume: Math.min(63, bytes[at + 0x1c] ?? 0),
			loopStart: 0,
			loopLength: 0,
		};
		samples.push(sample);
		if (type !== 1 || at + SAMPLE_HEADER > bytes.length) {
			continue;
		}

		const dataAt = ((bytes[at + 0x0d] << 16) | u16(at + 0x0e)) * 16;
		const length = u32(at + 0x10);
		const sampleFlags = bytes[at + 0x1f];
		const wide = (sampleFlags & 4) !== 0;
		const channels = sampleFlags & 2 ? 2 : 1;
		const frameBytes = wide ? 2 : 1;
		// OpenMPT: a C2SPD of 0 plays at 8363. A value past 16 bits is kept, as Impulse Tracker writes it.
		sample.c2spd = u32(at + 0x20) || 8363;
		const available = Math.max(0, Math.floor((bytes.length - dataAt) / (frameBytes * channels)));
		const frames = Math.min(length, available);
		if (frames < length) {
			truncated = true;
		}

		const read = (frame: number, channel: number): number => {
			const p = dataAt + (channel * length + frame) * frameBytes;
			if (wide) {
				const v = p + 2 <= bytes.length ? view.getUint16(p, true) : unsigned ? 0x8000 : 0;
				return unsigned ? v - 0x8000 : (v << 16) >> 16;
			}

			const v = bytes[p] ?? (unsigned ? 0x80 : 0);
			return (unsigned ? v - 0x80 : (v << 24) >> 24) * 256;
		};
		sample.pcm = Int16Array.from({ length: frames }, (_, f) =>
			channels === 2 ? Math.round((read(f, 0) + read(f, 1)) / 2) : read(f, 0),
		);
		const loopStart = u32(at + 0x14);
		const loopEnd = Math.min(u32(at + 0x18), frames);
		if (sampleFlags & 1 && loopEnd > loopStart) {
			sample.loopStart = loopStart;
			sample.loopLength = loopEnd - loopStart;
		}
	}

	const patterns = Array.from({ length: patternCount }, (_, i) =>
		readPattern(bytes, u16(patternAt + i * 2) * 16, map, sides.length),
	);
	const speed = bytes[0x31];
	const tempo = bytes[0x32];
	return {
		title: text(bytes, 0, 28),
		tracker,
		channels: sides.length,
		pans,
		orders,
		patterns,
		samples,
		globalVolume: Math.min(64, bytes[0x30]),
		speed: speed === 0 || speed === 255 ? 6 : speed,
		tempo: tempo < 33 ? 125 : tempo,
		fastSlides: (flags & 64) !== 0 || tracker === 0x1300,
		amigaLimits: (flags & 16) !== 0,
		oldVibrato: (flags & 1) !== 0,
		truncated,
	};
}
