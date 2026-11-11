/** `selftest`: diagnostic spans point into the source the author wrote, and ARAM overflow is caught. */

import "../localize";
import { check, section } from "../harness";
import { compile } from "./support";

section("diagnostic spans point into the source the author wrote");
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
	// sits at 16, and the marker preprocessing removes is 7 characters — so an
	// unmapped offset would say 9, pointing at the `4` of `o4`.
	const source = "#amk 4\n#0 o4 c4 % d4\n";
	const marked = spanOf(source, "AMK0100");
	check("the #amk marker is accounted for", marked?.text === "%", JSON.stringify(marked));
	check("the offset is exact", marked?.start === source.indexOf("%"), `${marked?.start} vs ${source.indexOf("%")}`);
	check("and the line is right", marked?.line === 2, String(marked?.line));

	// The more the preprocessor removes, the further an unmapped offset drifts.
	const heavy = "#amk 4\n#define A 1\n#define B 2\n; a comment line\n#0 o4 c4 % d4\n";
	const drifted = spanOf(heavy, "AMK0100");
	check("a heavily preprocessed song still lands", drifted?.text === "%", JSON.stringify(drifted));
	check("exactly", drifted?.start === heavy.indexOf("%"), `${drifted?.start} vs ${heavy.indexOf("%")}`);

	// Comments are stripped wholesale, so anything after one on the same line
	// would drift by the comment's length without the mapping.
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

section("ARAM overflow is caught");
{
	const result = compile("#amk 4\n#0 o4 [c4 d4 e4 f4]8\n", 0xfff0);
	check("overflow rejected", !result.ok && result.diagnostics.some((d) => d.code === "AMK0300"));
}
