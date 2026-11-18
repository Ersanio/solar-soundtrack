/** `fixtest`: a dead `$F7` deleted, a stranded `$DD` moved back to its note, and a runaway echo's feedback lowered as far as it must go and no further. */

import { echoStability, signedByte } from "@amk/spc/fir";
import { builtInTaps } from "@amk/tokens/echo-hazards";
import { applied } from "../../web/src/app/output/diagnostics-list/fixes/fix-diff";
import { check, section } from "../harness";
import { codes, expectFix, expectNoFix, fixesOf, song } from "./support";

section("a $F7 is deleted with its arguments");
expectFix("$F7", "#amk 2\n#0 @0 o4 c4 $F7 $00 $01 $02 d4", "SST0506", "#amk 2\n#0 @0 o4 c4 d4");

section("a $DD a command stands in front of moves to directly after the note");
expectFix(
	"blocked",
	"#amk 2\n#0 @0 o4 c4 v200 $DD $00 $08 $A4 d4",
	"SST0507",
	"#amk 2\n#0 @0 o4 c4 $DD $00 $08 $A4 v200 d4",
);
expectFix(
	"blocked, note target",
	"#amk 2\n#0 @0 o4 c4 y10 $DD $00 $08 e d4",
	"SST0507",
	"#amk 2\n#0 @0 o4 c4 $DD $00 $08 e y10 d4",
);

section("a $DD with no note before it, or across an octave or a bracket, is left alone");
expectNoFix("nothing before", "#amk 2\n#0 @0 $DD $00 $08 $A4 o4 c4", "SST0507");
expectNoFix("across an octave", "#amk 2\n#0 @0 o4 c4 v200 > $DD $00 $08 e d4", "SST0507");
expectNoFix("across a loop end", "#amk 2\n#0 @0 o4 [c4 d4]2 $DD $00 $08 $A4 e4", "SST0507");

/**
 * The fix lowers the governing `$F1`'s feedback to a value that fades and one step past it does
 * not, on the same side of zero, and touches nothing else.
 */
function expectFading(name: string, text: string, code: string, taps: readonly number[]): void {
	const before = song(text);
	check(`${name}: raises ${code}`, codes(before).includes(code), codes(before).join(", "));
	const [fix] = fixesOf(before, code);
	check(`${name}: offers a fix`, fix?.edits.length === 1);
	if (fix === undefined) {
		return;
	}

	const after = song(applied(text, fix.edits));
	check(`${name}: ${code} is gone`, !codes(after).includes(code), codes(after).join(", "));
	const delay = after.context.live.index.commands.find((command) => command.vcmd === 0xf1);
	const lowered = delay?.args[1].value ?? -1;
	const original = before.context.live.index.commands.find((command) => command.vcmd === 0xf1)?.args[1].value ?? -1;
	const step = signedByte(original) < 0 ? (lowered - 1) & 0xff : lowered + 1;
	check(`${name}: fades`, !echoStability(taps, lowered).runaway);
	check(`${name}: one step more runs away`, echoStability(taps, step).runaway, `lowered to $${lowered.toString(16)}`);
	check(`${name}: same sign`, Math.sign(signedByte(lowered)) === Math.sign(signedByte(original)));
}

section("a runaway echo's feedback is lowered to the most its filter lets fade");
expectFading("filter 0", "#amk 2\n#0 @0 $F1 $04 $7F $00 o4 c4", "SST0501", builtInTaps(0) ?? []);
expectFading("filter 0, negative", "#amk 2\n#0 @0 $F1 $04 $81 $00 o4 c4", "SST0501", builtInTaps(0) ?? []);
expectFading(
	"$F5",
	"#amk 2\n#0 @0 $F1 $04 $60 $01 $F5 $7F $7F $00 $00 $00 $00 $00 $00 o4 c4",
	"SST0500",
	[127, 127, 0, 0, 0, 0, 0, 0],
);
