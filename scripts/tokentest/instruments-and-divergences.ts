/**
 * `tokentest`: `q` and `n` read as hex, the `@` forms, the `#instruments`
 * block, the divergences from AddmusicK pinned on purpose, and a directive's
 * bare-word argument.
 */

import "../localize";
import { tokenize } from "@amk/tokens";
import { check, section } from "../harness";
import { tokenAt, lengthOf } from "./support";

section("q and n read their arguments as hex");
{
	// parseQuantization and parseNoise both use getHex. Reading either as decimal is
	// wrong twice over: the value, and the `F` that would become a note.
	const q = tokenize("#0 q7F\n").commands.find((c) => c.kind === "q");
	check("q7F is $7F, not 7", q?.args[0]?.value === 0x7f, `got ${q?.args[0]?.value}`);
	const n = tokenize("#0 n1F\n").commands.find((c) => c.kind === "n");
	check("n1F is $1F, not 1", n?.args[0]?.value === 0x1f, `got ${n?.args[0]?.value}`);
	check("and the F is not a note", !tokenize("#0 n1F\n").tokens.some((t) => t.kind === "note"));
	check("nA-nF scan at all", tokenize("#0 nA\n").commands.find((c) => c.kind === "n")?.args[0]?.value === 0xa);
	check("q10 is $10, not ten", tokenize("#0 q10\n").commands.find((c) => c.kind === "q")?.args[0]?.value === 0x10);
	// getHex stops at two digits (parser.ts).
	check("only two digits are taken", tokenize("#0 q7F0\n").tokens.filter((t) => t.kind === "hexNumber").length === 1);
	// getHex opens with doReplacement (parser.ts), so a macro really can
	// supply the digits.
	check(
		"a macro can supply the digits, as getHex allows",
		tokenize('"x=1F"\n#0 nx\n').commands.find((c) => c.kind === "n")?.args[0]?.value === 0x1f,
	);
	// getHex skips no spaces, so the digits after one are not read as hex.
	check("a space stops the hex run", !tokenize("#0 n 1F\n").tokens.some((t) => t.kind === "hexNumber"));
}

section("the @ forms");
{
	const direct = tokenize("#0 @@19\n").commands.filter((c) => c.kind === "@");
	check("@@19 is one command, not two", direct.length === 1);
	check("and it is marked direct", direct[0]?.direct === true);
	check("with the number intact", direct[0]?.args[0]?.value === 19);
	check("a plain @19 is not direct", tokenize("#0 @19\n").commands.find((c) => c.kind === "@")?.direct === undefined);

	// parseSampleLoad — `(@5, $02)` loads instrument 5's sample. The `@` belongs
	// to that command and does not change the instrument.
	check("(@5, $02) opens no instrument command", !tokenize("#0 (@5, $02) c4\n").commands.some((c) => c.kind === "@"));
	check(
		"but a bare (5) still works",
		tokenize("#0 (5)\n").tokens.some((t) => t.kind === "label"),
	);
}

section("#instruments is scanned as a block, not as commands");
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
	// readInstrumentSample — @5's sample is $07.
	check("resolving @5 to SRCN $07", (index.instruments[1]?.sample as { srcn: number }).srcn === 0x07);
	check("the third is noise", index.instruments[2]?.sample.form === "noise");
	// readInstrumentSample — the high bit is what marks it noise.
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

section("known divergences from AddmusicK, pinned on purpose");
{
	// Both come from the same root: `getInt`/`getHex` (parser.ts) expand
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
	// ties (parser.ts). Only `^` is folded here, so a rest's tooltip stays
	// about the rest under the caret.
	const rests = tokenize("#0 r4 r8\n").commands.filter((c) => c.noteLength);
	check("consecutive rests stay separate", rests.length === 2 && rests[0].noteLength?.length === 1);

	// A pitch bend ahead makes AMK rewind the last tied segment and emit it as
	// its own note (accumulateTiedLength's rewind). The scanner ties regardless.
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

	// preprocess's argument read stops at a line end (its getArgument), so
	// a real `#amk\n1` fails AMK0401 and compiles nothing; the one-shot here
	// cannot see line breaks. Harmless: it only recolours a broken song.
	const split = tokenize("#amk\n1\n#0 $FC $05 $7F\n").commands.find((c) => c.vcmd === 0xfc);
	check("the #amk version one-shot crosses a newline", split?.args.length === 2, `got ${split?.args.length}`);

	// An $ED $82 upload aimed at $6136 appends to the compiler's instrument
	// table (parseHFDInstrumentHack), shifting `@30 + k` numbering; this pass
	// counts only #instruments blocks. Error-truncation shapes are not mirrored
	// either — e.g. $FA under #amm zeroes hexLeft on its error path
	// (parseHexCommand's AMK0156 path) — the compiler squiggles those, and the scanner
	// keeps AddmusicK's grouping.
	const hacked = tokenize(
		'#am4\n#0 $ED $82 $61 $36 $00 $05 $04 $FE $6A $B8 $03 $00\n#instruments\n{\n\t"kick.brr" $FE $6A $B8 $03 $00\n}\n',
	);
	check(
		"the HFD instrument hack does not shift @ numbering",
		hacked.instruments.length === 1 && hacked.instruments[0].number === 30,
	);
}

section("a directive's bare-word argument is not music");
{
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
