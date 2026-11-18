/** `fixtest`: directives deleted, moved, written and switched, `#pad` grown and `#spc` text cut. */

import { check, section } from "../harness";
import { expectFix, expectNoFix, sameBytes, song } from "./support";

section("redundant directives are deleted, and the song compiles to the same bytes");
{
	const text = "#amk 2\n#option smwvtable\n#option smwvtable\n#0 @0 o4 c4";
	const after = expectFix("second smwvtable", text, "AMK0203", "#amk 2\n#option smwvtable\n#0 @0 o4 c4");
	check("second smwvtable: same bytes", sameBytes(song(text), after));
}

{
	const text = "#amk 4\n#option dividetempo 1\n#0 @0 o4 c4";
	const after = expectFix("dividetempo 1", text, "AMK0214", "#amk 4\n#0 @0 o4 c4");
	check("dividetempo 1: same bytes", sameBytes(song(text), after));
}

expectFix("nspcvtable", "#amk 2\n#option nspcvtable\n#0 @0 o4 c4", "AMK0202", "#amk 2\n#0 @0 o4 c4");
expectFix("louder", "#amk 2\n#louder\n#0 @0 o4 c4", "AMK0204", "#amk 2\n#0 @0 o4 c4");
expectFix("louder first on a line", "#amk 2\n#louder ; loud\n#0 @0 o4 c4", "AMK0204", "#amk 2\n; loud\n#0 @0 o4 c4");

section("an N-SPC request after smwvtable is not redundant, and is not offered for deletion");
expectNoFix("nspcvtable after smwvtable", "#amk 2\n#option smwvtable\n#option nspcvtable\n#0 @0 o4 c4", "AMK0202");
expectNoFix("louder after smwvtable", "#amk 2\n#option smwvtable\n#louder\n#0 @0 o4 c4", "AMK0204");

section("a directive below a channel is moved above the first one");
expectFix(
	"halvetempo",
	"#amk 2\n#0 @0 o4 c4\n#halvetempo\n#1 @0 c4",
	"AMK0040",
	"#amk 2\n#halvetempo\n#0 @0 o4 c4\n#1 @0 c4",
);
expectFix(
	"option noloop",
	"#amk 2\n#0 @0 o4 c4\n#option noloop\n#1 @0 c4",
	"AMK0041",
	"#amk 2\n#option noloop\n#0 @0 o4 c4\n#1 @0 c4",
);
expectFix(
	"option dividetempo 2",
	"#amk 4\n#0 @0 o4 c4\n#option dividetempo 2\n#1 @0 c4",
	"AMK0041",
	"#amk 4\n#option dividetempo 2\n#0 @0 o4 c4\n#1 @0 c4",
);

section("a song with no target gets #amk 4 on its first line, in the song's own line ending");
expectFix("no target", "#0 @0 o4 c4", "AMK0002", "#amk 4\n#0 @0 o4 c4");
expectFix("no target, CRLF", "#0 @0 o4 c4\r\n#1 @0 c4", "AMK0002", "#amk 4\r\n#0 @0 o4 c4\r\n#1 @0 c4");

section("the target marker is switched to the one the non-native warning suggests");
expectFix("h under #am4", "#am4\n#0 @0 h2 o4 c4", "AMK0205", "#amm\n#0 @0 h2 o4 c4");
expectFix("hex under #am4", "#am4\n#0 @0 o4 c4 $F4 $01 d4", "AMK0207", "#amm\n#0 @0 o4 c4 $F4 $01 d4");
// AddmusicM refuses every `$FA` (AMK0156), so a song holding one is not offered #amm.
expectNoFix("$FA under #am4", "#am4\n#0 @0 o4 c4 $FA $02 $01 d4", "AMK0207");
expectNoFix("two markers", "#am4\n#am4\n#0 @0 h2 o4 c4", "AMK0205");

section("#pad grows to the song's size, in its own number of digits");
expectFix(
	"pad",
	"#amk 2\n#pad $0010\n#0 @0 o4 c4 d4 e4 f4 g4 a4 b4 > c4 d4 e4",
	"AMK0213",
	"#amk 2\n#pad $002B\n#0 @0 o4 c4 d4 e4 f4 g4 a4 b4 > c4 d4 e4",
);

section("#spc text past 32 characters is cut to what AddmusicK keeps, so the tag is the same");
{
	const long = "abcdefghijklmnopqrstuvwxyz0123456789XYZ";
	const text = `#amk 2\n#spc\n{\n\t#title "${long}"\n\t#game "short"\n}\n#0 @0 o4 c4`;
	const after = expectFix(
		"title",
		text,
		"AMK0205",
		`#amk 2\n#spc\n{\n\t#title "${long.slice(0, 32)}"\n\t#game "short"\n}\n#0 @0 o4 c4`,
	);
	check("title: same tag", after?.result.stats?.tags.title === song(text).result.stats?.tags.title);
}

// `preprocess` reads every `"` as a delimiter, so a cut could leave a `\"` unpaired; a value
// holding one is left as it is. Two of them keep the song compiling, which is what raises AMK0205.
expectNoFix("escaped quotes", `#amk 2\n#spc\n{\n\t#author "${"a".repeat(31)}\\"x\\"yz"\n}\n#0 @0 o4 c4`, "AMK0205");
