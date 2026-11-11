/** Reading bytes as numbers: a byte's signed value and back, and a little-endian word. */

/** The signed reading of a byte: `$80`-`$FF` are −128 to −1. */
export function toSigned(value: number): number {
	return value >= 0x80 ? value - 0x100 : value;
}

/** The byte a signed value writes back as: negatives fold into the high half. */
export function fromSigned(value: number): number {
	return value < 0 ? value + 0x100 : value;
}

/** The little-endian word at `at`. */
export function word(bytes: Uint8Array, at: number): number {
	return bytes[at] | (bytes[at + 1] << 8);
}
