/**
 * Which importer can read a file, from its first bytes rather than its name.
 *
 * Each format is recognised by its own signature, so a `.mid` renamed `.bin` still opens and a
 * file that is not one is turned away before any reader sees it.
 */

import { isMod } from "./mod/file";
import { isUmx } from "./umx";

/** The formats there is a reader for. */
export type ImportFormat = "midi" | "mod" | "umx";

function ascii(bytes: Uint8Array, at: number, text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		if (bytes[at + i] !== text.charCodeAt(i)) {
			return false;
		}
	}

	return true;
}

/**
 * The Standard MIDI File inside `bytes`: the file itself, or the `data` chunk of a RIFF `RMID`
 * wrapper. `null` when there is none.
 */
export function smfBytes(bytes: Uint8Array): Uint8Array | null {
	if (ascii(bytes, 0, "MThd")) {
		return bytes;
	}

	if (!ascii(bytes, 0, "RIFF") || !ascii(bytes, 8, "RMID")) {
		return null;
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let at = 12;
	while (at + 8 <= bytes.length) {
		const size = view.getUint32(at + 4, true);
		if (ascii(bytes, at, "data")) {
			const inner = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + size));
			return ascii(inner, 0, "MThd") ? inner : null;
		}

		at += 8 + size + (size & 1);
	}

	return null;
}

/** The format `bytes` are in, or `null` when no importer reads them. */
export function detectFormat(bytes: Uint8Array): ImportFormat | null {
	if (smfBytes(bytes)) {
		return "midi";
	}

	if (isUmx(bytes)) {
		return "umx";
	}

	return isMod(bytes) ? "mod" : null;
}
