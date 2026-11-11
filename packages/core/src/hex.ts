/**
 * Uppercase hex: bare, padded to a byte (`hex2`) or to a word (`hex4`), and the
 * `$XX` spelling MML writes a byte in.
 */

export function hex(value: number): string {
	return value.toString(16).toUpperCase();
}

export function hex2(value: number): string {
	return hex(value).padStart(2, "0");
}

export function hex4(value: number): string {
	return hex(value).padStart(4, "0");
}

/** A byte as MML writes it: `$XX`. */
export function dollarHex(byte: number): string {
	return `$${hex2(byte)}`;
}

/** Bytes as MML writes a run of them: `$XX $YY …`. */
export function hexBytes(bytes: readonly number[]): string {
	return bytes.map((byte) => dollarHex(byte)).join(" ");
}
