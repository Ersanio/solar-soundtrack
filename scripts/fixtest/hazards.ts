/** `fixtest`: a dead `$F7` deleted, a stranded `$DD` moved back to its note, an arpeggio's dead loop points deleted, and a runaway echo's feedback lowered as far as it must go and no further. */

import { echoStability, signedByte } from "@amk/spc/fir";
import { builtInTaps } from "@amk/tokens/echo-hazards";
import { applied } from "../../web/src/app/output/diagnostics-list/fixes/fix-diff";
import { check, section } from "../harness";
import { codes, expectFix, expectNoFix, fixesOf, type Song, song } from "./support";

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
// Behind the slide already there, so the two still run in the order written.
expectFix(
	"blocked, behind another slide",
	"#amk 2\n#0 @0 o4 c4 $DD $00 $08 $B0 v200 $DD $00 $08 $B5 d4",
	"SST0507",
	"#amk 2\n#0 @0 o4 c4 $DD $00 $08 $B0 $DD $00 $08 $B5 v200 d4",
);

section("a $DD with no note before it, across an octave or a bracket, or behind a running slide, is left alone");
expectNoFix("nothing before", "#amk 2\n#0 @0 $DD $00 $08 $A4 o4 c4", "SST0507");
expectNoFix("across an octave", "#amk 2\n#0 @0 o4 c4 v200 > $DD $00 $08 e d4", "SST0507");
expectNoFix("across a loop end", "#amk 2\n#0 @0 o4 [c4 d4]2 $DD $00 $08 $A4 e4", "SST0507");
expectNoFix("behind a slide still running", "#amk 2\n#0 @0 o4 c8 $DD $00 $18 $B0 $DD $00 $18 $B5 d4", "SST0507");

section("an arpeggio's earlier loop points are deleted, and every note steps as it did");
{
	/** Each note's arpeggio steps, as the walk follows `HandleArpeggio`. */
	const stepsOf = (built: Song | null): string =>
		(built?.timeline?.notes ?? []).map((note) => note.arpeggioSteps?.join(",") ?? "null").join(" ");

	// The second note restarts the list with the loop point the first left standing (`main.asm:2423`).
	for (const [name, text, fixed, heard] of [
		[
			"two loop points",
			"#amk 4\n#0 @0 o4 $FB $06 $06 $00 $80 $04 $80 $07 $0C c4 c4",
			"#amk 4\n#0 @0 o4 $FB $05 $06 $00 $04 $80 $07 $0C c4 c4",
			"0,4,7,12,7,12,7,12",
		],
		[
			"three, two of them adjacent",
			"#amk 4\n#0 @0 o4 $FB $06 $06 $80 $00 $80 $80 $07 $0C c4 c4",
			"#amk 4\n#0 @0 o4 $FB $04 $06 $00 $80 $07 $0C c4 c4",
			"0,7,12,7,12,7,12,7",
		],
		[
			"across a line break, which stays",
			"#amk 4\n#0 @0 o4 $FB $05 $06 $00 $80\n$04 $80 $07 c4 c4",
			"#amk 4\n#0 @0 o4 $FB $04 $06 $00\n$04 $80 $07 c4 c4",
			"0,4,7,7,7,7,7,7",
		],
	] as const) {
		const after = expectFix(name, text, "SST0517", fixed);
		const before = stepsOf(song(text));
		check(
			`${name}: every note steps as it did`,
			before === `${heard} ${heard}` && stepsOf(after) === before,
			`${before} | ${stepsOf(after)}`,
		);
	}
}

section("a loop point a replacement wrote is left alone");
expectNoFix("through a replacement", '#amk 4\n"mark=$80"\n#0 @0 o4 $FB $05 $06 $00 mark $04 $80 $07 c4', "SST0517");

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
