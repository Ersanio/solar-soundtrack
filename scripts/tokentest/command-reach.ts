/** `tokentest`: what a command reaches (`commandScope`), and the parse-time half of what is in force on a note. */

import "../localize";
import { LETTER_NAMES, tokenize, VCMD_NAMES } from "@amk/tokens";
import { type CommandScope, commandScope, parseTimeInForce } from "@amk/tokens/commands/in-force";
import { check, section } from "../harness";
import { inForceAt } from "./support";

// ---------------------------------------------------------------------------
section("what a command reaches, and what the source alone can answer");
// ---------------------------------------------------------------------------
//
// The piano roll draws a glyph per command acting on a note. Two halves answer
// that and they must not overlap: anything that emits a VCMD is named by the
// walk, at the address the driver read it from, and the rest — `q`, `h` and
// `@21`-`@29`, which emit nothing — is named here. A command answered twice
// draws two glyphs for one setting; one answered neither way draws none.
{
	// Exhaustive, because a table that quietly loses an entry is a command the
	// roll silently stops drawing.
	const missing: string[] = [];
	const scopes = new Set<CommandScope>();
	for (const vcmd of Object.keys(VCMD_NAMES).map(Number)) {
		const source = `#amk 4\n#0 $${vcmd.toString(16).toUpperCase()}\n`;
		const command = tokenize(source).commands.find((entry) => entry.vcmd === vcmd);
		if (command === undefined) {
			missing.push(`${vcmd.toString(16)}`);
			continue;
		}

		scopes.add(commandScope(command));
	}

	check("every VCMD is gathered and scoped", missing.length === 0, missing.join(" "));

	const letters = Object.keys(LETTER_NAMES).filter((letter) => letter !== "<" && letter !== ">");
	const unscoped: string[] = [];
	for (const letter of letters) {
		const source = `#amk 4\n#0 ${letter}1\n`;
		const command = tokenize(source).commands.find((entry) => entry.kind.toLowerCase() === letter);
		if (command === undefined) {
			unscoped.push(letter);
			continue;
		}

		scopes.add(commandScope(command));
	}

	check("every named letter but the octave shifts is gathered", unscoped.length === 0, unscoped.join(" "));

	// `<` and `>` never become commands at all — `octaveShift` is absent from
	// `LETTER_COMMAND_KINDS` — so `commandScope` is never asked about them and
	// the roll has nothing to draw. Worth pinning, since they *are* in
	// `LETTER_NAMES` and reading that table would suggest otherwise.
	check(
		"an octave shift is not a command",
		tokenize(`#amk 4\n#0 c > d\n`).commands.every((command) => command.kind !== ">"),
	);

	const arms: CommandScope[] = ["note-state", "song", "position", "structure"];
	const unused = arms.filter((arm) => !scopes.has(arm));
	check("and every scope is reached by something", unused.length === 0, unused.join(", "));
}

// The exclusions, stated as the roll asks the question.
{
	const source = `#amk 4\n#0 t144 w200 o4 l8 $E4 $00 $EF $FF $28 $28 $F5 $7F $00 $00 $00 $00 $00 $00 $00 [ c8 ]2 *2\n`;
	const drawn = tokenize(source)
		.commands.filter((command) => commandScope(command) === "note-state")
		.map((command) => source.slice(command.span.start, command.span.end));
	check("nothing song-wide, positional or structural is note state", drawn.length === 0, drawn.join(" | "));
}

// The parse-time half. Exact rather than approximate: `parser.ts` resolves these
// in one textual pass, so the `q` before a note in the source is the `q` that
// went into the bytes of every pass of it.
{
	const under = inForceAt(`#amk 4\n#0 q7f h2 c8 d8 q6e e8\n#1 f8\n`);
	check("a q and an h carry forward to the notes after them", under("c8") === "q7f h2");
	check("and to the one after that", under("d8") === "q7f h2");
	check("a second q replaces the first", under("e8") === "q6e h2");
	check("and none of it reaches another channel", under("f8") === "");
}

// Above the first marker a command is on the starting channel, and the parser's
// `q[channel]` and `instrument[channel]` survive the marker — so a `q` or a
// drum `@` written there is what the channel's first note goes out under.
// `parseQuantization` writes `q[prevChannel]` from inside a `[ ]` body too
// (Music.cpp:684-687), which is why the remote definition's `q` counts:
// `selftest` pins the bytes, `18 40 A4`.
{
	check("a q above the first channel is the q of its first note", inForceAt(`#amk 4\nq40\n#0 c8\n`)("c8") === "q40");
	check(
		"and so is one inside a remote definition above it",
		inForceAt(`#amk 4\n(!1)[q40 $F4 $09]\n#0 c8\n`)("c8") === "q40",
	);
	check(
		"a percussion @ above the first channel reaches its first note",
		inForceAt(`#amk 4\n@21\n#0 c8\n`)("c8") === "@21",
	);
	check(
		"and it is the lowest channel declared that they reach, not the first",
		inForceAt(`#amk 4\nq40\n#3 d8\n#0 c8\n`)("c8") === "q40" && inForceAt(`#amk 4\nq40\n#3 d8\n#0 c8\n`)("d8") === "",
	);
}

// `h` is one variable in the parser and every `#N` resets it (`parseHash`,
// Music.cpp:569) — including a marker re-entering the channel it is on, which
// is what a channel written in two blocks does.
{
	check("an h above the first channel reaches nothing", inForceAt(`#amk 4\nh5\n#0 c8\n`)("c8") === "");

	const split = inForceAt(`#amk 4\n#0 h5 c8\n#1 d8\n#0 e8\n`);
	check("an h holds until the channel's block ends", split("c8") === "h5");
	check("and a second block of the same channel does not inherit it", split("e8") === "");

	const twice = inForceAt(`#amk 4\n#0 h5 c8\n#0 d8\n`);
	check("even when the two blocks are back to back", twice("d8") === "");

	// A `q` is per channel and survives the marker, so the same song keeps it.
	const kept = inForceAt(`#amk 4\n#0 q40 c8\n#1 d8\n#0 e8\n`);
	check("where a q does carry into the channel's second block", kept("e8") === "q40");

	// A malformed marker is reported and resets nothing (AMK0031).
	check("a marker the compiler rejects resets nothing", inForceAt(`#amk 4\n#0 h5 c8\n#9 d8\n`)("d8") === "h5");
}

// `@21`-`@29` emit no `$DA`, so they are this half's; every other `@` emits one
// and is the walk's. Reporting both would draw two instrument glyphs on one note.
{
	const held = (source: string) => {
		const index = tokenize(source);
		const note = index.commands.find((command) => command.noteLength !== undefined);
		return note === undefined ? -1 : (parseTimeInForce(index, source).get(note) ?? []).length;
	};

	check("a percussion @ is answered here", held(`#amk 4\n#0 @21 c8\n`) === 1);
	check("a pitched @ is left to the walk", held(`#amk 4\n#0 @1 c8\n`) === 0);
	check("and @@21 is direct, so it emits and is left to the walk too", held(`#amk 4\n#0 @@21 c8\n`) === 0);
}

// The drum slot is `instrument[channel]` as the parser keeps it, and this half
// answers what was *folded* into each note byte — `selftest` pins the bytes for
// every song here. Which drum a later note still sounds on is the walk's
// (`WalkNote.drumFrom`), and `walktest` pins the join.
{
	// Music.cpp:2178-2183 — the first pitched note the remap folds clears it,
	// except on #6 and #7 under #amk, where every note stays a drum.
	const once = inForceAt(`#amk 4\n#0 @21 c8 d8\n`);
	check("on #0 the drum @ folds into one note", once("c8") === "@21" && once("d8") === "");
	const sfx = inForceAt(`#amk 4\n#6 @21 c8 d8\n`);
	check("and on #6 into every note", sfx("c8") === "@21" && sfx("d8") === "@21");
	check("but under #am4 into one note on #6 as well", inForceAt(`#am4\n#6 @21 c8 d8\n`)("d8") === "");
	check("a rest is not folded, so it clears nothing", inForceAt(`#amk 4\n#0 @21 r8 c8\n`)("c8") === "@21");

	// Music.cpp:1239 — a `[` copies the drum state into the loop block, and a `]`
	// copies nothing back: what the body writes dies with it, and what stood
	// before it stands again.
	const inside = inForceAt(`#amk 4\n#0 [ @21 c8 ]2 d8\n`);
	check("a drum @ inside a [ ] reaches its body", inside("c8") === "@21");
	check("and not the note after the ]", inside("d8") === "");
	const restored = inForceAt(`#amk 4\n#0 @21 [ @0 c8 ]2 d8\n`);
	check("a body's @0 takes the copy", restored("c8") === "");
	check("and the ] gives the channel's own @21 back", restored("d8") === "@21");
	const copied = inForceAt(`#amk 4\n#0 @21 [ c8 ]2 d8\n`);
	check("the copy folds the body's first note", copied("c8") === "@21");
	check("and its clearing is the copy's, so the note after the ] is a drum too", copied("d8") === "@21");

	// `[[ ]]` never leaves the channel (`handleSuperLoopEnter`), so there is no copy.
	check("a subloop's @0 is the channel's own", inForceAt(`#amk 4\n#0 @21 [[ @0 c8 ]]2 d8\n`)("d8") === "");
	const nested = inForceAt(`#amk 4\n#0 [ c8 [[ @21 d8 ]]2 e8 ]2 f8\n`);
	check(
		"and inside a [ ] its brackets are stepped over",
		nested("d8") === "@21" && nested("e8") === "" && nested("f8") === "",
	);

	// Music.cpp:908 — only `@` writes `instrument[channel]`; a raw `$DA` emits and
	// leaves the remap standing.
	check("a $DA does not take the drum slot", inForceAt(`#amk 4\n#6 @21 c8 $DA $00 d8\n`)("d8") === "@21");
	check("though on #0 the first note has already cleared it", inForceAt(`#amk 4\n#0 @21 c8 $DA $00 d8\n`)("d8") === "");
}
