/**
 * What the `selftest` sections share: `compile`, the stand-in sample library,
 * and `hex` and `expectBytes` for comparing emitted bytes.
 */

import "../localize";
import { compiler } from "@amk/compiler";
import type { CompileResult } from "@amk/core/types";
import { check } from "../harness";

export function compile(source: string, aramAddress = 0x3e00, options?: Record<string, unknown>): CompileResult {
	return compiler.compile({ source, aramAddress, options });
}

/**
 * A stand-in sample library, so `#samples` can be exercised without dragging in
 * the driver bundle. Twenty names for `#default`, mirroring the real manifest's
 * shape, plus a couple of extras to reference by hand.
 */
export const STOCK = Array.from(
	{ length: 20 },
	(_, index) => `${index.toString(16).toUpperCase().padStart(2, "0")} SMW.brr`,
);
export const LIBRARY = {
	sampleNames: [...STOCK, "kick.brr", "snare.brr", "drums/snare.brr", "zelda.bnk"],
	sampleGroups: { default: STOCK, optimized: STOCK.slice(0, 5) },
};

export function hex(data: Uint8Array): string {
	return [...data].map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

export function expectBytes(name: string, actual: Uint8Array, expected: number[]): void {
	const got = hex(actual);
	const want = hex(Uint8Array.from(expected));
	const length = Math.min(actual.length, expected.length);
	let differs = 0;
	while (differs < length && actual[differs] === (expected[differs] ?? 0) % 256) {
		differs++;
	}

	const lengths =
		actual.length === expected.length ? "" : `, ${expected.length} bytes expected and ${actual.length} got`;
	check(
		name,
		got === want,
		`expected ${want}\n        got      ${got}\n        first differs at byte ${differs}${lengths}`,
	);
}
