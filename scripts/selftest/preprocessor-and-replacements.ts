/**
 * `selftest`: the preprocessor, near-miss directives, hex command validation,
 * and replacements, one that expands into itself included.
 */

import "../localize";
import { check, section } from "../harness";
import { compile } from "./support";

section("preprocessor");
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

section("near misses report clearly");
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

section("hex command validation");
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

section("replacements");
{
	const result = compile('#amk 4\n"LEAD=@0 v200"\n#0 o4 LEAD c4\n');
	check("compiles", result.ok, result.diagnostics.map((d) => d.message).join("; "));
	if (result.data) {
		const bytes = [...result.data];
		check("instrument emitted", bytes.includes(0xda));
		check("volume emitted", bytes.includes(0xe7) && bytes[bytes.indexOf(0xe7) + 1] === 200);
	}
}

section("a replacement that expands into itself is refused, not run forever");
{
	const started = Date.now();

	// Music.cpp:135 counts nesting at one position, so it sees this one: the
	// value begins with its own key and the next pass matches where the last
	// did. AMK0023 is that guard, and it now stops the parse the way
	// Music.cpp:139's `isFatal` stops AddmusicK.
	const left = compile('#amk 4\n"zz=zz $00"\n#0 o4 zz\n');
	const kitty = left.diagnostics.filter((d) => d.code === "AMK0023");
	check("a value beginning with its own key is AMK0023", kitty.length === 1, `${kitty.length} of them`);

	// The value begins with `[`, so nothing matches at that position twice and
	// the 500-iteration guard never rises above one. The recursion is between
	// calls: `scan` expands the `1`, `getInt` expands the `a1` that arrived with
	// it, and the buffer outgrows `pos` forever. AddmusicK hangs here too.
	const forwardSource = '#amk 4\n"1=[q7F @0 a1]"\n#0 o4 1\n';
	const forward = compile(forwardSource);
	const runaway = forward.diagnostics.filter((d) => d.code === "SST0505");
	check("a value that reaches its own key is SST0505", runaway.length === 1, `${runaway.length} of them`);
	check("and it fails the compile", !forward.ok);
	// Every round of the runaway raises the same nesting error, and `spanAt`
	// collapses all of them onto the one character the author typed. Filing that
	// six thousand times is what made the problems list the second freeze.
	check(
		"the rounds before it are one finding, not thousands",
		forward.diagnostics.length < 10,
		`${forward.diagnostics.length} diagnostics`,
	);
	// The `1` the author typed on the channel, not the one inside the definition:
	// text that arrived by expansion carries the outermost use site's origin.
	const useSite = runaway[0]?.span;
	check(
		"reported on the use site the author typed",
		useSite !== undefined &&
			forwardSource.slice(useSite.start, useSite.end) === "1" &&
			useSite.start === forwardSource.lastIndexOf("1"),
		JSON.stringify(useSite),
	);
	check("on its line", useSite?.line === 3, String(useSite?.line));

	// The control, and the reason the guard is a budget rather than a scan of
	// the values for their own keys: this one contains `F` and terminates,
	// because `getHex` offers only the first character of `$0F` for replacement.
	// A cycle check would refuse a song AddmusicK compiles.
	const terminates = compile('#amk 4\n"F=$E7 $0F"\n#0 o4 F c4\n');
	check(
		"a self-containing definition that terminates still compiles",
		terminates.ok,
		terminates.diagnostics.map((d) => d.message).join("; "),
	);

	// And ordinary macro use comes nowhere near the ceiling.
	const heavy = compile(`#amk 4\n"LEAD=@0 v200 y10 q7F "\n#0 o4 ${"LEAD c8 ".repeat(400)}\n`);
	check("four hundred expansions are not a runaway", heavy.ok, heavy.diagnostics.map((d) => d.message).join("; "));

	const elapsed = Date.now() - started;
	// Crude, but a guard that stopped working does not miss by a little.
	check("all of it finishes promptly", elapsed < 4000, `took ${elapsed} ms`);
}
