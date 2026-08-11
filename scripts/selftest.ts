/**
 * Byte-level sanity checks for the AddmusicK compiler.
 *
 * This is NOT the differential harness — `Compare-Spc.ps1` and `Compare-SongBin.ps1`
 * diff against a native AddmusicK build and are what actually establish fidelity.
 * This just catches gross breakage while iterating.
 *
 *   npm run selftest
 */

import { compiler } from "@amk/compiler";
import type { CompileResult } from "@amk/core/types";

import { check, summarise } from "./harness";

function compile(source: string, aramAddress = 0x3e00, options?: Record<string, unknown>): CompileResult {
	return compiler.compile({ source, aramAddress, options });
}

/**
 * A stand-in sample library, so `#samples` can be exercised without dragging in
 * the driver bundle. Twenty names for `#default`, mirroring the real manifest's
 * shape, plus a couple of extras to reference by hand.
 */
const STOCK = Array.from({ length: 20 }, (_, index) => `${index.toString(16).toUpperCase().padStart(2, "0")} SMW.brr`);
const LIBRARY = {
	sampleNames: [...STOCK, "kick.brr", "drums/snare.brr", "zelda.bnk"],
	sampleGroups: { default: STOCK, optimized: STOCK.slice(0, 5) },
};

function hex(data: Uint8Array): string {
	return [...data].map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
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
		// The pairing is the documentation here — each line is one little-endian
		// word and the comment names it. Prettier puts one byte per line, which
		// separates every word from its own annotation.
		// prettier-ignore
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
	expectBytes("duration is omitted when unchanged", result.data!.slice(28), [0x30, 0x7f, 0xa4, 0xa4, 0x18, 0xa6, 0x00]);
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
		check(
			"word 0 -> main pointer block",
			view.getUint16(0, true) === 0x3e00 + 8,
			`got ${view.getUint16(0, true).toString(16)}`,
		);
		check(
			"word 1 -> intro pointer block",
			view.getUint16(2, true) === 0x3e00 + 8 + 16,
			`got ${view.getUint16(2, true).toString(16)}`,
		);
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
	check(
		"missing marker reports AMK0002",
		noMarker.diagnostics.some((d) => d.code === "AMK0002"),
	);

	// #amk 3 is unimplemented in AddmusicK itself.
	const amk3 = compile("#amk 3\n#0 o4 c4\n");
	check("#amk 3 rejected", !amk3.ok, amk3.diagnostics.map((d) => d.code).join(", "));
	const amk9 = compile("#amk 9\n#0 o4 c4\n");
	check("future version rejected", !amk9.ok);
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

console.log("\ny packs its surround flags into the $DB byte");
{
	// Music.cpp:711-726 — `pan |= i << 7` for the second argument and
	// `pan |= i << 6` for the third, and the readme names them "(left,right)"
	// (`syntax_reference.html:101`). The driver splits the byte back apart with
	// `and a, #$1f` and `and a, #$c0` (`Commands.asm:239-243`), and bit 7 negates
	// the left output where bit 6 negates the right (`main.asm:2866`).
	//
	// Load-bearing: the command inspector reads a written `$DB` byte back into
	// three controls, so swapping the two bits here would silently mirror the
	// wrong speaker.
	for (const [source, expected, label] of [
		["#amk 4\n#0 y10 o4 c4\n", [0xdb, 0x0a], "y10 is a bare pan"],
		["#amk 4\n#0 y10,1,0 o4 c4\n", [0xdb, 0x8a], "left surround is bit 7"],
		["#amk 4\n#0 y10,0,1 o4 c4\n", [0xdb, 0x4a], "right surround is bit 6"],
		["#amk 4\n#0 y10,1,1 o4 c4\n", [0xdb, 0xca], "both is $C0"],
		["#amk 4\n#0 y20,0,0 o4 c4\n", [0xdb, 0x14], "the pan reaches $14, one past the readme's $13"],
		// `if (i > 2)` is the whole check, so 2 compiles — and `2 << 7` is $100,
		// which does not survive the byte. The flag reads as off, not on.
		["#amk 4\n#0 y10,2,0 o4 c4\n", [0xdb, 0x0a], "a second argument of 2 shifts its bit off the byte"],
	] as const) {
		const result = compile(source);
		const body = result.data!.slice(result.stats!.headerSize);
		expectBytes(label, body.slice(6, 8), [...expected]);
	}

	check("y21 is out of range", !compile("#amk 4\n#0 y21 o4 c4\n").ok);
	check("and so is a third argument of 3", !compile("#amk 4\n#0 y10,0,3 o4 c4\n").ok);
	// Music.cpp:718 — the second argument without a third is an error, not a default.
	check("a lone second argument is rejected", !compile("#amk 4\n#0 y10,1 o4 c4\n").ok);
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
	check(
		"#ifdef true branch kept",
		ifdef.ok && [...ifdef.data!].includes(0xe7),
		ifdef.diagnostics.map((d) => d.message).join("; "),
	);

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

console.log("\nnear misses report clearly");
{
	for (const [source, code] of [
		// Every directive form is implemented now; these are the errors people
		// actually hit while writing one.
		["#amk 4\n#0 @30 c4\n", "AMK0092"],
		['#amk 4\n#samples { "x.wav" }\n#0 c4\n', "AMK0056"],
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

console.log("\ndiagnostic spans point into the source the author wrote");
{
	// The parser works on preprocessed text — no `#amk` marker, no `#define`
	// lines, no comments — so a raw buffer offset lands short of where the
	// mistake actually is. These check the mapping back, by requiring that the
	// span picks out the offending text in the *original* string.
	const spanOf = (source: string, code: string) => {
		const found = compile(source).diagnostics.find((d) => d.code === code);
		return found ? { ...found.span, text: source.slice(found.span.start, found.span.end) } : null;
	};

	// There is no "nothing was removed" control to compare against: a target
	// marker is mandatory, and a song without one stops at AMK0002 long before
	// the scanner runs. So the check is against the exact index instead.
	//
	// `%` is not valid MML; AMK0100 reports the character it choked on. Here it
	// sits at 16, and the marker preprocessing removes is 7 characters — so
	// before this mapping existed the span said 9, pointing at the `4` of `o4`.
	const source = "#amk 4\n#0 o4 c4 % d4\n";
	const marked = spanOf(source, "AMK0100");
	check("the #amk marker is accounted for", marked?.text === "%", JSON.stringify(marked));
	check("the offset is exact", marked?.start === source.indexOf("%"), `${marked?.start} vs ${source.indexOf("%")}`);
	check("and the line is right", marked?.line === 2, String(marked?.line));

	// The more the preprocessor removes, the further the old spans drifted.
	const heavy = "#amk 4\n#define A 1\n#define B 2\n; a comment line\n#0 o4 c4 % d4\n";
	const drifted = spanOf(heavy, "AMK0100");
	check("a heavily preprocessed song still lands", drifted?.text === "%", JSON.stringify(drifted));
	check("exactly", drifted?.start === heavy.indexOf("%"), `${drifted?.start} vs ${heavy.indexOf("%")}`);

	// Comments are stripped wholesale, so anything after one on the same line
	// used to drift by the comment's length.
	const commented = spanOf("#amk 4\n#0 o4 ; a comment\nc4 % d4\n", "AMK0100");
	check("stripped comments are accounted for", commented?.text === "%", JSON.stringify(commented));
	check("on the line after the comment", commented?.line === 3, String(commented?.line));

	// A whole `#define` line vanishes, and so does the untaken side of an `#if`.
	const defined = spanOf("#amk 4\n#define FOO 1\n#ifdef BAR\no4 c4\n#endif\n#0 o4 % d4\n", "AMK0100");
	check("#define and a false branch are accounted for", defined?.text === "%", JSON.stringify(defined));

	// Text that came from a replacement has no source of its own, so it reports
	// at the use site — which must still be inside the document.
	const useSource = '#amk 4\n"BAD=%"\n#0 o4 BAD d4\n';
	const expanded = compile(useSource).diagnostics.find((d) => d.code === "AMK0100");
	check("an expanded replacement reports somewhere real", expanded !== undefined);
	check(
		"inside the document, not past it",
		expanded !== undefined && expanded.span.start >= 0 && expanded.span.end <= useSource.length,
		JSON.stringify(expanded?.span),
	);
	check(
		"and at the use site rather than the definition",
		expanded !== undefined && expanded.span.start >= useSource.indexOf("BAD d4"),
		`${expanded?.span.start} vs ${useSource.indexOf("BAD d4")}`,
	);

	// Every diagnostic from a realistic song must be selectable.
	const messy = "#amk 4\n; header\n#define X 2\n#0 o4 c4 % d4 & e4\n#1 o4 %% c4\n";
	for (const diagnostic of compile(messy).diagnostics) {
		check(
			`${diagnostic.code} span is inside the source`,
			diagnostic.span.start >= 0 && diagnostic.span.end <= messy.length && diagnostic.span.start <= diagnostic.span.end,
			JSON.stringify(diagnostic.span),
		);
		const upTo = messy.slice(0, diagnostic.span.start);
		check(
			`${diagnostic.code} line matches its offset`,
			diagnostic.span.line === upTo.split("\n").length,
			`line ${diagnostic.span.line}, offset says ${upTo.split("\n").length}`,
		);
	}
}

console.log("\nARAM overflow is caught");
{
	const result = compile("#amk 4\n#0 o4 [c4 d4 e4 f4]8\n", 0xfff0);
	check("overflow rejected", !result.ok && result.diagnostics.some((d) => d.code === "AMK0300"));
}

console.log("\nparity fixes against AddmusicKsrc");
{
	// Music.cpp:535 — `?1` and `?2` set `noMusic[][]`, which the reference never
	// reads. Only `?` and `?0` stop the song looping. Before the digit was
	// consumed, `?1` both killed the loop and left a stray `1` behind.
	const bare = compile("#amk 4\n#0 ? o4 c4\n");
	const zero = compile("#amk 4\n#0 ?0 o4 c4\n");
	const one = compile("#amk 4\n#0 ?1 o4 c4\n");
	const two = compile("#amk 4\n#0 ?2 o4 c4\n");
	check("? compiles", bare.ok, bare.diagnostics.map((d) => d.message).join("; "));
	check(
		"?1 compiles with no stray-character diagnostic",
		one.ok && one.diagnostics.length === 0,
		one.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);
	check("? stops the song looping", bare.stats?.loops === false);
	check("?0 stops the song looping", zero.stats?.loops === false);
	check("?1 leaves looping alone", one.stats?.loops === true, `loops=${one.stats?.loops}`);
	check("?2 leaves looping alone", two.stats?.loops === true, `loops=${two.stats?.loops}`);

	// Music.cpp:1217 guards this with a lookbehind that can never be true, so
	// the reference compiles a subloop inside a label-loop definition.
	const labelSubloop = compile("#amk 4\n#0 o4 (5)[ c4 [[d4]]4 ]\n");
	check(
		"a subloop inside a label loop compiles, as in AMK",
		labelSubloop.ok,
		labelSubloop.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);

	// Music.cpp:3493 — a declared length must switch guessing off, or the
	// estimate wins and the declared value is recorded but never used.
	const declared = compile('#amk 4\n#spc { #length "1:30" }\n#0 o4 c4\n');
	check('#length "1:30" is 90 seconds', declared.stats?.tagSeconds === 90, `${declared.stats?.tagSeconds}`);
	// AMK leaves intro/main at zero for a declared length, so its own readout
	// prints 0:00. We report what the author wrote instead; the tag is untouched.
	check(
		"a declared #length is also the play length",
		declared.stats?.introSeconds === 90 && declared.stats?.mainSeconds === 0,
		`${declared.stats?.introSeconds}+${declared.stats?.mainSeconds}`,
	);
	const auto = compile('#amk 4\n#spc { #length "auto" }\n#0 o4 c1 c1 c1\n');
	check('#length "auto" still estimates', (auto.stats?.tagSeconds ?? 0) > 0, `${auto.stats?.tagSeconds}`);
	const badLength = compile('#amk 4\n#spc { #length "90" }\n#0 o4 c4\n');
	check("a malformed #length is rejected", !badLength.ok && badLength.diagnostics.some((d) => d.code === "AMK0066"));
	const tooLong = compile('#amk 4\n#spc { #length "20:00" }\n#0 o4 c4\n');
	check("a length past 16:39 is rejected", !tooLong.ok && tooLong.diagnostics.some((d) => d.code === "AMK0067"));

	// Music.cpp:3253-3262 — two different lengths come out of one estimate. Four
	// whole notes at t96 are 4*192 ticks / (2*96) = 4 seconds of music, and the
	// ID666 tag carries 8 because it counts the loop twice before the fade.
	const plain = compile("#amk 4\n#0 o4 t96 a1 g1 e1 e1\n");
	check(
		"a 4-second loop estimates as 4 seconds",
		plain.stats?.introSeconds === 0 && plain.stats?.mainSeconds === 4,
		`intro=${plain.stats?.introSeconds} main=${plain.stats?.mainSeconds}`,
	);
	check("its ID666 tag counts the loop twice", plain.stats?.tagSeconds === 8, `${plain.stats?.tagSeconds}`);

	// An intro is counted once and the loop twice, so 2+2 seconds tags as 6.
	const intro = compile("#amk 4\n#0 o4 t96 a1 a1 / a1 a1\n");
	check(
		"an intro and its loop are reported apart",
		intro.stats?.introSeconds === 2 && intro.stats?.mainSeconds === 2,
		`intro=${intro.stats?.introSeconds} main=${intro.stats?.mainSeconds}`,
	);
	check("an intro tags as intro + two loops", intro.stats?.tagSeconds === 6, `${intro.stats?.tagSeconds}`);

	// Music.cpp:809 — a tempo fade makes the length unguessable, and all of the
	// figures have to go, not just the tag.
	const faded = compile("#amk 4\n#0 o4 t20,96 c1\n");
	check(
		"a tempo fade leaves every length unknown",
		faded.ok &&
			faded.stats?.tagSeconds === null &&
			faded.stats?.introSeconds === null &&
			faded.stats?.mainSeconds === null,
		`${faded.stats?.tagSeconds}/${faded.stats?.introSeconds}/${faded.stats?.mainSeconds}`,
	);
	check("and no playback timing either", faded.stats?.playback === null, `${JSON.stringify(faded.stats?.playback)}`);

	// The driver's real rate is (tempo + 1) * 500/256 ticks a second, not the
	// 2 * tempo AddmusicK rounds it to — 768 ticks at t96 run 4.0538s, not 4.
	// `audiotest` measures this against the emulator; here it is just arithmetic.
	const played = (ticks: number, tempo: number) => (ticks * 256) / (500 * (tempo + 1));
	check(
		"playback timing uses the driver's rate, not the estimate",
		Math.abs(plain.stats!.playback!.mainSeconds - played(768, 96)) < 1e-9,
		`${plain.stats?.playback?.mainSeconds} vs ${played(768, 96)}`,
	);
	const drift = plain.stats!.playback!.mainSeconds / plain.stats!.mainSeconds!;
	check("which runs longer than AddmusicK's figure", drift > 1.01 && drift < 1.03, `${drift}`);
	check(
		"the intro is timed the same way",
		Math.abs(intro.stats!.playback!.introSeconds - played(384, 96)) < 1e-9 &&
			Math.abs(intro.stats!.playback!.mainSeconds - played(384, 96)) < 1e-9,
		JSON.stringify(intro.stats?.playback),
	);

	// Each segment carries its own tempo, so the two rates cannot differ by one
	// constant factor across a song that changes tempo part-way.
	const shifting = compile("#amk 4\n#0 o4 t192 c1 c1 t16 c1 c1\n");
	check(
		"a tempo change is timed segment by segment",
		Math.abs(shifting.stats!.playback!.mainSeconds - (played(384, 192) + played(384, 16))) < 1e-9,
		`${shifting.stats?.playback?.mainSeconds}`,
	);

	// A declared length has no ticks to time, so it stands in for itself.
	check(
		"a declared #length is its own playback length",
		declared.stats?.playback?.introSeconds === 90 && declared.stats?.playback?.mainSeconds === 0,
		JSON.stringify(declared.stats?.playback),
	);

	// Channels may carry their `/` at different points. AddmusicK reassigns
	// introLength on every one and so ends up holding whichever channel was parsed
	// last, while the length estimate splits at the first — a different place in
	// the song. Taking the boundary from anywhere but the first contradicts the
	// seconds reported beside it, and a transport built on the pair maps the whole
	// first pass onto the wrong scale and then wraps to the wrong bar.
	//
	// Channel 0 turns over at 384 ticks here and channel 1 at 192, so the two
	// rules disagree and the wrong one shows.
	const staggered = compile("#amk 4\n#0 t192 @0 o4 q7F a1 a1 / g1 g1\n#1 @1 o3 q7F c1 / d1 d1 d1\n");
	check(
		"the intro ends at the first / in the file",
		staggered.stats?.introTicks === 384,
		`${staggered.stats?.introTicks} ticks`,
	);
	check(
		"and the loop is what is left of the shortest channel",
		staggered.stats?.loopTicks === 384,
		`${staggered.stats?.loopTicks} ticks`,
	);
	// Two views of one boundary, so they have to land in the same place.
	const split = staggered.stats!.playback!;
	check(
		"the tick split agrees with the seconds split",
		Math.abs(
			staggered.stats!.introTicks / (staggered.stats!.introTicks + staggered.stats!.loopTicks) -
				split.introSeconds / (split.introSeconds + split.mainSeconds),
		) < 1e-9,
		`${staggered.stats?.introTicks}/${staggered.stats?.loopTicks} vs ${split.introSeconds}/${split.mainSeconds}`,
	);

	// Music.cpp:3528 — ID666 gives each text field 32 bytes.
	const longTitle = compile(`#amk 4\n#spc { #title "${"x".repeat(40)}" }\n#0 o4 c4\n`);
	check(
		"an over-long title is truncated to 32",
		longTitle.stats?.tags.title?.length === 32,
		`${longTitle.stats?.tags.title?.length}`,
	);
	check(
		"truncation warns",
		longTitle.diagnostics.some((d) => d.code === "AMK0205"),
	);

	// globals.cpp:667 — the one escape the format allows.
	const escaped = compile('#amk 4\n#spc { #title "a \\"b\\" c" }\n#0 o4 c4\n');
	check(
		'\\" survives inside a quoted string',
		escaped.stats?.tags.title === 'a "b" c',
		JSON.stringify(escaped.stats?.tags.title),
	);
	const badEscape = compile('#amk 4\n#spc { #title "a \\n b" }\n#0 o4 c4\n');
	check("any other escape is rejected", !badEscape.ok && badEscape.diagnostics.some((d) => d.code === "AMK0068"));

	// Music.cpp:1826 — a sample load past the stock group needs #samples first.
	const am4Sample = compile("#am4\n#0 o4 $E5 $94 $02 c4\n");
	check(
		"am4 $E5 sample load past $13 without #samples is rejected",
		!am4Sample.ok && am4Sample.diagnostics.some((d) => d.code === "AMK0131"),
		am4Sample.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);
	const am4Stock = compile("#am4\n#0 o4 $E5 $85 $02 c4\n");
	check(
		"am4 $E5 sample load within the stock group is fine",
		am4Stock.ok,
		am4Stock.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);

	// A failing block directive must consume the rest of its block, or the scanner
	// reads the body as MML and buries the real diagnostic in nonsense.
	const unsupported = compile('#amk 4\n#samples { "x.wav" }\n#0 o4 c4\n', 0x3e00, LIBRARY);
	check(
		"a bad #samples entry reports exactly one error",
		unsupported.diagnostics.filter((d) => d.severity === "error").length === 1,
		unsupported.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);
}

console.log("\n#samples and #path");
{
	const names = (result: CompileResult): readonly string[] => result.sampleList ?? [];

	// Music.cpp:3064 — a song with no #samples gets the #default group, applied
	// at the end of compilation rather than eagerly.
	const implicit = compile("#amk 4\n#0 o4 @0 c4\n", 0x3e00, LIBRARY);
	check("no #samples falls back to #default", names(implicit).length === 20, `${names(implicit).length}`);
	check("the fallback is in manifest order", names(implicit)[0] === STOCK[0]);

	// With no library at all the compiler has no opinion, and the host keeps its
	// own default. `[]` would mean "this song wants zero samples".
	const noLibrary = compile("#amk 4\n#0 o4 @0 c4\n");
	check("no library yields null, not an empty list", noLibrary.sampleList === null);

	// Optimisation off from here on: this section is about which names resolve and
	// in what order, and emptying the unplayed ones would only obscure that.
	const resolved = (source: string) => compile(source, 0x3e00, { ...LIBRARY, optimizeSampleUsage: false });

	const explicitDefault = compile("#amk 4\n#samples { #default }\n#0 o4 @0 c4\n", 0x3e00, LIBRARY);
	check(
		"#samples { #default } resolves to 20",
		names(explicitDefault).length === 20,
		`${names(explicitDefault).length}`,
	);

	// AMK pushes onto mySamples per occurrence and only avoids duplicating the
	// bytes, so the directory really does grow. buildSpc dedupes the blobs.
	const twice = compile("#amk 4\n#samples { #default #default }\n#0 o4 @0 c4\n", 0x3e00, LIBRARY);
	check("#default twice gives 40 entries", names(twice).length === 40, `${names(twice).length}`);

	const extra = resolved('#amk 4\n#samples { #default "kick.brr" }\n#0 o4 @0 c4\n');
	check(
		"an added file lands after the group",
		names(extra).length === 21 && names(extra)[20] === "kick.brr",
		names(extra).slice(19).join(", "),
	);

	const otherGroup = compile("#amk 4\n#samples { #optimized }\n#0 o4 c4\n", 0x3e00, LIBRARY);
	check(
		"#optimized resolves too, so #default is not special",
		names(otherGroup).length === 5,
		`${names(otherGroup).length}`,
	);

	// #path prefixes quoted names, replaces rather than stacks, and never
	// applies to group members.
	const pathed = resolved('#amk 4\n#path "drums"\n#samples { "snare.brr" }\n#0 o4 c4\n');
	check("#path prefixes a quoted name", names(pathed)[0] === "drums/snare.brr", names(pathed).join(", "));
	const repathed = resolved('#amk 4\n#path "wrong"\n#path "drums"\n#samples { "snare.brr" }\n#0 o4 c4\n');
	check(
		"a second #path replaces the first",
		repathed.sampleList?.[0] === "drums/snare.brr",
		names(repathed).join(", "),
	);
	const groupUnprefixed = compile('#amk 4\n#path "drums"\n#samples { #default }\n#0 o4 @0 c4\n', 0x3e00, LIBRARY);
	check("#path does not touch group members", names(groupUnprefixed)[0] === STOCK[0], names(groupUnprefixed)[0]);

	for (const [source, code, label] of [
		['#amk 4\n#samples { "nope.brr" }\n#0 c4\n', "AMK0058", "an unknown filename"],
		["#amk 4\n#samples { #nosuchgroup }\n#0 c4\n", "AMK0059", "an unknown group"],
		['#amk 4\n#samples { "x.wav" }\n#0 c4\n', "AMK0056", "a non-brr extension"],
		['#amk 4\n#samples { "nope.bnk" }\n#0 c4\n', "AMK0058", "an unknown sample bank"],
		['#amk 4\n#samples { "noext" }\n#0 c4\n', "AMK0107", "a missing extension"],
		['#amk 4\n#samples ( "x.brr" )\n#0 c4\n', "AMK0050", "a missing brace"],
		['#amk 4\n#samples { "kick.brr" }\n#0 o4 @5 c4\n', "AMK0109", "@5 past a short sample list"],
	] as const) {
		const result = compile(source, 0x3e00, LIBRARY);
		check(
			`${label} is rejected with ${code}`,
			!result.ok && result.diagnostics.some((d) => d.code === code),
			result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
		);
	}

	// A short list is fine as long as nothing reaches past it.
	const shortButSafe = compile('#amk 4\n#samples { "kick.brr" }\n#0 o4 $F3 $00 $02 c4\n', 0x3e00, LIBRARY);
	check(
		"a one-sample list compiles when nothing exceeds it",
		shortButSafe.ok,
		shortButSafe.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);
}

console.log("\n#instruments and @30+");
{
	const ENTRY = "$8F $E0 $00 $02 $B0"; // ADSR1, ADSR2, GAIN, tuning hi, tuning lo
	const withDefault = (body: string) => `#amk 4\n#samples { #default }\n${body}`;

	const one = compile(withDefault(`#instruments { @0 ${ENTRY} }\n#0 o4 @30 c4\n`), 0x3e00, LIBRARY);
	check("a custom instrument compiles", one.ok, one.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));

	// add = 0 (no intro) + 2 (loops) + 4 = 6, so the six instrument bytes sit at
	// header[6..12) and the channel pointer table starts at 12.
	check("the header grew by exactly six bytes", one.stats?.headerSize === 28, `${one.stats?.headerSize}`);
	if (one.data) {
		// @0's sample is instrToSample[0] = 0x00.
		expectBytes(
			"the instrument block is sample + five bytes",
			one.data.slice(6, 12),
			[0x00, 0x8f, 0xe0, 0x00, 0x02, 0xb0],
		);
		const word0 = one.data[0] | (one.data[1] << 8);
		check("header word 0 points past the instrument block", word0 === 0x3e00 + 12, `0x${word0.toString(16)}`);
		const channel0 = one.data[12] | (one.data[13] << 8);
		check(
			"the channel pointer relocated correctly",
			channel0 === 0x3e00 + one.stats!.headerSize,
			`0x${channel0.toString(16)}`,
		);
		check("@30 emits $DA $1E", [...one.data].includes(0x1e) && [...one.data].includes(0xda));
	}

	// The relocation walk steps over the instrument block using a byte counter,
	// and that path has never run with a non-empty block. All four header shapes
	// use a different `add`, so each moves the block somewhere else.
	for (const [body, label, headerSize] of [
		[`#instruments { @0 ${ENTRY} }\n#0 o4 @30 c4\n`, "loops, no intro", 28],
		[`#instruments { @0 ${ENTRY} }\n#0 o4 @30 c4 ?\n`, "no loop, no intro", 26],
		[`#instruments { @0 ${ENTRY} }\n#0 o4 @30 c4 / d4\n`, "loops, intro", 46],
		[`#instruments { @0 ${ENTRY} }\n#0 o4 @30 c4 / d4 ?\n`, "no loop, intro", 44],
	] as const) {
		const result = compile(withDefault(body), 0x3e00, LIBRARY);
		check(`${label}: compiles`, result.ok, result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
		check(
			`${label}: header is ${headerSize} bytes`,
			result.stats?.headerSize === headerSize,
			`${result.stats?.headerSize}`,
		);
		if (!result.data) {
			continue;
		}

		// Wherever the block landed, word 0 must point just past it, and every
		// channel pointer must land inside the song rather than in the header.
		const add = (result.stats!.hasIntro ? 2 : 0) + (result.stats!.loops ? 2 : 0) + 4;
		expectBytes(
			`${label}: block sits at header[${add}]`,
			result.data.slice(add, add + 6),
			[0x00, 0x8f, 0xe0, 0x00, 0x02, 0xb0],
		);
		const word0 = result.data[0] | (result.data[1] << 8);
		check(`${label}: word 0 = base + ${add + 6}`, word0 === 0x3e00 + add + 6, `0x${word0.toString(16)}`);
		const channel0 = result.data[add + 6] | (result.data[add + 7] << 8);
		check(
			`${label}: channel 0 points into the song`,
			channel0 >= 0x3e00 + result.stats!.headerSize,
			`0x${channel0.toString(16)} vs header end 0x${(0x3e00 + result.stats!.headerSize).toString(16)}`,
		);
	}

	// Two entries, so @31 is reachable and the stride is verifiable.
	const two = compile(withDefault(`#instruments { @0 ${ENTRY} n05 ${ENTRY} }\n#0 o4 @31 c4\n`), 0x3e00, LIBRARY);
	check(
		"two entries compile and @31 resolves",
		two.ok,
		two.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);
	check("the block is twelve bytes", two.stats?.headerSize === 34, `${two.stats?.headerSize}`);
	if (two.data) {
		// Noise sets the high bit: $05 | $80 = $85 (Music.cpp:2618).
		expectBytes("the noise entry stores $85", two.data.slice(12, 18), [0x85, 0x8f, 0xe0, 0x00, 0x02, 0xb0]);
	}

	// A quoted name resolves to an index into this song's own sample list.
	const named = compile(
		`#amk 4\n#samples { #default "kick.brr" }\n#instruments { "kick.brr" ${ENTRY} }\n#0 o4 @30 c4\n`,
		0x3e00,
		LIBRARY,
	);
	check("a quoted name compiles", named.ok, named.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
	check("it resolves to SRCN 20, its slot in this song", named.data?.[6] === 20, `${named.data?.[6]}`);

	for (const [source, code, label] of [
		[`#amk 4\n#instruments { "kick.brr" ${ENTRY} }\n#0 c4\n`, "AMK0089", "a name not in #samples"],
		[withDefault(`#instruments { @30 ${ENTRY} }\n#0 c4\n`), "AMK0103", "@30 as a base instrument"],
		[withDefault(`#instruments { n20 ${ENTRY} }\n#0 c4\n`), "AMK0105", "a noise pitch past $1F"],
		[withDefault("#instruments { @0 $8F $E0 $00 $02 }\n#0 c4\n"), "AMK0087", "only four bytes"],
		[withDefault(`#instruments ( @0 ${ENTRY} )\n#0 c4\n`), "AMK0051", "a missing brace"],
		[withDefault(`#instruments { %0 ${ENTRY} }\n#0 c4\n`), "AMK0106", "an unexpected character"],
		[withDefault(`#instruments { @0 ${ENTRY} }\n#0 o4 @31 c4\n`), "AMK0092", "@31 with one entry defined"],
	] as const) {
		const result = compile(source, 0x3e00, LIBRARY);
		check(
			`${label} is rejected with ${code}`,
			!result.ok && result.diagnostics.some((d) => d.code === code),
			result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
		);
	}

	// Music.cpp:880 — the convert remap turns @@19 into @30, so it starts
	// resolving against #instruments the moment @30+ is allowed at all.
	const doubleAt = compile(withDefault(`#instruments { @0 ${ENTRY} }\n#0 o4 @@19 c4\n`), 0x3e00, LIBRARY);
	check(
		"@@19 remaps to @30 and resolves",
		doubleAt.ok,
		doubleAt.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);
	check("@@19 emits $DA $1E", doubleAt.data ? [...doubleAt.data.slice(12)].includes(0x1e) : false);
}

console.log("\nthe sample load command");
{
	const withDefault = (body: string) => `#amk 4\n#samples { #default }\n${body}`;

	// Both forms compile to $F3 <srcn> <tuning>. @1's sample is instrToSample[1] = 1.
	const byNumber = compile(withDefault("#0 o4 (@1, $02) c4\n"), 0x3e00, LIBRARY);
	check("(@1, $02) compiles", byNumber.ok, byNumber.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
	if (byNumber.data) {
		const bytes = [...byNumber.data];
		const at = bytes.indexOf(0xf3);
		check(
			"it emits $F3 $01 $02",
			at !== -1 && bytes[at + 1] === 0x01 && bytes[at + 2] === 0x02,
			at === -1 ? "no $F3" : `$F3 ${hex(Uint8Array.from(bytes.slice(at + 1, at + 3)))}`,
		);
	}

	const byName = compile(withDefault(`#0 o4 ("${STOCK[1]}", $02) c4\n`), 0x3e00, LIBRARY);
	check("the quoted form compiles", byName.ok, byName.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
	if (byName.data) {
		const bytes = [...byName.data];
		const at = bytes.indexOf(0xf3);
		check(
			"a name resolves to its slot in this song",
			at !== -1 && bytes[at + 1] === 0x01,
			at === -1 ? "no $F3" : `srcn ${bytes[at + 1]}`,
		);
	}

	// #path applies here too (Music.cpp:958).
	const pathed = compile(
		'#amk 4\n#path "drums"\n#samples { "snare.brr" }\n#0 o4 ("snare.brr", $02) c4\n',
		0x3e00,
		LIBRARY,
	);
	check(
		"#path applies to a sample load",
		pathed.ok,
		pathed.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);

	// A `(` that is not a sample load must still reach the label-loop parser.
	const labelLoops = compile("#amk 4\n#0 o4 (1)[c4 d4]2 (1)3\n", 0x3e00, LIBRARY);
	check(
		"label loops still parse",
		labelLoops.ok,
		labelLoops.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);

	for (const [source, code, label] of [
		[withDefault("#0 o4 (@1) c4\n"), "AMK0133", "a missing comma"],
		[withDefault("#0 o4 (@1, 02) c4\n"), "AMK0134", "a tuning value without $"],
		[withDefault("#0 o4 (@1, $02 c4\n"), "AMK0136", "a missing close paren"],
		[withDefault("#0 o4 (@30, $02) c4\n"), "AMK0110", "@30 as a sample load"],
		[withDefault("#0 o4 (@, $02) c4\n"), "AMK0110", "a missing instrument number"],
		[withDefault('#0 o4 ("nope.brr", $02) c4\n'), "AMK0132", "a name not in #samples"],
	] as const) {
		const result = compile(source, 0x3e00, LIBRARY);
		check(
			`${label} is rejected with ${code}`,
			!result.ok && result.diagnostics.some((d) => d.code === code),
			result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
		);
	}

	// Stage C's fix: $F3's *first* argument is the sample, so usage tracking must
	// read that rather than the tuning byte. The am4 $E5 bridge builds one by hand.
	const am4 = compile("#am4\n#0 o4 $E5 $81 $02 c4\n", 0x3e00, LIBRARY);
	check(
		"am4 $E5 $81 still becomes $F3 $01 $02",
		am4.ok,
		am4.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);
	if (am4.data) {
		const bytes = [...am4.data];
		const at = bytes.indexOf(0xf3);
		check(
			"the am4 bridge emits the right bytes",
			at !== -1 && bytes[at + 1] === 0x01 && bytes[at + 2] === 0x02,
			at === -1 ? "no $F3" : `$F3 ${bytes[at + 1]} ${bytes[at + 2]}`,
		);
	}
}

console.log("\nremote code");
{
	// A definition sits outside every channel; a call is inside one. That is the
	// only thing distinguishing them (Music.cpp:1015).
	const defined = compile("#amk 4\n(!1)[$F4 $02]\n#0 o4 (!1, 1, 8) c4\n");
	check("define then call compiles", defined.ok, defined.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));

	if (defined.data) {
		const bytes = [...defined.data];
		const fc = bytes.indexOf(0xfc);
		check("the call emits $FC", fc !== -1);
		// $FC <ptr lo> <ptr hi> <type> <arg>. Type 1, and `8` is an eighth note:
		// getNoteLength(8) = 192/8 = 24 ticks.
		check(
			"event type and argument are carried",
			fc !== -1 && bytes[fc + 3] === 1 && bytes[fc + 4] === 24,
			fc === -1 ? "no $FC" : `type ${bytes[fc + 3]}, arg ${bytes[fc + 4]}`,
		);
		// The definition body lives in the loop block and must NOT be followed by
		// an $E9 back-call, which is what separates it from a label loop.
		check(
			"the body is stored, not called",
			bytes.filter((b) => b === 0xe9).length === 0,
			`${bytes.filter((b) => b === 0xe9).length} $E9 bytes`,
		);
	}

	// A label loop still emits its $E9, so the two paths really do differ.
	const labelLoop = compile("#amk 4\n#0 o4 (1)[c4]2\n");
	check("a label loop still emits $E9", labelLoop.data ? [...labelLoop.data].includes(0xe9) : false);

	// A hex third argument, and the types that take none.
	const hexArg = compile("#amk 4\n(!2)[$F4 $02]\n#0 o4 (!2, 2, $30) c4\n");
	check("a $xx third argument works", hexArg.ok, hexArg.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
	const noArg = compile("#amk 4\n(!3)[$F4 $02]\n#0 o4 (!3, -1) c4\n");
	check("type -1 needs no third argument", noArg.ok, noArg.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));

	// `(!!n)` disables an event: 0 both kinds, -1 key-on, anything else non-key-on.
	for (const [source, expected, label] of [
		["#amk 4\n#0 o4 (!!0) c4\n", 0x00, "(!!0) disables both"],
		["#amk 4\n#0 o4 (!!-1) c4\n", 0x08, "(!!-1) disables key-on"],
		["#amk 4\n#0 o4 (!!5) c4\n", 0x07, "(!!5) disables non-key-on"],
	] as const) {
		const result = compile(source);
		check(`${label}: compiles`, result.ok, result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
		if (!result.data) {
			continue;
		}

		const bytes = [...result.data];
		const fc = bytes.indexOf(0xfc);
		check(
			`${label}: emits $FC 00 00 ${expected.toString(16).padStart(2, "0")} 00`,
			fc !== -1 && bytes[fc + 1] === 0 && bytes[fc + 2] === 0 && bytes[fc + 3] === expected && bytes[fc + 4] === 0,
			fc === -1 ? "no $FC" : hex(Uint8Array.from(bytes.slice(fc, fc + 5))),
		);
	}

	for (const [source, code, label] of [
		["#amk 1\n#0 o4 (!1, 1, 8) c4\n", "AMK0117", "remote code in #amk 1"],
		["#amk 4\n(!1)[$F4 $02]\n#0 o4 (!1) c4\n", "AMK0144", "a call with no event type"],
		["#amk 4\n(!1)[$F4 $02]\n#0 o4 (!1, 1) c4\n", "AMK0146", "type 1 with no third argument"],
		["#amk 4\n#0 o4 (!9, 1, 8) c4\n", "AMK0115", "a call to an undefined label"],
		["#amk 4\n(!1)\n#0 o4 c4\n", "AMK0137", "a definition with no body"],
		["#amk 4\n#0 o4 (!1, 1, 8)[$F4 $02] c4\n", "AMK0153", "defining remote code inside a channel"],
		["#amk 4\n(!1)[c4]\n#0 o4 c4\n", "AMK0165", "note data in a remote definition"],
		["#amk 4\n(!1)[$F4 $02]2\n#0 o4 c4\n", "AMK0164", "a repeat count on a definition"],
	] as const) {
		const result = compile(source);
		check(
			`${label} is rejected with ${code}`,
			!result.ok && result.diagnostics.some((d) => d.code === code),
			result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
		);
	}
}

console.log("\n#pad and the remaining warnings");
{
	// #pad records a reservation. It does not zero-fill: AMK only pads global
	// songs, and a song compiled here is always the local one.
	const padded = compile("#amk 4\n#pad $2000\n#0 o4 c4\n");
	check("#pad compiles", padded.ok, padded.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
	check("#pad does not inflate the song", (padded.stats?.totalSize ?? 0) < 0x2000, `${padded.stats?.totalSize}`);
	const outgrown = compile("#amk 4\n#pad $10\n#0 o4 [c4 d4 e4 f4]8\n");
	check(
		"outgrowing #pad warns",
		outgrown.diagnostics.some((d) => d.code === "AMK0213"),
		outgrown.diagnostics.map((d) => d.code).join(", "),
	);
	const badPad = compile("#amk 4\n#pad 100\n#0 o4 c4\n");
	check("#pad without $ is rejected", !badPad.ok && badPad.diagnostics.some((d) => d.code === "AMK0053"));

	const twiceVTable = compile("#amk 4\n#option smwvtable\n#option smwvtable\n#0 o4 c4\n");
	check(
		"a repeated #option smwvtable warns",
		twiceVTable.diagnostics.some((d) => d.code === "AMK0203"),
		twiceVTable.diagnostics.map((d) => d.code).join(", "),
	);

	const divideOne = compile("#amk 4\n#option dividetempo 1\n#0 o4 c4\n");
	check(
		"#option dividetempo 1 warns",
		divideOne.diagnostics.some((d) => d.code === "AMK0214"),
		divideOne.diagnostics.map((d) => d.code).join(", "),
	);

	const runaway = compile(`#amk 4\n${"#halvetempo\n".repeat(20)}#0 o4 c4\n`);
	check(
		"a runaway tempo divisor is rejected",
		!runaway.ok && runaway.diagnostics.some((d) => d.code === "AMK0215"),
		runaway.diagnostics.map((d) => d.code).join(", "),
	);

	const upperCase = compile("#amk 2\n#0 o4 C4\n");
	check(
		"upper-case notes warn below #amk 4",
		upperCase.diagnostics.some((d) => d.code === "AMK0216"),
		upperCase.diagnostics.map((d) => d.code).join(", "),
	);
	const upperCaseModern = compile("#amk 4\n#0 o4 C4\n");
	check("but not on #amk 4", !upperCaseModern.diagnostics.some((d) => d.code === "AMK0216"));

	// A tempo change after the shortest channel has ended never executes.
	const lateTempo = compile("#amk 4\n#0 o4 c4\n#1 o4 c1 c1 t60 c1\n");
	check(
		"a tempo change past the end warns",
		lateTempo.diagnostics.some((d) => d.code === "AMK0217"),
		lateTempo.diagnostics.map((d) => d.code).join(", "),
	);
}

console.log("\noptimizeSampleUsage");
{
	const EMPTY = "EMPTY.brr";
	const names = (result: CompileResult): readonly string[] => result.sampleList ?? [];
	const kept = (result: CompileResult): number => names(result).filter((name) => name !== EMPTY).length;
	const run = (source: string, optimize?: boolean) =>
		compile(source, 0x3e00, { ...LIBRARY, optimizeSampleUsage: optimize });

	// On by default, as in AddmusicK (globals.cpp:40; its -u flag turns it off).
	const oneInstrument = run("#amk 4\n#0 o4 @0 c4\n");
	check("the list keeps its length", names(oneInstrument).length === 20, `${names(oneInstrument).length}`);
	check("only the played sample survives", kept(oneInstrument) === 1, `${kept(oneInstrument)} kept`);
	check("and it stays at its own SRCN", names(oneInstrument)[0] === STOCK[0], names(oneInstrument)[0]);

	const off = run("#amk 4\n#0 o4 @0 c4\n", false);
	check("optimizeSampleUsage: false keeps everything", kept(off) === 20, `${kept(off)} kept`);

	// @0 is SRCN 0 and @1 is SRCN 1, so two instruments keep two samples.
	const two = run("#amk 4\n#0 o4 @0 c4\n#1 o4 @1 c4\n");
	check("two instruments keep two samples", kept(two) === 2, `${kept(two)} kept`);

	// Importance no longer follows from having written a name out; it comes from
	// the host, and the "importance comes from the host" section covers it.

	// Nothing is important by default here, so an unplayed group member goes.
	const group = run("#amk 4\n#samples { #optimized }\n#0 o4 @0 c4\n");
	check(
		"an unplayed group member is dropped",
		kept(group) === 1 && names(group).length === 5,
		`${kept(group)} of ${names(group).length}`,
	);

	// Every path that selects a sample has to mark it, or the pass silences it.
	for (const [source, expected, label] of [
		["#amk 4\n#0 o4 @0 c4\n", 1, "@n"],
		["#amk 4\n#0 o4 $F3 $07 $02 c4\n", 1, "$F3"],
		["#amk 4\n#0 o4 $DA $05 c4\n", 1, "raw $DA, which AMK itself misses"],
		["#amk 4\n#samples { #default }\n#instruments { @9 $8F $E0 $00 $02 $B0 }\n#0 o4 @30 c4\n", 1, "@30"],
		['#amk 4\n#samples { #default }\n#0 o4 ("' + STOCK[9] + '", $02) c4\n', 1, "a sample load"],
		["#amk 4\n(!1)[$F3 $07 $02]\n#0 o4 (!1, -1) c4\n", 1, "$F3 inside remote code"],
	] as const) {
		const result = run(source);
		check(
			`${label} marks its sample as used`,
			result.ok && kept(result) >= expected,
			result.ok ? `${kept(result)} kept` : result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
		);
	}

	// A song that plays nothing at all still gets a full-length directory.
	const silent = run("#amk 4\n#0 o4 l1 r r\n");
	check("a song with no instrument keeps the directory length", names(silent).length === 20);
}

console.log("\n#samples with a .bnk sample bank");
{
	const names = (result: CompileResult): readonly string[] => result.sampleList ?? [];
	const run = (source: string, extra: Record<string, unknown> = {}) =>
		compile(source, 0x3e00, { ...LIBRARY, ...extra });

	// A bank contributes all 64 slots, blanks included. Keeping the blanks is what
	// holds a ported song's SRCNs where the original game put them.
	const bank = run('#amk 4\n#samples { "zelda.bnk" }\n#0 o4 c4\n', { optimizeSampleUsage: false });
	check("a bank compiles", bank.ok, bank.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
	check("it contributes 64 entries", names(bank).length === 64, `${names(bank).length}`);
	check("slot 0 is named :00", names(bank)[0] === "zelda.bnk:00", names(bank)[0]);
	check("slot 63 is named :3F", names(bank)[63] === "zelda.bnk:3F", names(bank)[63]);

	// After a group, the bank's slots start at that group's length.
	const after = run('#amk 4\n#samples { #default "zelda.bnk" }\n#0 o4 @0 c4\n', { optimizeSampleUsage: false });
	check("#default then a bank puts slot 0 at SRCN 20", names(after)[20] === "zelda.bnk:00", names(after)[20]);
	check("and the whole list is 84 long", names(after).length === 84, `${names(after).length}`);

	// A bank is addressed positionally. Referencing one by name where a single
	// sample is expected has to fail, because only slot names are in the list.
	for (const [source, code, label] of [
		[
			'#amk 4\n#samples { "zelda.bnk" }\n#instruments { "zelda.bnk" $8F $E0 $00 $02 $B0 }\n#0 c4\n',
			"AMK0089",
			"a bank as an #instruments base",
		],
		['#amk 4\n#samples { "zelda.bnk" }\n#0 o4 ("zelda.bnk", $02) c4\n', "AMK0132", "a bank as a sample load"],
	] as const) {
		const result = run(source);
		check(
			`${label} is rejected with ${code}`,
			!result.ok && result.diagnostics.some((d) => d.code === code),
			result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
		);
	}

	// $F3 addresses a slot by SRCN, which is the only way to reach one.
	const played = run('#amk 4\n#samples { "zelda.bnk" }\n#0 o4 $F3 $05 $02 c4\n');
	check(
		"a slot reached by $F3 survives optimisation",
		played.ok && names(played)[5] === "zelda.bnk:05",
		`${names(played)[5]}`,
	);
	check("its unplayed neighbours do not", names(played)[6] === "EMPTY.brr", names(played)[6]);
}

console.log("\nimportance comes from the host, not from the syntax");
{
	const names = (result: CompileResult): readonly string[] => result.sampleList ?? [];
	const kept = (result: CompileResult): number => names(result).filter((n) => n !== "EMPTY.brr").length;
	const run = (source: string, important: readonly string[] = []) =>
		compile(source, 0x3e00, { ...LIBRARY, importantSamples: important });

	// The rule AMK uses — a name written out in #samples is important — is gone.
	// A checkbox is a better signal of intent than having typed a filename.
	const unmarked = run('#amk 4\n#samples { "kick.brr" "drums/snare.brr" }\n#0 o4 $F3 $00 $02 c4\n');
	check("an unmarked named sample is reclaimed when unplayed", kept(unmarked) === 1, `${kept(unmarked)} kept`);

	const marked = run('#amk 4\n#samples { "kick.brr" "drums/snare.brr" }\n#0 o4 $F3 $00 $02 c4\n', ["drums/snare.brr"]);
	check("marking it important keeps it", kept(marked) === 2, `${kept(marked)} kept`);
	check("and it stays at its own SRCN", names(marked)[1] === "drums/snare.brr", names(marked)[1]);

	// Group members are no different — importance is per name, wherever it came from.
	const group = run("#amk 4\n#samples { #optimized }\n#0 o4 @0 c4\n", [STOCK[3]]);
	check("an important group member is kept", names(group)[3] === STOCK[3], names(group)[3]);
	check("an unimportant one is not", names(group)[2] === "EMPTY.brr", names(group)[2]);

	// Bank slots take part too.
	const slot = run('#amk 4\n#samples { "zelda.bnk" }\n#0 o4 c4\n', ["zelda.bnk:07"]);
	check("an important bank slot is kept", names(slot)[7] === "zelda.bnk:07", names(slot)[7]);
	check("an unimportant slot is emptied", names(slot)[8] === "EMPTY.brr", names(slot)[8]);

	// Regression: the implicit `#default` fallback never goes through `pushSample`,
	// so it briefly had no importance at all and reclaimed every important sample
	// in any song that omitted `#samples` — which is most songs.
	const implicitImportant = run("#amk 4\n#0 o4 @0 c4\n", [STOCK[9], STOCK[12]]);
	check(
		"the implicit #default fallback honours importance",
		names(implicitImportant)[9] === STOCK[9] && names(implicitImportant)[12] === STOCK[12],
		`[9]=${names(implicitImportant)[9]} [12]=${names(implicitImportant)[12]}`,
	);
	check("and still reclaims the rest", names(implicitImportant)[11] === "EMPTY.brr", names(implicitImportant)[11]);
	check(
		"an explicit #samples { #default } agrees with it",
		names(run("#amk 4\n#samples { #default }\n#0 o4 @0 c4\n", [STOCK[9], STOCK[12]])).join() ===
			names(implicitImportant).join(),
	);

	// `stats.sampleNames` is what the song asked for, before anything was emptied —
	// which is how the browser can say a sample is not in the song at all.
	const asked = run("#amk 4\n#0 o4 @0 c4\n");
	check(
		"stats.sampleNames is the pre-optimisation list",
		asked.stats?.sampleNames.length === 20 && !asked.stats?.sampleNames.includes("EMPTY.brr"),
		`${asked.stats?.sampleNames.length} names, EMPTY present: ${asked.stats?.sampleNames.includes("EMPTY.brr")}`,
	);
	check("while sampleList is the optimised one", names(asked).includes("EMPTY.brr"));
}

console.log("\nwhich samples the song actually plays");
{
	const used = (result: CompileResult): readonly string[] => result.stats?.usedSampleNames ?? [];
	const run = (source: string) => compile(source, 0x3e00, LIBRARY);

	// Being included and being played are different things, and the browser marks
	// them differently, so the compiler has to tell them apart.
	const one = run("#amk 4\n#0 o4 @0 c4\n");
	check("only the played sample is reported used", used(one).length === 1, used(one).join(", "));
	check("and it is the right one", used(one)[0] === STOCK[0], used(one)[0]);
	check("the asked-for list is still the whole group", one.stats?.sampleNames.length === 20);

	// instrToSample[14] is SRCN 0x0D, i.e. the fourteenth entry — the case in the
	// filenames where the instrument number and the SRCN differ.
	const fourteen = run("#amk 4\n#0 o4 @14 c4\n");
	check("@14 marks SRCN 0x0D as used", used(fourteen)[0] === STOCK[0x0d], used(fourteen).join(", "));

	// Every route into a sample counts, not just `@n`.
	check("$F3 counts", used(run("#amk 4\n#0 o4 $F3 $07 $02 c4\n"))[0] === STOCK[7], "");
	const load = run(`#amk 4\n#samples { #default }\n#0 o4 ("${STOCK[9]}", $02) c4\n`);
	check("a sample load counts", used(load).includes(STOCK[9]), used(load).join(", "));
	const custom = run("#amk 4\n#samples { #default }\n#instruments { @9 $8F $E0 $00 $02 $B0 }\n#0 o4 @30 c4\n");
	check("a custom instrument's own sample counts", used(custom).includes(STOCK[0x0a]), used(custom).join(", "));

	// Bank slots report by slot name, which is what the browser rows are keyed on.
	const bank = run('#amk 4\n#samples { "zelda.bnk" }\n#0 o4 $F3 $05 $02 c4\n');
	check("a played bank slot is reported by its slot name", used(bank)[0] === "zelda.bnk:05", used(bank).join(", "));

	// A name listed twice must be reported once, whichever SRCN was played.
	const twice = run("#amk 4\n#samples { #default #default }\n#0 o4 @0 c4\n");
	check("a duplicated name is reported once", used(twice).length === 1, used(twice).join(", "));

	const silent = run("#amk 4\n#0 o4 l1 r r\n");
	check("a song playing nothing reports nothing used", used(silent).length === 0, used(silent).join(", "));
}

// ---------------------------------------------------------------------------
// Divergences found by reading the port against AddmusicK 1.0.11 line by line.
// Every one of these compiled to the wrong thing before its case existed here.
// ---------------------------------------------------------------------------

/** The last `n` bytes of a compile, which is where the channel data ends up. */
function tailOf(source: string, n: number): string {
	const data = compile(source).data;
	return data ? hex(data.subarray(Math.max(0, data.length - n))) : "(no data)";
}

console.log("\naudit: the tie lookahead is as case-sensitive as AddmusicK's");
{
	// Music.cpp:2224 strncmps against exactly "$DD" and "$dd". A mixed-case `$Dd`
	// matches neither, so AddmusicK does *not* rewind and the tie folds into the
	// note length — even though getHex (Music.cpp:2876) reads the spelling as a
	// perfectly good command byte.
	const canonical = tailOf("#amk 4\n#0 c8^8 $DD $00 $10 $C0\n", 9);
	check("$DD splits the tie off", canonical === "18 7F A4 C6 DD 00 10 C0 00", canonical);

	for (const spelling of ["$Dd", "$dD"]) {
		const mixed = tailOf(`#amk 4\n#0 c8^8 ${spelling} $00 $10 $C0\n`, 8);
		check(`${spelling} folds the tie in, as AddmusicK does`, mixed === "30 7F A4 DD 00 10 C0 00", mixed);
	}
}

console.log("\naudit: #amk 1's $FA $05 becomes remote code");
{
	// Music.cpp:1925-1962 pops the `$FA $05` back off and writes a type 6 remote
	// code event in its place, or a type 8 cancel when the gain is zero.
	const set = tailOf("#amk 1\n#0 $FA $05 $10 c4\n", 9);
	check("a non-zero gain becomes a type 6 event", set.startsWith("FC 10 01 06 00"), set);

	const clear = tailOf("#amk 1\n#0 $FA $05 $00 c4\n", 9);
	check("a zero gain becomes a type 8 cancel", clear.startsWith("FC 00 00 08 00"), clear);

	// Still an error on every later target — the branch that already existed.
	const later = compile("#amk 2\n#0 $FA $05 $10 c4\n");
	check(
		"$FA $05 is still rejected under #amk 2",
		later.diagnostics.some((d) => d.code === "AMK0157"),
		later.diagnostics.map((d) => d.code).join(", "),
	);
}

console.log("\naudit: the tempo ratio divides 0x60 only where AddmusicK does");
{
	// Music.cpp:2252 divides 0x80 on every note but reaches 0x60 only inside the
	// long-note branch. Hoisting the 0x60 out of that branch made every short
	// note a hard error under a ratio that divides 128 but not 96 — 64 and 128.
	const short = compile("#amk 4\n#option dividetempo 64\n#0 c3\n");
	check("a short note compiles under dividetempo 64", short.ok, short.diagnostics.map((d) => d.code).join(", "));
	check("and keeps its tick count", short.stats?.channelTicks[0] === 1, String(short.stats?.channelTicks[0]));

	// A long note does reach the 0x60 division, and still reports it.
	const long = compile("#amk 4\n#option dividetempo 64\n#0 c1\n");
	check("a long note still reports the fractional value", !long.ok, "");
}

console.log("\naudit: a source that ends on a directive is not truncated");
{
	// Music.cpp:286 pads the buffer with 16 spaces in init(), *before* the
	// preprocessor runs, so getArgument (globals.cpp:706) never reaches the end
	// of the file. Padding afterwards instead made a source with no trailing
	// newline fail outright.
	for (const ending of ["#define FOO 1", "#if FOO", "; a trailing comment"]) {
		const result = compile(`#amk 4\n#0 c4\n${ending}`);
		check(
			`no end-of-file error for a source ending "${ending}"`,
			!result.diagnostics.some((d) => d.message.includes("end of file")),
			result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
		);
	}
}

console.log("\naudit: nothing is accepted that AddmusicK would reject");
{
	// The point of the tool is that a song written here works in AddmusicK, so
	// being more permissive than the reference is the failure that matters most:
	// it compiles, it plays, and then the real thing refuses it.
	const rejects = (name: string, source: string, because: string) => {
		const result = compile(source, 0x3e00, LIBRARY);
		check(name, !result.ok, `${because}; got ${result.diagnostics.map((d) => d.code).join(", ") || "no diagnostics"}`);
	};

	// globals.cpp:788-956 compares the directive against lowercase literals.
	// Music.cpp:2432-2456 then catches the capitalised spelling and names the
	// stage rather than calling it unknown.
	const capitalised = compile("#amk 4\n#DEFINE FOO 1\n#0 c4\n");
	check(
		"#DEFINE is rejected, by the branch that names the stage",
		capitalised.diagnostics.some((d) => d.message.includes("after the preprocessing stage")),
		capitalised.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);
	rejects("#IFDEF is rejected", "#amk 4\n#IFDEF FOO\n#0 c4\n#ENDIF\n", "the preprocessor is case-sensitive");

	// Music.cpp:3471 — `typeName != "title"` and friends, so the field name is
	// case-sensitive even though the directive keyword before it is not.
	rejects("#Title inside #spc is rejected", '#amk 4\n#spc { #Title "x" }\n#0 c4\n', "Music.cpp:3471 compares with !=");
	const lower = compile('#amk 4\n#spc { #title "x" }\n#0 c4\n');
	check("#title still works", lower.ok, lower.diagnostics.map((d) => d.code).join(", "));

	// Music.cpp:2723-2728 — `extension == ".brr"`.
	rejects(
		"an upper-case .BRR is rejected",
		'#amk 4\n#samples { "kick.BRR" }\n#0 c4\n',
		"the extension compares with ==",
	);

	// Music.cpp:2421 — `isspace(text[pos + 7])`, so `{` does not terminate a
	// directive keyword and `#samples{` is not a directive at all.
	rejects("#samples{ is not a directive", '#amk 4\n#samples{ "kick.brr" }\n#0 c4\n', "the terminator is whitespace");
	const spaced = compile('#amk 4\n#samples { "kick.brr" }\n#0 c4\n', 0x3e00, LIBRARY);
	check("#samples { still works", spaced.ok, spaced.diagnostics.map((d) => d.code).join(", "));

	// globals.cpp:716-726 — `strToInt` reads through a stringstream into an int
	// and throws when it overflows.
	rejects("an out-of-range #define operand is rejected", "#amk 4\n#define FOO 99999999999\n#0 c4\n", "strToInt throws");
}

console.log("\naudit: nothing is rejected that AddmusicK would accept");
{
	// Music.cpp:2493 — `#halvetempo` is matched on prefix alone, with no
	// trailing-whitespace test, so it may butt straight up against what follows.
	const butted = compile("#amk 4\n#halvetempo#0 c4\n");
	check(
		"#halvetempo needs no terminator",
		butted.ok,
		butted.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);

	// Music.cpp:2488 — `#amk=N` for N other than 1 is read and thrown away.
	const equals = compile("#amk 4\n#amk=2\n#0 c4\n");
	check("#amk=2 is consumed silently", equals.ok, equals.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));

	// Music.cpp:2480-2486 — a capitalised marker reaches the parser, which
	// consumes it without complaint.
	const marker = compile("#amk 4\n#AM4\n#0 c4\n");
	check("#AM4 is consumed silently", marker.ok, marker.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
}

console.log("\naudit: the diagnostics AddmusicK produces, produced here too");
{
	// Music.cpp:1181 and 1332 — `error()` returns, so no `$E9` is written and the
	// dead `j = 1` after it never runs. Forcing the count to 1 and carrying on put
	// a loop call in the song that AddmusicK does not.
	const badCall = compile("#amk 4\n#0 (1)[ c4 ] (1)0\n");
	check(
		"an out-of-range label-loop count aborts the call",
		!badCall.ok,
		badCall.diagnostics.map((d) => d.code).join(", "),
	);
	const badStar = compile("#amk 4\n#0 [ c4 ]2 *300\n");
	check(
		"an out-of-range star-loop count aborts the call",
		!badStar.ok,
		badStar.diagnostics.map((d) => d.code).join(", "),
	);

	// Music.cpp:3210-3214 — the shortest non-zero channel. A song can emit plenty
	// of bytes and still run for no time at all; an unclosed `[[` does exactly
	// that, parking every note in the superloop accumulator.
	const noTicks = compile("#amk 4\n#0 [[ c4 d4\n");
	check(
		"a song with bytes but no ticks is rejected",
		noTicks.diagnostics.some((d) => d.code === "AMK0303"),
		noTicks.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);

	// Music.cpp:1699-1713 folds the warn-once flag into the condition, so the
	// second raw byte >= $80 falls through to the *duration* warning as well.
	// `#am4` is one of the two markers that leave `targetAMKVersion` at 0, which
	// is the only target that warns here rather than erroring.
	const twoRaw = compile("#am4\n#0 $80 $80 c4\n");
	const codes = twoRaw.diagnostics.map((d) => d.code);
	check("the first raw byte warns about notes", codes.includes("AMK0208"), codes.join(", "));
	check("the second falls through to the duration warning", codes.includes("AMK0209"), codes.join(", "));

	// Music.cpp:2020 — 1.0.8 and earlier freeze on hex validation here.
	const octaveDD = compile("#amk 2\n#0 $DD $00 $10 o4 c4\n");
	check(
		"o after $DD warns on a pre-1.0.9 target",
		octaveDD.diagnostics.some((d) => d.code === "AMK0218"),
		octaveDD.diagnostics.map((d) => d.code).join(", "),
	);
	const octaveDDCurrent = compile("#amk 4\n#0 $DD $00 $10 o4 c4\n");
	check(
		"and not on #amk 4",
		!octaveDDCurrent.diagnostics.some((d) => d.code === "AMK0218"),
		octaveDDCurrent.diagnostics.map((d) => d.code).join(", "),
	);
}

console.log("\naudit: ;title= sets the ID666 title");
{
	// Music.cpp:297-306 — a plain substring search of the raw source, before
	// preprocessing, taking everything to the end of the line.
	const plain = compile("#amk 4\n;title=Green Hill Zone\n#0 c4\n");
	check("a ;title= comment becomes the title", plain.stats?.tags.title === "Green Hill Zone", plain.stats?.tags.title);

	// It runs before preprocessing, so a false `#if` does not hide it.
	const hidden = compile("#amk 4\n#if 0\n;title=Still Counts\n#endif\n#0 c4\n");
	check("even inside a false #if", hidden.stats?.tags.title === "Still Counts", hidden.stats?.tags.title);

	// `#spc { #title }` is parsed later and wins, as it does in Music.cpp:3490.
	const both = compile('#amk 4\n;title=Ignored\n#spc { #title "Wins" }\n#0 c4\n');
	check("#spc #title overrides it", both.stats?.tags.title === "Wins", both.stats?.tags.title);

	const none = compile("#amk 4\n#0 c4\n");
	check("and no marker leaves it empty", none.stats?.tags.title === undefined, String(none.stats?.tags.title));
}

console.log("\naudit: the two constructs AddmusicK lets through are let through");
{
	// Music.cpp:2413-2506 has no final else, so `pos` stays on the first letter
	// and the scan loop reads it as music. `#c4` really is a quarter-note C.
	const asMusic = compile("#amk 4\n#0 c4 #d4\n");
	check("an unknown # directive is read as music", asMusic.ok, asMusic.diagnostics.map((d) => d.code).join(", "));
	check("and its letters become notes", asMusic.stats?.channelTicks[0] === 96, String(asMusic.stats?.channelTicks[0]));

	// Music.cpp:1321 has no check that a previous loop exists, and `prevLoop` is
	// an unsigned int at -1 (Music.cpp:240) — so this emits `$E9 FF FF 02` and
	// relocation turns it into a pointer to nowhere. It compiles there, and the
	// point of this tool is that what compiles here compiles there.
	const noLoop = compile("#amk 4\n#0 *2 c4\n");
	check(
		"a * with no previous loop compiles",
		noLoop.ok,
		noLoop.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);

	const bytes = [...(noLoop.data ?? [])];
	const call = bytes.indexOf(0xe9);
	check("it emits the whole four-byte call", call !== -1 && bytes[call + 3] === 2, hex(Uint8Array.from(bytes)));
	// The stored word was $FFFF, so relocation lands it one byte *below* the loop
	// block — which is the pointer to nowhere, arriving intact.
	const pointer = call === -1 ? -1 : (bytes[call + 2] << 8) | bytes[call + 1];
	const blockAt = 0x3e00 + (noLoop.stats?.totalSize ?? 0) - (noLoop.stats?.loopDataSize ?? 0);
	check(
		"pointing one byte below the loop block, as -1 does",
		pointer !== -1 && ((pointer + 1) & 0xffff) === (blockAt & 0xffff),
		`pointer $${pointer.toString(16)}, block $${blockAt.toString(16)}`,
	);
}

summarise();
