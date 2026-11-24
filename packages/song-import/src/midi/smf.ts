/**
 * A Standard MIDI File, read into its tracks of timed events.
 *
 * The layout is the SMF 1.0 one: an `MThd` chunk of at least six bytes (format, track count,
 * division), then chunks of which only `MTrk` is read and every other is skipped whole. A track is
 * delta-timed events: channel messages, which may leave their status byte out while it repeats
 * (running status, cancelled by a meta or sysex event), `F0`/`F7` sysex with a variable-length size,
 * and `FF` meta events. A file cut short keeps every event read before the cut.
 */

import { smfBytes } from "../format";

/** How the file counts time: ticks per quarter note, or SMPTE frames and ticks per frame. */
export type Division = { kind: "ppq"; ppq: number } | { kind: "smpte"; fps: number; ticksPerFrame: number };

/** A channel message: `status` is the high nybble (`0x80`-`0xE0`), `channel` 0-15. */
export interface ChannelEvent {
	type: "channel";
	tick: number;
	status: number;
	channel: number;
	data1: number;
	data2: number;
}

export interface MetaEvent {
	type: "meta";
	tick: number;
	meta: number;
	data: Uint8Array;
}

/** A sysex message's bytes after its `F0` or `F7`. */
export interface SysexEvent {
	type: "sysex";
	tick: number;
	data: Uint8Array;
}

export type SmfEvent = ChannelEvent | MetaEvent | SysexEvent;

export interface Smf {
	format: 0 | 1;
	division: Division;
	tracks: SmfEvent[][];
	/** Indices of tracks that ran past the end of the file or their chunk. */
	truncated: number[];
}

/** Why a file could not be read as MIDI at all. */
export type SmfErrorCode = "not-midi" | "bad-header" | "format-2" | "no-tracks" | "no-notes";

export class SmfError extends Error {
	constructor(readonly code: SmfErrorCode) {
		super(code);
	}
}

/** Bytes after a channel status, by its high nybble: `C0` and `D0` take one, the rest two. */
function dataBytes(status: number): number {
	return status === 0xc0 || status === 0xd0 ? 1 : 2;
}

class Reader {
	pos: number;

	constructor(
		private readonly bytes: Uint8Array,
		start: number,
		readonly end: number,
	) {
		this.pos = start;
	}

	get done(): boolean {
		return this.pos >= this.end;
	}

	byte(): number {
		if (this.pos >= this.end) {
			throw new RangeError("past the end of the track");
		}

		return this.bytes[this.pos++];
	}

	peek(): number {
		if (this.pos >= this.end) {
			throw new RangeError("past the end of the track");
		}

		return this.bytes[this.pos];
	}

	/** A variable-length quantity: seven bits a byte, high bit set on all but the last, four bytes at most. */
	vlq(): number {
		let value = 0;
		for (let i = 0; i < 4; i++) {
			const b = this.byte();
			value = (value << 7) | (b & 0x7f);
			if ((b & 0x80) === 0) {
				return value;
			}
		}

		throw new RangeError("variable-length quantity longer than four bytes");
	}

	take(count: number): Uint8Array {
		if (this.pos + count > this.end) {
			throw new RangeError("past the end of the track");
		}

		const out = this.bytes.slice(this.pos, this.pos + count);
		this.pos += count;
		return out;
	}
}

/** One `MTrk` body. Returns whether it ended cleanly, at an end-of-track event or at its last byte. */
function readTrack(reader: Reader, out: SmfEvent[]): boolean {
	let tick = 0;
	let running = 0;
	try {
		while (!reader.done) {
			tick += reader.vlq();
			const lead = reader.peek();
			if (lead === 0xff) {
				reader.byte();
				const meta = reader.byte();
				const data = reader.take(reader.vlq());
				running = 0;
				if (meta === 0x2f) {
					return true;
				}

				out.push({ type: "meta", tick, meta, data });
				continue;
			}

			if (lead === 0xf0 || lead === 0xf7) {
				reader.byte();
				out.push({ type: "sysex", tick, data: reader.take(reader.vlq()) });
				running = 0;
				continue;
			}

			let status: number;
			if (lead & 0x80) {
				status = reader.byte();
				if (status >= 0xf0) {
					// System common and real-time bytes have no place in a file; skip their data.
					reader.take(status === 0xf2 ? 2 : status === 0xf1 || status === 0xf3 ? 1 : 0);
					running = 0;
					continue;
				}

				running = status;
			} else if (running !== 0) {
				status = running;
			} else {
				return false;
			}

			const data1 = reader.byte() & 0x7f;
			const data2 = dataBytes(status & 0xf0) === 2 ? reader.byte() & 0x7f : 0;
			out.push({ type: "channel", tick, status: status & 0xf0, channel: status & 0x0f, data1, data2 });
		}

		return true;
	} catch {
		return false;
	}
}

/** Reads a Standard MIDI File, or an RMID wrapping one. Throws {@link SmfError}. */
export function readSmf(file: Uint8Array): Smf {
	const bytes = smfBytes(file);
	if (!bytes) {
		throw new SmfError("not-midi");
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.length < 14) {
		throw new SmfError("bad-header");
	}

	const headerLength = view.getUint32(4);
	if (headerLength < 6 || 8 + headerLength > bytes.length) {
		throw new SmfError("bad-header");
	}

	const format = view.getUint16(8);
	if (format === 2) {
		throw new SmfError("format-2");
	}

	if (format !== 0 && format !== 1) {
		throw new SmfError("bad-header");
	}

	const rawDivision = view.getUint16(12);
	let division: Division;
	if (rawDivision & 0x8000) {
		const fps = 256 - (rawDivision >> 8);
		const ticksPerFrame = rawDivision & 0xff;
		if (ticksPerFrame === 0 || ![24, 25, 29, 30].includes(fps)) {
			throw new SmfError("bad-header");
		}

		division = { kind: "smpte", fps: fps === 29 ? 29.97 : fps, ticksPerFrame };
	} else {
		if (rawDivision === 0) {
			throw new SmfError("bad-header");
		}

		division = { kind: "ppq", ppq: rawDivision };
	}

	const tracks: SmfEvent[][] = [];
	const truncated: number[] = [];
	let at = 8 + headerLength;
	while (at + 8 <= bytes.length) {
		const id = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
		const size = view.getUint32(at + 4);
		const start = at + 8;
		const end = Math.min(bytes.length, start + size);
		if (id === "MTrk") {
			const events: SmfEvent[] = [];
			const clean = readTrack(new Reader(bytes, start, end), events);
			if (!clean || start + size > bytes.length) {
				truncated.push(tracks.length);
			}

			tracks.push(events);
		}

		at = start + size;
	}

	if (tracks.length === 0) {
		throw new SmfError("no-tracks");
	}

	return { format, division, tracks, truncated };
}
