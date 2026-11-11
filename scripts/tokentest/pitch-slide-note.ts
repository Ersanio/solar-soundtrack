/** `tokentest`: `$DD`'s note target and `bendAnchor`, and a remote call's `$` wait read as an argument. */

import "../localize";
import { type TokenKind, DEFAULT_TARGET, expectedArgs, tokenize } from "@amk/tokens";
import { bendAnchor } from "@amk/tokens/command-hazards";
import { check, section } from "../harness";
import { said, tokenAt, inForceAt } from "./support";

// `$DD`'s last parameter may be a written note instead of a byte, and it is the
// only command in AddmusicK that takes one: `parseNote` is dispatched from one
// place and `getPitch` called from one, and the only note-letter test anywhere
// else is this hack (Music.cpp:2027). The parser settles it with a lookahead
// from the second argument (parser.ts:parseHexCommand, Music.cpp:2012-2042);
// `step` may not look at another line, so it is deferred to the tokens that
// follow and cleared by default. What goes wrong when the run is left open is
// the whole of issue #28: the *next* `$XX` in the document scans as this
// command's last argument, and the one after that is right again.
section("$DD takes a note as its last parameter");
{
	/** The `$DD`s and the kind of the `$XX` after them, which is what the bug moved. */
	const read = (source: string): { targets: string[]; after: TokenKind | undefined } => {
		const index = tokenize(source);
		return {
			targets: index.commands
				.filter((command) => command.vcmd === 0xdd)
				.map((command) => `${command.noteTarget?.text ?? "-"}${command.complete ? "" : "!"}`),
			after: tokenAt(index.tokens, source.indexOf("$E7"))?.kind,
		};
	};

	/** A source with the run open, the given text, then a fresh command. */
	const after = (between: string): { targets: string[]; after: TokenKind | undefined } =>
		read(`#amk 4\n#0 c4 $DD $00 $18 ${between} $E7 $10 d4\n`);

	const chained = tokenize("#amk 4\n#0 o4 c4 $DD $00 $18 g $DD $00 $18 a $DD $00 $18 b\n");
	const bends = chained.commands.filter((command) => command.vcmd === 0xdd);
	check("every chained $DD is a command", bends.length === 3, `got ${bends.length}`);
	check(
		"each takes two bytes and a note",
		bends.every((command) => command.args.length === 2 && command.complete && command.noteTarget !== undefined),
		bends.map((command) => `${command.args.length}/${command.complete}`).join(" "),
	);
	check(
		"and each is coloured as a command, not as an argument",
		bends.every((command) => tokenAt(chained.tokens, command.span.start)?.kind === "hex"),
	);

	// The issue's other half: neither the scanner nor the parser resets `hexLeft`
	// at a marker, so a `hexLeft` left standing would reach the next channel.
	const across = "#amk 4\n#0 c4 $DD $00 $18 g\n#1 $E7 $10 c4\n";
	check("a run closed by a note does not leak past a #N", read(across).after === "hex");

	// The target's own token, and the span the command grew over it — which is
	// what makes a removal take the two together and `commandAt` answer the
	// `$DD` for a caret on the note.
	const one = "#amk 4\n#0 c4 $DD $00 $18 g8 d4\n";
	const index = tokenize(one);
	check("the target is not a note token", tokenAt(index.tokens, one.indexOf("g8"))?.kind === "hexNote");
	check(
		"the command's span reaches to the letter and stops",
		one.slice(
			index.commands.find((c) => c.vcmd === 0xdd)?.span.start ?? 0,
			index.commands.find((c) => c.vcmd === 0xdd)?.span.end ?? 0,
		) === "$DD $00 $18 g",
	);
	// `parseNote` returns before it reads a length (parser.ts:parseNote), so the
	// `8` is a stray digit the parser reports as AMK0100 — not part of the
	// command, and the note command it does belong to is still raised.
	check(
		"the target still raises its own note command",
		index.commands.some((c) => c.kind === "g"),
	);

	// The all-hex form is untouched, and `expectedArgs` is untouched with it:
	// the note changes where the third parameter is written, not how many there
	// are, so the fork lives in `gather` alone.
	const bytes = after("$A4");
	check("a byte target still gathers three arguments", read("#amk 4\n#0 $DD $00 $18 $A4\n").targets.join() === "-");
	check("and the command after it is still a command", bytes.after === "hex");
	check("expectedArgs is not forked", expectedArgs(0xdd, [], DEFAULT_TARGET) === 3);

	// What the lookahead steps over. Each of these emits no byte, so the target
	// still follows the command's own three.
	for (const [name, between] of [
		["a plain note", "g"],
		["an upper-case note", "G"],
		["an o and its digits", "o5 c"],
		["octave shifts", ">> c"],
		["both", "o5 >> c"],
		["a comment and a line break", "; why\nc"],
		["a bare line break", "\nc"],
		// `getInt` reads nothing after a bare `o`, and the loop's own `skipSpaces`
		// then lands on the note — so an `o` with no digits still crosses.
		["an o with no digits", "o c"],
		["an o at the end of a line", "o\nc"],
	] as const) {
		const got = after(between);
		check(
			`the lookahead crosses ${name}`,
			got.targets.length === 1 && !got.targets[0].endsWith("!"),
			got.targets.join(),
		);
		check(`and closes the run at ${name}`, got.after === "hex", String(got.after));
	}

	// And what ends it. These are the cases that stop the fix over-firing: the
	// parser's loop breaks on anything it does not name, and the run then takes
	// its last argument from the next `$XX` as `parseHexCommand` does.
	for (const [name, between, closes] of [
		["a rest", "r4", false],
		["a tie", "^ c", false],
		// The one `ddTargetOctave` buys: `getInt` skips no spaces, so `o5` carries
		// the lookahead where a bare digit and a spaced one both end it.
		["a bare digit", "5 c", false],
		["a spaced o", "o 5 c", false],
		// The same digits one line down. They are nobody's argument there either,
		// so the lookahead ends on them rather than on the note after.
		["an o whose digits are on the next line", "o\n5 c", false],
		// Music.cpp:2018 tests the raw character where isNoteLetter takes either
		// case, so an upper-case O is not the `o` the lookahead names.
		["an upper-case O", "O5 c", false],
		// `|` abandons the run outright (parser.ts:scan), so the next `$XX` is a
		// command again — by a different route from the note's.
		["a bar line", "| c", true],
		["a marker", "\n#1 c", false],
	] as const) {
		const got = after(between);
		check(`${name} ends the lookahead`, got.targets.join() === "-!", got.targets.join());
		check(
			`and ${closes ? "abandons" : "leaves"} the run at ${name}`,
			got.after === (closes ? "hex" : "hexArg"),
			String(got.after),
		);
	}

	// A target keys nothing on, so a second `$DD` written straight after one has
	// no note in front of it — which is what the inspector's reachability line
	// says, and what `main.asm:L_10E4` means by reading the byte at the track
	// pointer. Counting the target as a note put a plausible tick figure there.
	const chain = tokenize("#amk 4\n#0 o4 c4 $DD $00 $18 e $DD $00 $18 g\n");
	const slides = chain.commands.filter((command) => command.vcmd === 0xdd);
	check("the first slide rides on the note before it", said(bendAnchor(slides[0], chain)) === "rides:48");
	check("and the second rides on nothing", said(bendAnchor(slides[1], chain)) === "nothing");

	// A fourth departure, and `packages/mml-tokens/CLAUDE.md` lists it. `Music.cpp:2029` reads
	// `text[pos]` raw, with no `doReplacement` in front of it, so AMK decides the
	// lookahead on the macro's *name* and then expands it — and where the
	// expansion holds no note, `nextNoteIsForDD` leaks onto the next real note in
	// the song. A model whose tokens are spans cannot say that. The replacement
	// arm clears the flag instead, which errs the safe way: the run stays open
	// and the next `$XX` colours as its argument, which is what it did before.
	const macro = read('#amk 4\n"g=v200"\n#0 c4 $DD $00 $18 g $E7 $10 d4\n');
	check("a replacement in the lookahead ends it", macro.targets.join() === "-!", macro.targets.join());
	check("and leaves the run open", macro.after === "hexArg", String(macro.after));

	// The regression guard that matters most. `parseNote` resolves the target's
	// pitch — applying the `@21`-`@29` remap and **clearing** it — before the
	// `nextNoteIsForDD` return, so the target consumes the drum like any other
	// pitched letter. That only holds while `gather` keeps raising a note command
	// for it, which nothing else here would notice.
	const drum = inForceAt("#amk 4\n#0 @21 $DD $00 $18 c d\n");
	check("a $DD target takes the drum @", drum("c") === "@21", drum("c"));
	check("and clears it behind itself", drum("d") === "", drum("d"));
	const sfx = inForceAt("#amk 4\n#6 @21 $DD $00 $18 c d\n");
	check("but not on #6, where the remap survives its note", sfx("d") === "@21", sfx("d"));
}

// A remote call's wait is read with `getHex` (parser.ts:2356-2358, Music.cpp:1090-1094),
// so any byte written there is an argument. One in `$DA`-`$FE` read as a VCMD
// would open a command nobody wrote and take the next real `$XX` as its argument.
section("a remote call's $ wait is an argument");
{
	/** The VCMDs gathered, with how many arguments each took. */
	const vcmds = (source: string): string =>
		tokenize(source)
			.commands.filter((command) => command.vcmd !== undefined)
			.map((command) => `$${command.vcmd?.toString(16).toUpperCase()}/${command.args.length}`)
			.join(" ");

	const head = "#amk 4\n(!1)[$F4 $09]\n#0 ";
	check("a wait of $E0 opens nothing", vcmds(`${head}(!1, 1, $E0) $ED $0F $E0 c4\n`) === "$F4/1 $ED/2");
	check(
		"nor across a line break, which skipSpaces crosses",
		vcmds(`${head}(!1, 1,\n$E0) $ED $0F $E0 c4\n`) === "$F4/1 $ED/2",
	);
	check("a $ written after the call is a command again", vcmds(`${head}(!1, 3) $E0 $10 c4\n`) === "$F4/1 $E0/1");
	// Cleared by default, so a call left open ends at the first token that is
	// not part of one rather than reaching down the song.
	check("an unclosed call ends at a note", vcmds(`${head}(!1, 3 c4 $E7 $10\n`) === "$F4/1 $E7/1");
	check("a sample load is not a call", vcmds(`#amk 4\n#0 ("kick.brr", $02) $E7 $10\n`) === "$E7/1");
}
