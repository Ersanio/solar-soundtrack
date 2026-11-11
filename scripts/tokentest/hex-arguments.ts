/**
 * `tokentest`: a hex command gathers exactly its arguments: counted,
 * incomplete, outside `$DA`-`$FE`, `$FB`'s variable length, and abandoned at a
 * bar line.
 */

import "../localize";
import { tokenize } from "@amk/tokens";
import { check, section } from "../harness";

section("hex commands gather their arguments");
{
	const source = "#amk 4\n#0 $F5 $7F $00 $00 $00 $00 $00 $00 $00 c4\n";
	const { commands } = tokenize(source);
	const fir = commands.find((c) => c.vcmd === 0xf5);
	check("$F5 is found", fir !== undefined);
	check("$F5 takes eight arguments", fir?.args.length === 8, `got ${fir?.args.length}`);
	check("$F5 is named", fir?.name === "FIR filter", fir?.name);
	check("$F5 is complete", fir?.complete === true);
	check("first coefficient is 0x7F", fir?.args[0].value === 0x7f);
	check(
		"the span covers command through last argument",
		source.slice(fir!.span.start, fir!.span.end) === "$F5 $7F $00 $00 $00 $00 $00 $00 $00",
		source.slice(fir!.span.start, fir!.span.end),
	);
	check(
		"the note after it is not swallowed",
		commands.some((c) => c.kind === "c"),
	);
}

section("an incomplete hex command is reported as incomplete");
{
	const { commands } = tokenize("#0 $F5 $7F $00\n");
	const fir = commands.find((c) => c.vcmd === 0xf5);
	check("two of eight arguments", fir?.args.length === 2);
	check("not complete", fir?.complete === false);
}

section("hex arguments are counted, not guessed");
{
	const { commands } = tokenize("#0 $E7 $10 $E7 $20\n");
	const volumes = commands.filter((c) => c.vcmd === 0xe7);
	check("two separate $E7 commands", volumes.length === 2, `got ${volumes.length}`);
	check(
		"each took one argument",
		volumes.every((c) => c.args.length === 1),
	);
}

section("a byte outside $DA-$FE opens no command");
{
	// The tuning byte of a sample load is not a VCMD, and treating it as one
	// would eat the tokens after it as arguments.
	const { commands } = tokenize('#0 ("kick.brr", $02) c4\n');
	check("no command claims $02", !commands.some((c) => c.vcmd === 0x02));
	check(
		"the note still parses",
		commands.some((c) => c.kind === "c"),
	);
}

section("$FB takes its length from its first argument");
{
	// `parseHexCommand`'s `$FB` branch — the count byte is itself an argument, and `count + 1`
	// more follow it, so `$FB $02` wants four arguments in total.
	const short = tokenize("#0 $FB $02 $01 $02 $03\n").commands.find((c) => c.vcmd === 0xfb);
	check("count 2 means four arguments", short?.args.length === 4, `got ${short?.args.length}`);
	check("short form is complete", short?.complete === true);

	const truncated = tokenize("#0 $FB $02 $01 $02\n").commands.find((c) => c.vcmd === 0xfb);
	check("one argument short is incomplete", truncated?.complete === false);

	const long = tokenize("#0 $FB $80 $01 $02\n").commands.find((c) => c.vcmd === 0xfb);
	check("a high count means the three-argument form", long?.complete === true);
}

section("a bar line abandons a half-written command");
{
	// parser.ts's dispatch loop resets hexLeft on `|`, so the bytes after one are fresh.
	const { commands } = tokenize("#0 $F5 $7F | $E7 $10\n");
	const volume = commands.find((c) => c.vcmd === 0xe7);
	check("$E7 after the bar is its own command", volume !== undefined);
	check("and took its argument", volume?.args.length === 1);

	// parser.ts's dispatch loop reports a stray character mid-command but still dispatches
	// it, so the note here is a note rather than being swallowed as an argument.
	const stray = tokenize("#0 $F5 $7F c4\n");
	check(
		"a note inside an unfinished command is still a note",
		stray.tokens.some((t) => t.kind === "note"),
	);
}
