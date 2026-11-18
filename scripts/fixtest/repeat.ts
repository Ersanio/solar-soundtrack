/** `fixtest`: a setting that carries into the repeat, written again where the loop starts, reset, or switched back. */

import { section } from "../harness";
import { expectFix, expectNoFix } from "./support";

section("the first pass's tempo is written again after the /");
expectFix("tempo", "#amk 4\n#0 t60 / o4 c4 t80 c4", "SST0510", "#amk 4\n#0 t60 / t60 o4 c4 t80 c4");
expectFix("default tempo", "#amk 4\n#0 / o4 c4 t80 c4", "SST0510", "#amk 4\n#0 / t53 o4 c4 t80 c4");
expectFix(
	"tempo, two channels",
	"#amk 4\n#0 t60 / o4 c4 c4\n#1 / o4 c4 t80 c4",
	"SST0510",
	"#amk 4\n#0 t60 / t60 o4 c4 c4\n#1 / o4 c4 t80 c4",
);

section("the first pass's channel or song setting is written again after its /");
expectFix("volume", "#amk 4\n#0 v200 / o4 c4 v150 c4", "SST0511", "#amk 4\n#0 v200 / v200 o4 c4 v150 c4");
expectFix("master volume", "#amk 4\n#0 w200 / o4 c4 w150 c4", "SST0512", "#amk 4\n#0 w200 / w200 o4 c4 w150 c4");
expectNoFix("back to the start value", "#amk 4\n#0 / o4 c4 v150 c4", "SST0511");

section("remote code carried over is cancelled with the reset the message names");
expectFix(
	"remote key-on",
	"#amk 4\n(!1)[$E7 $FF]\n#0 / o4 c4 (!1, -1) c4",
	"SST0511",
	"#amk 4\n(!1)[$E7 $FF]\n#0 / (!!-1) o4 c4 (!1, -1) c4",
);

section("a toggle switched an odd number of times is switched again at the song's end");
expectFix("legato", "#amk 4\n#0 / o4 c4 $F4 $01 c4", "SST0511", "#amk 4\n#0 / o4 c4 $F4 $01 c4\n$F4 $01");
