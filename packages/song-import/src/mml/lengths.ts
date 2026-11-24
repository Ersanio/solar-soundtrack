/**
 * Note and rest lengths in driver ticks, spelled as MML: whole notes tied to what is left, with a dot
 * only where it halves exactly and `=ticks` otherwise, since a dot that halves an odd count is AMK0200.
 */

import { TICKS_PER_WHOLE } from "@amk/core/hardcoded-tables";

/**
 * A length of any size, as whole notes tied to what is left. The remainder is `N`, `N.` or `N..` only
 * where the dots halve it exactly, and `=ticks` otherwise: a dot that halves an odd count is AMK0200.
 */
export function spellTicks(ticks: number): string {
	const parts: string[] = [];
	let left = ticks;
	while (left > TICKS_PER_WHOLE) {
		parts.push("1");
		left -= TICKS_PER_WHOLE;
	}

	parts.push(oneLength(left));
	return parts.join("^");
}

/** The lengths a rest is tied from, each one a plain or dotted length that halves exactly. */
const REST_PIECES = [192, 144, 96, 72, 48, 36, 24, 18, 12, 9, 6, 3];

/** {@link spellTicks} for a rest, which reads better as up to three common lengths tied: 60 ticks is `4^16`. */
export function spellRestTicks(ticks: number): string {
	const parts: string[] = [];
	let left = ticks;
	while (left > TICKS_PER_WHOLE) {
		parts.push("1");
		left -= TICKS_PER_WHOLE;
	}

	const tied: number[] = [];
	for (const piece of REST_PIECES) {
		while (left >= piece && tied.length < 3) {
			tied.push(piece);
			left -= piece;
		}
	}

	if (left !== 0) {
		return spellTicks(ticks);
	}

	return [...parts, ...tied.map(oneLength)].join("^");
}

function oneLength(ticks: number): string {
	if (TICKS_PER_WHOLE % ticks === 0) {
		return String(TICKS_PER_WHOLE / ticks);
	}

	for (let divisor = 1; divisor <= TICKS_PER_WHOLE; divisor++) {
		const base = TICKS_PER_WHOLE / divisor;
		if (!Number.isInteger(base)) {
			continue;
		}

		if (base % 2 === 0 && (base * 3) / 2 === ticks) {
			return `${divisor}.`;
		}

		if (base % 4 === 0 && (base * 7) / 4 === ticks) {
			return `${divisor}..`;
		}
	}

	return `=${ticks}`;
}
