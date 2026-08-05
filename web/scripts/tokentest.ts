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

import { Tag, tags } from "@lezer/highlight";

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

/** The length of the note or rest written at `needle` — `undefined` for anything else. */
const lengthOf = (source: string, needle: string) => at(source, source.indexOf(needle))?.noteLength;

console.log("\nnotes and rests resolve their length");
{
	// getNoteLength (parser.ts:607-637), over the 192 ticks of a whole note. The
	// tooltip states the tick count outright, so a wrong fork here is a wrong
	// number on screen rather than a wrong colour.
	const plain = lengthOf("#0 c4\n", "c4");
	check("c4 is one segment", plain?.length === 1, `got ${plain?.length}`);
	check("of 48 ticks", plain?.[0].ticks === 48, String(plain?.[0].ticks));
	check("written as the denominator it was", plain?.[0].written === "4", plain?.[0].written);
	check("with no dots, no =, and nothing implied", plain?.[0].dots === 0 && !plain[0].exact && !plain[0].implicit);

	// parser.ts:198 — what the parser starts at, before any `l`.
	const bare = lengthOf("#0 c\n", "c");
	check("a bare c takes the standing default", bare?.[0].ticks === 24, String(bare?.[0].ticks));
	check("and says the length was implied", bare?.[0].implicit === true && bare[0].written === "");

	check("c8. is dotted", lengthOf("#0 c8.\n", "c8")?.[0].ticks === 36, String(lengthOf("#0 c8.\n", "c8")?.[0].ticks));
	check("c8.. doubles down", lengthOf("#0 c8..\n", "c8")?.[0].dots === 2);
	check("to 42 ticks", lengthOf("#0 c8..\n", "c8")?.[0].ticks === 42, String(lengthOf("#0 c8..\n", "c8")?.[0].ticks));

	const exact = lengthOf("#0 c=48\n", "c=48");
	check("c=48 is 48 ticks exactly", exact?.[0].ticks === 48 && exact[0].exact === true);
	check("c=48. dots an exact count under #amk 4", lengthOf("#0 c=48.\n", "c=48")?.[0].ticks === 72);

	check("a rest carries a length too", lengthOf("#0 r2\n", "r2")?.[0].ticks === 96);
	check("an accidental does not disturb it", lengthOf("#0 c+4\n", "c+4")?.[0].ticks === 48);
	// parser.ts:622 — outside 1..192 the written length is discarded entirely.
	check("c200 falls back to the default length", lengthOf("#0 c200\n", "c200")?.[0].ticks === 24);
	check("a command that is not a note carries none", at("#0 t144\n", 4)?.noteLength === undefined);
}

console.log("\na tie plays as one note");
{
	// accumulateTiedLength (parser.ts:2794) — every segment after a `^` belongs
	// to the note that opened the run, which is why the tooltip totals them
	// rather than describing the `^` on its own.
	const source = "#0 c4^8\n";
	const tied = lengthOf(source, "c4");
	check("c4^8 has two segments", tied?.length === 2, `got ${tied?.length}`);
	check("48 then 24", tied?.[0].ticks === 48 && tied[1].ticks === 24);
	check(
		"and one span over both",
		source.slice(at(source, 3)!.span.start, at(source, 3)!.span.end) === "c4^8",
		source.slice(at(source, 3)!.span.start, at(source, 3)!.span.end),
	);
	check("so the caret on the ^ finds the note", at(source, source.indexOf("^"))?.noteLength?.length === 2);

	const open = lengthOf("#0 c4^\n", "c4");
	check("a ^ with no digits continues at the default", open?.[1].ticks === 24 && open[1].implicit === true);

	const three = lengthOf("#0 c4^8^16\n", "c4");
	check("ties accumulate without limit", three?.length === 3, `got ${three?.length}`);
	check("48 + 24 + 12", three?.map((s) => s.ticks).join() === "48,24,12", three?.map((s) => s.ticks).join());

	check("spacing does not break the run", lengthOf("#0 c4 ^ 8\n", "c4")?.length === 2);
	check("a rest ties too", lengthOf("#0 r4^8\n", "r4")?.length === 2);

	// The note after a tie is a fresh command, and the segment the `^` opened
	// took the default rather than reaching forward for the `8`.
	const next = tokenize("#0 c4^d8\n").commands.filter((c) => c.noteLength);
	check("a note after a tie is its own command", next.length === 2 && next[1].kind === "d");
	check("and the tie's segment is implied, not the d's length", next[0].noteLength?.[1].implicit === true);
}

console.log("\nthe default length follows `l`");
{
	// parseDefaultLength (parser.ts:1524-1550). One field on the parser, never
	// reset — so it is one running value here, not one per channel.
	check("l16 makes a bare note 12 ticks", lengthOf("#0 l16 c\n", "c")?.[0].ticks === 12);
	check("l8. dots the default", lengthOf("#0 l8. c\n", "c")?.[0].ticks === 36);
	check("l=48 sets it exactly", lengthOf("#0 l=48 c\n", "c")?.[0].ticks === 48);
	check("l=48. dots that", lengthOf("#0 l=48. c\n", "c")?.[0].ticks === 72);

	// AMK0071 and AMK0070 are errors, and an error leaves the old length standing.
	check("l0 is an error, so the previous length stands", lengthOf("#0 l16 l0 c\n", "c")?.[0].ticks === 12);
	check("l200 likewise", lengthOf("#0 l16 l200 c\n", "c")?.[0].ticks === 12);

	check("the length crosses lines and channels", lengthOf("#0 l16\n#1 c\n", "c")?.[0].ticks === 12);
	check("and a written length still wins over it", lengthOf("#0 l16 c4\n", "c4")?.[0].ticks === 48);
	check("the l command itself carries no note length", at("#0 l16\n", 3)?.noteLength === undefined);
}

console.log("\ndots and exact lengths fork by dialect");
{
	// Music.cpp:2960 — Addmusic 4.05 stops after the second dot.
	const am4 = lengthOf("#am4\n#0 c8...\n", "c8");
	check("#am4 stops adding after two dots", am4?.[0].ticks === 42, String(am4?.[0].ticks));
	check("and counts only the dots it applied", am4?.[0].dots === 2, String(am4?.[0].dots));
	check("#amk 4 applies every one", lengthOf("#0 c8...\n", "c8")?.[0].ticks === 45);

	// parser.ts:619 — exact counts predate dots, so below #amk 4 the dot is not
	// theirs to take.
	check("under #am4 an exact count takes no dots", lengthOf("#am4\n#0 c=48.\n", "c=48")?.[0].ticks === 48);
	check("under #amk 4 it does", lengthOf("#0 c=48.\n", "c=48")?.[0].ticks === 72);

	// parser.ts:1548 and :1528 — `l`'s dots and its `=` form are both #amk 4 and
	// above, and neither is the same fork a note takes.
	check("under #am4, l ignores its dots", lengthOf("#am4\n#0 l8. c\n", "c")?.[0].ticks === 24);
	check("under #amk 1 too", lengthOf("#amk 1\n#0 l8. c\n", "c")?.[0].ticks === 24);
	check(
		"while l= is an error there, leaving the length standing",
		lengthOf("#am4\n#0 l16 l=48 c\n", "c")?.[0].ticks === 12,
	);
	check("and a note's own = still works", lengthOf("#am4\n#0 c=48\n", "c=48")?.[0].ticks === 48);
}

console.log("\na lone dot still lengthens the note before it");
{
	// `l8 c.` is ordinary MML: getInt finds no digits and getNoteLengthModifier
	// dots the standing default anyway (parser.ts:622-637). A lone `.` scans as
	// unknown — `step` reads one character with no memory of the token before it
	// — so `gather` is where it rejoins the note.
	const dotted = lengthOf("#0 c.\n", "c.");
	check("c. is the dotted default", dotted?.[0].ticks === 36, String(dotted?.[0].ticks));
	check("implied, and dotted once", dotted?.[0].implicit === true && dotted[0].dots === 1);
	check("c.. doubles down", lengthOf("#0 c..\n", "c.")?.[0].ticks === 42);
	check("it follows the standing length", lengthOf("#0 l4 c.\n", "c.")?.[0].ticks === 72);
	check("a rest takes one too", lengthOf("#0 r.\n", "r.")?.[0].ticks === 36);

	const tie = lengthOf("#0 c4^.\n", "c4");
	check("a tie's segment can be dotted alone", tie?.[1].ticks === 36, String(tie?.[1].ticks));

	const source = "#0 c.\n";
	check(
		"the span covers the dot",
		source.slice(at(source, 3)!.span.start, at(source, 3)!.span.end) === "c.",
		source.slice(at(source, 3)!.span.start, at(source, 3)!.span.end),
	);
}

console.log("\na triplet scales the notes inside it");
{
	// getNoteLengthModifier's second half (parser.ts:661-667): two thirds,
	// rounded half up, applied after the dots. A reader hovering a note wants
	// the length it plays at, so the brace state is followed here even though
	// the per-line colouring pass cannot carry it.
	const triplet = tokenize("#0 {c4 c4 c4}\n").commands.filter((c) => c.noteLength);
	check(
		"each note of {c4 c4 c4} plays 32 ticks",
		triplet.length === 3 && triplet.every((c) => c.noteLength?.[0].ticks === 32),
		triplet.map((c) => c.noteLength?.[0].ticks).join(),
	);
	check("and says so", triplet[0]?.noteLength?.[0].triplet === true);
	check("while the written denominator is untouched", triplet[0]?.noteLength?.[0].written === "4");

	const around = tokenize("#0 c4 {c4} c4\n").commands.filter((c) => c.noteLength);
	check(
		"the brace opens and closes",
		around.map((c) => c.noteLength?.[0].ticks).join() === "48,32,48",
		around.map((c) => c.noteLength?.[0].ticks).join(),
	);
	check("and only the middle one is flagged", around[2]?.noteLength?.[0].triplet === false);

	check("the default length is scaled too", lengthOf("#0 l4 {c}\n", "c}")?.[0].ticks === 32);
	check("dots go first, the triplet after", lengthOf("#0 {c4.}\n", "c4.")?.[0].ticks === 48);
	check(
		"a tie scales segment by segment",
		lengthOf("#0 {c4^8}\n", "c4")
			?.map((s) => s.ticks)
			.join() === "32,16",
	);
	check("a rest is a note here as anywhere", lengthOf("#0 {r4}\n", "r4")?.[0].ticks === 32);

	// floor(x * 2/3 + 0.5), so 7 ticks is 5 rather than 4.
	check("the two thirds round half up", lengthOf("#0 {c=7}\n", "c=7")?.[0].ticks === 5);

	// parser.ts:1549 is the one call that passes allowTriplet: false, so an `l`
	// inside a triplet sets the plain length and the notes scale it themselves.
	check("l is not scaled", lengthOf("#0 {l4}c\n", "c\n")?.[0].ticks === 48);

	// The early return at parser.ts:619-621 is ahead of both modifiers.
	const old = lengthOf("#am4\n#0 {c=48}\n", "c=48");
	check("an exact count below #amk 4 escapes it", old?.[0].ticks === 48 && old[0].triplet === false);

	check("the state crosses lines", lengthOf("#0 {\nc4\n", "c4")?.[0].ticks === 32);
	check("and channels, as the parser's own flag does", lengthOf("#0 {\n#1 c4\n", "c4")?.[0].ticks === 32);

	// AMK0097 reports the second `{` and leaves the one block open, so the
	// first `}` closes it (parser.ts:2037-2052).
	const nested = tokenize("#0 {{c4}c4\n").commands.filter((c) => c.noteLength);
	check(
		"a nested brace does not need two to close",
		nested.map((c) => c.noteLength?.[0].ticks).join() === "32,48",
		nested.map((c) => c.noteLength?.[0].ticks).join(),
	);
	check("and an unopened } leaves the note alone", lengthOf("#0 }c4\n", "c4")?.[0].ticks === 48);

	// #spc, #samples and #instruments are read by parseBlock, which eats their
	// brace before parseTripletOpen could see it (parser.ts:823-856).
	const block = '#instruments\n{\n\t"kick.brr" $FE $6A $B8 $03 $00\n}\n#0 c4\n';
	check("a block directive's brace is not a triplet", lengthOf(block, "c4")?.[0].ticks === 48);
	check("nor #samples'", lengthOf('#samples\n{\n\t"kick.brr"\n}\n#0 c4\n', "c4")?.[0].ticks === 48);
	// The case that makes the distinction worth drawing: half-typed, the block
	// never closes, and a plain toggle would two-thirds the rest of the song.
	check("an unclosed one does not either", lengthOf('#samples\n{\n\t"kick.brr"\n#0 c4\n', "c4")?.[0].ticks === 48);
	check("and a real triplet after one still works", lengthOf(`${block}#0 {c4}\n`, "c4}")?.[0].ticks === 32);
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

console.log("\nevery tag name resolves against @lezer/highlight");
{
	// The editor builds its tokenTable by looking TOKEN_TAGS values up on
	// `tags`. A name that misses — or that lands on one of the helper
	// *functions* that object also carries — would drop the highlight silently,
	// so this pins the name-resolution contract the adapter relies on.
	const names = [...new Set(Object.values(TOKEN_TAGS))];
	const unresolved = names.filter((name) => !((tags as unknown as Record<string, unknown>)[name] instanceof Tag));
	check("every TOKEN_TAGS value is a real Tag", unresolved.length === 0, unresolved.join(", "));
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

console.log("\na command knows which of its parts came through a macro");
{
	// The whole point of carrying provenance per part rather than per command:
	// `replacement` alone cannot tell "the bytes are not in the document" from
	// "the command byte is a macro and every argument is literal text", and only
	// the second of those can be rewritten in place. `compiler/edits.ts` asks
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
	check(
		"the bytes are the ones written",
		index.instruments[0]?.bytes.map((b) => b.value).join() === [0xfe, 0x6a, 0xb8, 0x03, 0x00].join(),
	);

	// Every byte carries its own span, which is what makes one of them editable
	// without rewriting the entry around it. Slicing the span back out of the
	// source is the assertion: an off-by-one would still be a plausible-looking
	// number, and only the text can tell.
	check(
		"each byte's span slices back to its own $XX",
		index.instruments[0]?.bytes.map((b) => source.slice(b.span.start, b.span.end)).join(" ") === "$FE $6A $B8 $03 $00",
	);
	check(
		"the sample span covers the name and nothing else",
		source.slice(index.instruments[0].sampleSpan.start, index.instruments[0].sampleSpan.end) === '"kick.brr"',
	);
	check(
		"and covers both tokens of the @n form",
		source.slice(index.instruments[1].sampleSpan.start, index.instruments[1].sampleSpan.end) === "@5",
	);
	check(
		"and of the noise form",
		source.slice(index.instruments[2].sampleSpan.start, index.instruments[2].sampleSpan.end) === "n1F",
	);

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

	// accumulateTiedLength folds consecutive rests into one the way it folds
	// ties (parser.ts:2802). Only `^` is folded here, so a rest's tooltip stays
	// about the rest under the caret.
	const rests = tokenize("#0 r4 r8\n").commands.filter((c) => c.noteLength);
	check("consecutive rests stay separate", rests.length === 2 && rests[0].noteLength?.length === 1);

	// A pitch bend ahead makes AMK rewind the last tied segment and emit it as
	// its own note (parser.ts:2810-2817). The scanner ties regardless.
	check("a $DD ahead does not break the tie", lengthOf("#0 c4^8 $DD $00 $00 $00\n", "c4")?.length === 2);

	// The same whitespace generosity as `t 144` above, and getNoteLength reads
	// digits at the cursor — so AMK sees a bare `c` and a stray `4` here.
	check("a spaced length is still the note's", lengthOf("#0 c 4\n", "c 4")?.[0].ticks === 48);

	// preprocess.ts resolves the target markers before the parser runs, so the
	// file's *last* effective marker governs the whole song — but a resumable
	// scanner can only apply one from its line down. Well-formed songs put the
	// marker before any music, where the two agree.
	const positional = tokenize("#0 $FC $05 $7F $01 $02\n#amk 1\n#1 $FC $05 $7F\n").commands.filter(
		(c) => c.vcmd === 0xfc,
	);
	check(
		"a mid-file marker applies from its line down, not to the whole file",
		positional[0]?.args.length === 4 && positional[1]?.args.length === 2,
		`got ${positional[0]?.args.length} and ${positional[1]?.args.length}`,
	);

	// preprocess's argument read stops at a line end (preprocess.ts:79-101), so
	// a real `#amk\n1` fails AMK0401 and compiles nothing; the one-shot here
	// cannot see line breaks. Harmless: it only recolours a broken song.
	const split = tokenize("#amk\n1\n#0 $FC $05 $7F\n").commands.find((c) => c.vcmd === 0xfc);
	check("the #amk version one-shot crosses a newline", split?.args.length === 2, `got ${split?.args.length}`);

	// An $ED $82 upload aimed at $6136 appends to the compiler's instrument
	// table (parser.ts:3384-3385), shifting `@30 + k` numbering; this pass
	// counts only #instruments blocks. Error-truncation shapes are not mirrored
	// either — e.g. $FA under #amm zeroes hexLeft on its error path
	// (parser.ts:2993-2996) — the compiler squiggles those, and the scanner
	// keeps AddmusicK's grouping.
	const hacked = tokenize(
		'#am4\n#0 $ED $82 $61 $36 $00 $05 $04 $FE $6A $B8 $03 $00\n#instruments\n{\n\t"kick.brr" $FE $6A $B8 $03 $00\n}\n',
	);
	check(
		"the HFD instrument hack does not shift @ numbering",
		hacked.instruments.length === 1 && hacked.instruments[0].number === 30,
	);
}

console.log("\na directive's bare-word argument is not music");
{
	// `#option smwvtable` used to colour as s, m, a global volume, a volume,
	// two notes and a default length — the report that added directiveWord.
	const source = "#amk 4\n#option smwvtable\n#0 w255 c4\n";
	const { tokens } = tokenize(source);
	const word = tokenAt(tokens, source.indexOf("smwvtable"));
	check("smwvtable is one directive token", word?.kind === "directive", word?.kind);
	check("all of it", word !== null && word.end - word.start === "smwvtable".length, `${word?.start}-${word?.end}`);
	check("the w after it is still a global volume", tokenAt(tokens, source.indexOf("w255"))?.kind === "globalVolume");
	check("and the note is still a note", tokenAt(tokens, source.indexOf("c4"))?.kind === "note");

	const divide = tokenize("#option dividetempo 3\n").tokens;
	check("dividetempo is a directive word", tokenAt(divide, "#option ".length)?.kind === "directive");
	check("its count stays a number", tokenAt(divide, "#option dividetempo ".length)?.kind === "number");

	const defines = tokenize("#define !loud 1\n#ifdef !loud\n#0 c4\n#endif\n").tokens;
	check("a define's name is part of the directive", tokenAt(defines, "#define ".length)?.kind === "directive");
	check("its value stays a number", tokenAt(defines, "#define !loud ".length)?.kind === "number");

	// The flag is consumed by whatever token comes next, word or not, so it
	// cannot lie in wait and swallow music further down.
	const cleared = tokenize("#option\n$EF $01 $02 $03 c4\n").tokens;
	check("a non-word consumes the flag", tokenAt(cleared, "#option\n".length)?.kind === "hex");
	check(
		"music after it is untouched",
		cleared.some((t) => t.kind === "note"),
	);
}

console.log("\nthe target markers pick the dialect");
{
	// parser.ts:2970 — #amk 1's $FC is remote gain and takes two arguments.
	const amk1 = tokenize("#amk 1\n#0 $FC $05 $7F c4\n").commands;
	const gain = amk1.find((c) => c.vcmd === 0xfc);
	check("under #amk 1, $FC takes two arguments", gain?.args.length === 2, `got ${gain?.args.length}`);
	check("and is complete", gain?.complete === true);
	check("and is named remote gain", gain?.name === "remote gain", gain?.name);
	check("and carries its dialect", gain?.target.amkVersion === 1 && gain.target.program === 0);
	check(
		"the note after it survives",
		amk1.some((c) => c.kind === "c"),
	);

	// The flip point pins scanHex and expectedArgs against each other.
	const short = tokenize("#amk 1\n#0 $FC $05\n").commands.find((c) => c.vcmd === 0xfc);
	check("one argument short is incomplete", short?.complete === false);

	const amk4 = tokenize("#amk 4\n#0 $FC $05 $7F $01 $02\n").commands.find((c) => c.vcmd === 0xfc);
	check("under #amk 4, $FC takes four", amk4?.args.length === 4, `got ${amk4?.args.length}`);
	check("and is named remote code", amk4?.name === "remote code", amk4?.name);

	// The pre-spaced form (preprocess.ts:163-171) arrives as the number `=1`.
	const eq = tokenize("#amk=1\n#0 $FC $05 $7F c4\n").commands.find((c) => c.vcmd === 0xfc);
	check("#amk=1 selects version 1", eq?.args.length === 2, `got ${eq?.args.length}`);

	// preprocess reads the directive word whole (preprocess.ts:173), so `#amk4`
	// is an unknown directive, not a marker.
	const glued = tokenize("#amk4\n#0 $FC $05 $7F $01 $02\n").commands.find((c) => c.vcmd === 0xfc);
	check("#amk4 without a space is no marker", glued?.args.length === 4, `got ${glued?.args.length}`);

	// preprocess.ts:323 — once a legacy marker is seen, a later #amk is ignored…
	const guarded = tokenize("#am4\n#amk 4\n#0 $ED $80 $6C $20 c4\n").commands.find((c) => c.vcmd === 0xed);
	check("#amk after #am4 is ignored", guarded?.args.length === 3, `got ${guarded?.args.length}`);

	// …while a later legacy marker always wins (preprocess.ts:340-345).
	const amm = tokenize("#amk 4\n#amm\n#0 $E7 $10\n").commands.find((c) => c.vcmd === 0xe7);
	check("a later #amm wins over #amk", amm?.target.program === 2, String(amm?.target.program));

	const flipped = tokenize("#amm\n#am4\n#0 $ED $81 $05 c4\n").commands.find((c) => c.vcmd === 0xed);
	check("a later #am4 wins over #amm", flipped?.args.length === 2 && flipped.name === "tune", flipped?.name);

	// parser.ts:181-182 — before any marker, the parser assumes #amk 4.
	const bare = tokenize("#0 $FC $01 $02 $03 $04\n").commands.find((c) => c.vcmd === 0xfc);
	check("no marker means the #amk 4 default", bare?.target.program === 0 && bare.target.amkVersion === 4);
}

console.log("\n#am4's $ED is HFD's escape");
{
	// parseHFDHex (parser.ts:3286, Music.cpp:1466) — the sub-byte picks the form.
	const dsp = tokenize("#am4\n#0 $ED $80 $6C $20 c4\n").commands.find((c) => c.vcmd === 0xed);
	check("$ED $80 takes a register and a value", dsp?.args.length === 3, `got ${dsp?.args.length}`);
	check("and is complete", dsp?.complete === true);
	check("and is named as the DSP write it compiles to", dsp?.name === "DSP write", dsp?.name);

	const tune = tokenize("#am4\n#0 $ED $81 $05 $E7 $10\n").commands;
	const tuned = tune.find((c) => c.vcmd === 0xed);
	check("$ED $81 takes one value", tuned?.args.length === 2, `got ${tuned?.args.length}`);
	check("and is named tune", tuned?.name === "tune", tuned?.name);
	check("the byte after it opens its own command", tune.find((c) => c.vcmd === 0xe7)?.args.length === 1);

	// $ED $82: address, then a big-endian count of the data bytes that follow —
	// count+1 of them, the do-while at parser.ts:3390.
	const upload = tokenize("#am4\n#0 $ED $82 $61 $00 $00 $02 $AA $BB $CC c4\n").commands;
	const block = upload.find((c) => c.vcmd === 0xed);
	check("$ED $82 reads its count and the data", block?.args.length === 8, `got ${block?.args.length}`);
	check("and is complete", block?.complete === true);
	check("and is named ARAM upload", block?.name === "ARAM upload", block?.name);
	check(
		"the note after the data survives",
		upload.some((c) => c.kind === "c"),
	);

	const shortData = tokenize("#am4\n#0 $ED $82 $61 $00 $00 $02 $AA $BB\n").commands.find((c) => c.vcmd === 0xed);
	check("one data byte short is incomplete", shortData?.complete === false);

	const noCount = tokenize("#am4\n#0 $ED $82 $61 $00\n").commands.find((c) => c.vcmd === 0xed);
	check("a header cut before its count is incomplete", noCount?.complete === false);

	const adsr = tokenize("#am4\n#0 $ED $05 $7F c4\n").commands.find((c) => c.vcmd === 0xed);
	check("a low sub-byte is the plain ADSR form", adsr?.args.length === 2 && adsr.complete, `got ${adsr?.args.length}`);
	check("named as such", adsr?.name === "ADSR / GAIN", adsr?.name);

	// AMK0163 is the compiler's diagnostic; the scanner just ends the run.
	const bad = tokenize("#am4\n#0 $ED $83 c4\n").commands.find((c) => c.vcmd === 0xed);
	check("$ED $83 takes nothing further", bad?.args.length === 1 && bad.complete === true);

	const amk = tokenize("#amk 4\n#0 $ED $80 $A0 c4\n").commands.find((c) => c.vcmd === 0xed);
	check("under #amk 4, $ED is two-argument ADSR", amk?.args.length === 2, `got ${amk?.args.length}`);
}

console.log("\n#am4's $E5 forks on its first argument");
{
	// Music.cpp:1820, parser.ts:3014-3031 — a high bit means "load sample".
	const load = tokenize("#am4\n#0 $E5 $85 $04 c4\n").commands.find((c) => c.vcmd === 0xe5);
	check("a high first argument is a sample load", load?.args.length === 2, `got ${load?.args.length}`);
	check("named as the $F3 it compiles to", load?.name === "sample load", load?.name);
	check("and complete", load?.complete === true);

	const trem = tokenize("#am4\n#0 $E5 $20 $30 $40 c4\n").commands.find((c) => c.vcmd === 0xe5);
	check("a low first argument stays tremolo", trem?.args.length === 3 && trem.name === "tremolo", trem?.name);

	const amk = tokenize("#amk 4\n#0 $E5 $85 $04 $01\n").commands.find((c) => c.vcmd === 0xe5);
	check("no fork outside #am4", amk?.args.length === 3, `got ${amk?.args.length}`);
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
		// A directive's word argument on the next line — the parser's skipSpaces
		// crosses the break, so the flag must too, and a restart between the two
		// must still colour the word as part of the directive.
		"#option\nsmwvtable\n#0 c4\n",
		// The dialect fields cross every line below the marker.
		"#am4\n#0 $ED $80 $6C\n$E7 $10 c4\n",
		// awaitingHfdSub itself crosses the break — the parser's skipSpaces allows it.
		"#am4\n#0 $ED\n$80 $6C $20 c4\n",
		// An $ED $82 split inside its header: hfdCountHi crosses the break…
		"#am4\n#0 $ED $82 $61 $00\n$00 $02 $AA $BB $CC c4\n",
		// …and split between the count bytes, so the extension lands right after a restart.
		"#am4\n#0 $ED $82 $61 $00 $00\n$02 $AA $BB $CC c4\n",
		// The #amk version one-shot crossing the break (the pinned approximation).
		"#amk\n1\n#0 $FC $05 $7F c4\n",
		// A mid-file #amm: the dialect changes partway down the document.
		"#amk 4\n#0 c4\n#amm\n$FA $02 $05 c4\n",
		// #am4's shortened sample-load form split at the break.
		"#am4\n#0 $E5 $85\n$04 c4\n",
		// #amk 1's two-argument $FC split, with a fresh command right after.
		"#amk 1\n#0 $FC $05\n$7F $E7 $10\n",
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
