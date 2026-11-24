/**
 * An Unreal package (`.umx`) unwrapped to the tracker module its `Music` object holds.
 *
 * The layout follows OpenMPT's `UMXTools.cpp`: a 36-byte header naming the name, export and import
 * tables, compact indices throughout, and fields that come and go with the package version (below
 * 40, 60, 62, 64, 100 and 120). The module's format is read from its own signature rather than the
 * name the package gives it, which can be wrong.
 */

import { isMod } from "./mod/file";
import { isS3m } from "./s3m/file";

/** Why a package gave no module. */
export type UmxErrorCode = "not-umx" | "no-music" | "audio";

export class UmxError extends Error {
	constructor(readonly code: UmxErrorCode) {
		super(code);
	}
}

/** The tracker formats a package's music can be in. */
export type TrackerFormat = "mod" | "s3m" | "xm" | "it";

export interface UmxModule {
	format: TrackerFormat;
	/** The module's own bytes, as a standalone file of its format. */
	bytes: Uint8Array;
}

const MAGIC = 0x9e2a83c1;
const HEADER_BYTES = 36;

function ascii(bytes: Uint8Array, at: number, text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		if (bytes[at + i] !== text.charCodeAt(i)) {
			return false;
		}
	}

	return true;
}

/** The tracker format `bytes` are in, by signature; `null` for anything else. */
export function trackerFormatOf(bytes: Uint8Array): TrackerFormat | null {
	if (ascii(bytes, 0, "IMPM")) {
		return "it";
	}

	if (ascii(bytes, 0, "Extended Module: ")) {
		return "xm";
	}

	if (isS3m(bytes)) {
		return "s3m";
	}

	return isMod(bytes) ? "mod" : null;
}

interface Header {
	version: number;
	nameCount: number;
	nameOffset: number;
	exportCount: number;
	exportOffset: number;
	importCount: number;
	importOffset: number;
}

function headerOf(bytes: Uint8Array): Header | null {
	if (bytes.length < HEADER_BYTES) {
		return null;
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, true) !== MAGIC) {
		return null;
	}

	const header = {
		version: view.getUint16(4, true),
		nameCount: view.getUint32(12, true),
		nameOffset: view.getUint32(16, true),
		exportCount: view.getUint32(20, true),
		exportOffset: view.getUint32(24, true),
		importCount: view.getUint32(28, true),
		importOffset: view.getUint32(32, true),
	};
	// `FileHeader::IsValid`: every table past the header and every count above zero.
	const valid =
		header.nameOffset >= HEADER_BYTES &&
		header.exportOffset >= HEADER_BYTES &&
		header.importOffset >= HEADER_BYTES &&
		header.nameCount > 0 &&
		header.exportCount > 0 &&
		header.importCount > 0;
	return valid ? header : null;
}

/** Whether `bytes` open with an Unreal package header. */
export function isUmx(bytes: Uint8Array): boolean {
	return headerOf(bytes) !== null;
}

/** A cursor over the package; a read past the end throws, which the caller turns into `not-umx`. */
class Reader {
	constructor(
		private readonly bytes: Uint8Array,
		public at: number,
	) {}

	byte(): number {
		if (this.at >= this.bytes.length) {
			throw new UmxError("not-umx");
		}

		return this.bytes[this.at++];
	}

	skip(count: number): void {
		this.at += count;
	}

	/** `ReadIndexImpl`: a sign and six bits, then seven bits a byte while the top bit is set. */
	index(): number {
		let b = this.byte();
		const negative = (b & 0x80) !== 0;
		let value = b & 0x3f;
		if (b & 0x40) {
			let shift = 6;
			do {
				b = this.byte();
				value += (b & 0x7f) * 2 ** shift;
				shift += 7;
			} while (b & 0x80 && shift < 32);
		}

		return negative ? -value : value;
	}

	/** A NUL-terminated string, lowercased as OpenMPT compares names. */
	name(): string {
		let out = "";
		for (let c = this.byte(); c !== 0; c = this.byte()) {
			out += String.fromCharCode(c >= 0x41 && c <= 0x5a ? c + 0x20 : c);
		}

		return out;
	}
}

/** The bytes of every `Music` object, in export order. */
function musicObjects(bytes: Uint8Array, header: Header): Uint8Array[] {
	const { version } = header;
	const r = new Reader(bytes, header.nameOffset);
	const names: string[] = [];
	for (let i = 0; i < header.nameCount; i++) {
		if (version >= 64) {
			r.index();
		}

		names.push(r.name());
		r.skip(4);
	}

	r.at = header.importOffset;
	const imports: string[] = [];
	for (let i = 0; i < header.importCount; i++) {
		r.index();
		r.index();
		if (version >= 60) {
			r.skip(4);
		} else {
			r.index();
		}

		imports.push(names[r.index()] ?? "");
	}

	r.at = header.exportOffset;
	const found: Uint8Array[] = [];
	for (let i = 0; i < header.exportCount; i++) {
		// The class is an import, written as -1 - its index.
		const cls = imports[-1 - r.index()];
		r.index();
		if (version >= 60) {
			r.skip(4);
		}

		r.index();
		r.skip(4);
		const size = r.index();
		const offset = size > 0 ? r.index() : 0;
		if (cls !== "music" || offset <= HEADER_BYTES || offset >= bytes.length) {
			continue;
		}

		const o = new Reader(bytes, offset);
		if (version < 40) {
			o.skip(8);
		}

		if (version < 60) {
			o.skip(16);
		}

		// The property list, which for music is only its terminating `None`.
		o.index();
		if (version >= 120) {
			o.index();
			o.skip(8);
		} else if (version >= 100) {
			o.skip(4);
			o.index();
			o.skip(4);
		} else if (version >= 62) {
			// `UMXTools.cpp`: Mech8.umx and others are 62, though Unreal's own source says 63.
			o.index();
			o.skip(4);
		} else {
			o.index();
		}

		const length = o.index();
		if (length > 0 && o.at < bytes.length) {
			found.push(bytes.subarray(o.at, Math.min(bytes.length, o.at + length)));
		}
	}

	return found;
}

/**
 * The tracker module inside a package: the first `Music` object that holds one. Throws
 * {@link UmxError}: `not-umx` for a damaged package, `no-music` where it has no music, `audio`
 * where its music is sampled audio (MP2, Ogg, WAV) rather than a module.
 */
export function unwrapUmx(bytes: Uint8Array): UmxModule {
	const header = headerOf(bytes);
	if (!header) {
		throw new UmxError("not-umx");
	}

	let objects: Uint8Array[];
	try {
		objects = musicObjects(bytes, header);
	} catch (error) {
		if (error instanceof UmxError) {
			throw error;
		}

		throw new UmxError("not-umx");
	}

	if (objects.length === 0) {
		throw new UmxError("no-music");
	}

	for (const object of objects) {
		const format = trackerFormatOf(object);
		if (format) {
			return { format, bytes: object };
		}
	}

	throw new UmxError("audio");
}
