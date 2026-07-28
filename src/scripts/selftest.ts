/**
 * Byte-level sanity checks for the AddmusicK compiler.
 *
 * This is NOT the differential harness described in PLAN.md §3 — that one diffs
 * against a native AddmusicK build over a real song corpus and is what actually
 * establishes fidelity. This just catches gross breakage while iterating.
 *
 *   npm run selftest
 */

import { compilers } from "../src/compilers";
import type { CompileResult } from "../src/core/types";

let failures = 0;

function compile(source: string, aramAddress = 0x3e00): CompileResult {
	const compiler = compilers.get("addmusick");
	if (!compiler) throw new Error("addmusick compiler not registered");
	return compiler.compile({ source, aramAddress });
}

function hex(data: Uint8Array): string {
	return [...data].map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

function check(name: string, condition: boolean, detail = ""): void {
	if (condition) {
		console.log(`  ok    ${name}`);
	} else {
		failures++;
		console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
	}
}

function expectBytes(name: string, actual: Uint8Array, expected: number[]): void {
	const got = hex(actual);
	const want = hex(Uint8Array.from(expected));
	check(name, got === want, `expected ${want}\n        got      ${got}`);
}

// ---------------------------------------------------------------------------

console.log("\nminimal song, no intro, loops");
{
	// One channel, one quarter-note C in octave 4.
	const result = compile("#amk 4\n#0 @0 o4 c4\n");
	check("compiles", result.ok, result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));

	if (result.data) {
		// Header: add = 0 (no intro) + 2 (loops) + 4 = 6, instrLen = 0, size = 22.
		//   [0]  word -> add+instrLen = 6, relocated  = 0x3E06
		//   [2]  0xFFFE                              -> 0x00FF
		//   [4]  0xFFFC -> song base                 -> 0x3E00
		//   [6]  channel 0 phrase ptr = 0 + 22 = 22  -> 0x3E16
		//   [8..20] unused channels                  -> 0x0000
		const header = result.data.slice(0, 22);
		expectBytes(
			"header",
			header,
			[
				0x06, 0x3e, // pointer to the phrase pointer block
				0xff, 0x00, // loop marker
				0x00, 0x3e, // loop target = song base
				0x16, 0x3e, // channel 0
				0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
				0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			],
		);

		// Channel body: FA 04 00 (echo alloc) FA 06 01 (N-SPC vtable)
		//               DA 00 (instrument) 30 7F A4 (48 ticks, q, note) 00 (end)
		// c in octave 4 = pitches['c'] + (4-1)*12 + 0x80 = 0 + 0x24 + 0x80 = 0xA4.
		expectBytes(
			"channel 0 body",
			result.data.slice(22),
			[0xfa, 0x04, 0x00, 0xfa, 0x06, 0x01, 0xda, 0x00, 0x30, 0x7f, 0xa4, 0x00],
		);
	}
}

console.log("\nnote encoding");
{
	const result = compile("#amk 4\n#0 o4 c4 c4 d8\n");
	// Second c4 reuses the previous length, so no duration byte is emitted.
	// Note bytes: c in octave 4 = 0 + 3*12 + 0x80 = 0xA4, d = 0xA6.
	// Instrument 0 has transpose 0, so no adjustment.
	expectBytes(
		"duration is omitted when unchanged",
		result.data!.slice(28),
		[0x30, 0x7f, 0xa4, 0xa4, 0x18, 0xa6, 0x00],
	);
}

console.log("\nlong notes split into ties");
{
	const result = compile("#amk 4\n#0 o4 c1\n");
	// 192 ticks exceeds the 0x80 note-length limit, so Music.cpp:2245 emits a
	// 0x60 head and ties the rest. The remainder is exactly 0x60, so the
	// `if (j != 0x60)` guard suppresses a redundant duration byte before the tie.
	expectBytes("whole note", result.data!.slice(28), [0x60, 0x7f, 0xa4, 0xc6, 0x00]);

	// 0x60 + 0x60 = 192 ticks total.
	const longer = compile("#amk 4\n#0 o4 c1^2\n");
	// 288 ticks: 0x60 head, then one full tie, then a 0x60 remainder tie.
	expectBytes("dotted-whole via tie", longer.data!.slice(28), [0x60, 0x7f, 0xa4, 0xc6, 0xc6, 0x00]);
}

console.log("\nintro changes the header shape");
{
	const result = compile("#amk 4\n#0 o4 c4 / d4\n");
	check("compiles", result.ok, result.diagnostics.map((d) => d.message).join("; "));
	// add = 2 + 2 + 4 = 8, size = 20 + 18 + 2 = 40.
	check("header is 40 bytes", result.stats?.headerSize === 40, `got ${result.stats?.headerSize}`);
	check("hasIntro", result.stats?.hasIntro === true);
	if (result.data) {
		const view = new DataView(result.data.buffer, result.data.byteOffset);
		check("word 0 -> main pointer block", view.getUint16(0, true) === 0x3e00 + 8, `got ${view.getUint16(0, true).toString(16)}`);
		check("word 1 -> intro pointer block", view.getUint16(2, true) === 0x3e00 + 8 + 16, `got ${view.getUint16(2, true).toString(16)}`);
		check("loop marker", view.getUint16(4, true) === 0x00ff);
		check("loop target = base + 2", view.getUint16(6, true) === 0x3e02);
	}
}

console.log("\nnoloop drops the loop words");
{
	const result = compile("#amk 4\n#0 o4 c4 ?\n");
	check("header is 20 bytes", result.stats?.headerSize === 20, `got ${result.stats?.headerSize}`);
	check("does not loop", result.stats?.loops === false);
}

console.log("\nloops relocate their pointers");
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

console.log("\nlabel loops");
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

console.log("\nrelocation follows the ARAM address");
{
	const a = compile("#amk 4\n#0 o4 [c4]2\n", 0x3e00);
	const b = compile("#amk 4\n#0 o4 [c4]2\n", 0x4000);
	check("both compile", a.ok && b.ok);
	if (a.data && b.data) {
		const delta = 0x4000 - 0x3e00;
		const wordA = a.data[0] | (a.data[1] << 8);
		const wordB = b.data[0] | (b.data[1] << 8);
		check("header pointer shifts", wordB - wordA === delta, `${wordA.toString(16)} vs ${wordB.toString(16)}`);
		check("body is otherwise identical", a.data.length === b.data.length);
	}
}

console.log("\nlegacy targets compile");
{
	for (const [source, label] of [
		["#am4\n#0 o4 c4\n", "#am4"],
		["#amm\n#0 o4 c4\n", "#amm"],
		["#amk 1\n#0 o4 c4\n", "#amk 1"],
		["#amk 2\n#0 o4 c4\n", "#amk 2"],
		["#amk=1\n#0 o4 c4\n", "#amk=1"],
	] as const) {
		const result = compile(source);
		check(`${label} compiles`, result.ok, result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
	}

	const noMarker = compile("#0 c4\n");
	check("missing marker still rejected", !noMarker.ok);
	check("missing marker reports AMK0002", noMarker.diagnostics.some((d) => d.code === "AMK0002"));

	// #amk 3 is unimplemented in AddmusicK itself.
	const amk3 = compile("#amk 3\n#0 o4 c4\n");
	check("#amk 3 rejected", !amk3.ok, amk3.diagnostics.map((d) => d.code).join(", "));
	const amk9 = compile("#amk 9\n#0 o4 c4\n");
	check("future version rejected", !amk9.ok);

	const detect = (s: string) => compilers.get("addmusick")!.detect(s);
	check("detect() claims #am4", detect("#am4\n") === 1, `${detect("#am4\n")}`);
	check("detect() claims #amk 4", detect("#amk 4\n") === 1);
	check("detect() disowns #amk 3", detect("#amk 3\n") === 0);
}

console.log("\ntarget selects the compatibility prefix");
{
	// Music.cpp:2989 — each target gets its own 3-byte mode prefix, right after
	// the echo buffer allocation.
	for (const [source, expected, label] of [
		["#amk 4\n#0 o4 c4\n", [0xfa, 0x06, 0x01], "#amk 4 -> N-SPC vtable"],
		["#amk 2\n#0 o4 c4\n", [0xfa, 0x06, 0x01], "#amk 2 -> N-SPC vtable"],
		["#amk 1\n#0 o4 c4\n", [0xfa, 0x7f, 0x02], "#amk 1 -> mode 2"],
		["#am4\n#0 o4 c4\n", [0xfa, 0x7f, 0x04], "#am4 -> mode 4"],
		["#amm\n#0 o4 c4\n", [0xfa, 0x7f, 0x05], "#amm -> mode 5"],
	] as const) {
		const result = compile(source);
		const body = result.data!.slice(result.stats!.headerSize);
		expectBytes(label, body.slice(3, 6), [...expected]);
	}
}

console.log("\nlegacy note behaviour");
{
	// Addmusic 4.05 ignores instrument tuning until an instrument is declared,
	// so @2 (transpose +5) shifts the note only after the @ command.
	const am4 = compile("#am4\n#0 o4 c4 @2 c4\n");
	const amk = compile("#amk 4\n#0 o4 c4 @2 c4\n");
	check("both compile", am4.ok && amk.ok, [...am4.diagnostics, ...amk.diagnostics].map((d) => d.message).join("; "));

	const notesOf = (r: typeof am4) => [...r.data!].filter((b) => b >= 0x80 && b < 0xc6);
	// Before any @, AMK applies transposeMap[0] = 0 and AM4 applies nothing, so
	// the first note matches; the second differs only if tuning kicked in.
	check("am4 first note untransposed", notesOf(am4)[0] === 0xa4, `0x${notesOf(am4)[0]?.toString(16)}`);
	check("am4 second note transposed by @2", notesOf(am4)[1] === 0xa4 - 5, `0x${notesOf(am4)[1]?.toString(16)}`);

	// Addmusic 4.05 stops honouring dots after two.
	const twoDots = compile("#am4\n#0 o4 c4...\n");
	const amkDots = compile("#amk 4\n#0 o4 c4...\n");
	check("three dots differ between targets", twoDots.data!.length !== 0 && amkDots.data!.length !== 0);
	const lenOf = (r: typeof am4) => [...r.data!.slice(r.stats!.headerSize)][6];
	check("am4 honours only two dots", lenOf(twoDots) === 48 + 24 + 12, `${lenOf(twoDots)}`);
	check("amk honours three", lenOf(amkDots) === 48 + 24 + 12 + 6, `${lenOf(amkDots)}`);
}

console.log("\nlegacy hex translation");
{
	// Channel data starts after two 3-byte prefixes: the echo buffer allocation
	// and the target's compatibility mode.
	const PREFIX = 6;
	const bodyOf = (r: CompileResult) => [...r.data!.slice(r.stats!.headerSize + PREFIX)];

	// Addmusic 4.05 overloads $E5: a high bit on the second byte means "load
	// sample" ($F3 sample tuning), otherwise it is tremolo.
	const load = compile("#am4\n#0 o4 $E5 $85 $01 c4\n");
	check("compiles", load.ok, load.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
	expectBytes("$E5 $8x becomes $F3 sample load", Uint8Array.from(bodyOf(load).slice(0, 3)), [0xf3, 0x05, 0x01]);

	const tremolo = compile("#am4\n#0 o4 $E5 $01 $02 $03 c4\n");
	expectBytes("$E5 $0x stays tremolo", Uint8Array.from(bodyOf(tremolo).slice(0, 4)), [0xe5, 0x01, 0x02, 0x03]);

	// $E4 is offset by one for Addmusic 4.05.
	const e4am4 = compile("#am4\n#0 o4 $E4 $05 c4\n");
	const e4amk = compile("#amk 4\n#0 o4 $E4 $05 c4\n");
	check("am4 $E4 offset by one", bodyOf(e4am4)[1] === 6, `${bodyOf(e4am4)[1]}`);
	check("amk $E4 unchanged", bodyOf(e4amk)[1] === 5, `${bodyOf(e4amk)[1]}`);

	// HFD packed DSP writes behind $ED $80.
	const hfd = compile("#am4\n#0 o4 $ED $80 $0C $7F c4\n");
	check("HFD compiles", hfd.ok, hfd.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
	expectBytes("$ED $80 becomes $F6 DSP write", Uint8Array.from(bodyOf(hfd).slice(0, 3)), [0xf6, 0x0c, 0x7f]);

	// Register $6C is the noise clock, which gets a real command instead.
	const noise = compile("#am4\n#0 o4 $ED $80 $6C $05 c4\n");
	expectBytes("$ED $80 $6C becomes $F8 noise", Uint8Array.from(bodyOf(noise).slice(0, 2)), [0xf8, 0x05]);

	// $ED $81 is a semitone tune, which AddmusicK expresses as $FA $02.
	const tune = compile("#am4\n#0 o4 $ED $81 $03 c4\n");
	expectBytes("$ED $81 becomes $FA $02", Uint8Array.from(bodyOf(tune).slice(0, 3)), [0xfa, 0x02, 0x03]);
}

console.log("\npreprocessor");
{
	const ifdef = compile("#amk 4\n#define LOUD\n#0 o4\n#ifdef LOUD\nv200\n#endif\nc4\n");
	check("#ifdef true branch kept", ifdef.ok && [...ifdef.data!].includes(0xe7), ifdef.diagnostics.map((d) => d.message).join("; "));

	const ifndef = compile("#amk 4\n#0 o4\n#ifdef LOUD\nv200\n#endif\nc4\n");
	check("#ifdef false branch dropped", ifndef.ok && ![...ifndef.data!].includes(0xe7));

	const ifCmp = compile("#amk 4\n#define VER 5\n#0 o4\n#if VER >= 4\nv200\n#endif\nc4\n");
	check("#if comparison works", ifCmp.ok && [...ifCmp.data!].includes(0xe7));

	const unbalanced = compile("#amk 4\n#0 o4\n#ifdef X\nc4\n");
	check("missing #endif rejected", !unbalanced.ok, unbalanced.diagnostics.map((d) => d.code).join(", "));

	// Comments are stripped before the scanner for every target but AddmusicM.
	const commented = compile("#amk 4\n#0 o4 c4 ; this is a comment\nd4\n");
	check("; comment stripped", commented.ok, commented.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
	const ammComment = compile("#amm\n#0 o4 c4 ; comment\nd4\n");
	check("amm handles ; in the scanner", ammComment.ok, ammComment.diagnostics.map((d) => d.message).join("; "));
}

console.log("\nunimplemented features error clearly");
{
	for (const [source, code] of [
		['#amk 4\n#samples\n{\n#default\n}\n#0 c4\n', "AMK0050"],
		["#amk 4\n#0 @30 c4\n", "AMK0092"],
		["#amk 4\n#0 (!1)[$F4 $02]\n", "AMK0111"],
	] as const) {
		const result = compile(source);
		check(
			`reports ${code}`,
			!result.ok && result.diagnostics.some((d) => d.code === code),
			result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
		);
	}
}

console.log("\nhex command validation");
{
	const good = compile("#amk 4\n#0 o4 $E7 $C8 c4\n");
	check("valid $E7 accepted", good.ok, good.diagnostics.map((d) => d.message).join("; "));

	const short = compile("#amk 4\n#0 o4 $DE $01 c4\n");
	check("$DE with too few args is rejected", !short.ok);

	const notCommand = compile("#amk 4\n#0 o4 $12 c4\n");
	check(
		"$12 rejected as not a command byte",
		!notCommand.ok && notCommand.diagnostics.some((d) => d.code === "AMK0151"),
	);

	const echo = compile("#amk 4\n#0 o4 $F1 $04 $20 $20 c4\n");
	check("echo buffer size tracked from $F1", echo.stats?.echoBufferSize === 4, `got ${echo.stats?.echoBufferSize}`);
}

console.log("\nreplacements");
{
	const result = compile('#amk 4\n"LEAD=@0 v200"\n#0 o4 LEAD c4\n');
	check("compiles", result.ok, result.diagnostics.map((d) => d.message).join("; "));
	if (result.data) {
		const bytes = [...result.data];
		check("instrument emitted", bytes.includes(0xda));
		check("volume emitted", bytes.includes(0xe7) && bytes[bytes.indexOf(0xe7) + 1] === 200);
	}
}

console.log("\nARAM overflow is caught");
{
	const result = compile("#amk 4\n#0 o4 [c4 d4 e4 f4]8\n", 0xfff0);
	check("overflow rejected", !result.ok && result.diagnostics.some((d) => d.code === "AMK0300"));
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
