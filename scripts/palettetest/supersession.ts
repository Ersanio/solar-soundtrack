/**
 * `palettetest`: a superseded hex command and a substituted spelling compile to
 * the same bytes, and a snippet is one run of MML on one line.
 */

import "../localize";
import { compiler } from "@amk/compiler";
import { ENTRIES, resolveEntry } from "../../web/src/app/editor/command-palette/catalog";
import { check, section } from "../harness";
import { DIALECTS, ARAM, hex, resolveAll, SUPERSEDED } from "./support";

// The supersession claims, proven against the compiler rather than asserted.
section("superseded");

for (const row of SUPERSEDED) {
	const byte = hex(row.vcmd);
	const label = `${byte} superseded`;
	const data = (body: string) =>
		compiler.compile({ source: `#amk 4\n${row.above ? `${row.above}\n` : ""}#0 ${body}\n`, aramAddress: ARAM }).data;

	if (row.hex === null) {
		// Equality is not writable, so the check is differential: the construct
		// emits the byte and a song that is otherwise the same does not.
		const withIt = data(row.letter);
		const without = data("c4");
		check(
			`${label}: emits ${byte} where a plain note does not (${row.cite})`,
			withIt !== null && without !== null && withIt.includes(row.vcmd) && !without.includes(row.vcmd),
			withIt === null ? "did not compile" : "",
		);
		continue;
	}

	const fromLetter = data(row.letter);
	const fromHex = data(row.hex);
	check(
		`${label}: "${row.letter}" compiles to exactly "${row.hex}" (${row.cite})`,
		fromLetter !== null &&
			fromHex !== null &&
			fromLetter.length === fromHex.length &&
			fromLetter.every((value, index) => value === fromHex[index]),
		`${fromLetter?.length ?? "no"} bytes against ${fromHex?.length ?? "no"}`,
	);
}

// The substitutions, held to the same standard.
//
// A dialect that refuses a spelling gets the bytes it would have compiled to
// instead — so the button keeps its name, and "does the same thing" in its
// readout has to be true. Both spellings are compiled at `#amk 4`, where the
// dialect takes each, and compared. The pair is read off the entries themselves:
// an entry whose text moves between dialects is one that substitutes.
section("substituted");

for (const entry of ENTRIES) {
	const spelled = resolveEntry(entry, DIALECTS[2].target, { beforeChannels: false });
	const swapped = DIALECTS.map((dialect) => resolveEntry(entry, dialect.target, { beforeChannels: false })).find(
		(resolved) => resolved.text !== spelled.text,
	);

	if (swapped === undefined) {
		continue;
	}

	const data = (body: string) => compiler.compile({ source: `#amk 4\n#0 c4 ${body}\n`, aramAddress: ARAM }).data;
	const fromSpelling = data(spelled.text);
	const fromHex = data(swapped.text);
	check(
		`${spelled.key}: "${spelled.text}" compiles to exactly "${swapped.text}"`,
		fromSpelling !== null &&
			fromHex !== null &&
			fromSpelling.length === fromHex.length &&
			fromSpelling.every((value, index) => value === fromHex[index]),
		`${fromSpelling?.length ?? "no"} bytes against ${fromHex?.length ?? "no"}`,
	);

	// And that it says nothing about having done so. The button is named for the
	// command, both spellings are that command, and which one a dialect takes is
	// not the porter’s business — a `caveat` here would be a hazard warning about
	// a byte the porter did not choose to write, and an `SST05xx` beside it.
	check(`${spelled.key}: swaps silently`, swapped.caveat === undefined, swapped.caveat);
}

// A snippet is one run of MML on one line. A newline would break the line-oriented
// scanner's account of it, a `"` would open a replacement definition, and a `;`
// survives preprocessing under `#amm` (`preprocess.ts`) and would comment out the
// rest of the line.
{
	const bad = DIALECTS.flatMap(({ target }) =>
		resolveAll(target, false)
			.concat(resolveAll(target, true))
			.filter((entry) => /[\n";]/.test(entry.text))
			.map((entry) => entry.key),
	);

	check("no snippet carries a newline, a quote or a semicolon", bad.length === 0, bad.join(", "));
}
