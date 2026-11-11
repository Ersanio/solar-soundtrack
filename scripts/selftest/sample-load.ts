/** `selftest`: the sample load command. */

import "../localize";
import { check, section } from "../harness";
import { compile, STOCK, LIBRARY, hex } from "./support";

section("the sample load command");
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

	// AMK prefixes this one too (Music.cpp:958); here #path reaches it as little
	// as it reaches #samples, so the two agree on the bare name and it resolves.
	// The list is what discriminates: prefixing both ends would resolve as well.
	const pathed = compile('#amk 4\n#path "drums"\n#samples { "snare.brr" }\n#0 o4 ("snare.brr", $02) c4\n', 0x3e00, {
		...LIBRARY,
		optimizeSampleUsage: false,
	});
	check(
		"a sample load under #path resolves the name as written",
		pathed.ok && pathed.sampleList?.[0] === "snare.brr",
		pathed.ok
			? (pathed.sampleList ?? []).join(", ")
			: pathed.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
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
