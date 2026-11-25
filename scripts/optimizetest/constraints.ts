/** `optimizetest`: what a rewrite must leave alone — a tie on either side of a loop edge, the porter's loops, labels and macros, a hot-patched song, a `$DD` under a transpose — and that it is never larger. */

import { check, section } from "../harness";
import { optimize, refusedChannels, sameNotes } from "./support";

section("constraints: a note's ties never fall on the far side of a loop edge");
{
	// The read-ahead that keeps a note on into its tie steps over $E9 and stops at a body's $00, so
	// a tie across either edge would key the note off; the roll refuses such a channel too.
	const shape = "c8 v100 ^8 v80 ^8 v60 ^8 r8 ";
	const text = `#amk 4\n#0 @0 o4 v200 ${shape.repeat(6)}d8 v100 ^8 ${shape.repeat(6)}\n`;
	const result = optimize(text);
	check("it still loops something", result.after < result.before, `${result.before} -> ${result.after}`);
	check("it plays the same", sameNotes(text, result.text) === null, sameNotes(text, result.text) ?? "");
	check("and opens in the roll", refusedChannels(result.text).length === 0, refusedChannels(result.text).join("; "));
	check("no body opens on a tie", !/\[\s*(?:v\d+\s*)*\^/.test(result.text), result.text);
	check("and no tie follows a loop or call", !/(\]\d*|\(\d+\)\d*)\s*(?:v\d+\s*)*\^/.test(result.text), result.text);
}

section("constraints: the porter's loops, labels and macros are kept as written");
{
	const text = [
		"#amk 4",
		'"BASS=@0 o3"',
		"(!1)[$ED $80 $E0]",
		"#0 BASS (!1, 3) (5)[c8 d8 e8]2 r4 (5) " + "o4 c8 d8 e8 f8 g4 e4 c2 r4 ".repeat(3),
		"",
	].join("\n");
	const result = optimize(text);
	check("smaller", result.after < result.before, `${result.before} -> ${result.after}`);
	check("plays the same", sameNotes(text, result.text) === null, sameNotes(text, result.text) ?? "");
	for (const kept of ['"BASS=@0 o3"', "(!1)[$ED $80 $E0]", "(!1, 3)", "(5)[c8 d8 e8]2", "BASS"]) {
		check(`${kept} is still written`, result.text.includes(kept), result.text);
	}

	check(
		"no new label is 5, nor 0, which (!1) uses",
		!/\((0|5)\)\[/.test(result.text.replace("(5)[c8 d8 e8]2", "")),
		result.text,
	);
}

section("constraints: a hot-patched song is left alone");
{
	// A hot patch changes what the read-ahead does at a loop and at a rest (COMMANDS.html §6).
	const text = `#amk 4\n#option amk109hotpatch\n#0 @0 ${"o4 c8 d8 e8 f8 g4 e4 c2 r4 ".repeat(4)}\n`;
	check("it is not rewritten", optimize(text).text === text);
}

section("constraints: a body holding a $DD is not transposed");
{
	// $DD's target ignores $FA $02 unless hot patch bit 0.3 is set.
	const bend = (note: string, target: string) => `o4 ${note}4 $DD $00 $06 ${target} ^4 e8 f8 g4 `;
	const text = `#amk 4\n#0 @0 ${[bend("c", "$A6"), bend("d", "$A8"), bend("c", "$A6"), bend("d", "$A8")].join("r4 ")}\n`;
	const result = optimize(text);
	check("it plays the same", sameNotes(text, result.text) === null, sameNotes(text, result.text) ?? "");
	check("and moves nothing with $FA $02", !result.text.includes("$FA $02"), result.text);
}

section("constraints: a song with nothing to loop is returned as it was");
{
	const text = "#amk 4\n#0 @0 o4 c4 d4 e4 f4 g4 a4 b4 > c4\n";
	const result = optimize(text);
	check("the same text", result.text === text, result.text);
	check("the same size", result.after === result.before);
}

section("constraints: counts stay within a byte");
{
	const text = `#amk 4\n#0 @0 o4 ${"c32 d32 ".repeat(300)}\n#1 @0 o4 ${"c32 d32 e8 ".repeat(300)}\n`;
	const result = optimize(text);
	const counts = [...result.text.matchAll(/(?:\]\]|\]|\(\d+\))(\d+)/g)].map((m) => Number(m[1]));
	check(
		"every count is 255 or below",
		counts.every((n) => n <= 255),
		JSON.stringify(counts),
	);
	check("it plays the same", sameNotes(text, result.text) === null, sameNotes(text, result.text) ?? "");
}
