/**
 * `tokentest`: restartability, that `copyState` copies, that the scanner always
 * makes progress, and the empty document.
 */

import "../localize";
import { type ScanState, type Token, commandAt, copyState, startState, step, tokenize } from "@amk/tokens";
import { check, section } from "../harness";
import { tokenAt } from "./support";

section("restartability — the property CodeMirror relies on");
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
		// $DD's lookahead crossing the break, which is the whole reason it is a
		// deferred flag rather than a lookahead: the parser's own skipSpaces
		// crosses newlines and `step` may not read another line.
		"#amk 4\n#0 c4 $DD $00 $18\ng $E7 $10\n",
		"#amk 4\n#0 c4 $DD $00 $18 ; why\ng $E7 $10\n",
		// An `o` at the end of a line. `getInt` reads no digits there, so the
		// digits below belong to nobody and the lookahead ends at them — which is
		// only exact because `ddTargetOctave` is set on the next character.
		"#amk 4\n#0 c4 $DD $00 $18 o\n5 g4 $E7 $10\n",
		// A remote call split across lines, its wait a byte in the VCMD range.
		"#amk 4\n(!1)[$F4 $09]\n#0 (!1, 1,\n$E0) $ED $0F $E0 c4\n",
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

section("copyState really copies");
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

section("the scanner always makes progress");
{
	// Garbage in must not hang the editor.
	const nasty = "\0\x1b~`%:!\\\n#0 éé $ $$ $Z c\n";
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

section("an empty document is not a special case");
{
	check("empty text yields nothing", tokenize("").tokens.length === 0);
	check("empty text has no commands", tokenize("").commands.length === 0);
	check("a lone newline yields nothing", tokenize("\n").tokens.length === 0);
	check("commandAt on nothing is null", commandAt([], 0) === null);
	check("tokenAt on nothing is null", tokenAt([], 0) === null);
}
