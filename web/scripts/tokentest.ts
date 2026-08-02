/**
 * The MML source scanner.
 *
 * Most of what this checks is ordinary — that `$F5` gathers eight arguments,
 * that `("kick.brr", $02)` does not mistake its tuning byte for a command. The
 * one that earns its place is restartability: scanning line by line with the
 * state carried across must give exactly what scanning the whole document
 * gives. CodeMirror restarts the scanner at arbitrary lines, so a state machine
 * that quietly depends on having seen the start of the file works perfectly
 * here and mis-colours text there, months later, for no visible reason.
 *
 *   npm run tokentest
 */

import {
	type ScanState,
	type Token,
	commandAt,
	copyState,
	startState,
	step,
	tokenAt,
	tokenize,
	TOKEN_TAGS,
} from "../src/compiler/tokens";

import { check, summarise } from "./harness";

const at = (text: string, offset: number) => commandAt(tokenize(text).commands, offset);

console.log("\nhex commands gather their arguments");
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

console.log("\nan incomplete hex command is reported as incomplete");
{
	const { commands } = tokenize("#0 $F5 $7F $00\n");
	const fir = commands.find((c) => c.vcmd === 0xf5);
	check("two of eight arguments", fir?.args.length === 2);
	check("not complete", fir?.complete === false);
}

console.log("\nhex arguments are counted, not guessed");
{
	const { commands } = tokenize("#0 $E7 $10 $E7 $20\n");
	const volumes = commands.filter((c) => c.vcmd === 0xe7);
	check("two separate $E7 commands", volumes.length === 2, `got ${volumes.length}`);
	check(
		"each took one argument",
		volumes.every((c) => c.args.length === 1),
	);
}

console.log("\na byte outside $DA-$FE opens no command");
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

console.log("\n$FB takes its length from its first argument");
{
	// `parser.ts:2420` — the count byte is itself an argument, and `count + 1`
	// more follow it, so `$FB $02` wants four arguments in total.
	const short = tokenize("#0 $FB $02 $01 $02 $03\n").commands.find((c) => c.vcmd === 0xfb);
	check("count 2 means four arguments", short?.args.length === 4, `got ${short?.args.length}`);
	check("short form is complete", short?.complete === true);

	const truncated = tokenize("#0 $FB $02 $01 $02\n").commands.find((c) => c.vcmd === 0xfb);
	check("one argument short is incomplete", truncated?.complete === false);

	const long = tokenize("#0 $FB $80 $01 $02\n").commands.find((c) => c.vcmd === 0xfb);
	check("a high count means the three-argument form", long?.complete === true);
}

console.log("\na bar line abandons a half-written command");
{
	// parser.ts:435 resets hexLeft on `|`, so the bytes after one are fresh.
	const { commands } = tokenize("#0 $F5 $7F | $E7 $10\n");
	const volume = commands.find((c) => c.vcmd === 0xe7);
	check("$E7 after the bar is its own command", volume !== undefined);
	check("and took its argument", volume?.args.length === 1);

	// parser.ts:399 reports a stray character mid-command but still dispatches
	// it, so the note here is a note rather than being swallowed as an argument.
	const stray = tokenize("#0 $F5 $7F c4\n");
	check(
		"a note inside an unfinished command is still a note",
		stray.tokens.some((t) => t.kind === "note"),
	);
}

console.log("\nletter commands carry their arguments");
{
	const tempo = at("#0 t144 c4\n", 4);
	check("t144 is the tempo command", tempo?.kind === "t", tempo?.kind);
	check("its name is spelled out", tempo?.name === "tempo");
	check("its argument is 144", tempo?.args[0].value === 144, String(tempo?.args[0].value));

	const pan = at("#0 y10,1,2\n", 4);
	check("y10,1,2 takes three arguments", pan?.args.length === 3, `got ${pan?.args.length}`);
	check("the last is 2", pan?.args[2].value === 2);

	const note = at("#0 c+8.\n", 4);
	check("an accidental belongs to the note", note?.kind === "c");
	check("a dotted length is one argument", note?.args.length === 1, `got ${note?.args.length}`);

	const exact = at("#0 c=48\n", 4);
	check("an exact tick count is the note's argument", exact?.args[0].value === 48);
}

console.log("\ncomments and strings");
{
	const { tokens } = tokenize("; a comment with $F5 in it\n#0 c4\n");
	check("the comment is one token", tokens[0].kind === "comment");
	check("the $F5 inside it is not a command", !tokenize("; $F5 $00\n").commands.length);

	const strung = tokenize('"a=b"\n#0 c4\n');
	check("a replacement directive reads as a string", strung.tokens[0].kind === "string");

	// An unterminated string is the state that must survive a line break.
	const open = tokenize('"unterminated\nstill inside"\n#0 c4\n');
	check("an unterminated string keeps running", open.tokens[0].kind === "string");
	check(
		"and the channel after it recovers",
		open.tokens.some((t) => t.kind === "channel"),
	);
}

console.log("\ndirectives and channels are told apart");
{
	const { tokens } = tokenize("#amk 4\n#samples\n#0 c4\n");
	check("#amk is a directive", tokens[0].kind === "directive");
	check("#samples is a directive", tokens.filter((t) => t.kind === "directive").length === 2);
	check(
		"#0 is a channel",
		tokens.some((t) => t.kind === "channel"),
	);
}

console.log("\ncommands carry the channel they were written under");
{
	// Source order is execution order within one channel and meaningless across
	// them, so anything reasoning about "runs after" needs this.
	const { commands } = tokenize("#amk 4\n#0 $F5 $7F $00 $00 $00 $00 $00 $00 $00\n#3 $F1 $05 $60 $00\n");
	const fir = commands.find((c) => c.vcmd === 0xf5);
	const echo = commands.find((c) => c.vcmd === 0xf1);
	check("the $F5 is in channel 0", fir?.channel === 0, String(fir?.channel));
	check("the $F1 is in channel 3", echo?.channel === 3, String(echo?.channel));

	const before = tokenize("$F5 $7F $00 $00 $00 $00 $00 $00 $00\n").commands[0];
	check("a command before any channel has none", before?.channel === undefined);

	// A channel directive mid-line still applies to what follows it.
	const mixed = tokenize("#0 t100 #1 t200\n").commands.filter((c) => c.kind === "t");
	check("two tempo commands", mixed.length === 2);
	check("the first is channel 0", mixed[0]?.channel === 0);
	check("the second is channel 1", mixed[1]?.channel === 1, String(mixed[1]?.channel));

	// The channel persists across lines, since it is a mode not a prefix.
	const across = tokenize("#2\nt100\n$E7 $10\n").commands;
	check(
		"everything after #2 is channel 2",
		across.every((c) => c.channel === 2),
	);
}

console.log("\nlookup");
{
	const source = "#amk 4\n#0 $F5 $7F $00 $00 $00 $00 $00 $00 $00\n";
	const { commands } = tokenize(source);
	const start = source.indexOf("$F5");
	const end = source.indexOf("\n", start);

	check("the caret on the command byte finds it", commandAt(commands, start)?.vcmd === 0xf5);
	check("the caret mid-argument finds it", commandAt(commands, start + 10)?.vcmd === 0xf5);
	check("the caret just past the last argument still finds it", commandAt(commands, end)?.vcmd === 0xf5);
	check("the caret before the channel finds nothing", commandAt(commands, 0) === null);

	// tokenAt is half-open, so the boundary belongs to exactly one token.
	const noteSource = "#0 c4\n";
	const note = tokenize(noteSource);
	const noteAt = noteSource.indexOf("c");
	check("tokenAt lands inside the note", tokenAt(note.tokens, noteAt)?.kind === "note");
	check("tokenAt at the note's end is the next token", tokenAt(note.tokens, noteAt + 1)?.kind === "number");
}

console.log("\nevery kind has a highlight tag");
{
	const { tokens } = tokenize(
		'#amk 4\n"a=b"\n#0 t144 o4 l8 v200 w150 y10 q7F h2 @1 p1 n5 [c+4 ^ r8]3 *2 (1) < > | & / ? {c} $F5 $7F $00 $00 $00 $00 $00 $00 $00 ; end\n',
	);
	const kinds = new Set(tokens.map((t) => t.kind));
	const missing = [...kinds].filter((k) => !TOKEN_TAGS[k]);
	check("no token kind lacks a tag", missing.length === 0, missing.join(", "));
	check("the sample exercised a good spread", kinds.size >= 15, `${kinds.size} kinds`);
	check("nothing came out as unknown", !kinds.has("unknown"), [...kinds].join(", "));

	// Kept separate so the dense line above stays exactly as it is; it is
	// load-bearing for the three checks that precede this.
	const used = tokenize('"x=$EF $2b $2d $2d"\n#0 x\n').tokens;
	check(
		"a replacement token has a tag too",
		used.some((t) => t.kind === "replacement" && TOKEN_TAGS[t.kind] !== undefined),
	);
}

console.log("\nreplacements are expanded at the use site");
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

console.log("\na definition only applies below itself");
{
	// `doReplacement` runs at the cursor and never behind it (parser.ts:415), so
	// there is no hoisting. A whole-document pre-pass would fail this.
	const { commands } = tokenize('echo1 $2b\n"echo1=$EF"\n#0 echo1 $2b $2d $2d\n');
	check("exactly one $EF", commands.filter((c) => c.vcmd === 0xef).length === 1);
}

console.log("\nlongest match wins, and there is no word boundary");
{
	const { commands } = tokenize('"e=$E7 $10"\n"ee=$EF $2b $2d $2d"\n#0 ee\n');
	check(
		"the longer definition wins",
		commands.some((c) => c.vcmd === 0xef),
	);
	check("the shorter one does not fire inside it", !commands.some((c) => c.vcmd === 0xe7));

	// parser.ts:690 is a bare `startsWith`. `"c=…"` really does eat every note c.
	// It looks like a bug in this scanner and is not one.
	const shadowed = tokenize('"c=$E7 $10"\n#0 c4\n');
	check(
		"a definition can shadow a note letter",
		shadowed.commands.some((c) => c.vcmd === 0xe7),
	);
	check("leaving no note behind", !shadowed.tokens.some((t) => t.kind === "note"));
}

console.log("\na replacement can carry a whole run of commands");
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

console.log("\na replacement can supply arguments, or take them");
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

console.log("\nreplacements are transitive");
{
	// parser.ts:687 re-runs the match on the text it just spliced in.
	const { commands } = tokenize('"a1=a2 $2d"\n"a2=$EF $2b"\n#0 a1 $2d\n');
	const echo = commands.find((c) => c.vcmd === 0xef);
	check("a macro naming another resolves through it", echo !== undefined);
	check("gathering arguments from both sides", echo?.args.length === 3, `got ${echo?.args.length}`);
	check("and is complete", echo?.complete === true);
}

console.log("\na recursive replacement cannot hang the editor");
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

console.log("\na sample load is not a replacement definition");
{
	// parser.ts:1732 hands `("` to parseSampleLoad, which reads the name itself,
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

console.log("\nreplacement edge cases");
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

console.log("\nq and n read their arguments as hex");
{
	// parser.ts:1405 and :1665 both use getHex. Reading either as decimal is
	// wrong twice over: the value, and the `F` that would become a note.
	const q = tokenize("#0 q7F\n").commands.find((c) => c.kind === "q");
	check("q7F is $7F, not 7", q?.args[0]?.value === 0x7f, `got ${q?.args[0]?.value}`);
	const n = tokenize("#0 n1F\n").commands.find((c) => c.kind === "n");
	check("n1F is $1F, not 1", n?.args[0]?.value === 0x1f, `got ${n?.args[0]?.value}`);
	check("and the F is not a note", !tokenize("#0 n1F\n").tokens.some((t) => t.kind === "note"));
	check("nA-nF scan at all", tokenize("#0 nA\n").commands.find((c) => c.kind === "n")?.args[0]?.value === 0xa);
	check("q10 is $10, not ten", tokenize("#0 q10\n").commands.find((c) => c.kind === "q")?.args[0]?.value === 0x10);
	// getHex stops at two digits (parser.ts:536).
	check("only two digits are taken", tokenize("#0 q7F0\n").tokens.filter((t) => t.kind === "hexNumber").length === 1);
	// getHex opens with doReplacement (parser.ts:532), so a macro really can
	// supply the digits.
	check(
		"a macro can supply the digits, as getHex allows",
		tokenize('"x=1F"\n#0 nx\n').commands.find((c) => c.kind === "n")?.args[0]?.value === 0x1f,
	);
	// getHex skips no spaces, so the digits after one are not read as hex.
	check("a space stops the hex run", !tokenize("#0 n 1F\n").tokens.some((t) => t.kind === "hexNumber"));
}

console.log("\nthe @ forms");
{
	const direct = tokenize("#0 @@19\n").commands.filter((c) => c.kind === "@");
	check("@@19 is one command, not two", direct.length === 1);
	check("and it is marked direct", direct[0]?.direct === true);
	check("with the number intact", direct[0]?.args[0]?.value === 19);
	check("a plain @19 is not direct", tokenize("#0 @19\n").commands.find((c) => c.kind === "@")?.direct === undefined);

	// parser.ts:1743 — `(@5, $02)` loads instrument 5's sample. The `@` belongs
	// to that command and does not change the instrument.
	check("(@5, $02) opens no instrument command", !tokenize("#0 (@5, $02) c4\n").commands.some((c) => c.kind === "@"));
	check(
		"but a bare (5) still works",
		tokenize("#0 (5)\n").tokens.some((t) => t.kind === "label"),
	);
}

console.log("\n#instruments is scanned as a block, not as commands");
{
	const source =
		'#instruments\n{\n\t"kick.brr" $FE $6A $B8 $03 $00\n\t@5 $8F $E0 $7F $02 $80\n\tn1F $00 $00 $7F $01 $00\n}\n';
	const index = tokenize(source);

	// The headline: an entry's ADSR bytes land in $DA-$FE, so without a block
	// mode the second byte opens a VCMD and eats the rest of the entry.
	check("no $xx inside the block opens a command", !index.tokens.some((t) => t.kind === "hex"));

	check("all three entries are found", index.instruments.length === 3);
	check("numbering starts at @30", index.instruments[0]?.number === 30);
	check("and runs upward", index.instruments.map((d) => d.number).join() === "30,31,32");
	check(
		"every one is complete",
		index.instruments.every((d) => d.complete),
	);
	check(
		"each carries its five bytes",
		index.instruments.every((d) => d.bytes.length === 5),
	);
	check("the first is a named file", index.instruments[0]?.sample.form === "file");
	check("with its name unquoted", (index.instruments[0]?.sample as { name: string }).name === "kick.brr");
	check("the second copies an instrument", index.instruments[1]?.sample.form === "copy");
	// parser.ts:1147 — @5's sample is $07, which is the whole point of the fix.
	check("resolving @5 to SRCN $07", (index.instruments[1]?.sample as { srcn: number }).srcn === 0x07);
	check("the third is noise", index.instruments[2]?.sample.form === "noise");
	// parser.ts:1162 — the high bit is what marks it noise.
	check("with the high bit set", (index.instruments[2]?.sample as { byte: number }).byte === 0x9f);
	check("the bytes are the ones written", index.instruments[0]?.bytes.join() === [0xfe, 0x6a, 0xb8, 0x03, 0x00].join());

	// Outside the block, hex commands work as before.
	check(
		"a $EF after the block still opens one",
		tokenize(`${source}#0 $EF $2b $2d $2d\n`).commands.some((c) => c.vcmd === 0xef),
	);

	// Numbering continues across blocks, which is why it lives in the second
	// pass rather than in ScanState.
	const two = tokenize(`${source}#instruments\n{\n\t@0 $FE $6A $B8 $01 $00\n}\n`);
	check("numbering continues across two blocks", two.instruments.map((d) => d.number).join() === "30,31,32,33");

	// Half-written source is the normal case for a scanner that runs per keystroke.
	const partial = tokenize('#instruments\n{\n\t"kick.brr" $FE $6A\n');
	check("an unterminated block does not hang", partial.instruments.length === 1);
	check("and its entry is marked incomplete", partial.instruments[0]?.complete === false);
	check("an #instruments with no brace yields nothing", tokenize("#instruments\n#0 c4\n").instruments.length === 0);
	check("and does not arm an unrelated brace", tokenize("#instruments\n#samples\n{ $FE }\n").instruments.length === 0);
	check("a song with no block has no entries", tokenize("#0 c4\n").instruments.length === 0);
}

console.log("\nknown divergences from AddmusicK, pinned on purpose");
{
	// Both come from the same root: `getInt`/`getHex` (parser.ts:502-532) expand
	// *inside* a token, which a model whose tokens are spans cannot express.

	// AMK's getInt expands once at the first digit, reading c44 as c84. The
	// scanner dispatches at each digit instead, so it sees two arguments.
	const midNumber = tokenize('"4=8"\n#0 c44\n').commands.find((c) => c.kind === "c");
	check("a macro inside a number is not folded into it", midNumber?.args.length === 2, `got ${midNumber?.args.length}`);

	// AMK's getHex expands after the `$`, turning $2b into $EF. scanHex takes the
	// byte whole, so it never gets the chance.
	check(
		"a macro naming hex digits does not rewrite a byte",
		!tokenize('"2b=EF"\n#0 $2b\n').commands.some((c) => c.vcmd === 0xef),
	);

	// The scanner does not evaluate `#if`, which `preprocess.ts` does before the
	// parser ever sees the text. So a block in an untaken branch is counted here
	// and dropped there. Harmless for a panel that describes what is under the
	// caret, and not worth a second preprocessor to fix.
	const branched = "#if 0\n#instruments\n{\n\t@0 $FE $6A $B8 $01 $00\n}\n#endif\n";
	check("an #instruments block in a false branch is still counted", tokenize(branched).instruments.length === 1);

	// `gather` associates the numbers that follow a letter command without
	// caring about the whitespace between, which is how `t 144` has always
	// worked. So `n 1F` reports a decimal 1 where AMK's getHex reports an error.
	// The tokens are right — the `1F` is not read as hex — but the command is
	// generous where AMK is strict.
	check(
		"a spaced argument is still gathered, where AMK would error",
		tokenize("#0 n 1F\n").commands.find((c) => c.kind === "n")?.args[0]?.value === 1,
	);
}

console.log("\nrestartability — the property CodeMirror relies on");
{
	const sources = [
		"#amk 4\n#0 $F5 $7F $00 $00 $00 $00 $00 $00 $00 c4\n",
		// A hex command split across a line break: the whole point of ScanState.
		"#amk 4\n#0 $F5 $7F $00 $00\n   $00 $00 $00 $00 $00 c4\n",
		'"a=b"\n#0 t144 [c4 d8 e2]4 $E7 $10\n; trailing comment\n',
		'#0 ("kick.brr", $02) $FB $03 $01 $02 $03 c4\n',
		'"unterminated\nstill inside"\n#0 c4\n',
		// Replacements cross line boundaries inside ScanState like everything
		// else, so a restart below a definition must still see it — and a restart
		// above one must still not.
		'"echo1=$EF"\n"echo2=$F1"\n\n#0 echo1 $2b $2d $2d\necho2 $05 $3c $00\n',
		'echo1 c4\n"echo1=$EF"\n#0 echo1 $2b $2d $2d\n',
		'"x=$EF $2b $2d $2d c4"\n#0 x\n',
		// An #instruments block spans lines, and its mode flag is the newest thing
		// in ScanState. A restart inside the block must still know it is inside.
		'#instruments\n{\n\t"kick.brr" $FE $6A $B8 $03 $00\n\t@5 $8F $E0 $7F $02 $80\n}\n#0 $EF $2b $2d $2d\n',
		// Hex letter arguments, whose one-shot flag is set and consumed within a
		// line but must not leak across one.
		"#0 q7F n1F\n#0 c4\n",
		// Left open at EOF, which is what a half-typed block looks like.
		'#instruments\n{\n\t"kick.brr" $FE $6A\n',
	];

	for (const [index, source] of sources.entries()) {
		// Re-scan line by line, exactly as StreamLanguage would, carrying the
		// state across and copying it the way CodeMirror does.
		const manual: Token[] = [];
		let state: ScanState = startState();
		let offset = 0;
		let lineNumber = 1;
		for (const line of source.split("\n")) {
			state = copyState(state);
			let cursor = 0;
			while (cursor < line.length) {
				const { kind, end } = step(line, cursor, state);
				const next = end > cursor ? end : cursor + 1;
				if (kind) {
					manual.push({ kind, start: offset + cursor, end: offset + next, line: lineNumber });
				}

				cursor = next;
			}

			offset += line.length + 1;
			lineNumber++;
		}

		const whole = tokenize(source).tokens;
		check(
			`source ${index + 1}: line-by-line equals whole-document`,
			JSON.stringify(manual) === JSON.stringify(whole),
			`\n        line-by-line: ${JSON.stringify(manual).slice(0, 220)}\n        whole-doc:    ${JSON.stringify(whole).slice(0, 220)}`,
		);
	}
}

console.log("\ncopyState really copies");
{
	const original = startState();
	original.hexLeft = 3;
	original.currentHex = 0xf5;
	const copy = copyState(original);
	copy.hexLeft = 0;
	copy.currentHex = 0;
	check("mutating the copy leaves the original alone", original.hexLeft === 3 && original.currentHex === 0xf5);
	check("every field came across", Object.keys(copy).length === Object.keys(original).length);
	// The one compound field is shared rather than cloned, which is only safe
	// because it is never mutated in place — `withReplacement` returns a new one.
	check("the replacement table is shared, not deep-copied", copy.replacements === original.replacements);
}

console.log("\nthe scanner always makes progress");
{
	// Garbage in must not hang the editor.
	const nasty = " ~`%:!\\\n#0 éé $ $$ $Z c\n";
	const { tokens } = tokenize(nasty);
	check("a hostile document terminates and yields tokens", tokens.length > 0);
	check(
		"every token advances",
		tokens.every((t) => t.end > t.start),
	);
	check(
		"tokens are ordered and never overlap",
		tokens.every((t, i) => i === 0 || t.start >= tokens[i - 1].end),
	);
}

console.log("\nan empty document is not a special case");
{
	check("empty text yields nothing", tokenize("").tokens.length === 0);
	check("empty text has no commands", tokenize("").commands.length === 0);
	check("a lone newline yields nothing", tokenize("\n").tokens.length === 0);
	check("commandAt on nothing is null", commandAt([], 0) === null);
	check("tokenAt on nothing is null", tokenAt([], 0) === null);
}

summarise();
