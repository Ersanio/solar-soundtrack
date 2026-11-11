/**
 * `tokentest`: the dialect a command is read under: the velocity table, the
 * target markers, `#am4`'s `$ED` and `$E5`, and a command stopping at its
 * argument count.
 */

import "../localize";
import { commandAt, tokenize } from "@amk/tokens";
import { velocityTableAt } from "@amk/tokens/dialect";
import { check, section } from "../harness";

section("the velocity table follows the hex, not just the directives");
{
	const tableAt = (source: string, needle: string) => {
		const index = tokenize(source);
		const command = commandAt(index.commands, source.indexOf(needle));
		return command === null ? null : velocityTableAt(command, index, source);
	};

	check("#amk 4 starts on N-SPC", tableAt("#amk 4\n#0 q7F c4\n", "q7F") === "nspc");
	check("#amk 1 starts on SMW", tableAt("#amk 1\n#0 q7F c4\n", "q7F") === "smw");
	check("#option smwvtable switches", tableAt("#amk 4\n#option smwvtable\n#0 q7F c4\n", "q7F") === "smw");

	// Commands.asm:1087 — the driver takes the hex as readily as the directive.
	// AddmusicK's own usingSMWVTable is the thing that does not, which is why
	// this walks the commands rather than mirroring the compiler's bookkeeping.
	check("$FA $06 $00 switches", tableAt("#amk 4\n#0 $FA $06 $00 q7F c4\n", "q7F") === "smw");
	check(
		"and a later $FA $06 $01 switches back",
		tableAt("#amk 4\n#option smwvtable\n#0 $FA $06 $01 q7F c4\n", "q7F") === "nspc",
	);
	// main.asm:2373 compares against zero, so $05 is as N-SPC as $01 is.
	check("a value the driver does not test for is N-SPC", tableAt("#amk 4\n#0 $FA $06 $05 q7F c4\n", "q7F") === "nspc");

	// Commands.asm:610 stores #$01 outright, so $F4 $08 only goes the one way.
	check("$F4 $08 leaves SMW", tableAt("#amk 4\n#option smwvtable\n#0 $F4 $08 q7F c4\n", "q7F") === "nspc");
	check("#louder does the same", tableAt("#amk 4\n#option smwvtable\n#louder\n#0 q7F c4\n", "q7F") === "nspc");

	// $6F is one byte for the whole driver, so the walk does not stop at the
	// channel boundary the way echo-hazards.ts and fir-override.ts do.
	check("a switch in #1 is heard in #0", tableAt("#amk 4\n#1 $FA $06 $00\n#0 q7F c4\n", "q7F") === "smw");
}

section("the target markers pick the dialect");
{
	// parseHexCommand — #amk 1's $FC is remote gain and takes two arguments.
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

	// The pre-spaced form (preprocess.ts's `amk=1` special case) arrives as the number `=1`.
	const eq = tokenize("#amk=1\n#0 $FC $05 $7F c4\n").commands.find((c) => c.vcmd === 0xfc);
	check("#amk=1 selects version 1", eq?.args.length === 2, `got ${eq?.args.length}`);

	// preprocess reads the directive word whole (its getArgument), so `#amk4`
	// is an unknown directive, not a marker.
	const glued = tokenize("#amk4\n#0 $FC $05 $7F $01 $02\n").commands.find((c) => c.vcmd === 0xfc);
	check("#amk4 without a space is no marker", glued?.args.length === 4, `got ${glued?.args.length}`);

	// preprocess.ts's `amk` case — once a legacy marker is seen, a later #amk is ignored…
	const guarded = tokenize("#am4\n#amk 4\n#0 $ED $80 $6C $20 c4\n").commands.find((c) => c.vcmd === 0xed);
	check("#amk after #am4 is ignored", guarded?.args.length === 3, `got ${guarded?.args.length}`);

	// …while a later legacy marker always wins (its `amm` and `am4` cases).
	const amm = tokenize("#amk 4\n#amm\n#0 $E7 $10\n").commands.find((c) => c.vcmd === 0xe7);
	check("a later #amm wins over #amk", amm?.target.program === 2, String(amm?.target.program));

	const flipped = tokenize("#amm\n#am4\n#0 $ED $81 $05 c4\n").commands.find((c) => c.vcmd === 0xed);
	check("a later #am4 wins over #amm", flipped?.args.length === 2 && flipped.name === "tune", flipped?.name);

	// parser.ts's initial targetAMKVersion — before any marker, the parser assumes #amk 4.
	const bare = tokenize("#0 $FC $01 $02 $03 $04\n").commands.find((c) => c.vcmd === 0xfc);
	check("no marker means the #amk 4 default", bare?.target.program === 0 && bare.target.amkVersion === 4);
}

section("#am4's $ED is HFD's escape");
{
	// parseHFDHex (parser.ts, Music.cpp:1466) — the sub-byte picks the form.
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
	// count+1 of them, the do-while in parseHFDHex.
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

section("#am4's $E5 forks on its first argument");
{
	// Music.cpp:1820, parseHexCommand's $E5 fork — a high bit means "load sample".
	const load = tokenize("#am4\n#0 $E5 $85 $04 c4\n").commands.find((c) => c.vcmd === 0xe5);
	check("a high first argument is a sample load", load?.args.length === 2, `got ${load?.args.length}`);
	check("named as the $F3 it compiles to", load?.name === "sample load", load?.name);
	check("and complete", load?.complete === true);

	const trem = tokenize("#am4\n#0 $E5 $20 $30 $40 c4\n").commands.find((c) => c.vcmd === 0xe5);
	check("a low first argument stays tremolo", trem?.args.length === 3 && trem.name === "tremolo", trem?.name);

	const amk = tokenize("#amk 4\n#0 $E5 $85 $04 $01\n").commands.find((c) => c.vcmd === 0xe5);
	check("no fork outside #am4", amk?.args.length === 3, `got ${amk?.args.length}`);
}

section("a command takes its arguments and stops");
{
	// `scanHex` emits `hexArg` for any byte below $DA even with `hexLeft` at 0
	// (tokens.ts), because a sample load's tuning byte has to read as one.
	// So a byte standing after a full command looks exactly like an argument, and
	// `gather` must not claim it. The parser does not: `parseHexCommand` reads
	// it as a standalone literal and reports AMK0151 under #amk. Two things go
	// wrong if the scanner disagrees — the inspector draws a row for an argument
	// that is not one, and `spliceArg` writes over a byte the command does not own.
	const one = tokenize("#amk 2\n#0 $E7 $FF $00 c4\n").commands.find((c) => c.vcmd === 0xe7);
	check("a trailing byte is not claimed as an argument", one?.args.length === 1, `got ${one?.args.length}`);
	check("the command still ends at its own last argument", one?.span.end === one?.args[0]?.span.end);

	const two = tokenize("#amk 2\n#0 $E0 $C0 $12 $34 c4\n").commands.find((c) => c.vcmd === 0xe0);
	check("nor are two of them", two?.args.length === 1, `got ${two?.args.length}`);

	// The stop must not fire early on the commands whose length is decided by
	// their own arguments — `expectedArgs` returns null until the deciding byte
	// has been read, and null has to mean "keep going".
	const arp = tokenize("#amk 2\n#0 $FB $03 $10 $01 $02 $03 c4\n").commands.find((c) => c.vcmd === 0xfb);
	check("an arpeggio still gathers its whole list", arp?.args.length === 5, `got ${arp?.args.length}`);

	const upload = tokenize("#am4\n#0 $ED $82 $20 $00 $00 $02 $11 $22 $33 c4\n").commands.find((c) => c.vcmd === 0xed);
	check("an HFD upload still gathers its payload", upload?.args.length === 8, `got ${upload?.args.length}`);

	// parseHexCommand / scanHex — $FA $FE's toggle byte takes a
	// further byte when its high bit is set. `expectedArgs` and `scanHex` must
	// fork here together.
	const bits = tokenize("#amk 2\n#0 $FA $FE $81 $02 c4\n").commands.find((c) => c.vcmd === 0xfa);
	check("$FA $FE takes a third byte when the high bit is set", bits?.args.length === 3, `got ${bits?.args.length}`);
	check("and is complete with it", bits?.complete === true);

	const short = tokenize("#amk 2\n#0 $FA $FE $81\n").commands.find((c) => c.vcmd === 0xfa);
	check("and incomplete without it", short?.complete === false);

	const plain = tokenize("#amk 2\n#0 $FA $FE $01 $02 c4\n").commands.find((c) => c.vcmd === 0xfa);
	check("a low toggle byte takes no third", plain?.args.length === 2, `got ${plain?.args.length}`);
}
