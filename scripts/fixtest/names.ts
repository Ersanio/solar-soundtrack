/** `fixtest`: a sample, group or `#spc` field name put right where exactly one name fits. */

import { section } from "../harness";
import { expectFix, expectNoFix } from "./support";

const samples = (entry: string) => `#amk 2\n#samples\n{\n\t#default\n\t${entry}\n}\n#0 @0 o4 c4`;

section("a sample name wrong only in case takes the library's case");
expectFix("case", samples('"Kick.brr"'), "AMK0058", samples('"kick.brr"'));
expectNoFix("no such sample", samples('"Hat.brr"'), "AMK0058");

section("a sample missing its extension takes the one file that has it");
expectFix("brr", samples('"kick"'), "AMK0107", samples('"kick.brr"'));
expectFix("bnk", samples('"snare"'), "AMK0107", samples('"snare.bnk"'));
expectNoFix("no such file", samples('"hat"'), "AMK0107");

section("a sample group wrong only in case takes the group's own");
expectFix(
	"group",
	"#amk 2\n#samples\n{\n\t#Default\n}\n#0 @0 o4 c4",
	"AMK0059",
	"#amk 2\n#samples\n{\n\t#default\n}\n#0 @0 o4 c4",
);

section("an #spc field wrong only in case takes the field's own");
expectFix(
	"field",
	'#amk 2\n#spc\n{\n\t#Title "x"\n}\n#0 @0 o4 c4',
	"AMK0065",
	'#amk 2\n#spc\n{\n\t#title "x"\n}\n#0 @0 o4 c4',
);
expectNoFix("unknown field", '#amk 2\n#spc\n{\n\t#composer "x"\n}\n#0 @0 o4 c4', "AMK0065");
