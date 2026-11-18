/** `fixtest`: a stray character deleted and upper-case note letters lowered, both to the same bytes. */

import { check, section } from "../harness";
import { expectFix, expectNoFix, sameBytes, song } from "./support";

section("upper-case note and rest letters are lowered, and compile to the same bytes");
{
	const text = "#amk 2\n#0 @0 o4 C4 D+4 e4 R4\n#1 @0 o4 c4 c4 c4 c4";
	const after = expectFix("upper case", text, "AMK0216", "#amk 2\n#0 @0 o4 c4 d+4 e4 r4\n#1 @0 o4 c4 c4 c4 c4");
	check("upper case: same bytes", sameBytes(song(text), after));
}

section("a stray character AddmusicK skips is deleted, and the song compiles to the same bytes");
{
	const text = "#amk 2\n#0 @0 o4 c4 ` d4";
	const after = expectFix("stray", text, "AMK0100", "#amk 2\n#0 @0 o4 c4 d4");
	check("stray: same bytes", sameBytes(song(text), after));
}

section("one that came in through a replacement is the macro's name, and is left alone");
expectNoFix("through a replacement", '#amk 2\n"x=`"\n#0 @0 o4 c4 x d4', "AMK0100");
