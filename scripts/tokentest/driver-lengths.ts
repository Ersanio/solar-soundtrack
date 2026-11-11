/** `tokentest`: the scanner agrees with the driver about command lengths. */

import "../localize";
import { tokenize } from "@amk/tokens";
import { check, section } from "../harness";
import { tokenAt } from "./support";

section("audit: the scanner agrees with the driver about command lengths");
{
	// Music.cpp:1807-1813 — every trailing byte with its high bit set extends the
	// hot patch by one, not just the first.
	const chain = tokenize("#amk 4\n#0 $FA $FE $80 $80 $10 $E7 $50 c4\n");
	const patch = chain.commands.find((c) => c.vcmd === 0xfa);
	check("a two-link $FA $FE chain keeps all four bytes", patch?.args.length === 4, `got ${patch?.args.length}`);
	check("and is complete", patch?.complete === true, String(patch?.complete));
	check(
		"so the command after it is still seen",
		chain.commands.some((c) => c.vcmd === 0xe7),
		chain.commands.map((c) => c.vcmd?.toString(16)).join(", "),
	);

	const short = tokenize("#amk 4\n#0 $FA $FE $10 c4\n");
	check("a plain $FA $FE still takes two", short.commands.find((c) => c.vcmd === 0xfa)?.args.length === 2, "");

	// Music.cpp:2762 — `#pad` reads its argument with `getHex(true)`, any length,
	// so `$DA0` is one number and not the VCMD `$DA`.
	const pad = tokenize("#amk 4\n#pad $DA0\n#0 $E7 $50 c4\n");
	check(
		"a three-digit #pad does not open a phantom VCMD",
		!pad.commands.some((c) => c.vcmd === 0xda),
		pad.commands.map((c) => c.vcmd?.toString(16)).join(", "),
	);
	check(
		"and the command after it survives",
		pad.commands.some((c) => c.vcmd === 0xe7),
		pad.commands.map((c) => c.vcmd?.toString(16)).join(", "),
	);

	// Music.cpp:433 — under #am4 an unfinished $E6 met by a non-hex byte is a
	// one-byte Tremolo Off, so it must not swallow what comes next.
	const tremolo = tokenize("#am4\n#0 $E6 c4 $E7 $50\n");
	check(
		"#am4's $E6 releases the next command",
		tremolo.commands.some((c) => c.vcmd === 0xe7),
		tremolo.commands.map((c) => c.vcmd?.toString(16)).join(", "),
	);

	// Music.cpp:2310 — `h` reads through getIntWithNegative.
	const source = "#amk 4\n#0 h-3 c4\n";
	const transpose = tokenize(source);
	const minus = tokenAt(transpose.tokens, source.indexOf("-"));
	check(
		"h's negative argument scans as one number",
		minus?.kind === "number" && source.slice(minus.start, minus.end) === "-3",
		`${minus?.kind} ${minus ? JSON.stringify(source.slice(minus.start, minus.end)) : ""}`,
	);
	check(
		"and nothing scans as unknown around it",
		!transpose.tokens.some((t) => t.kind === "unknown"),
		transpose.tokens
			.filter((t) => t.kind === "unknown")
			.map((t) => t.start)
			.join(", "),
	);
}
