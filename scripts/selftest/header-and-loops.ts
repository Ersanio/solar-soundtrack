/**
 * `selftest`: the header with an intro and under `#noloop`, loop and label-loop
 * pointers, and relocation to the ARAM address.
 */

import "../localize";
import { check, section } from "../harness";
import { compile, hex } from "./support";

section("intro changes the header shape");
{
	const result = compile("#amk 4\n#0 o4 c4 / d4\n");
	check("compiles", result.ok, result.diagnostics.map((d) => d.message).join("; "));
	// add = 2 + 2 + 4 = 8, size = 20 + 18 + 2 = 40.
	check("header is 40 bytes", result.stats?.headerSize === 40, `got ${result.stats?.headerSize}`);
	check("hasIntro", result.stats?.hasIntro === true);
	if (result.data) {
		const view = new DataView(result.data.buffer, result.data.byteOffset);
		// Word 0 points at each channel's start, the intro; word 1 at the part after
		// `/`, which the loop returns to (Music.cpp:3159-3163, :3166, :3185).
		check(
			"word 0 -> intro pointer block",
			view.getUint16(0, true) === 0x3e00 + 8,
			`got ${view.getUint16(0, true).toString(16)}`,
		);
		check(
			"word 1 -> main pointer block",
			view.getUint16(2, true) === 0x3e00 + 8 + 16,
			`got ${view.getUint16(2, true).toString(16)}`,
		);
		check("loop marker", view.getUint16(4, true) === 0x00ff);
		check("loop target = base + 2", view.getUint16(6, true) === 0x3e02);
	}
}

section("noloop drops the loop words");
{
	const result = compile("#amk 4\n#0 o4 c4 ?\n");
	check("header is 20 bytes", result.stats?.headerSize === 20, `got ${result.stats?.headerSize}`);
	check("does not loop", result.stats?.loops === false);
}

section("loops relocate their pointers");
{
	const result = compile("#amk 4\n#0 o4 [c4 d4]4\n");
	check("compiles", result.ok, result.diagnostics.map((d) => d.message).join("; "));
	if (result.data) {
		// The $E9 call is at the end of channel 0, followed by a little-endian
		// pointer into the loop block and the repeat count.
		const bytes = [...result.data];
		const e9 = bytes.lastIndexOf(0xe9);
		check("emits $E9 call", e9 !== -1);
		const target = bytes[e9 + 1] | (bytes[e9 + 2] << 8);
		const loopBlockStart = 0x3e00 + result.stats!.headerSize + result.stats!.channelSizes.reduce((a, b) => a + b, 0);
		check(
			"loop pointer targets the loop block",
			target === loopBlockStart,
			`expected 0x${loopBlockStart.toString(16)}, got 0x${target.toString(16)}`,
		);
		check("repeat count", bytes[e9 + 3] === 4, `got ${bytes[e9 + 3]}`);
	}
}

section("label loops");
{
	const result = compile("#amk 4\n#0 o4 (1)[c4 d4]2 (1)3\n");
	check("compiles", result.ok, result.diagnostics.map((d) => d.message).join("; "));
	const undefinedLabel = compile("#amk 4\n#0 o4 (9)2\n");
	check("undefined label is rejected", !undefinedLabel.ok);
	check(
		"undefined label reports AMK0115",
		undefinedLabel.diagnostics.some((d) => d.code === "AMK0115"),
		undefinedLabel.diagnostics.map((d) => d.code).join(", "),
	);
}

section("relocation follows the ARAM address");
{
	const a = compile("#amk 4\n#0 o4 [c4]2\n", 0x3e00);
	const b = compile("#amk 4\n#0 o4 [c4]2\n", 0x4000);
	check("both compile", a.ok && b.ok);
	if (a.data && b.data) {
		const delta = 0x4000 - 0x3e00;
		const wordA = a.data[0] | (a.data[1] << 8);
		const wordB = b.data[0] | (b.data[1] << 8);
		check("header pointer shifts", wordB - wordA === delta, `${wordA.toString(16)} vs ${wordB.toString(16)}`);

		// The song pointer, the loop target, channel 0's pointer and the $E9 call's target.
		const pointers = [0, 4, 6, [...a.data].lastIndexOf(0xe9) + 1];
		const word = (data: Uint8Array, at: number) => data[at] | (data[at + 1] << 8);
		check(
			"every pointer shifts",
			pointers.every((at) => word(b.data!, at) - word(a.data!, at) === delta),
			pointers.map((at) => `${word(a.data!, at).toString(16)} vs ${word(b.data!, at).toString(16)}`).join(", "),
		);
		const rest = (data: Uint8Array) => data.filter((_, i) => !pointers.some((at) => i === at || i === at + 1));
		check("body is otherwise identical", hex(rest(a.data)) === hex(rest(b.data)), `${hex(a.data)}\n${hex(b.data)}`);
	}
}
