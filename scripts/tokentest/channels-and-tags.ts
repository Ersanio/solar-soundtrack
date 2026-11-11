/**
 * `tokentest`: comments and strings, directives and channel markers, the
 * channel a command is written under, remote definitions, lookup by offset, and
 * the highlight tags.
 */

import "../localize";
import { Tag, tags } from "@lezer/highlight";
import { commandAt, tokenize, TOKEN_TAGS } from "@amk/tokens";
import { check, section } from "../harness";
import { tokenAt } from "./support";

section("comments and strings");
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

section("directives and channels are told apart");
{
	const { tokens } = tokenize("#amk 4\n#samples\n#0 c4\n");
	check("#amk is a directive", tokens[0].kind === "directive");
	check("#samples is a directive", tokens.filter((t) => t.kind === "directive").length === 2);
	check(
		"#0 is a channel",
		tokens.some((t) => t.kind === "channel"),
	);
}

section("commands carry the channel they were written under");
{
	// Source order is execution order within one channel and meaningless across
	// them, so anything reasoning about "runs after" needs this.
	const { commands } = tokenize("#amk 4\n#0 $F5 $7F $00 $00 $00 $00 $00 $00 $00\n#3 $F1 $05 $60 $00\n");
	const fir = commands.find((c) => c.vcmd === 0xf5);
	const echo = commands.find((c) => c.vcmd === 0xf1);
	check("the $F5 is in channel 0", fir?.channel === 0, String(fir?.channel));
	check("the $F1 is in channel 3", echo?.channel === 3, String(echo?.channel));

	// Above the first marker a command is on the channel the compiler starts
	// on, which `parser.ts:detectStartingChannel` (Music.cpp:385-400) takes as
	// the lowest `#N` found anywhere in the text — the first it *finds*, probing
	// `#0` up through `#7`, not the first the song declares — and 0 without one.
	const before = tokenize("$F5 $7F $00 $00 $00 $00 $00 $00 $00\n").commands[0];
	check("a command before any channel is on channel 0 when the song has none", before?.channel === 0);
	const lowest = tokenize("$ED $7F $E0\n#3 c8\n#0 c8\n").commands[0];
	check("and on the lowest channel the song declares, not the first", lowest?.channel === 0, String(lowest?.channel));
	const three = tokenize("$ED $7F $E0\n#3 c8\n#5 c8\n").commands[0];
	check("which is #3 in a song without #0", three?.channel === 3, String(three?.channel));
	// The probe is a substring search, so `#08` reads as `#0` there — and then
	// fails as a directive (AMK0031) and leaves the channel where it was.
	const substring = tokenize("$ED $7F $E0\n#08 c8\n#3 c8\n").commands;
	check('#08 makes the starting channel 0, as text.find("#0") does', substring[0]?.channel === 0);
	check(
		"and does not switch to channel 8, which the compiler rejects",
		substring.find((c) => c.noteLength !== undefined)?.channel === 0,
	);

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

section("a remote code definition is marked, and is not the starting channel's music");
{
	// Music.cpp:1015 tells a definition from a call by position alone, so one can
	// only sit above the first `#N` and its brackets gather on the starting
	// channel. The body compiles to the loop block and runs where a `$FC` fires
	// it, which is what the mark says and `channel` cannot.
	const source = "#amk 2\n(!1)[$F4 $02]\n#0 [c4]2\n";
	const { commands } = tokenize(source);
	const marked = commands.filter((c) => c.inRemoteDefinition);
	check("the body and both its brackets are marked", marked.length === 3, String(marked.length));
	check(
		"and are still reported on the starting channel",
		marked.every((c) => c.channel === 0),
	);
	check(
		"the channel's own loop below the marker is not",
		commands.filter((c) => c.span.start > source.indexOf("#0")).every((c) => c.inRemoteDefinition === undefined),
	);

	// `[` inside `[[` is allowed (parser.ts:parseLoopStart), so the body's own
	// brackets are counted rather than the first `]` closing the definition.
	const nested = tokenize("#amk 2\n(!1)[ [[ $F4 $02 ]]2 ]\n#0 c4\n").commands;
	check(
		"a subloop inside a body does not close it early",
		nested.filter((c) => c.inRemoteDefinition).length === 7,
		String(nested.filter((c) => c.inRemoteDefinition).length),
	);
	check("and the note below the marker is left clear", nested.at(-1)?.inRemoteDefinition === undefined);

	// Below the marker the same syntax is a call, and `(` and `!` are not command
	// kinds — so there is nothing there to mark either way.
	const called = "#amk 2\n(!1)[$F4 $02]\n#0 c4 (!1, 1, 8) d4\n";
	check(
		"a remote call below the marker is not marked",
		tokenize(called)
			.commands.filter((c) => c.span.start > called.indexOf("#0"))
			.every((c) => c.inRemoteDefinition === undefined),
	);

	// A `[ ]` above the first `#N` that no `(!n)` armed is the starting channel's
	// own music, and is marked by nothing.
	const plain = tokenize("#amk 2\n[$F4 $02]2\n#0 c4\n").commands;
	check(
		"a plain loop above the marker stays the channel's own",
		plain.every((c) => c.inRemoteDefinition === undefined) && plain.some((c) => c.kind === "["),
	);
}

section("lookup");
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

section("every kind has a highlight tag");
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

section("every tag name resolves against @lezer/highlight");
{
	// The editor builds its tokenTable by looking TOKEN_TAGS values up on
	// `tags`. A name that misses — or that lands on one of the helper
	// *functions* that object also carries — would drop the highlight silently,
	// so this pins the name-resolution contract the adapter relies on.
	const names = [...new Set(Object.values(TOKEN_TAGS))];
	const unresolved = names.filter((name) => !((tags as unknown as Record<string, unknown>)[name] instanceof Tag));
	check("every TOKEN_TAGS value is a real Tag", unresolved.length === 0, unresolved.join(", "));
}
