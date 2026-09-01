/**
 * `@amk/tokens`'s `edits.ts` — the splices the command inspector writes back.
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
	argumentText,
	commandRewritable,
	spliceArg,
	spliceArgs,
	spliceCommand,
	spliceHead,
	spliceInstrumentByte,
	spliceInstrumentSample,
} from "@amk/tokens/edits";
import {
	LAST_DRIVER_INSTRUMENT,
	instrumentByte,
	instrumentReach,
	selectedInstrument,
} from "@amk/tokens/commands/instruments";
import { type Command, tokenize } from "@amk/tokens";
import { check, summarise } from "./harness";

/** The command a test is about, found by VCMD so the source can stay readable. */
function hexCommand(source: string, vcmd: number): Command {
	const found = tokenize(source).commands.find((c) => c.vcmd === vcmd);
	if (!found) {
		throw new Error(`no $${vcmd.toString(16)} in ${JSON.stringify(source)}`);
	}

	return found;
}

/** Applies an edit the way `views/source-view/source-view.ts` does, so a test reads as before/after text. */
function applied(source: string, edit: { span: { start: number; end: number }; text: string } | null): string {
	return edit === null ? source : source.slice(0, edit.span.start) + edit.text + source.slice(edit.span.end);
}

console.log("an argument is written in the radix its own command reads");
{
	// Pins that `q` and `n` are read with `getHex`, not `getInt`
	// (`HEX_ARG_LETTERS`), so writing their argument as decimal is wrong
	// *silently* — a decimal string carries no hex letters to trip an error, it
	// just means a different number. The assertion is a round trip through
	// `tokenize`, because that is the only thing that can catch it: any
	// assertion about the *text* cannot tell the two apart.
	const roundTrip = (letter: string, value: number): number => {
		const source = `#0 ${letter}00\n`;
		const command = tokenize(source).commands.find((c) => c.kind === letter);
		const edit = spliceArg(source, command!, 0, argumentText(command!, value));
		const after = applied(source, edit);
		return tokenize(after).commands.find((c) => c.kind === letter)?.args[0].value ?? -1;
	};

	check("n survives a round trip at 10", roundTrip("n", 10) === 10, `got ${roundTrip("n", 10)}`);
	check("and at 31, its maximum", roundTrip("n", 31) === 31, `got ${roundTrip("n", 31)}`);
	check("q survives one too", roundTrip("q", 0x7f) === 0x7f, `got ${roundTrip("q", 0x7f)}`);
	check("as does a decimal letter command", roundTrip("v", 200) === 200, `got ${roundTrip("v", 200)}`);

	// The spelling itself, so the intent is legible next to the round trip.
	const noise = tokenize("#0 n00\n").commands.find((c) => c.kind === "n");
	check("a hex-argument letter writes bare hex", argumentText(noise!, 10) === "0A", argumentText(noise!, 10));
	const volume = tokenize("#0 v0\n").commands.find((c) => c.kind === "v");
	check("a decimal one writes decimal", argumentText(volume!, 10) === "10", argumentText(volume!, 10));
	check("and a hex command keeps its $", argumentText(hexCommand("#0 $EF $80 $10 $10\n", 0xef), 10) === "$0A");
}

console.log("\nan edit replaces the part that changed and nothing else");
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

console.log("\nan instrument the inspector offers is the instrument it then selects");
{
	// The list a picker draws and the number a pick writes are two halves of one
	// map, and the three spellings do not carry it the same way: `parseInstrument`
	// remaps 19-29 under `@@` and emits nothing at all for a plain `@19`-`@29`,
	// while a raw `$DA` is the byte itself — except under `#am4`, where `$13` up
	// is a custom instrument and the driver's own last table entry has no spelling
	// left. A list built on one reading and a write built on another offers one
	// instrument and selects another, silently, and no assertion about the numbers
	// on either side can see it. So this is a round trip through `tokenize`: write
	// what the picker would write, and ask the scanner what the text now selects.
	const CUSTOM = 2;
	const song = (prelude: string, written: string): string =>
		`${prelude}#instruments\n{\n\t"a.brr" $FE $6A $B8 $03 $00\n\t"b.brr" $FE $6A $B8 $03 $00\n}\n#0 ${written} c4\n`;

	const instrumentIn = (source: string): Command => {
		const found = tokenize(source).commands.find((c) => c.kind === "@" || c.vcmd === 0xda);
		if (!found) {
			throw new Error(`no instrument command in ${JSON.stringify(source)}`);
		}

		return found;
	};

	for (const spelling of [
		{ name: "@n", prelude: "", written: "@0" },
		{ name: "@@n", prelude: "", written: "@@0" },
		{ name: "$DA", prelude: "", written: "$DA $00" },
		{ name: "$DA under #am4", prelude: "#am4\n", written: "$DA $00" },
	]) {
		const source = song(spelling.prelude, spelling.written);
		const command = instrumentIn(source);
		const reach = instrumentReach(command, CUSTOM);
		const offered = reach.join(" ");
		const missed = reach.filter((instrument) => {
			const byte = instrumentByte(command, instrument)!;
			const after = applied(source, spliceArg(source, command, 0, argumentText(command, byte)));
			return selectedInstrument(instrumentIn(after)) !== instrument;
		});

		check(`${spelling.name} selects every instrument it offers`, missed.length === 0, `missed ${missed.join(" ")}`);
		check(`${spelling.name} offers this song's own two`, reach.includes(30) && reach.includes(31), `got ${offered}`);
		check(`and not a third it has not defined`, !reach.includes(32), `got ${offered}`);
		// 19 is a real entry that a raw `$DA` reaches; 20 is past the table under
		// every spelling and emits nothing under any of them.
		check(`nor 20, which no spelling reaches`, !reach.includes(20), `got ${offered}`);
	}

	const plain = instrumentIn(song("", "@0"));
	const direct = instrumentIn(song("", "@@0"));
	const raw = instrumentIn(song("", "$DA $00"));
	const am4 = instrumentIn(song("#am4\n", "$DA $00"));

	check("only the plain form writes a drum", instrumentReach(plain, CUSTOM).includes(21));
	check("the direct form cannot, its 19-29 being custom instruments", instrumentByte(direct, 21) === null);
	check("and a $DA cannot, a drum emitting no $DA at all", instrumentByte(raw, 21) === null);

	check(
		"a raw $DA is what reaches the driver's last table entry",
		instrumentByte(raw, LAST_DRIVER_INSTRUMENT) === 0x13,
		`${instrumentByte(raw, LAST_DRIVER_INSTRUMENT)}`,
	);
	check("which no @ names", instrumentByte(plain, LAST_DRIVER_INSTRUMENT) === null);
	check("and which #am4 spends on a custom instrument", instrumentByte(am4, LAST_DRIVER_INSTRUMENT) === null);
	check("$13 being where its own numbering starts", instrumentByte(am4, 30) === 0x13, `${instrumentByte(am4, 30)}`);
	check("nothing past a byte is offered", instrumentByte(plain, 256) === null);
}

summarise();
