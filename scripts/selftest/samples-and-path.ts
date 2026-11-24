/** `selftest`: `#samples` and `#path`. */

import "../localize";
import type { CompileResult } from "@amk/core/types";
import { check, section } from "../harness";
import { compile, STOCK, LIBRARY } from "./support";

section("#samples and #path");
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

	// The two stock groups name the same flat files, so the host reads which group
	// each entry came from to pick that group's copy.
	const groups = (result: CompileResult) => result.stats?.sampleGroups ?? [];
	check(
		"the implicit fallback's entries are all #default's",
		groups(implicit).length === 20 && groups(implicit).every((group) => group === "default"),
		groups(implicit).slice(0, 3).join(", "),
	);
	check(
		"each entry says which group it came from, and a written name none",
		JSON.stringify(groups(resolved('#amk 4\n#samples { #optimized "kick.brr" }\n#0 o4 c4\n'))) ===
			JSON.stringify([...Array.from({ length: 5 }, () => "optimized"), null]),
		groups(resolved('#amk 4\n#samples { #optimized "kick.brr" }\n#0 o4 c4\n')).join(", "),
	);
	check(
		"and they line up with the sample list",
		groups(otherGroup).length === names(otherGroup).length,
		`${groups(otherGroup).length} vs ${names(otherGroup).length}`,
	);

	// #path is the one deliberate divergence from AddmusicK (AUDIT.md): the
	// library is one flat folder, so the directive is parsed, reported and
	// applied to nothing.
	const pathSource = '#amk 4\n#path "drums"\n#samples { "snare.brr" }\n#0 o4 c4\n';
	const pathed = resolved(pathSource);
	check("a song with #path compiles", pathed.ok, pathed.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
	check("#path does not prefix a quoted name", names(pathed)[0] === "snare.brr", names(pathed).join(", "));

	const notices = pathed.diagnostics.filter((d) => d.code === "SST0504");
	check("one notice says so", notices.length === 1, `${notices.length}`);
	check("and it is info rather than an error", notices[0]?.severity === "info", notices[0]?.severity);
	check(
		"the notice names the directive rather than the sample",
		notices[0]?.message.includes("#path") === true && notices[0]?.message.includes("snare") === false,
		notices[0]?.message,
	);
	const noticeSpan = notices[0]?.span;
	check(
		"and its span covers the whole directive",
		noticeSpan !== undefined && pathSource.slice(noticeSpan.start, noticeSpan.end) === '#path "drums"',
		noticeSpan && JSON.stringify(pathSource.slice(noticeSpan.start, noticeSpan.end)),
	);

	// One per occurrence, not one per song: each carries its own span, and a
	// notice pinned at the first would underline neither of the others.
	const twicePathed = resolved('#amk 4\n#path "wrong"\n#path "drums"\n#samples { "snare.brr" }\n#0 o4 c4\n');
	check(
		"two #path directives give two notices",
		twicePathed.diagnostics.filter((d) => d.code === "SST0504").length === 2,
		`${twicePathed.diagnostics.filter((d) => d.code === "SST0504").length}`,
	);
	check("and neither prefixes anything", names(twicePathed)[0] === "snare.brr", names(twicePathed).join(", "));

	// The syntax is still AddmusicK's, which is the whole reason the quoted
	// string is still read: an unquoted argument is an error in both.
	const unquoted = compile('#amk 4\n#path drums\n#samples { "snare.brr" }\n#0 o4 c4\n', 0x3e00, LIBRARY);
	check(
		"#path without a quoted string is still an error",
		!unquoted.ok && unquoted.diagnostics.some((d) => d.code === "AMK0052"),
		unquoted.diagnostics.map((d) => d.code).join(", "),
	);

	const groupUnprefixed = compile('#amk 4\n#path "drums"\n#samples { #default }\n#0 o4 @0 c4\n', 0x3e00, LIBRARY);
	check("#path does not touch group members", names(groupUnprefixed)[0] === STOCK[0], names(groupUnprefixed)[0]);

	// A slash inside a filename is still just a filename; the divergence is
	// about the directive, not about the character.
	const slashed = resolved('#amk 4\n#samples { "drums/snare.brr" }\n#0 o4 c4\n');
	check(
		"a name written with a slash still resolves",
		names(slashed)[0] === "drums/snare.brr",
		names(slashed).join(", "),
	);

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
