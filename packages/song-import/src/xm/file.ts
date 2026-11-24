/**
 * A FastTracker II module (`.xm`), read into its instruments and their samples, its order list and its
 * patterns of cells.
 *
 * The layout follows 8bitbubsy's `ft2_load_xm.c`: a header whose size field says where the patterns
 * start; patterns of packed cells, a byte with bit 7 set naming which of note, instrument, volume,
 * effect and parameter follow; then each instrument's header, up to 16 sample headers and their
 * delta-coded data. Version 1.04 stores the patterns first and each instrument's data after its
 * header; 1.02 and 1.03 store every instrument header, then the patterns, then all the sample data. A
 * ping-pong loop is laid out forward (`unrollPingPong`), since a BRR loop only runs one way.
 */

import { unrollPingPong } from "../tracker/pingpong";

/** Why a file could not be read at all. */
export type XmErrorCode = "not-xm";

export class XmError extends Error {
	constructor(readonly code: XmErrorCode) {
		super(code);
	}
}

export interface XmCell {
	/** 0 for none, 1-96 (1 is C-0), 97 for key off. */
	note: number;
	/** 0 for none, else 1-128. */
	instrument: number;
	/** The volume column byte, 0 for none. */
	volume: number;
	/** 0-35: 0-9, then A (10) to Z (35). */
	effect: number;
	param: number;
}

export interface XmEnvelope {
	/** `[tick, value]`, the value 0-64. */
	points: [number, number][];
	/** The point the envelope holds at until key off. */
	sustain: number | null;
	/** The points it loops between. */
	loop: { start: number; end: number } | null;
}

export interface XmSample {
	/** The song's sample number, from 1, across every instrument. */
	index: number;
	name: string;
	/** 16-bit; an 8-bit sample is scaled by 256. A ping-pong loop is laid out forward. */
	pcm: Int16Array;
	loopStart: number;
	/** In frames; 0 means the sample plays once. */
	loopLength: number;
	/** 0-64. */
	volume: number;
	/** -128..127, in 128ths of a semitone. */
	finetune: number;
	/** 0-255. */
	panning: number;
	/** Semitones the sample is played above the note. */
	relativeNote: number;
}

export interface XmInstrument {
	name: string;
	/** For each note 1-96, which of `samples` it plays. */
	keymap: number[];
	samples: XmSample[];
	volumeEnvelope: XmEnvelope | null;
	panEnvelope: XmEnvelope | null;
	fadeout: number;
	autoVibrato: { type: number; sweep: number; depth: number; rate: number };
}

export interface XmFile {
	title: string;
	version: number;
	channels: number;
	orders: number[];
	/** The order the song restarts at. */
	restart: number;
	/** Linear frequencies rather than Amiga periods. */
	linear: boolean;
	speed: number;
	bpm: number;
	/** Pattern, then row, then channel. */
	patterns: XmCell[][][];
	/** Instrument 1 is `instruments[0]`; one with no samples has an empty list. */
	instruments: XmInstrument[];
	/** The sample data ran past the end of the file; what was there is kept. */
	truncated: boolean;
}

const SIGNATURE = "Extended Module: ";
const INSTRUMENT_HEADER = 263;
const SAMPLE_HEADER = 40;

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

/** Whether `bytes` carry an XM signature. */
export function isXm(bytes: Uint8Array): boolean {
	if (bytes.length < 80) {
		return false;
	}

	for (let i = 0; i < SIGNATURE.length; i++) {
		if (bytes[i] !== SIGNATURE.charCodeAt(i)) {
			return false;
		}
	}

	return true;
}

const empty = (): XmCell => ({ note: 0, instrument: 0, volume: 0, effect: 0, param: 0 });

/** Reads an XM file. Throws {@link XmError} where it has no signature or a version FT2 does not read. */
export function readXmFile(bytes: Uint8Array): XmFile {
	if (!isXm(bytes)) {
		throw new XmError("not-xm");
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const u8 = (at: number): number => bytes[at] ?? 0;
	const u16 = (at: number): number => (at + 2 <= bytes.length ? view.getUint16(at, true) : 0);
	const u32 = (at: number): number => (at + 4 <= bytes.length ? view.getUint32(at, true) : 0);
	const s8 = (at: number): number => (u8(at) << 24) >> 24;
	const version = u16(58);
	if (version < 0x0102 || version > 0x0104) {
		throw new XmError("not-xm");
	}

	const songLength = Math.max(1, Math.min(256, u16(64)));
	const channels = Math.max(2, Math.min(32, u16(68) + (u16(68) & 1)));
	const patternCount = Math.min(256, u16(70));
	const instrumentCount = Math.min(256, u16(72));
	const orders = Array.from({ length: songLength }, (_, i) => u8(80 + i));
	let restart = u16(66);
	if (restart >= songLength) {
		restart = 0;
	}

	let at = 60 + u32(60);
	let truncated = false;

	const readPatterns = (): XmCell[][][] =>
		Array.from({ length: patternCount }, () => {
			const headerSize = u32(at);
			const rowCount = version === 0x0102 ? u8(at + 5) + 1 : u16(at + 5);
			const dataSize = version === 0x0102 ? u16(at + 6) : u16(at + 7);
			at += Math.max(version === 0x0102 ? 8 : 9, headerSize);
			const rows = Math.max(1, Math.min(256, rowCount || 64));
			const pattern = Array.from({ length: rows }, () => Array.from({ length: channels }, empty));
			let p = at;
			const end = at + dataSize;
			for (let row = 0; row < rows && dataSize > 0; row++) {
				for (let c = 0; c < channels && p < end; c++) {
					const first = u8(p);
					const cell = empty();
					if (first & 0x80) {
						p++;
						if (first & 1) cell.note = u8(p++);
						if (first & 2) cell.instrument = u8(p++);
						if (first & 4) cell.volume = u8(p++);
						if (first & 8) cell.effect = u8(p++);
						if (first & 16) cell.param = u8(p++);
					} else {
						[cell.note, cell.instrument, cell.volume, cell.effect, cell.param] = [
							first,
							u8(p + 1),
							u8(p + 2),
							u8(p + 3),
							u8(p + 4),
						];
						p += 5;
					}

					// `setupLoadedModule`: what FT2 cannot play is cleared.
					if (cell.note > 97) cell.note = 0;
					if (cell.instrument > 128) cell.instrument = 0;
					if (cell.effect > 35) {
						cell.effect = 0;
						cell.param = 0;
					}

					pattern[row][c] = cell;
				}
			}

			at = end;
			return pattern;
		});

	interface Pending {
		sample: XmSample;
		bytes: number;
		wide: boolean;
		loopType: number;
	}

	let nextIndex = 1;
	/** An instrument's header and its sample headers; the data is read by `readData`. */
	const readInstrument = (): { instrument: XmInstrument; pending: Pending[] } => {
		const start = at;
		// `loadInstrHeader`: a size of 0 means the full 263 bytes.
		const size = u32(at) || INSTRUMENT_HEADER;

		const sampleCount = Math.max(0, Math.min(32, (u16(at + 27) << 16) >> 16));
		const instrument: XmInstrument = {
			name: text(bytes, at + 4, 22),
			keymap: new Array<number>(96).fill(0),
			samples: [],
			volumeEnvelope: null,
			panEnvelope: null,
			fadeout: 0,
			autoVibrato: { type: 0, sweep: 0, depth: 0, rate: 0 },
		};
		const pending: Pending[] = [];
		if (sampleCount === 0) {
			at = start + size;
			return { instrument, pending };
		}

		const sampleHeaderSize = u32(at + 29) || SAMPLE_HEADER;
		for (let i = 0; i < 96; i++) {
			instrument.keymap[i] = u8(at + 33 + i) & 0x0f;
		}

		const envelope = (
			pointsAt: number,
			length: number,
			sustain: number,
			loopStart: number,
			loopEnd: number,
			flags: number,
		): XmEnvelope | null => {
			if (!(flags & 1) || length === 0) {
				return null;
			}

			const count = Math.min(12, length);
			const points = Array.from({ length: count }, (_, i): [number, number] => [
				u16(pointsAt + i * 4),
				Math.min(64, u16(pointsAt + i * 4 + 2)),
			]);
			return {
				points,
				sustain: flags & 2 && sustain < count ? sustain : null,
				loop: flags & 4 && loopStart <= loopEnd && loopEnd < count ? { start: loopStart, end: loopEnd } : null,
			};
		};
		instrument.volumeEnvelope = envelope(
			at + 129,
			u8(at + 225),
			u8(at + 227),
			u8(at + 228),
			u8(at + 229),
			u8(at + 233),
		);
		instrument.panEnvelope = envelope(at + 177, u8(at + 226), u8(at + 230), u8(at + 231), u8(at + 232), u8(at + 234));
		instrument.autoVibrato = { type: u8(at + 235), sweep: u8(at + 236), depth: u8(at + 237), rate: u8(at + 238) };
		instrument.fadeout = u16(at + 239);
		at = start + size;

		for (let i = 0; i < sampleCount; i++) {
			const h = at + i * sampleHeaderSize;
			const flags = u8(h + 14);
			const wide = (flags & 16) !== 0;
			const length = u32(h);
			const sample: XmSample = {
				index: 0,
				name: text(bytes, h + 18, 22),
				pcm: new Int16Array(0),
				loopStart: wide ? u32(h + 4) >> 1 : u32(h + 4),
				loopLength: (flags & 3) === 0 ? 0 : wide ? u32(h + 8) >> 1 : u32(h + 8),
				volume: Math.min(64, u8(h + 12)),
				finetune: s8(h + 13),
				panning: u8(h + 15),
				relativeNote: s8(h + 16),
			};
			if (i < 16) {
				instrument.samples.push(sample);
			}

			pending.push({ sample, bytes: length, wide, loopType: flags & 3 });
		}

		at += sampleCount * sampleHeaderSize;
		return { instrument, pending };
	};

	/** The delta-coded data of `pending`, in order, from `at`. */
	const readData = (pending: Pending[]): void => {
		for (const p of pending) {
			const frames = p.wide ? p.bytes >> 1 : p.bytes;
			const available = Math.max(0, Math.floor((bytes.length - at) / (p.wide ? 2 : 1)));
			const count = Math.min(frames, available);
			if (count < frames) {
				truncated = true;
			}

			const pcm = new Int16Array(count);
			let old = 0;
			for (let i = 0; i < count; i++) {
				if (p.wide) {
					old = ((old + view.getInt16(at + i * 2, true)) << 16) >> 16;
					pcm[i] = old;
				} else {
					old = ((old + s8(at + i)) << 24) >> 24;
					pcm[i] = old * 256;
				}
			}

			at += p.bytes;
			const s = p.sample;
			const loopEnd = Math.min(count, s.loopStart + s.loopLength);
			if (s.loopLength > 0 && loopEnd > s.loopStart) {
				const looped = p.loopType === 2 ? unrollPingPong(pcm, s.loopStart, loopEnd - s.loopStart) : null;
				s.pcm = looped ? looped.pcm : pcm;
				s.loopLength = looped ? looped.loopLength : loopEnd - s.loopStart;
			} else {
				s.pcm = pcm;
				s.loopStart = 0;
				s.loopLength = 0;
			}
		}
	};

	let patterns: XmCell[][][];
	const instruments: XmInstrument[] = [];
	if (version === 0x0104) {
		patterns = readPatterns();
		for (let i = 0; i < instrumentCount; i++) {
			const { instrument, pending } = readInstrument();
			readData(pending);
			instruments.push(instrument);
		}
	} else {
		const pendingAll: Pending[] = [];
		for (let i = 0; i < instrumentCount; i++) {
			const { instrument, pending } = readInstrument();
			pendingAll.push(...pending);
			instruments.push(instrument);
		}

		patterns = readPatterns();
		readData(pendingAll);
	}

	for (const instrument of instruments) {
		for (const sample of instrument.samples) {
			sample.index = nextIndex++;
		}
	}

	return {
		title: text(bytes, 17, 20),
		version,
		channels,
		orders,
		restart,
		linear: (u16(74) & 1) !== 0,
		speed: Math.max(1, Math.min(31, u16(76) || 6)),
		bpm: Math.max(32, Math.min(255, u16(78) || 125)),
		patterns,
		instruments,
		truncated,
	};
}
