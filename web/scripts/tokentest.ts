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

let failures = 0;
function check(name: string, condition: boolean, detail = ""): void {
	if (condition) console.log(`  ok    ${name}`);
	else {
		failures++;
		console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
	}
}

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
	check("the note after it is not swallowed", commands.some((c) => c.kind === "c"));
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
	check("each took one argument", volumes.every((c) => c.args.length === 1));
}

console.log("\na byte outside $DA-$FE opens no command");
{
	// The tuning byte of a sample load is not a VCMD, and treating it as one
	// would eat the tokens after it as arguments.
	const { commands } = tokenize('#0 ("kick.brr", $02) c4\n');
	check("no command claims $02", !commands.some((c) => c.vcmd === 0x02));
	check("the note still parses", commands.some((c) => c.kind === "c"));
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
	check("a note inside an unfinished command is still a note", stray.tokens.some((t) => t.kind === "note"));
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
	const { tokens } = tokenize('; a comment with $F5 in it\n#0 c4\n');
	check("the comment is one token", tokens[0].kind === "comment");
	check("the $F5 inside it is not a command", !tokenize("; $F5 $00\n").commands.length);

	const strung = tokenize('"a=b"\n#0 c4\n');
	check("a replacement directive reads as a string", strung.tokens[0].kind === "string");

	// An unterminated string is the state that must survive a line break.
	const open = tokenize('"unterminated\nstill inside"\n#0 c4\n');
	check("an unterminated string keeps running", open.tokens[0].kind === "string");
	check("and the channel after it recovers", open.tokens.some((t) => t.kind === "channel"));
}

console.log("\ndirectives and channels are told apart");
{
	const { tokens } = tokenize("#amk 4\n#samples\n#0 c4\n");
	check("#amk is a directive", tokens[0].kind === "directive");
	check("#samples is a directive", tokens.filter((t) => t.kind === "directive").length === 2);
	check("#0 is a channel", tokens.some((t) => t.kind === "channel"));
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
	check("everything after #2 is channel 2", across.every((c) => c.channel === 2));
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
}

console.log("\nthe scanner always makes progress");
{
	// Garbage in must not hang the editor.
	const nasty = " ~`%:!\\\n#0 éé $ $$ $Z c\n";
	const { tokens } = tokenize(nasty);
	check("a hostile document terminates and yields tokens", tokens.length > 0);
	check("every token advances", tokens.every((t) => t.end > t.start));
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

console.log(failures === 0 ? "\nAll token tests passed.\n" : `\n${failures} token test(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
