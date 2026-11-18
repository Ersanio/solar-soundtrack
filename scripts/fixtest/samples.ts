/** `fixtest`: a used sample added to `#samples`, `#default` put first, and a list written where there was none. */

import { section } from "../harness";
import { expectFix, expectNoFix } from "./support";

const INSTRUMENT = '#instruments\n{\n\t"kick.brr" $FF $E0 $B8 $02 $00\n}';

section("a sample an instrument uses is added to the end of #samples");
expectFix(
	"instrument",
	`#amk 2\n#samples\n{\n\t#default\n}\n${INSTRUMENT}\n#0 @30 o4 c4`,
	"AMK0089",
	`#amk 2\n#samples\n{\n\t#default\n\t"kick.brr"\n}\n${INSTRUMENT}\n#0 @30 o4 c4`,
);
expectNoFix(
	"not in the library",
	'#amk 2\n#samples\n{\n\t#default\n}\n#instruments\n{\n\t"hat.brr" $FF $E0 $B8 $02 $00\n}\n#0 @30 o4 c4',
	"AMK0089",
);

expectFix(
	"sample load",
	'#amk 2\n#samples\n{\n\t#default\n}\n#0 ("kick.brr", $02) o4 c4',
	"AMK0132",
	'#amk 2\n#samples\n{\n\t#default\n\t"kick.brr"\n}\n#0 ("kick.brr", $02) o4 c4',
);

section("a song with no #samples gets one, #default first, above what reads it");
expectFix(
	"no list",
	`#amk 2\n${INSTRUMENT}\n#0 @30 o4 c4`,
	"AMK0089",
	`#amk 2\n#samples\n{\n\t#default\n\t"kick.brr"\n}\n${INSTRUMENT}\n#0 @30 o4 c4`,
);

section("a stock instrument past the list's end gets #default as its first entry");
expectFix(
	"default",
	'#amk 2\n#samples\n{\n\t"kick.brr"\n}\n#0 @5 o4 c4',
	"AMK0109",
	'#amk 2\n#samples\n{\n\t#default\n\t"kick.brr"\n}\n#0 @5 o4 c4',
);
