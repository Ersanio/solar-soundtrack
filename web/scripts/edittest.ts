/**
 * `compiler/edits.ts` — the splices the command inspector writes back.
 *
 * This is the one part of the inspector that does arithmetic on the user's
 * document, so it is the part that gets a harness. Two properties carry the
 * weight, and neither is visible from the panels that call it:
 *
 *   1. **Gap preservation.** A splice replaces the parts that changed and copies
 *      the text between them out of the source. That is what keeps a tab, a
 *      column of aligned bytes or a `; comment` written mid-run alive through an
 *      edit to the byte beside it. A re-render from values passes any assertion
 *      about the *numbers* and silently destroys all three, which is why the
 *      assertions below compare whole strings.
 *
 *   2. **The macro interlock, per part.** `"ech=$EF"` used as `ech $80 $10 $10`
 *      has a macro for its command byte and literal text for every argument, so
 *      the arguments are writable and the byte is not. Asking that question of
 *      the whole command — which is all `Command.replacement` can answer —
 *      refuses an edit that is perfectly safe.
 */

import {
	argEditable,
	argsRewritable,
	commandRewritable,
	spliceArg,
	spliceArgs,
	spliceCommand,
	spliceHead,
	spliceInstrumentByte,
	spliceInstrumentSample,
} from "../src/compiler/edits";
import { type Command, tokenize } from "../src/compiler/tokens";
import { check, summarise } from "./harness";

/** The command a test is about, found by VCMD so the source can stay readable. */
function hexCommand(source: string, vcmd: number): Command {
	const found = tokenize(source).commands.find((c) => c.vcmd === vcmd);
	if (!found) {
		throw new Error(`no $${vcmd.toString(16)} in ${JSON.stringify(source)}`);
	}

	return found;
}

/** Applies an edit the way `editor-pane.ts` does, so a test reads as before/after text. */
function applied(source: string, edit: { span: { start: number; end: number }; text: string } | null): string {
	return edit === null ? source : source.slice(0, edit.span.start) + edit.text + source.slice(edit.span.end);
}

console.log("an edit replaces the part that changed and nothing else");
{
	const source = "#0 $EF   $80 $10\t$10\n";
	const command = hexCommand(source, 0xef);

	const edit = spliceArg(source, command, 1, "$20");
	check("a single-argument edit is produced", edit !== null);
	check(
		"and only that argument's text is replaced",
		source.slice(edit!.span.start, edit!.span.end) === "$10",
		source.slice(edit!.span.start, edit!.span.end),
	);
	check(
		"the rest of the line survives verbatim",
		applied(source, edit) === "#0 $EF   $80 $20\t$10\n",
		applied(source, edit),
	);

	// The headline: three spaces, a tab and a comment are all things a re-render
	// from values would flatten, and none of them is the byte being edited.
	const spaced = "#0 $F5 $7F  $00\t$00 ; the SMW filter\n";
	const fir = hexCommand(spaced, 0xf5);
	check(
		"whitespace between untouched arguments is copied out of the source",
		applied(spaced, spliceArgs(spaced, fir, ["$40", null, "$01"])) === "#0 $F5 $40  $00\t$01 ; the SMW filter\n",
		applied(spaced, spliceArgs(spaced, fir, ["$40", null, "$01"])),
	);
	check(
		"an edit to the first and last argument still spans only those",
		spaced.slice(
			spliceArgs(spaced, fir, ["$40", null, "$01"])!.span.start,
			spliceArgs(spaced, fir, ["$40", null, "$01"])!.span.end,
		) === "$7F  $00\t$00",
	);

	// A control that fires per frame of a drag must not push a no-op through the
	// compile debounce.
	check("writing a part's existing text is not an edit", spliceArg(source, command, 1, "$10") === null);
	check("nor is an all-null splice", spliceArgs(source, command, [null, null, null]) === null);
	check("an out-of-range index yields nothing", spliceArg(source, command, 9, "$00") === null);
}

console.log("\nthe splice carries what it expects to be replacing");
{
	const source = "#0 $EF $80 $10 $10\n";
	const edit = spliceArg(source, hexCommand(source, 0xef), 0, "$FF");
	check("expect is the current text of the span", edit!.expect === "$80", edit!.expect);
	check(
		"so a consumer can compare before dispatching",
		source.slice(edit!.span.start, edit!.span.end) === edit!.expect,
	);
}

console.log("\nthe macro interlock is asked per part");
{
	// The requirement: only the command byte came through a macro, so every
	// argument is literal text and rewriting one touches nothing else.
	const head = '"ech=$EF"\n#0 ech $80 $10 $10\n';
	const headCommand = hexCommand(head, 0xef);
	check("the whole command is not rewritable", !commandRewritable(headCommand));
	check("but its arguments are", argsRewritable(headCommand));
	check(
		"each one individually too",
		headCommand.args.every((_, i) => argEditable(headCommand, i)),
	);
	check(
		"and an argument edit lands on the literal text",
		applied(head, spliceArg(head, headCommand, 1, "$20")) === '"ech=$EF"\n#0 ech $80 $20 $10\n',
		applied(head, spliceArg(head, headCommand, 1, "$20")),
	);
	check("while the command byte itself refuses", spliceHead(head, headCommand, "$F1") === null);
	check("as does a whole-run rewrite", spliceCommand(head, headCommand, "$F1 $04 $30 $01") === null);

	// One argument through a macro: that one refuses, its neighbours do not.
	const arg = '"lo=$2b"\n#0 $EF lo $2d $2d\n';
	const argCommand = hexCommand(arg, 0xef);
	check("the macro'd argument is not editable", !argEditable(argCommand, 0));
	check("its literal neighbours are", argEditable(argCommand, 1) && argEditable(argCommand, 2));
	check("so the command as a whole is not rewritable by arguments", !argsRewritable(argCommand));
	check("editing the macro'd one refuses", spliceArg(arg, argCommand, 0, "$40") === null);
	check(
		"editing a literal one succeeds",
		applied(arg, spliceArg(arg, argCommand, 2, "$40")) === '"lo=$2b"\n#0 $EF lo $2d $40\n',
		applied(arg, spliceArg(arg, argCommand, 2, "$40")),
	);

	// Everything through one macro: every part shares the use site's span, so no
	// part-by-part edit exists at all.
	const whole = '"x=$EF $2b $2d $2d"\n#0 x\n';
	const wholeCommand = hexCommand(whole, 0xef);
	check("nothing is editable", !argsRewritable(wholeCommand) && !commandRewritable(wholeCommand));
	check("and every splice refuses", spliceArgs(whole, wholeCommand, ["$40", "$40", "$40"]) === null);

	const plain = "#0 $EF $80 $10 $10\n";
	check("a command with no macro anywhere is fully rewritable", commandRewritable(hexCommand(plain, 0xef)));
	check(
		"and a whole-run rewrite replaces exactly the run",
		applied(plain, spliceCommand(plain, hexCommand(plain, 0xef), "$F1 $04 $30 $01")) === "#0 $F1 $04 $30 $01\n",
	);
}

console.log("\nan #instruments entry edits byte by byte");
{
	const source = '#instruments\n{\n\t"kick.brr" $FE  $6A $B8 $03 $00\n}\n';
	const entry = tokenize(source).instruments[0];

	check(
		"one byte is replaced, the two spaces beside it kept",
		applied(source, spliceInstrumentByte(source, entry, 1, "$7F")) ===
			'#instruments\n{\n\t"kick.brr" $FE  $7F $B8 $03 $00\n}\n',
		applied(source, spliceInstrumentByte(source, entry, 1, "$7F")),
	);
	check(
		"the sample form swaps without touching the envelope after it",
		applied(source, spliceInstrumentSample(source, entry, "@5")) === "#instruments\n{\n\t@5 $FE  $6A $B8 $03 $00\n}\n",
		applied(source, spliceInstrumentSample(source, entry, "@5")),
	);
	check("an out-of-range byte index yields nothing", spliceInstrumentByte(source, entry, 5, "$00") === null);

	// Half-written source is the normal case for a scanner that runs per keystroke.
	const partial = tokenize('#instruments\n{\n\t"kick.brr" $FE $6A\n').instruments[0];
	check(
		"an incomplete entry still edits the bytes it has",
		spliceInstrumentByte('#instruments\n{\n\t"kick.brr" $FE $6A\n', partial, 0, "$7F") !== null,
	);
	check(
		"and refuses the ones it does not",
		spliceInstrumentByte('#instruments\n{\n\t"kick.brr" $FE $6A\n', partial, 3, "$7F") === null,
	);
}

console.log("\nvariable-length commands do not lose their payload");
{
	// `#am4 $ED $82` is an ARAM upload whose 16-bit count decides how many of the
	// bytes after it belong to the command. An edit to the count either leaves
	// the payload alone or refuses; what it must never do is rewrite across it.
	const source = "#am4\n#0 $ED $82 $61 $36 $00 $02 $04 $FE $6A\n";
	const upload = hexCommand(source, 0xed);
	check("the upload's arguments are gathered", upload.args.length > 5, `got ${upload.args.length}`);

	const edit = spliceArg(source, upload, 4, "$03");
	check("editing the count is a splice of just that byte", edit !== null && edit.expect === "$02", edit?.expect);
	check(
		"and leaves every payload byte where it was",
		applied(source, edit) === "#am4\n#0 $ED $82 $61 $36 $00 $03 $04 $FE $6A\n",
		applied(source, edit),
	);

	// `$FB`'s count byte is the same hazard in the AddmusicK dialect.
	const arp = "#0 $FB $02 $18 $04 $07\n";
	const arpCommand = hexCommand(arp, 0xfb);
	check("an arpeggio's note list is gathered", arpCommand.args.length === 4, `got ${arpCommand.args.length}`);
	check(
		"and appending a note rewrites only from the count to the end",
		applied(arp, spliceArgs(arp, arpCommand, ["$03", null, null, null])) === "#0 $FB $03 $18 $04 $07\n",
	);
}

summarise();
