/** `walktest`: both packages agree on how long a command is. */

import "../localize";
import { FIRST_VCMD, LAST_VCMD } from "@amk/core/hardcoded-tables";
import { expectedArgs } from "@amk/tokens";
import { vcmdLength } from "@amk/spc/song-walk";
import { check, section } from "../harness";
import { DEFAULT_TARGET } from "./support";

// ---------------------------------------------------------------------------
section("both packages agree on how long a command is");
// ---------------------------------------------------------------------------
{
	const args = (values: number[]) => values.map((value) => ({ value }));

	let mismatched = "";
	for (let vcmd = FIRST_VCMD; vcmd <= LAST_VCMD; vcmd++) {
		if (vcmd === 0xfa || vcmd === 0xfb) {
			continue; // Both are variable, and get their own checks below.
		}

		const bytes = Uint8Array.from([vcmd, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		const expected = (expectedArgs(vcmd, args([0, 0, 0, 0, 0, 0, 0, 0]), DEFAULT_TARGET) ?? -1) + 1;
		if (vcmdLength(bytes, 0) !== expected) {
			mismatched += ` $${vcmd.toString(16)}(${vcmdLength(bytes, 0)}!=${expected})`;
		}
	}

	check("every fixed-length VCMD matches expectedArgs", mismatched === "", mismatched);

	let arpeggio = "";
	for (const count of [0x00, 0x01, 0x03, 0x7f, 0x80, 0xff]) {
		const bytes = Uint8Array.from([0xfb, count, ...new Array<number>(count + 4).fill(0x80)]);
		const expected = (expectedArgs(0xfb, args([count]), DEFAULT_TARGET) ?? -1) + 1;
		if (vcmdLength(bytes, 0) !== expected) {
			arpeggio += ` $${count.toString(16)}(${vcmdLength(bytes, 0)}!=${expected})`;
		}
	}

	check("$FB matches expectedArgs at every count", arpeggio === "", arpeggio);

	// `$FA $FE`'s hot patch takes one further byte for every trailing byte whose
	// high bit is set — a flat 3 is right only for a chain of one.
	let hotPatch = "";
	for (const chain of [[0x05], [0x80, 0x05], [0x80, 0x80, 0x05], [0x80, 0x80, 0x80, 0x05]]) {
		const bytes = Uint8Array.from([0xfa, 0xfe, ...chain, 0x00, 0x00]);
		const expected = (expectedArgs(0xfa, args([0xfe, ...chain]), DEFAULT_TARGET) ?? -1) + 1;
		if (vcmdLength(bytes, 0) !== expected) {
			hotPatch += ` [${chain.length}](${vcmdLength(bytes, 0)}!=${expected})`;
		}
	}

	check("$FA $FE matches expectedArgs at every chain length", hotPatch === "", hotPatch);
	check("a plain $FA is three bytes", vcmdLength(Uint8Array.from([0xfa, 0x06, 0x01]), 0) === 3);
	check("a byte that is not a VCMD has no length", vcmdLength(Uint8Array.from([0x80]), 0) === 0);
}
