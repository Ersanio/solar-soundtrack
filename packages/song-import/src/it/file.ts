/**
 * An Impulse Tracker module (`.it`), read into its samples, its instruments, its order list and its
 * patterns of cells.
 *
 * The layout follows 8bitbubsy's `it2play` (`loaders/it.c`) and Impulse Tracker's `ITTECH.TXT`: a
 * header with `IMPM`, 64 channel pans and volumes and the order list, then parapointers (file
 * offsets) to each instrument, sample and pattern. A pattern's rows are packed per channel: a byte
 * naming the channel, a mask saying which of note, instrument, volume and command follow or repeat
 * the channel's last, and a 0 ending the row. Samples may be compressed as Impulse Tracker 2.14 and
 * 2.15 compress them (`decompress8`, `decompress16`, ported from `it2play`), and a ping-pong loop is
 * laid out forward (`unrollPingPong`). Instruments in the format before 2.00 are refused.
 */

import { unrollPingPong } from "../tracker/pingpong";

/** Why a file could not be read at all. */
export type ItErrorCode = "not-it" | "old-instruments";

export class ItError extends Error {
	constructor(readonly code: ItErrorCode) {
		super(code);
	}
}

export interface ItSample {
	/** 1-99, as a cell or a keymap names it. */
	index: number;
	name: string;
	/** 16-bit; an 8-bit sample is scaled by 256, a stereo one mixed to mono, a ping-pong loop laid out forward. */
	pcm: Int16Array;
	/** The rate C-5 plays the sample at. */
	c5Speed: number;
	/** 0-64. */
	volume: number;
	/** 0-64. */
	globalVolume: number;
	/** 0-64, or `null` where the sample sets none. */
	pan: number | null;
	loopStart: number;
	/** In frames; 0 means the sample plays once. */
	loopLength: number;
	/** The loop is the sample's sustain loop, which a note off leaves. */
	sustain: boolean;
	autoVibrato: { speed: number; depth: number; rate: number; waveform: number };
}

export interface ItEnvelope {
	/** `[tick, value]`: a volume 0-64, a pan or pitch -32..32. */
	points: [number, number][];
	loop: { start: number; end: number } | null;
	sustain: { start: number; end: number } | null;
	/** A pitch envelope that drives the filter instead. */
	filter: boolean;
}

export interface ItInstrument {
	name: string;
	/** 0 cut, 1 continue, 2 note off, 3 note fade. */
	newNoteAction: number;
	fadeout: number;
	/** 0-128. */
	globalVolume: number;
	/** 0-64, or `null` where the instrument sets none. */
	pan: number | null;
	pitchPanSeparation: number;
	pitchPanCenter: number;
	/** For each note 0-119, the note it plays and the sample (0 for none). */
	keymap: { note: number; sample: number }[];
	volumeEnvelope: ItEnvelope | null;
	panEnvelope: ItEnvelope | null;
	pitchEnvelope: ItEnvelope | null;
}

export interface ItCell {
	/** -1 for none, 0-119 a note (60 is C-5), 120-253 a note fade, 254 a cut, 255 a note off. */
	note: number;
	/** 0 for none. */
	instrument: number;
	/** -1 for none, else the volume column byte (0-212). */
	volume: number;
	/** 0 for none, 1 for A to 26 for Z. */
	command: number;
	param: number;
}

export interface ItFile {
	title: string;
	tracker: number;
	compatible: number;
	stereo: boolean;
	instrumentMode: boolean;
	linear: boolean;
	oldEffects: boolean;
	/** Gxx keeps its own memory rather than sharing E's and F's. */
	compatibleGxx: boolean;
	/** 0-128. */
	globalVolume: number;
	speed: number;
	tempo: number;
	/** 0-128: how far apart the channels' pans are put. */
	separation: number;
	/** The channels up to the last any pattern uses. */
	channels: number;
	/** Each channel's pan, 0-64, or 100 for surround. */
	channelPans: number[];
	/** Each channel's volume, 0-64. */
	channelVolumes: number[];
	/** The order list as stored: pattern indices, 254 to skip and 255 to end. */
	orders: number[];
	/** Pattern, then row, then channel; `null` where a row leaves the channel alone. */
	patterns: (ItCell | null)[][][];
	samples: ItSample[];
	instruments: ItInstrument[];
	/** The sample data ran past the end of the file; what was there is kept. */
	truncated: boolean;
}

const HEADER_BYTES = 0xc0;

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

/** Whether `bytes` carry an IT signature. */
export function isIt(bytes: Uint8Array): boolean {
	return (
		bytes.length >= HEADER_BYTES && bytes[0] === 0x49 && bytes[1] === 0x4d && bytes[2] === 0x50 && bytes[3] === 0x4d
	);
}

/** A little-endian reader of bits from `src`, as `it2play` reads its unaligned words. */
function word(src: Uint8Array, p: number, bytes: number): number {
	let v = 0;
	for (let i = 0; i < bytes; i++) {
		v += (src[p + i] ?? 0) * 2 ** (8 * i);
	}

	return v;
}

/** `Decompress8BitData`: one block of an IT 2.14 8-bit sample, `count` frames. */
export function decompress8(src: Uint8Array, count: number): Int8Array {
	const out = new Int8Array(count);
	let n = 0;
	let p = 0;
	let last = 0;
	let depth = 9;
	let inverse = 0;
	let bitsRead = 0;
	while (n < count) {
		let bits = (word(src, p, 2) >>> bitsRead) & 0xffff;
		bitsRead += depth;
		p += bitsRead >> 3;
		bitsRead &= 7;
		let byte = bits & 0xff;
		if (depth <= 6) {
			bits = (bits << (inverse & 0x1f)) & 0xffff;
			byte = bits & 0xff;
			if (byte !== 0x80) {
				last = (last + (((byte << 24) >> 24) >> (inverse & 0x1f))) & 0xff;
				out[n++] = (last << 24) >> 24;
				continue;
			}

			byte = (bits >> 8) & 7;
			bitsRead += 3;
			p += bitsRead >> 3;
			bitsRead &= 7;
		} else if (depth === 8) {
			if (byte < 0x7c || byte > 0x83) {
				last = (last + byte) & 0xff;
				out[n++] = (last << 24) >> 24;
				continue;
			}

			byte -= 0x7c;
		} else if (depth < 8) {
			byte = (byte << 1) & 0xff;
			if (byte < 0x78 || byte > 0x86) {
				last = (last + (((byte << 24) >> 24) >> (inverse & 0x1f))) & 0xff;
				out[n++] = (last << 24) >> 24;
				continue;
			}

			byte = (byte >> 1) - 0x3c;
		} else {
			bits &= 0x1ff;
			if ((bits & 0x100) === 0) {
				last = (last + byte) & 0xff;
				out[n++] = (last << 24) >> 24;
				continue;
			}
		}

		// Every path that reaches here read an escape: the width changes.
		byte++;
		if (byte >= depth) {
			byte++;
		}

		depth = byte;
		inverse = 8;
		if (inverse < depth) {
			inverse++;
		}

		inverse -= depth;
	}

	return out;
}

/** `Decompress16BitData`: one block of an IT 2.14 16-bit sample, `count` frames. */
export function decompress16(src: Uint8Array, count: number): Int16Array {
	const out = new Int16Array(count);
	let n = 0;
	let p = 0;
	let last = 0;
	let depth = 17;
	let inverse = 0;
	let bitsRead = 0;
	while (n < count) {
		let bits = Math.floor(word(src, p, 4) / 2 ** bitsRead);
		bitsRead += depth;
		p += bitsRead >> 3;
		bitsRead &= 7;
		if (depth <= 6) {
			bits = (bits * 2 ** (inverse & 0x1f)) % 2 ** 32;
			const low = bits & 0xffff;
			if (low !== 0x8000) {
				last = (last + (((low << 16) >> 16) >> (inverse & 0x1f))) & 0xffff;
				out[n++] = (last << 16) >> 16;
				continue;
			}

			let next = ((bits >>> 16) & 0xf) + 1;
			if (next >= depth) {
				next++;
			}

			depth = next;
			inverse = 16;
			if (inverse < depth) {
				inverse++;
			}

			inverse -= depth;
			bitsRead += 4;
			continue;
		}

		let low = bits & 0xffff;
		if (depth <= 16) {
			const mask = 0xffff >>> (inverse & 0x1f);
			low &= mask;
			const middle = (mask >>> 1) - 8;
			if (low > middle + 16 || low <= middle) {
				low = (low << (inverse & 0x1f)) & 0xffff;
				low = ((low << 16) >> 16) >> (inverse & 0x1f);
				last = (last + low) & 0xffff;
				out[n++] = (last << 16) >> 16;
				continue;
			}

			let next = (low - middle) & 0xff;
			if (next >= depth) {
				next++;
			}

			depth = next;
			inverse = 16;
			if (inverse < depth) {
				inverse++;
			}

			inverse -= depth;
			continue;
		}

		if (bits & 0x10000) {
			depth = (low + 1) & 0xff;
			inverse = 16 - depth;
		} else {
			last = (last + low) & 0xffff;
			out[n++] = (last << 16) >> 16;
		}
	}

	return out;
}

/** Reads an IT file. Throws {@link ItError} where it has no signature or instruments of the old format. */
export function readItFile(bytes: Uint8Array): ItFile {
	if (!isIt(bytes)) {
		throw new ItError("not-it");
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const u8 = (at: number): number => bytes[at] ?? 0;
	const s8 = (at: number): number => (u8(at) << 24) >> 24;
	const u16 = (at: number): number => (at + 2 <= bytes.length ? view.getUint16(at, true) : 0);
	const u32 = (at: number): number => (at + 4 <= bytes.length ? view.getUint32(at, true) : 0);
	const orderCount = u16(0x20);
	const instrumentCount = u16(0x22);
	const sampleCount = u16(0x24);
	const patternCount = u16(0x26);
	const tracker = u16(0x28);
	const compatible = u16(0x2a);
	const flags = u16(0x2c);
	const instrumentMode = (flags & 4) !== 0;
	if (instrumentMode && instrumentCount > 0 && compatible < 0x200) {
		throw new ItError("old-instruments");
	}

	const orders = Array.from({ length: orderCount }, (_, i) => u8(HEADER_BYTES + i));
	const instrumentAt = HEADER_BYTES + orderCount;
	const sampleAt = instrumentAt + instrumentCount * 4;
	const patternAt = sampleAt + sampleCount * 4;
	let truncated = false;

	const samples: ItSample[] = Array.from({ length: sampleCount }, (_, i) => {
		const at = u32(sampleAt + i * 4);
		const sampleFlags = u8(at + 0x12);
		const convert = u8(at + 0x2e);
		const defaultPan = u8(at + 0x2f);
		const sample: ItSample = {
			index: i + 1,
			name: text(bytes, at + 0x14, 26),
			pcm: new Int16Array(0),
			c5Speed: u32(at + 0x3c) || 8363,
			volume: Math.min(64, u8(at + 0x13)),
			globalVolume: Math.min(64, u8(at + 0x11)),
			pan: defaultPan & 0x80 ? Math.min(64, defaultPan & 0x7f) : null,
			loopStart: 0,
			loopLength: 0,
			sustain: false,
			autoVibrato: { speed: u8(at + 0x4c), depth: u8(at + 0x4d), rate: u8(at + 0x4e), waveform: u8(at + 0x4f) },
		};
		const length = u32(at + 0x30);
		if (!(sampleFlags & 1) || length === 0 || at + 0x50 > bytes.length) {
			return sample;
		}

		const wide = (sampleFlags & 2) !== 0;
		const stereo = (sampleFlags & 4) !== 0;
		const compressed = (sampleFlags & 8) !== 0;
		const signed = (convert & 1) !== 0;
		const delta = (convert & 4) !== 0;
		const channels: Int16Array[] = [];
		let p = u32(at + 0x48);
		for (let c = 0; c < (stereo ? 2 : 1); c++) {
			const pcm = new Int16Array(length);
			if (compressed) {
				// Blocks of 0x8000 bytes of output, each a 16-bit packed length and its data.
				const perBlock = wide ? 0x4000 : 0x8000;
				for (let done = 0; done < length;) {
					const count = Math.min(perBlock, length - done);
					const packed = u16(p);
					if (p + 2 + packed > bytes.length) {
						truncated = true;
					}

					const src = bytes.subarray(Math.min(bytes.length, p + 2), Math.min(bytes.length, p + 2 + packed));
					const block = wide ? decompress16(src, count) : decompress8(src, count);
					// IT 2.15: the decompressed values are deltas again, summed afresh in every block.
					let sum = 0;
					for (let j = 0; j < count; j++) {
						const v = delta ? (wide ? ((sum + block[j]) << 16) >> 16 : ((sum + block[j]) << 24) >> 24) : block[j];
						sum = v;
						pcm[done + j] = wide ? v : v * 256;
					}

					p += 2 + packed;
					done += count;
				}
			} else {
				const frameBytes = wide ? 2 : 1;
				const available = Math.max(0, Math.floor((bytes.length - p) / frameBytes));
				if (available < length) {
					truncated = true;
				}

				for (let j = 0; j < Math.min(length, available); j++) {
					if (wide) {
						const v = view.getUint16(p + j * 2, true);
						pcm[j] = signed ? (v << 16) >> 16 : v - 0x8000;
					} else {
						const v = bytes[p + j];
						pcm[j] = (signed ? (v << 24) >> 24 : v - 0x80) * 256;
					}
				}

				p += length * frameBytes;
			}

			channels.push(pcm);
		}

		const pcm =
			channels.length === 2
				? Int16Array.from(channels[0], (v, j) => Math.round((v + channels[1][j]) / 2))
				: channels[0];
		// A BRR sample has one loop: the loop, or the sustain loop where there is none.
		const hasLoop = (sampleFlags & 16) !== 0;
		const hasSustain = (sampleFlags & 32) !== 0;
		const begin = hasLoop ? u32(at + 0x34) : u32(at + 0x40);
		const end = Math.min(length, hasLoop ? u32(at + 0x38) : u32(at + 0x44));
		const pingPong = hasLoop ? (sampleFlags & 64) !== 0 : (sampleFlags & 128) !== 0;
		if ((hasLoop || hasSustain) && end > begin) {
			const laid = pingPong
				? unrollPingPong(pcm, begin, end - begin)
				: { pcm: pcm.slice(0, end), loopStart: begin, loopLength: end - begin };
			sample.pcm = laid.pcm;
			sample.loopStart = laid.loopStart;
			sample.loopLength = laid.loopLength;
			sample.sustain = !hasLoop;
		} else {
			sample.pcm = pcm;
		}

		return sample;
	});

	const envelope = (at: number, pitch: boolean): ItEnvelope | null => {
		const envFlags = u8(at);
		const count = Math.min(25, u8(at + 1));
		if (!(envFlags & 1) || count === 0) {
			return null;
		}

		const points = Array.from({ length: count }, (_, i): [number, number] => [
			u16(at + 6 + i * 3 + 1),
			s8(at + 6 + i * 3),
		]);
		const range = (start: number, end: number) => (start <= end && end < count ? { start, end } : null);
		return {
			points,
			loop: envFlags & 2 ? range(u8(at + 2), u8(at + 3)) : null,
			sustain: envFlags & 4 ? range(u8(at + 4), u8(at + 5)) : null,
			filter: pitch && (envFlags & 128) !== 0,
		};
	};

	const instruments: ItInstrument[] = Array.from({ length: instrumentMode ? instrumentCount : 0 }, (_, i) => {
		const at = u32(instrumentAt + i * 4);
		const pan = u8(at + 0x19);
		return {
			name: text(bytes, at + 0x20, 26),
			newNoteAction: u8(at + 0x11) & 3,
			fadeout: u16(at + 0x14),
			globalVolume: Math.min(128, u8(at + 0x18)),
			pan: pan & 0x80 ? null : Math.min(64, pan),
			pitchPanSeparation: s8(at + 0x16),
			pitchPanCenter: u8(at + 0x17),
			keymap: Array.from({ length: 120 }, (_entry, n) => ({
				note: u8(at + 0x40 + n * 2),
				sample: u8(at + 0x41 + n * 2),
			})),
			volumeEnvelope: envelope(at + 0x130, false),
			panEnvelope: envelope(at + 0x182, false),
			pitchEnvelope: envelope(at + 0x1d4, true),
		};
	});

	let channels = 0;
	const patterns = Array.from({ length: patternCount }, (_, i) => {
		const at = u32(patternAt + i * 4);
		if (at === 0 || at + 8 > bytes.length) {
			return Array.from({ length: 64 }, () => new Array<ItCell | null>(64).fill(null));
		}

		const rowCount = Math.max(1, Math.min(200, u16(at + 2)));
		const end = Math.min(bytes.length, at + 8 + u16(at));
		const rows = Array.from({ length: rowCount }, () => new Array<ItCell | null>(64).fill(null));
		const masks = new Array<number>(64).fill(0);
		const last = Array.from({ length: 64 }, () => ({ note: -1, instrument: 0, volume: -1, command: 0, param: 0 }));
		let p = at + 8;
		for (let row = 0; row < rowCount && p < end;) {
			const variable = u8(p++);
			if (variable === 0) {
				row++;
				continue;
			}

			const c = (variable - 1) & 63;
			if (variable & 0x80) {
				masks[c] = u8(p++);
			}

			const mask = masks[c];
			const cell: ItCell = { note: -1, instrument: 0, volume: -1, command: 0, param: 0 };
			if (mask & 1) last[c].note = u8(p++);
			if (mask & 2) last[c].instrument = u8(p++);
			if (mask & 4) last[c].volume = u8(p++);
			if (mask & 8) {
				last[c].command = u8(p++);
				last[c].param = u8(p++);
			}

			if (mask & 0x11) cell.note = last[c].note;
			if (mask & 0x22) cell.instrument = last[c].instrument;
			if (mask & 0x44) cell.volume = last[c].volume;
			if (mask & 0x88) {
				cell.command = last[c].command;
				cell.param = last[c].param;
			}

			rows[row][c] = cell;
			channels = Math.max(channels, c + 1);
		}

		return rows;
	});

	return {
		title: text(bytes, 4, 26),
		tracker,
		compatible,
		stereo: (flags & 1) !== 0,
		instrumentMode,
		linear: (flags & 8) !== 0,
		oldEffects: (flags & 16) !== 0,
		compatibleGxx: (flags & 32) !== 0,
		globalVolume: Math.min(128, u8(0x30)),
		speed: u8(0x32) || 6,
		tempo: Math.max(31, u8(0x33) || 125),
		separation: Math.min(128, u8(0x34)),
		channels: Math.max(1, channels),
		channelPans: Array.from({ length: 64 }, (_, i) => u8(0x40 + i)),
		channelVolumes: Array.from({ length: 64 }, (_, i) => Math.min(64, u8(0x80 + i))),
		orders,
		patterns: patterns.map((rows) => rows.map((cells) => cells.slice(0, Math.max(1, channels)))),
		samples,
		instruments,
		truncated,
	};
}
