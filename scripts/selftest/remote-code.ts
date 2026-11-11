/** `selftest`: remote code. */

import "../localize";
import { check, section } from "../harness";
import { compile, hex } from "./support";

section("remote code");
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

	// A call to a label no body was recorded for writes `loopPointers`' $FFFF
	// (Music.cpp:290, :1116-1122), which relocation lands on the last channel's
	// terminating $00. Types 0, 7 and 8 never read it, so they say nothing.
	for (const type of [0, 7, 8]) {
		const result = compile(`#amk 4\n#0 o4 c4 (!0, ${type}) c4\n`);
		check(
			`(!0, ${type}) with no (!0) compiles clean`,
			result.ok && result.diagnostics.length === 0,
			result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
		);

		const bytes = [...(result.data ?? [])];
		const fc = bytes.indexOf(0xfc);
		const pointer = fc === -1 ? -1 : (bytes[fc + 2] << 8) | bytes[fc + 1];
		const blockAt = 0x3e00 + (result.stats?.totalSize ?? 0) - (result.stats?.loopDataSize ?? 0);
		check(
			`(!0, ${type}) emits $FC <ptr> ${type.toString(16).padStart(2, "0")} 00`,
			fc !== -1 && bytes[fc + 3] === type && bytes[fc + 4] === 0,
			fc === -1 ? "no $FC" : hex(Uint8Array.from(bytes.slice(fc, fc + 5))),
		);
		check(
			`(!0, ${type}) points one byte below the loop block, at a $00`,
			pointer !== -1 && ((pointer + 1) & 0xffff) === (blockAt & 0xffff) && bytes[pointer - 0x3e00] === 0x00,
			`pointer $${pointer.toString(16)}, block $${blockAt.toString(16)}`,
		);
	}

	// Two bodies armed, then both switched off through a body that does not exist.
	const switchedOff = compile(
		"#amk 4\n#instruments\n{\n@1 $ff $e0 $b8 $03 $00\n}\n(!100)[$f4 $09]\n(!101)[$fa $01 $b8]\n" +
			"#0 t61 w220 $f4 $02 /\n@30 (!100, -1) (!101, 3)\nc8r8\n(!0,0)\nc8r8\n",
	);
	check(
		"switching remote code off with (!0,0) compiles clean",
		switchedOff.ok && switchedOff.diagnostics.length === 0,
		switchedOff.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);

	// Every other type reads the pointer, so the event runs that $00 and does
	// nothing. AddmusicK compiles it in silence; SST0509 is the port's finding.
	{
		const source = "#amk 4\n#0 o4 (!9, 1, 8) c4\n";
		const result = compile(source);
		const found = result.diagnostics.filter((d) => d.code === "SST0509");
		const call = source.indexOf("(!9, 1, 8)");
		check(
			"a call to an undefined label compiles",
			result.ok,
			result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
		);
		check(
			"and raises SST0509 as a warning, spanning the call",
			found.length === 1 &&
				found[0].severity === "warning" &&
				found[0].span.start === call &&
				found[0].span.end === call + "(!9, 1, 8)".length,
			found.map((d) => `${d.severity} ${d.span.start}-${d.span.end}`).join("; "),
		);
	}

	// Body 0 is never recorded (Music.cpp:1242), so defining it does not help.
	const bodyZero = compile("#amk 4\n(!0)[$F4 $02]\n#0 o4 (!0, -1) c4\n");
	check(
		"calling a defined (!0) raises SST0509 all the same",
		bodyZero.ok && bodyZero.diagnostics.some((d) => d.code === "SST0509" && d.message.includes("(!0)")),
		bodyZero.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);
	const bodyOne = compile("#amk 4\n(!1)[$F4 $02]\n#0 o4 (!1, -1) c4\n");
	check(
		"and a defined (!1) raises none",
		bodyOne.ok && !bodyOne.diagnostics.some((d) => d.code === "SST0509"),
		bodyOne.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);

	for (const [source, code, label] of [
		["#amk 1\n#0 o4 (!1, 1, 8) c4\n", "AMK0117", "remote code in #amk 1"],
		["#amk 4\n(!1)[$F4 $02]\n#0 o4 (!1) c4\n", "AMK0144", "a call with no event type"],
		["#amk 4\n(!1)[$F4 $02]\n#0 o4 (!1, 1) c4\n", "AMK0146", "type 1 with no third argument"],
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
