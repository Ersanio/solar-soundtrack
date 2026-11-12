/**
 * `selftest`: the legacy targets: that they compile, the compatibility prefix,
 * `y`'s surround flags, legacy note behaviour and legacy hex translation.
 */

import "../localize";
import type { CompileResult } from "@amk/core/types";
import { check, section } from "../harness";
import { compile, expectBytes } from "./support";

section("legacy targets compile");
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

section("target selects the compatibility prefix");
{
	// Music.cpp:2992-3018 — each target gets its own 3-byte mode prefix, right after
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

section("y packs its surround flags into the $DB byte");
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
	// Music.cpp:717 — the second argument without a third is an error, not a default.
	check("a lone second argument is rejected", !compile("#amk 4\n#0 y10,1 o4 c4\n").ok);
}

section("legacy note behaviour");
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

section("legacy hex translation");
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
