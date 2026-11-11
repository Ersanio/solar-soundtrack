/**
 * `tokentest`: replacements expanded at the use site: scope, longest match,
 * arguments, transitivity, recursion and the edge cases.
 */

import "../localize";
import { commandAt, tokenize } from "@amk/tokens";
import { check, section } from "../harness";
import { tokenAt } from "./support";

section("replacements are expanded at the use site");
{
	// The report this came from, verbatim.
	const source = '"echo1=$EF"\n"echo2=$F1"\n\n#0 echo1 $2b $2d $2d\necho2 $05 $3c $00\n';
	const { tokens, commands } = tokenize(source);
	const use = source.indexOf("echo1", 20);

	check("the use site is one replacement token", tokenAt(tokens, use + 2)?.kind === "replacement");
	check("and not a note", tokenAt(tokens, use)?.kind !== "note");

	const echo = commandAt(commands, use + 1);
	check("the caret inside it inspects $EF", echo?.vcmd === 0xef, `got ${echo?.vcmd?.toString(16)}`);
	check("which knows it came through echo1", echo?.replacement === "echo1", echo?.replacement);
	check("the arguments written after it are its own", echo?.args.length === 3, `got ${echo?.args.length}`);
	check("the first is $2B", echo?.args[0].value === 0x2b);
	check("so it is complete", echo?.complete === true);
	check("its name is spelled out", echo?.name !== undefined && echo.name.length > 0, echo?.name);
	check(
		"the span runs from the macro to the last argument",
		source.slice(echo!.span.start, echo!.span.end) === "echo1 $2b $2d $2d",
		source.slice(echo!.span.start, echo!.span.end),
	);

	const second = commands.find((c) => c.vcmd === 0xf1);
	check("the second macro resolves too", second?.replacement === "echo2");
	check("and takes its three arguments", second?.args.length === 3, `got ${second?.args.length}`);
	check("the channel still carries across lines", second?.channel === 0, String(second?.channel));

	check(
		"the public token list stays ordered and non-overlapping",
		tokens.every((t, i) => i === 0 || t.start >= tokens[i - 1].end),
	);
}

section("a definition only applies below itself");
{
	// `doReplacement` runs at the cursor and never behind it (parser.ts), so
	// there is no hoisting. A whole-document pre-pass would fail this.
	const { commands } = tokenize('echo1 $2b\n"echo1=$EF"\n#0 echo1 $2b $2d $2d\n');
	check("exactly one $EF", commands.filter((c) => c.vcmd === 0xef).length === 1);
}

section("longest match wins, and there is no word boundary");
{
	const { commands } = tokenize('"e=$E7 $10"\n"ee=$EF $2b $2d $2d"\n#0 ee\n');
	check(
		"the longer definition wins",
		commands.some((c) => c.vcmd === 0xef),
	);
	check("the shorter one does not fire inside it", !commands.some((c) => c.vcmd === 0xe7));

	// doReplacement matches with a bare `startsWith`. `"c=…"` really does eat every note c.
	// It looks like a bug in this scanner and is not one.
	const shadowed = tokenize('"c=$E7 $10"\n#0 c4\n');
	check(
		"a definition can shadow a note letter",
		shadowed.commands.some((c) => c.vcmd === 0xe7),
	);
	check("leaving no note behind", !shadowed.tokens.some((t) => t.kind === "note"));
}

section("a replacement can carry a whole run of commands");
{
	const source = '"x=$EF $2b $2d $2d c4"\n#0 x\n';
	const { commands } = tokenize(source);
	const use = source.indexOf("x", source.indexOf("#0"));

	check("both commands are found", commands.length === 2, `got ${commands.length}`);
	check("they share the one-character use site", commands[0].span.start === commands[1].span.start);
	check(
		"both know where they came from",
		commands.every((c) => c.replacement === "x"),
	);
	check("the caret resolves to the first, not whichever the search landed on", commandAt(commands, use)?.vcmd === 0xef);
}

section("a replacement can supply arguments, or take them");
{
	const supplies = tokenize('"lo=$2b"\n#0 $EF lo $2d $2d\n').commands.find((c) => c.vcmd === 0xef);
	check(
		"a macro standing in for an argument counts as one",
		supplies?.args.length === 3,
		`got ${supplies?.args.length}`,
	);
	check("with its value read from the expansion", supplies?.args[0].value === 0x2b);
	check("and the command is marked", supplies?.replacement === "lo");

	const source = '"ef=$EF $2b"\n#0 ef $2d $2d\n';
	const straddles = tokenize(source).commands.find((c) => c.vcmd === 0xef);
	check("a command straddling the boundary is complete", straddles?.complete === true);
	check(
		"and its span is contiguous from the macro to the last real argument",
		source.slice(straddles!.span.start, straddles!.span.end) === "ef $2d $2d",
		source.slice(straddles!.span.start, straddles!.span.end),
	);
}

section("a command knows which of its parts came through a macro");
{
	// The whole point of carrying provenance per part rather than per command:
	// `replacement` alone cannot tell "the bytes are not in the document" from
	// "the command byte is a macro and every argument is literal text", and only
	// the second of those can be rewritten in place. `@amk/tokens`'s `edits.ts` asks
	// this question; here is where the answer is pinned.
	const head = tokenize('"ech=$EF"\n#0 ech $80 $10 $10\n').commands.find((c) => c.vcmd === 0xef);
	check("the aggregate still fires", head?.replacement === "ech");
	check("the command byte names the macro", head?.headReplacement === "ech");
	check("and every argument is literal", head?.args.every((a) => a.replacement === undefined) === true);

	const arg = tokenize('"lo=$2b"\n#0 $EF lo $2d $2d\n').commands.find((c) => c.vcmd === 0xef);
	check("a macro standing in for one argument marks only that one", arg?.args[0].replacement === "lo");
	check("leaving the others literal", arg?.args.slice(1).every((a) => a.replacement === undefined) === true);
	check("and the command byte untouched", arg?.headReplacement === undefined);

	const whole = tokenize('"x=$EF $2b $2d $2d"\n#0 x\n').commands.find((c) => c.vcmd === 0xef);
	check(
		"a macro carrying the whole command marks every part",
		whole?.headReplacement === "x" && whole.args.every((a) => a.replacement === "x"),
	);

	// `head` is what lets an editor append a missing argument rather than only
	// overwrite the ones that are there, so it must stop at the command itself.
	const source = "#0 $F5 $7F $00 $00 $00 $00 $00 $00 $00\n@@19\n";
	const { commands } = tokenize(source);
	const fir = commands.find((c) => c.vcmd === 0xf5);
	check("head covers the command byte alone", source.slice(fir!.head.start, fir!.head.end) === "$F5");
	const direct = commands.find((c) => c.direct === true);
	check("and the whole of the direct form's @@", source.slice(direct!.head.start, direct!.head.end) === "@@");
}

section("replacements are transitive");
{
	// doReplacement re-runs the match on the text it just spliced in.
	const { commands } = tokenize('"a1=a2 $2d"\n"a2=$EF $2b"\n#0 a1 $2d\n');
	const echo = commands.find((c) => c.vcmd === 0xef);
	check("a macro naming another resolves through it", echo !== undefined);
	check("gathering arguments from both sides", echo?.args.length === 3, `got ${echo?.args.length}`);
	check("and is complete", echo?.complete === true);
}

section("a recursive replacement cannot hang the editor");
{
	// The guard here is an active set plus a character budget rather than AMK's
	// 500 iterations, because expansion is a tree: `"g=g g"` doubles at every
	// level and would defeat any depth-only cap.
	const sources = ['"zz=zz $00"\n#0 zz\n', '"p1=p2"\n"p2=p1"\n#0 p1\n', '"g=g g"\n#0 g\n'];
	const started = Date.now();
	for (const [index, source] of sources.entries()) {
		const { tokens } = tokenize(source);
		check(`source ${index + 1} terminates`, tokens.length > 0);
		check(
			`source ${index + 1} still advances every token`,
			tokens.every((t) => t.end > t.start),
		);
	}

	const elapsed = Date.now() - started;
	// Crude, but an exponential regression is not a near miss.
	check("all three finish promptly", elapsed < 500, `took ${elapsed} ms`);
}

section("a sample load is not a replacement definition");
{
	// parseOpenParen hands `("` to parseSampleLoad, which reads the name itself,
	// so that quote never reaches the directive arm.
	const loaded = tokenize('#0 ("kick=x.brr", $02) c4\n');
	check("no macro is defined by a sample name", !loaded.tokens.some((t) => t.kind === "replacement"));
	check(
		"and the note after it still parses",
		loaded.commands.some((c) => c.kind === "c"),
	);

	const inside = tokenize('"a=b"\n#0 ("a=b.brr", $02)\n');
	check("nor is one expanded inside one", !inside.tokens.some((t) => t.kind === "replacement"));
	check(
		"the name survives as a single string",
		inside.tokens.some((t) => t.kind === "string" && t.line === 2),
	);
}

section("replacement edge cases");
{
	// An empty value expands to nothing, but `find` is non-empty so the scanner
	// still advances over it.
	const empty = tokenize('"x="\n#0 x c4\n');
	check(
		"an empty expansion still advances",
		empty.tokens.every((t) => t.end > t.start),
	);
	check(
		"and the music after it is untouched",
		empty.commands.some((c) => c.kind === "c"),
	);

	// preprocess.ts strips comments before the parser ever sees them.
	check(
		"a definition inside a comment defines nothing",
		!tokenize('; "a=$EF"\n#0 a\n').commands.some((c) => c.vcmd === 0xef),
	);

	// A body with no `=` is AMK0021 in the compiler and simply defines nothing here.
	check(
		"a body with no equals defines nothing",
		!tokenize('"nope"\n#0 nope\n').tokens.some((t) => t.kind === "replacement"),
	);

	// Nothing is carried between calls; the table lives in ScanState.
	tokenize('"leak=$EF"\n#0 leak $2b $2d $2d\n');
	check("no definition leaks into the next scan", !tokenize("#0 leak\n").commands.some((c) => c.vcmd === 0xef));
}
