/**
 * `tokentest`: note and rest lengths: ties, `l`, each segment's denominator and
 * digits, dots by dialect, and triplets.
 */

import "../localize";
import { tokenize } from "@amk/tokens";
import { check, section } from "../harness";
import { at, lengthOf } from "./support";

section("notes and rests resolve their length");
{
	// getNoteLength (parser.ts), over the 192 ticks of a whole note. The
	// tooltip states the tick count outright, so a wrong fork here is a wrong
	// number on screen rather than a wrong colour.
	const plain = lengthOf("#0 c4\n", "c4");
	check("c4 is one segment", plain?.length === 1, `got ${plain?.length}`);
	check("of 48 ticks", plain?.[0].ticks === 48, String(plain?.[0].ticks));
	check("written as the denominator it was", plain?.[0].written === "4", plain?.[0].written);
	check("with no dots, no =, and nothing implied", plain?.[0].dots === 0 && !plain[0].exact && !plain[0].implicit);

	// parser.ts's `defaultNoteLength` — what the parser starts at, before any `l`.
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
	// getNoteLength — outside 1..192 the written length is discarded entirely.
	check("c200 falls back to the default length", lengthOf("#0 c200\n", "c200")?.[0].ticks === 24);
	check("a command that is not a note carries none", at("#0 t144\n", 4)?.noteLength === undefined);
}

section("a tie plays as one note");
{
	// accumulateTiedLength (parser.ts) — every segment after a `^` belongs
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

section("the default length follows `l`");
{
	// parseDefaultLength (parser.ts). One field on the parser, never
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

section("every segment says which denominator names it, and where the digits go");
{
	// The inspector's Length slider is a `1/n` over these two fields, and both
	// halves are load-bearing in a way a tick count cannot see. `denominator` has
	// to be a value that, *written*, reproduces the ticks the segment already
	// plays for — otherwise letting a slider go where it was picked up changes
	// the music. `digits` has to cover the digits and nothing else: the dots of a
	// segment compose rather than add (`Music.cpp:2956-2957`), so a span reaching over
	// them writes 48 where the note was 36, and one reaching over an `=` turns a
	// tick count into a denominator.
	const segmentOf = (source: string, needle: string) => lengthOf(source, needle)?.[0];
	const digitsOf = (source: string, needle: string) => {
		const span = segmentOf(source, needle)?.digits;
		return span === undefined ? null : source.slice(span.start, span.end);
	};

	check("a written denominator is its own", segmentOf("#0 c4\n", "c4")?.denominator === 4);
	check("and its digits are the digits", digitsOf("#0 c4\n", "c4") === "4", String(digitsOf("#0 c4\n", "c4")));

	// The whole reason this exists: a bare note has no argument to hang a
	// descriptor on and is still a note of a definite length.
	const bare = segmentOf("#0 l8 c\n", "c\n");
	check("a bare note reads the standing l's denominator", bare?.denominator === 8, String(bare?.denominator));
	check("and its digit span is empty", bare?.digits.start === bare?.digits.end);
	check(
		"sitting right after the letter",
		bare?.digits.start === "#0 l8 c\n".indexOf("c\n") + 1,
		String(bare?.digits.start),
	);

	// In front of the dots rather than after them, so `c8.` is the 36 ticks `c.`
	// already was and not the 72 that `c` + `4.` would be.
	const dotted = "#0 l8 c.\n";
	check("a dotted bare note keeps its dot out of the span", digitsOf(dotted, "c.") === "");
	check("with the span before it", segmentOf(dotted, "c.")?.digits.start === dotted.indexOf("c.") + 1);
	check("and the denominator that reproduces it", segmentOf(dotted, "c.")?.denominator === 8);

	check("a written dotted note spans its digits alone", digitsOf("#0 c8.\n", "c8") === "8");
	check("an exact count spans the number and not the =", digitsOf("#0 c=48\n", "c=48") === "48");
	check("and names no denominator", segmentOf("#0 c=48\n", "c=48")?.denominator === null);

	// A length nothing can be written as `1/n`. `l8.` is 36 ticks and every
	// denominator floors to 38 or 32 either side of it.
	check("a dotted l leaves a bare note with no denominator", segmentOf("#0 l8. c\n", "c\n")?.denominator === null);
	// Where an exact one happens to land on a divisor, it does have one.
	check("an exact l that lands on a note value has one", segmentOf("#0 l=48 c\n", "c\n")?.denominator === 4);

	// getNoteLength discards a written length outside 1..192 and plays the
	// standing default, so that is the number a control on it is showing.
	check("c200 reads the standing l's denominator", segmentOf("#0 l16 c200\n", "c200")?.denominator === 16);

	// The misalignment an argument-indexed row had: one number, two segments.
	const tied = lengthOf("#0 c^8\n", "c^8");
	check("c^8 is two segments", tied?.length === 2, `got ${tied?.length}`);
	check("the head takes the default's denominator", tied?.[0].denominator === 8);
	check("the tie takes its own", tied?.[1].denominator === 8 && tied[1].written === "8");
	check("and the head's digits go before the ^", tied?.[0].digits.start === "#0 c^8\n".indexOf("c^8") + 1);
	check("where the tie's are its number", tied?.[1].digits.start === "#0 c^8\n".indexOf("8"));

	// The macro interlock, per segment: an expansion's tokens share one collapsed
	// span, so there is no text of the author's to write the digits over.
	const macro = lengthOf('"n=c4"\n#0 n\n', "n\n");
	check("a note through a macro says so", macro?.[0].replacement === "n", macro?.[0].replacement);
	check("a note written out does not", segmentOf("#0 c4\n", "c4")?.replacement === undefined);

	// The property the whole field exists for, over every `l` a porter can
	// write: the denominator a bare note reports, written onto that note, plays
	// exactly what the note was already playing.
	let reproduced = 0;
	let unreachable = 0;
	for (let n = 1; n <= 192; n++) {
		const standing = segmentOf(`#0 l${n} c\n`, "c\n");
		if (standing?.denominator == null) {
			unreachable++;
			continue;
		}

		const written = segmentOf(`#0 l${n} c${standing.denominator}\n`, `c${standing.denominator}`);
		if (written?.ticks === standing.ticks) {
			reproduced++;
		}
	}

	check(`every l from 1 to 192 reproduces its own length (${reproduced})`, reproduced === 192, String(reproduced));
	check("and none of them is unreachable", unreachable === 0, String(unreachable));
}

section("dots and exact lengths fork by dialect");
{
	// Music.cpp:2960 — Addmusic 4.05 stops after the second dot.
	const am4 = lengthOf("#am4\n#0 c8...\n", "c8");
	check("#am4 stops adding after two dots", am4?.[0].ticks === 42, String(am4?.[0].ticks));
	check("and counts only the dots it applied", am4?.[0].dots === 2, String(am4?.[0].dots));
	check("#amk 4 applies every one", lengthOf("#0 c8...\n", "c8")?.[0].ticks === 45);

	// getNoteLength's `=` arm — exact counts predate dots, so below #amk 4 the dot is not
	// theirs to take.
	check("under #am4 an exact count takes no dots", lengthOf("#am4\n#0 c=48.\n", "c=48")?.[0].ticks === 48);
	check("under #amk 4 it does", lengthOf("#0 c=48.\n", "c=48")?.[0].ticks === 72);

	// parseDefaultLength — `l`'s dots and its `=` form are both #amk 4 and
	// above, and neither is the same fork a note takes.
	check("under #am4, l ignores its dots", lengthOf("#am4\n#0 l8. c\n", "c")?.[0].ticks === 24);
	check("under #amk 1 too", lengthOf("#amk 1\n#0 l8. c\n", "c")?.[0].ticks === 24);
	check(
		"while l= is an error there, leaving the length standing",
		lengthOf("#am4\n#0 l16 l=48 c\n", "c")?.[0].ticks === 12,
	);
	check("and a note's own = still works", lengthOf("#am4\n#0 c=48\n", "c=48")?.[0].ticks === 48);
}

section("a lone dot still lengthens the note before it");
{
	// `l8 c.` is ordinary MML: getInt finds no digits and getNoteLengthModifier
	// dots the standing default anyway (getNoteLength). A lone `.` scans as
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

section("a triplet scales the notes inside it");
{
	// getNoteLengthModifier's second half (parser.ts): two thirds,
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

	// parseDefaultLength is the one call that passes allowTriplet: false, so an `l`
	// inside a triplet sets the plain length and the notes scale it themselves.
	check("l is not scaled", lengthOf("#0 {l4}c\n", "c\n")?.[0].ticks === 48);

	// The early return in getNoteLength's `=` arm is ahead of both modifiers.
	const old = lengthOf("#am4\n#0 {c=48}\n", "c=48");
	check("an exact count below #amk 4 escapes it", old?.[0].ticks === 48 && old[0].triplet === false);

	check("the state crosses lines", lengthOf("#0 {\nc4\n", "c4")?.[0].ticks === 32);
	check("and channels, as the parser's own flag does", lengthOf("#0 {\n#1 c4\n", "c4")?.[0].ticks === 32);

	// AMK0097 reports the second `{` and leaves the one block open, so the
	// first `}` closes it (parseTripletOpen and parseTripletClose).
	const nested = tokenize("#0 {{c4}c4\n").commands.filter((c) => c.noteLength);
	check(
		"a nested brace does not need two to close",
		nested.map((c) => c.noteLength?.[0].ticks).join() === "32,48",
		nested.map((c) => c.noteLength?.[0].ticks).join(),
	);
	check("and an unopened } leaves the note alone", lengthOf("#0 }c4\n", "c4")?.[0].ticks === 48);

	// #spc, #samples and #instruments are read by parseBlock, whose readers eat
	// their brace before parseTripletOpen could see it (parseSampleDefinitions,
	// parseInstrumentDefinitions and parseSpcInfo).
	const block = '#instruments\n{\n\t"kick.brr" $FE $6A $B8 $03 $00\n}\n#0 c4\n';
	check("a block directive's brace is not a triplet", lengthOf(block, "c4")?.[0].ticks === 48);
	check("nor #samples'", lengthOf('#samples\n{\n\t"kick.brr"\n}\n#0 c4\n', "c4")?.[0].ticks === 48);
	// The case that makes the distinction worth drawing: half-typed, the block
	// never closes, and a plain toggle would two-thirds the rest of the song.
	check("an unclosed one does not either", lengthOf('#samples\n{\n\t"kick.brr"\n#0 c4\n', "c4")?.[0].ticks === 48);
	check("and a real triplet after one still works", lengthOf(`${block}#0 {c4}\n`, "c4}")?.[0].ticks === 32);
}
