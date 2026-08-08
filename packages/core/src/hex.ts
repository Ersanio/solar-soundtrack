/**
 * Hex formatting, upper case throughout — the notation AddmusicK, the readme and
 * this editor all write bytes in.
 *
 * `spc/` states these again rather than importing them, for the same reason it
 * states `BANK_SLOT_COUNT` again: that package depends on nothing.
 */

/** As many digits as the value needs. */
export function hex(value: number): string {
	return value.toString(16).toUpperCase();
}

/** A byte. */
export function hex2(value: number): string {
	return hex(value).padStart(2, "0");
}

/** An ARAM address. */
export function hex4(value: number): string {
	return hex(value).padStart(4, "0");
}
