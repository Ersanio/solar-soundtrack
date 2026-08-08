/**
 * Hex formatting, upper case throughout — the notation AddmusicK, the readme and
 * this editor all write bytes in.
 *
 * The one copy: `@amk/spc` imports these rather than restating them, unlike
 * `BANK_SLOT_COUNT`, because it already depends on this package for `SongTags`
 * and formatting a byte is not a fact about AddmusicK to be stated twice.
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
