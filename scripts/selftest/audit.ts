/** `selftest`: the divergences a line-by-line reading against AddmusicK 1.0.11 found, a case each. */

import "../localize";
import { check, section } from "../harness";
import { compile, LIBRARY, hex } from "./support";

// ---------------------------------------------------------------------------
// Divergences found by reading the port against AddmusicK 1.0.11 line by line.
// Every one of these compiled to the wrong thing before its case existed here.
// ---------------------------------------------------------------------------

/** The last `n` bytes of a compile, which is where the channel data ends up. */
function tailOf(source: string, n: number): string {
	const data = compile(source).data;
	return data ? hex(data.subarray(Math.max(0, data.length - n))) : "(no data)";
}

section("audit: the tie lookahead is as case-sensitive as AddmusicK's");
{
	// Music.cpp:2224 strncmps against exactly "$DD" and "$dd". A mixed-case `$Dd`
	// matches neither, so AddmusicK does *not* rewind and the tie folds into the
	// note length — even though getHex (Music.cpp:2876) reads the spelling as a
	// perfectly good command byte.
	const canonical = tailOf("#amk 4\n#0 c8^8 $DD $00 $10 $C0\n", 9);
	check("$DD splits the tie off", canonical === "18 7F A4 C6 DD 00 10 C0 00", canonical);

	for (const spelling of ["$Dd", "$dD"]) {
		const mixed = tailOf(`#amk 4\n#0 c8^8 ${spelling} $00 $10 $C0\n`, 8);
		check(`${spelling} folds the tie in, as AddmusicK does`, mixed === "30 7F A4 DD 00 10 C0 00", mixed);
	}
}

section("audit: #amk 1's $FA $05 becomes remote code");
{
	// Music.cpp:1925-1962 pops the `$FA $05` back off and writes a type 6 remote
	// code event in its place, or a type 8 cancel when the gain is zero.
	const set = tailOf("#amk 1\n#0 $FA $05 $10 c4\n", 9);
	check("a non-zero gain becomes a type 6 event", set.startsWith("FC 10 01 06 00"), set);

	const clear = tailOf("#amk 1\n#0 $FA $05 $00 c4\n", 9);
	check("a zero gain becomes a type 8 cancel", clear.startsWith("FC 00 00 08 00"), clear);

	// Still an error on every later target — the branch that already existed.
	const later = compile("#amk 2\n#0 $FA $05 $10 c4\n");
	check(
		"$FA $05 is still rejected under #amk 2",
		later.diagnostics.some((d) => d.code === "AMK0157"),
		later.diagnostics.map((d) => d.code).join(", "),
	);
}

section("audit: the tempo ratio divides 0x60 only where AddmusicK does");
{
	// Music.cpp:2252 divides 0x80 on every note but reaches 0x60 only inside the
	// long-note branch. Hoisting the 0x60 out of that branch made every short
	// note a hard error under a ratio that divides 128 but not 96 — 64 and 128.
	const short = compile("#amk 4\n#option dividetempo 64\n#0 c3\n");
	check("a short note compiles under dividetempo 64", short.ok, short.diagnostics.map((d) => d.code).join(", "));
	check("and keeps its tick count", short.stats?.channelTicks[0] === 1, String(short.stats?.channelTicks[0]));

	// A long note does reach the 0x60 division, and still reports it.
	const long = compile("#amk 4\n#option dividetempo 64\n#0 c1\n");
	check("a long note still reports the fractional value", !long.ok, "");
}

section("audit: a source that ends on a directive is not truncated");
{
	// Music.cpp:286 pads the buffer with 16 spaces in init(), *before* the
	// preprocessor runs, so getArgument (globals.cpp:706) never reaches the end
	// of the file. Padding afterwards instead made a source with no trailing
	// newline fail outright.
	for (const ending of ["#define FOO 1", "#if FOO", "; a trailing comment"]) {
		const result = compile(`#amk 4\n#0 c4\n${ending}`);
		check(
			`no end-of-file error for a source ending "${ending}"`,
			!result.diagnostics.some((d) => d.message.includes("end of file")),
			result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
		);
	}
}

section("audit: nothing is accepted that AddmusicK would reject");
{
	// The point of the tool is that a song written here works in AddmusicK, so
	// being more permissive than the reference is the failure that matters most:
	// it compiles, it plays, and then the real thing refuses it.
	const rejects = (name: string, source: string, because: string) => {
		const result = compile(source, 0x3e00, LIBRARY);
		check(name, !result.ok, `${because}; got ${result.diagnostics.map((d) => d.code).join(", ") || "no diagnostics"}`);
	};

	// globals.cpp:788-956 compares the directive against lowercase literals.
	// Music.cpp:2432-2456 then catches the capitalised spelling and names the
	// stage rather than calling it unknown.
	const capitalised = compile("#amk 4\n#DEFINE FOO 1\n#0 c4\n");
	check(
		"#DEFINE is rejected, by the branch that names the stage",
		capitalised.diagnostics.some((d) => d.message.includes("after the preprocessing stage")),
		capitalised.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);
	rejects("#IFDEF is rejected", "#amk 4\n#IFDEF FOO\n#0 c4\n#ENDIF\n", "the preprocessor is case-sensitive");

	// Music.cpp:3471 — `typeName != "title"` and friends, so the field name is
	// case-sensitive even though the directive keyword before it is not.
	rejects("#Title inside #spc is rejected", '#amk 4\n#spc { #Title "x" }\n#0 c4\n', "Music.cpp:3471 compares with !=");
	const lower = compile('#amk 4\n#spc { #title "x" }\n#0 c4\n');
	check("#title still works", lower.ok, lower.diagnostics.map((d) => d.code).join(", "));

	// Music.cpp:2723-2728 — `extension == ".brr"`.
	rejects(
		"an upper-case .BRR is rejected",
		'#amk 4\n#samples { "kick.BRR" }\n#0 c4\n',
		"the extension compares with ==",
	);

	// Music.cpp:2421 — `isspace(text[pos + 7])`, so `{` does not terminate a
	// directive keyword and `#samples{` is not a directive at all.
	rejects("#samples{ is not a directive", '#amk 4\n#samples{ "kick.brr" }\n#0 c4\n', "the terminator is whitespace");
	const spaced = compile('#amk 4\n#samples { "kick.brr" }\n#0 c4\n', 0x3e00, LIBRARY);
	check("#samples { still works", spaced.ok, spaced.diagnostics.map((d) => d.code).join(", "));

	// globals.cpp:716-726 — `strToInt` reads through a stringstream into an int
	// and throws when it overflows.
	rejects("an out-of-range #define operand is rejected", "#amk 4\n#define FOO 99999999999\n#0 c4\n", "strToInt throws");
}

section("audit: nothing is rejected that AddmusicK would accept");
{
	// Music.cpp:2493 — `#halvetempo` is matched on prefix alone, with no
	// trailing-whitespace test, so it may butt straight up against what follows.
	const butted = compile("#amk 4\n#halvetempo#0 c4\n");
	check(
		"#halvetempo needs no terminator",
		butted.ok,
		butted.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);

	// Music.cpp:2488 — `#amk=N` for N other than 1 is read and thrown away.
	const equals = compile("#amk 4\n#amk=2\n#0 c4\n");
	check("#amk=2 is consumed silently", equals.ok, equals.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));

	// Music.cpp:2480-2486 — a capitalised marker reaches the parser, which
	// consumes it without complaint.
	const marker = compile("#amk 4\n#AM4\n#0 c4\n");
	check("#AM4 is consumed silently", marker.ok, marker.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
}

section("audit: the diagnostics AddmusicK produces, produced here too");
{
	// Music.cpp:1181 and 1332 — `error()` returns, so no `$E9` is written and the
	// dead `j = 1` after it never runs. Forcing the count to 1 and carrying on put
	// a loop call in the song that AddmusicK does not.
	const badCall = compile("#amk 4\n#0 (1)[ c4 ] (1)0\n");
	check(
		"an out-of-range label-loop count aborts the call",
		!badCall.ok,
		badCall.diagnostics.map((d) => d.code).join(", "),
	);
	const badStar = compile("#amk 4\n#0 [ c4 ]2 *300\n");
	check(
		"an out-of-range star-loop count aborts the call",
		!badStar.ok,
		badStar.diagnostics.map((d) => d.code).join(", "),
	);

	// Music.cpp:3210-3214 — the shortest non-zero channel. A song can emit plenty
	// of bytes and still run for no time at all; an unclosed `[[` does exactly
	// that, parking every note in the superloop accumulator.
	const noTicks = compile("#amk 4\n#0 [[ c4 d4\n");
	check(
		"a song with bytes but no ticks is rejected",
		noTicks.diagnostics.some((d) => d.code === "AMK0303"),
		noTicks.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);

	// Music.cpp:1699-1713 folds the warn-once flag into the condition, so the
	// second raw byte >= $80 falls through to the *duration* warning as well.
	// `#am4` is one of the two markers that leave `targetAMKVersion` at 0, which
	// is the only target that warns here rather than erroring.
	const twoRaw = compile("#am4\n#0 $80 $80 c4\n");
	const codes = twoRaw.diagnostics.map((d) => d.code);
	check("the first raw byte warns about notes", codes.includes("AMK0208"), codes.join(", "));
	check("the second falls through to the duration warning", codes.includes("AMK0209"), codes.join(", "));

	// Music.cpp:2020 — 1.0.8 and earlier freeze on hex validation here.
	const octaveDD = compile("#amk 2\n#0 $DD $00 $10 o4 c4\n");
	check(
		"o after $DD warns on a pre-1.0.9 target",
		octaveDD.diagnostics.some((d) => d.code === "AMK0218"),
		octaveDD.diagnostics.map((d) => d.code).join(", "),
	);
	const octaveDDCurrent = compile("#amk 4\n#0 $DD $00 $10 o4 c4\n");
	check(
		"and not on #amk 4",
		!octaveDDCurrent.diagnostics.some((d) => d.code === "AMK0218"),
		octaveDDCurrent.diagnostics.map((d) => d.code).join(", "),
	);
}

section("audit: ;title= sets the ID666 title");
{
	// Music.cpp:297-306 — a plain substring search of the raw source, before
	// preprocessing, taking everything to the end of the line.
	const plain = compile("#amk 4\n;title=Green Hill Zone\n#0 c4\n");
	check("a ;title= comment becomes the title", plain.stats?.tags.title === "Green Hill Zone", plain.stats?.tags.title);

	// It runs before preprocessing, so a false `#if` does not hide it.
	const hidden = compile("#amk 4\n#if 0\n;title=Still Counts\n#endif\n#0 c4\n");
	check("even inside a false #if", hidden.stats?.tags.title === "Still Counts", hidden.stats?.tags.title);

	// `#spc { #title }` is parsed later and wins, as it does in Music.cpp:3490.
	const both = compile('#amk 4\n;title=Ignored\n#spc { #title "Wins" }\n#0 c4\n');
	check("#spc #title overrides it", both.stats?.tags.title === "Wins", both.stats?.tags.title);

	const none = compile("#amk 4\n#0 c4\n");
	check("and no marker leaves it empty", none.stats?.tags.title === undefined, String(none.stats?.tags.title));
}

section("audit: the two constructs AddmusicK lets through are let through");
{
	// Music.cpp:2413-2506 has no final else, so `pos` stays on the first letter
	// and the scan loop reads it as music. `#c4` really is a quarter-note C.
	const asMusic = compile("#amk 4\n#0 c4 #d4\n");
	check("an unknown # directive is read as music", asMusic.ok, asMusic.diagnostics.map((d) => d.code).join(", "));
	check("and its letters become notes", asMusic.stats?.channelTicks[0] === 96, String(asMusic.stats?.channelTicks[0]));

	// Music.cpp:1321 has no check that a previous loop exists, and `prevLoop` is
	// an unsigned int at -1 (Music.cpp:240) — so this emits `$E9 FF FF 02` and
	// relocation turns it into a pointer to nowhere. It compiles there, and the
	// point of this tool is that what compiles here compiles there.
	const noLoop = compile("#amk 4\n#0 *2 c4\n");
	check(
		"a * with no previous loop compiles",
		noLoop.ok,
		noLoop.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);

	const bytes = [...(noLoop.data ?? [])];
	const call = bytes.indexOf(0xe9);
	check("it emits the whole four-byte call", call !== -1 && bytes[call + 3] === 2, hex(Uint8Array.from(bytes)));
	// The stored word was $FFFF, so relocation lands it one byte *below* the loop
	// block — which is the pointer to nowhere, arriving intact.
	const pointer = call === -1 ? -1 : (bytes[call + 2] << 8) | bytes[call + 1];
	const blockAt = 0x3e00 + (noLoop.stats?.totalSize ?? 0) - (noLoop.stats?.loopDataSize ?? 0);
	check(
		"pointing one byte below the loop block, as -1 does",
		pointer !== -1 && ((pointer + 1) & 0xffff) === (blockAt & 0xffff),
		`pointer $${pointer.toString(16)}, block $${blockAt.toString(16)}`,
	);
}
