/** `selftest`: `#pad` and the remaining warnings. */

import "../localize";
import { check, section } from "../harness";
import { compile } from "./support";

section("#pad and the remaining warnings");
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
