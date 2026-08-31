/**
 * The normalizer: `@amk/compiler/normalize`, driven the way the app drives it
 * through `web/src/app/state/normalize-song.ts`.
 *
 * Every song that normalizes is held to four things, and the last three are
 * what make the first worth having: it compiles, it **plays the same music** —
 * the walk of the result agrees with the walk of the original on every note,
 * its tick, its state and the pitch it was written at — it has nothing left
 * that the roll cannot splice (no triplet, replacement or preprocessor line
 * outside a remote definition; loops stay exactly as written, being shapes the
 * roll edits in place), and it is a **fixed point**: normalizing the result
 * changes nothing. The songs that are refused are refused for a named reason,
 * and the reason is pinned too.
 *
 *   npm run normalizetest
 */

import { compiler } from "@amk/compiler";
import { writePitchSlides } from "@amk/compiler/normalize";
import type { CompileResult, Diagnostic } from "@amk/core/types";
import { loadDriver } from "@amk/spc/driver";
import { type SongTimeline, walkSong } from "@amk/spc/song-walk";
import { DEFAULT_TEMPO } from "@amk/tokens/commands/units";
import { type NormalizeOutcome, normalizeSong, timelinesAgree } from "../web/src/app/state/normalize-song";
import { SAMPLE_SONG } from "../web/src/app/state/sample-song";

import { check, stubFetch, summarise } from "./harness";

stubFetch();

const driver = await loadDriver();
const ARAM = driver.manifest.localPos;
const OPTIONS = {
	sampleNames: driver.samples.map((sample) => sample.sampleName),
	sampleGroups: driver.manifest.sampleGroups,
};

const describe = (diagnostics: readonly Diagnostic[]): string =>
	diagnostics.map((d) => `${d.code} ${d.message}`).join("; ");
const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

function build(source: string): { result: CompileResult; timeline: SongTimeline } | string {
	const result = compiler.compile({ source, aramAddress: ARAM, options: OPTIONS });
	if (!result.ok || !result.data) {
		return describe(result.diagnostics.filter((d) => d.severity === "error"));
	}

	return { result, timeline: walkSong(result.data, ARAM) };
}

const normalize = (source: string): NormalizeOutcome => normalizeSong(source, ARAM, OPTIONS);

/**
 * What may still be there afterwards: loops and their recalls, remote code, and
 * the quoted names and braces of the header blocks. Anything else the roll
 * would trip on is named — the triplet braces, a replacement's quotes, and the
 * preprocessor's directives.
 */
function residue(text: string): string | null {
	const stripped = text
		.replace(/#(spc|samples|instruments)\s*\{[^}]*\}/gi, "")
		.replace(/#path\s+"[^"]*"/gi, "")
		.replace(/\("[^"]*"\s*,[^)]*\)/g, "");
	const left = /[{}"]|#(define|undef|ifdef|ifndef|if|endif)\b/.exec(stripped);
	return left ? left[0] : null;
}

/**
 * The one thing a regex over the text cannot answer, asked of the parse
 * instead: an `l` is an `l` command, so this cannot fire on the letter in a
 * comment, in an `#spc` title or in a sample filename; the ones inside a
 * remote definition are the ones the pass is asked to leave, and govern
 * nothing that plays.
 */
function unnormalised(text: string): string | null {
	const result = compiler.compile({ source: text, aramAddress: ARAM, options: { ...OPTIONS, trace: true } });
	const events = result.trace?.events;
	if (!events) {
		return "the result carries no trace";
	}

	for (const event of events) {
		if (event.char === "l" && !event.state.inRemoteDefinition) {
			return `an l at ${event.span.start}`;
		}
	}

	return null;
}

function expectNormalized(name: string, source: string, shape?: (text: string) => boolean): NormalizeOutcome {
	const original = build(source);
	check(
		`${name}: the song compiles to begin with`,
		typeof original !== "string",
		typeof original === "string" ? original : "",
	);
	const outcome = normalize(source);
	check(`${name}: normalizes`, outcome.ok, outcome.ok ? "" : describe(outcome.diagnostics));
	if (!outcome.ok || typeof original === "string") {
		return outcome;
	}

	const rewritten = build(outcome.text);
	check(`${name}: the result compiles`, typeof rewritten !== "string", typeof rewritten === "string" ? rewritten : "");
	if (typeof rewritten !== "string") {
		const writtenTempo = original.timeline.tempoChanges.some((change) => change.tick === 0) ? null : DEFAULT_TEMPO;
		const difference = timelinesAgree(
			{ timeline: original.timeline, noteMap: original.result.noteMap ?? [] },
			{ timeline: rewritten.timeline, noteMap: rewritten.result.noteMap ?? [] },
			{ writtenTempo },
		);
		check(`${name}: plays the same music`, difference === null, difference?.message ?? "");
	}

	const left = residue(outcome.text);
	check(`${name}: nothing the roll trips on is left`, left === null, `found ${left ?? ""} in:\n${outcome.text}`);

	const asked = unnormalised(outcome.text);
	check(`${name}: no l survives`, asked === null, `found ${asked ?? ""} in:\n${outcome.text}`);

	const again = normalize(outcome.text);
	check(
		`${name}: is a fixed point`,
		again.ok && again.text === outcome.text,
		again.ok ? `a second pass changed it to:\n${again.text}\nfrom:\n${outcome.text}` : describe(again.diagnostics),
	);
	// The passes named as having changed the song are what the confirmation
	// dialog lists, so an empty list has to mean an unchanged song and a fixed
	// point has to name none.
	check(
		`${name}: names the passes that changed it`,
		outcome.changed.length > 0 === (outcome.text !== source) && again.ok && again.changed.length === 0,
		`changed ${JSON.stringify(outcome.changed)}, then ${again.ok ? JSON.stringify(again.changed) : "refused"}`,
	);

	if (shape) {
		check(`${name}: has the expected shape`, shape(outcome.text), outcome.text);
	}

	return outcome;
}

function expectRefused(name: string, source: string, code: string): void {
	const outcome = normalize(source);
	check(
		`${name}: refused with ${code}`,
		!outcome.ok && outcome.diagnostics.some((d) => d.code === code),
		outcome.ok ? `normalized instead:\n${outcome.text}` : describe(outcome.diagnostics),
	);
}

// ---------------------------------------------------------------------------
console.log("loops");
// ---------------------------------------------------------------------------

// Loops stay exactly as written — they are shapes the roll edits in place —
// and the passes that rewrite around and *inside* them work on the single
// parse a body gets, which is what keeps every one of these byte-neutral.
expectNormalized(
	"a [ ] body with an octave step inside",
	"#amk 4\n#0 o4 [c8 d8 > e8 f8]3 g8\n",
	// The body plays once per pass from one text, so its notes are written once;
	// the `>` inside it is left exactly where it stands.
	(t) => count(t, /c8/g) === 1 && t.includes("[c8 d8 > e8 f8]3"),
);
expectNormalized(
	"a drum remap standing at the [",
	"#amk 4\n#0 @21 [ c8 ]2 d8\n",
	// The body's head consumes the block's copy of the remap, so `d8` outside is
	// still on the drum and both get their own `@` — three with the original.
	(t) => count(t, /@21/g) === 3 && t.includes("[ @21 c8 ]2"),
);
expectNormalized(
	"the same on #6, where a note does not consume it",
	"#amk 4\n#6 @21 [ c8 ]2 d8\n",
	(t) => count(t, /@21/g) === 3,
);
expectNormalized("a drum remap set inside the body", "#amk 4\n#0 [ @21 c8 ]2 d8\n", (t) =>
	t.includes("[ @21 c8 ]2 d8"),
);
expectNormalized("a * call", "#amk 4\n#0 [c8 d8]2 *3 e8\n", (t) => t.includes("[c8 d8]2 *3 e8"));
expectNormalized(
	"a label loop called from another channel under another o and l",
	"#amk 4\n#0 o4 l8 (1)[c d e]2\n#1 o3 l16 (1)3 f\n",
	// The `l`s go and every note gets its own length, the body's included — the
	// body is parsed once, under the `l` standing at its `[`, so the rewrite is
	// exact there — and the call site is one token either way.
	(t) => t.includes("(1)[c8 d8 e8]2") && t.includes("(1)3 f16") && count(t, /c8 d8 e8/g) === 1,
);
expectNormalized("a subloop inside a loop", "#amk 4\n#0 [ c8 [[ d8 ]]3 e8 ]2\n", (t) =>
	t.includes("[ c8 [[ d8 ]]3 e8 ]2"),
);
expectNormalized("a loop inside a subloop", "#amk 4\n#0 [[ c8 [ d8 ]2 e8 ]]2\n", (t) =>
	t.includes("[[ c8 [ d8 ]2 e8 ]]2"),
);
expectNormalized("a subloop written as hex", "#amk 4\n#0 c8 $E6 $00 d8 $E6 $02 e8\n", (t) =>
	t.includes("c8 $E6 $00 d8 $E6 $02 e8"),
);
expectNormalized("a hex subloop inside a [ ]", "#amk 4\n#0 [ c8 $E6 $00 d8 $E6 $02 e8 ]2\n", (t) =>
	t.includes("[ c8 $E6 $00 d8 $E6 $02 e8 ]2"),
);
expectNormalized("a [ ] inside a hex subloop", "#amk 4\n#0 $E6 $00 c8 [ d8 ]2 e8 $E6 $01\n", (t) =>
	t.includes("$E6 $00 c8 [ d8 ]2 e8 $E6 $01"),
);
expectNormalized("a hex open closed by ]]", "#amk 4\n#0 $E6 $00 c8 ]]3\n", (t) => t.includes("$E6 $00 c8 ]]3"));
expectNormalized("a [[ closed by hex", "#amk 4\n#0 [[ c8 $E6 $02\n", (t) => t.includes("[[ c8 $E6 $02"));
// Music.cpp:433 — under `#am4` an unfinished `$E6` is a one-byte tremolo off,
// not a subloop.
expectNormalized("#am4's unfinished $E6 is not a subloop", "#am4\n#0 $E6 c4 d4\n", (t) => t.includes("$E6 c4"));
expectNormalized("a q inside the body", "#amk 4\n#0 q7F [ q3F c8 ]2 d8\n", (t) => t.includes("[ q3F c8 ]2"));
expectNormalized(
	"a custom instrument set inside the body",
	"#amk 4\n#instruments\n{\n@0 $FF $E0 $B8 $02 $00\n}\n#0 @0 [ @30 c8 ]2 d8\n",
	(t) => t.includes("[ @30 c8 ]2 d8"),
);
expectNormalized(
	"h inside a body called from a channel without h",
	"#amk 4\n#0 (1)[ h3 c8 d8 ]2\n#1 o4 (1)2 e8\n",
	(t) => count(t, /h3 c8 d8/g) === 1 && t.includes("(1)2 e8"),
);
expectNormalized("a ] with no count", "#amk 4\n#0 [c8 d8] e8\n", (t) => t.includes("[c8 d8] e8"));
expectNormalized(
	"remote code is left alone",
	"#amk 4\n(!1)[ $F4 $02 ]\n#0 (!1, 1, 8) c8\n",
	(t) => t.includes("(!1)[ $F4 $02 ]") && t.includes("(!1, 1, 8) c8"),
);
expectNormalized(
	"a recall under other state",
	"#amk 4\n#0 v255 (1)[ c8 d8 e8 ]2 v200 (1)5\n",
	(t) => count(t, /c8 d8 e8/g) === 1,
);
// The recall-under-another-instrument songs the unroll era refused outright
// (the copies would have retuned): the byte is fixed at the parse and the
// state is the pass's, so with the loop kept there is nothing to object to.
expectNormalized(
	"a call under a differently tuned instrument",
	"#amk 4\n#0 @0 (1)[c8]2\n#1 @2 (1)2\n",
	(t) => t.includes("(1)[c8]2") && t.includes("(1)2"),
);
expectNormalized("an @ inside the body that retunes what follows", "#amk 4\n#0 @0 [ @2 c8 ]2 d8\n", (t) =>
	t.includes("[ @2 c8 ]2 d8"),
);
// A loop and a subloop that cross. AddmusicK guards nesting and not crossing
// (Music.cpp:1208-1290), so these build and the driver plays what `walktest`
// pins for them; the text stands as written, and the roll is what refuses the
// shape (`rolltest`), having runs it cannot line the brackets up with.
expectNormalized("a subloop that closes outside its loop", "#amk 4\n#0 [ c4 $E6 $00 d4 ]2 e4 $E6 $01\n", (t) =>
	t.includes("[ c4 $E6 $00 d4 ]2 e4 $E6 $01"),
);
expectNormalized("a subloop that closes inside a loop", "#amk 4\n#0 $E6 $00 c4 [ d4 $E6 $01 ]2\n", (t) =>
	t.includes("$E6 $00 c4 [ d4 $E6 $01 ]2"),
);

// A `*` before any loop compiles to a call to nowhere (`$E9 FF FF n`,
// Music.cpp:1321), which relocation wraps back inside the blob — the walk
// follows it into whatever is there, deterministically, so the oracle holds
// and the text stands. The roll's own gate is what refuses the shape.
expectNormalized("a * before any loop", "#amk 4\n#0 *2 c4\n", (t) => t.includes("*2 c4"));
expectRefused("a pitch slide across a bracket", "#amk 4\n#0 c8 & [ d8 ]2\n", "SST0607");
// A hex subloop is a boundary the same way a bracket is, now that `precheck` can
// see one at all.
expectRefused("a pitch slide across a hex subloop", "#amk 4\n#0 c8 & $E6 $00 d8 $E6 $01\n", "SST0607");
expectRefused("a song that retunes an instrument", "#amk 4\ntuning[0]=2\n#0 [c8]2\n", "SST0608");

// ---------------------------------------------------------------------------
console.log("\ntriplets");
// ---------------------------------------------------------------------------

expectNormalized("a triplet", "#amk 4\n#0 {c8 d8 e8} f8\n", (t) => t.includes("c12 d12 e12 f8"));
expectNormalized("a triplet with an l inside", "#amk 4\n#0 {l16 c d} e\n", (t) => t.includes("c24 d24 e16"));
expectNormalized("a triplet only =N can spell", "#amk 4\n#0 {c3} d8\n", (t) => t.includes("c=43 d8"));
expectNormalized("a tied note in a triplet", "#amk 4\n#0 {c8^8} d8\n", (t) => t.includes("c6 d8"));

// ---------------------------------------------------------------------------
console.log("\nnote lengths");
// ---------------------------------------------------------------------------

expectNormalized("a song of bare note letters", "#amk 4\n#0 o4 l8 c d e\n", (t) => t.includes("c8 d8 e8"));
// Each segment answers for itself: `accumulateTiedLength` folds a run across
// whitespace and nothing else, so `c4^` is one note of an explicit 48 and an
// implied 24, and `r4 r r` is one rest of three segments.
expectNormalized("a tie and a rest run, segment by segment", "#amk 4\n#0 o4 l8 c4^ r4 r r d\n", (t) =>
	t.includes("c4^8 r4 r8 r8 d8"),
);
// The dots compose rather than add, so the length cannot be written in front of
// the ones already there: under a 36-tick default `c.` is 36 + 18, where `c8..`
// would be 24 + 12 + 6.
expectNormalized(
	"a dotted note under a dotted default",
	"#amk 4\n#0 o4 l8. c. d\n",
	(t) => t.includes("c=54 d8.") && !t.includes("8.."),
);
// `l=n` range-checks nothing, so a segment can be longer than the whole note one
// token stops at. The tie folds back into the same note.
expectNormalized("a default longer than a whole note", "#amk 4\n#0 o4 l=500 c d4\n", (t) => t.includes("c1^1^=116 d4"));
// The written length is what the ratio is applied to, and the default is written
// as it stands, so neither moves.
expectNormalized("a song under #halvetempo", "#amk 4\n#halvetempo\n#0 o4 l8 c d e\n", (t) => t.includes("c8 d8 e8"));
// A comment beside an `l` is about the music and outlives it, where one beside a
// `#define` is about the directive and goes with it.
expectNormalized("a comment beside the l", "#amk 4\n#0 o4 c8\nl16 ; the fast bit\nd\n", (t) =>
	t.includes("; the fast bit"),
);
// `$E6 $00` inside a command's arguments is two argument bytes and opens nothing,
// which is why what has been unrolled is asked of the parse rather than the text.
expectNormalized(
	"an $E6 $00 among a command's arguments",
	"#amk 4\n#0 o4 $F5 $E6 $00 $00 $00 $00 $00 $00 $00 c8\n",
	(t) => t.includes("$F5 $E6 $00"),
);
// `$DD`'s last parameter names a pitch and nothing else — `parseNote` returns
// before it reads a length — so a length written here would be a stray digit.
expectNormalized("the note $DD slides to", "#amk 4\n#0 o4 l8 c $DD $00 $18 g f\n", (t) =>
	t.includes("$DD $00 $18 g f8"),
);
// A remote body cannot hold a note at all (AMK0165), so nothing in one is ever
// written a length, and the definition comes through as it was.
expectNormalized(
	"a channel under a remote definition",
	"#amk 4\n(!1)[ $F4 $02 ]\n#0 o4 l8 c d (!1, 1, 8)\n",
	(t) => t.includes("(!1)[ $F4 $02 ]") && t.includes("c8 d8"),
);
// The one reader of the default that is not a note (`parser.ts:2552`). There is
// no note to write the length onto, and the walk need not notice a `$FC`
// argument moving, so it is refused rather than left to the oracle.
expectRefused(
	"a remote call whose length is the l in force",
	"#amk 4\n(!1)[ $F4 $02 ]\n#0 o4 l8 c (!1, 1, )\n",
	"SST0606",
);

// ---------------------------------------------------------------------------
console.log("\nreplacements and the preprocessor");
// ---------------------------------------------------------------------------

expectNormalized(
	"a replacement used twice",
	'#amk 4\n"ech=$EF $80 $10 $10"\n#0 ech c8 ech d8\n',
	(t) => count(t, /\$EF \$80 \$10 \$10/g) === 2 && !t.includes('"'),
);
expectNormalized("a transitive replacement", '#amk 4\n"a=b"\n"b=c8"\n#0 a d8\n', (t) => t.includes("c8 d8"));
expectNormalized("a replacement that begins inside a number", '#amk 4\n"4=8"\n#0 c44 d8\n', (t) =>
	t.includes("c84 d8"),
);
expectNormalized(
	"#ifdef taken and #ifndef untaken",
	"#amk 4\n#define LOUD\n#ifdef LOUD\nv200 ; loud\n#endif\n#ifndef LOUD\nv100 ; quiet\n#endif\n#0 c8\n",
	(t) =>
		t.includes("v200 ; loud") && !t.includes("v100") && !t.includes("quiet") && !/#(define|ifdef|ifndef|endif)/.test(t),
);
expectNormalized(
	"#if with a comparison",
	"#amk 4\n#define VER 4\n#if VER >= 4\nv200\n#endif\n#0 c8\n",
	(t) => t.includes("v200") && !/#(define|if|endif)\b/.test(t),
);

// ---------------------------------------------------------------------------
console.log("\nchannel blocks");
// ---------------------------------------------------------------------------

expectNormalized(
	"a channel written in two blocks",
	"#amk 4\n#0 c8\n#1 d8\n#0 e8\n",
	(t) => count(t, /#0/g) === 1 && /c8\s+e8/.test(t) && t.indexOf("#1") > t.indexOf("e8"),
);
expectNormalized(
	"the #N kept where the later block relied on its h reset",
	"#amk 4\n#0 h5 c8\n#1 d8\n#0 e8\n",
	(t) => count(t, /#0/g) === 2,
);
expectNormalized(
	"the #N dropped where the later block sets h first",
	"#amk 4\n#0 c8\n#1 d8\n#0 h2 e8\n",
	(t) => count(t, /#0/g) === 1,
);
expectNormalized(
	"music above the first #N goes under the starting channel",
	"#amk 4\nt54 @3 o2\n#1 c8\n",
	(t) => /#1 [^\n]*t54 @3 o2/.test(t) && count(t, /#1/g) === 1,
);
expectNormalized("a moved block is given the octave it was parsed under", "#amk 4\n#0 c8\n#1 o3 d8\n#0 e8\n", (t) =>
	/c8\s+o3 e8/.test(t),
);
expectNormalized(
	"a #spc block and a remote definition stay in the header",
	'#amk 4\n#spc\n{\n\t#title "x"\n}\n(!1)[ $F4 $02 ]\nv200\n#1 c8\n',
	(t) => t.indexOf("#title") < t.indexOf("(!1)") && t.indexOf("(!1)") < t.indexOf("#1") && /#1 [^\n]*v200/.test(t),
);
// A remote definition's own `(!n)` label is not music, so the body setting `q`
// is not "after music above the first channel". Only the `[` carries the loop
// event, so the label is classified a beat before anything knows what it opens.
expectNormalized(
	"a remote definition that sets q, with nothing above it",
	"#amk 4\n(!1)[ q3F $F4 $02 ]\n#0 o4 c8 (!1, 1, 8)\n",
	(t) => t.includes("(!1)[ q3F $F4 $02 ]"),
);
// And an `l` in one is left where it was written, governing nothing: a remote
// body cannot hold a note at all (AMK0165), and every note outside carries its
// own length by then.
expectNormalized(
	"an l inside a remote definition",
	"#amk 4\n(!1)[ l16 $F4 $02 ]\n#0 o4 l8 c d (!1, 1, 8)\n",
	(t) => t.includes("(!1)[ l16 $F4 $02 ]") && t.includes("c8 d8"),
);
// Where there really is music above the marker, the refusal stands.
expectRefused(
	"a remote definition that sets q after music above the first #N",
	"#amk 4\nt54 o2\n(!1)[ q3F $F4 $02 ]\n#0 c8 (!1, 1, 8)\n",
	"SST0612",
);

// ---------------------------------------------------------------------------
console.log("\ndefaults");
// ---------------------------------------------------------------------------

expectNormalized("a song that says nothing gets every default once", "#amk 4\n#0 c8 d8\n", (t) =>
	t.includes("#0 t53 o4 q7F @0 c8 d8"),
);
{
	const said = "#amk 4\n#0 t53 o4 q7F @0 c8 d8\n";
	expectNormalized("a song that says everything is left as it is", said, (t) => t === said);
}

expectNormalized("an o leaked from another channel is written as what it was", "#amk 4\n#0 o5 l16 c\n#1 d\n", (t) =>
	t.includes("#1 o5 q7F @0 d16"),
);
{
	const outcome = expectNormalized(
		"a tempo ratio the default cannot be written under",
		"#amk 4\n#option dividetempo 8\n#0 c8\n",
		(t) => !/\bt\d/.test(t),
	);
	check(
		"and it says so",
		outcome.ok && outcome.diagnostics.some((d) => d.code === "SST0611" && d.severity === "info"),
		outcome.ok ? describe(outcome.diagnostics) : "",
	);
}

expectNormalized("#halvetempo doubles the written default", "#amk 4\n#halvetempo\n#0 c8\n", (t) => t.includes("t106"));
expectNormalized(
	"no @ is written on #am4, where @ switches tuning on",
	"#am4\n#0 o4 c8\n",
	(t) => !t.includes("@0") && t.includes("q7F"),
);
// The roll reads a note's octave off its own emitted byte rather than off a
// running sum, so it has never needed these gone — and rewriting them cost the
// porter the idiom they wrote.
expectNormalized("< and > are left as written", "#amk 4\n#0 o4 c8 > d8 < e8\n", (t) => t.includes("o4 c8 > d8 < e8"));
{
	const said = "#amk 4\n#0 t53 o4 q7F @0 c8 > d8\n";
	expectNormalized("a song that says everything, shifts included, is left as it is", said, (t) => t === said);
}

// A shift moves the octave without saying what from, so a block whose prelude
// leads with one is not a block that has stated its octave: `#1` enters at 5,
// and the `o5` is what makes its `<` mean o4 wherever the block ends up.
expectNormalized(
	"a block whose prelude leads with a shift is given the octave it entered on",
	"#amk 4\n#0 o4 c8 >\n#1 < d8\n",
	(t) => t.includes("#1 o5 q7F @0 < d8"),
);
// And where that octave is one `o` cannot reach — the parser's counter sits at 7
// and at -1 where `o` spells 0 to 6 (Music.cpp:1400-1418) — the shift is already
// saying what the block needs, so there is nothing to write and nothing to
// refuse. AddmusicK compiles this, so normalizing it must not turn it away.
expectNormalized(
	"a block entered at an octave o cannot reach, with a shift of its own",
	"#amk 4\n#0 o6 c8 >\n#1 < d8\n",
	(t) => t.includes("#1 q7F @0 < d8"),
);

// ---------------------------------------------------------------------------
console.log("\ndrums");
// ---------------------------------------------------------------------------

expectNormalized("one drum @ per drum note on #6", "#amk 4\n#6 @21 c8 d8 e8\n", (t) =>
	t.includes("@21 c8 @21 d8 @21 e8"),
);
expectNormalized("#0 already has one per note", "#amk 4\n#0 @21 c8 d8\n", (t) => count(t, /@21/g) === 1);
expectNormalized("a rest between the @ and its note", "#amk 4\n#0 @21 r8 c8\n", (t) => t.includes("@21 r8 @21 c8"));
expectNormalized("@29 o2a1b2c3 on #0 and #6", "#amk 4\n#0 @29 o2a1b2c3\n#6 @29 o2a1b2c3\n");

// ---------------------------------------------------------------------------
console.log("\npitch slides");
// ---------------------------------------------------------------------------

const dump = (data: Uint8Array | null): string =>
	data === null ? "no data" : [...data].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");

/**
 * A `&` written out with the song data unchanged, byte for byte.
 *
 * `expectNormalized`'s oracle is `timelinesAgree`, which is a description of the
 * music and takes a rewrite that plays the same as a rewrite that is right. What
 * this pass claims is stricter and exact — the same bytes in the same order,
 * since `&` compiles to a `$DD` and the text now merely says so.
 *
 * So the pass is run **on its own** rather than through the pipeline: the whole
 * of normalize legitimately moves bytes about, and a song put through it comes
 * back with `writeDefaults`' `t` and `@` in front of everything. Isolating the
 * one pass is what makes "the same bytes" the claim it is.
 */
function expectSameBytes(name: string, source: string, shape?: (text: string) => boolean): void {
	expectNormalized(name, source, shape);

	const first = compiler.compile({ source, aramAddress: ARAM, options: { ...OPTIONS, trace: true } });
	if (!first.ok || !first.data || !first.trace) {
		check(`${name}: compiles for the pass alone`, false, describe(first.diagnostics));
		return;
	}

	const out = writePitchSlides({ text: source, result: first, trace: first.trace });
	const after = compiler.compile({ source: out.text, aramAddress: ARAM, options: OPTIONS }).data;
	check(
		`${name}: the pass alone changes no byte`,
		out.changed &&
			after !== null &&
			first.data.length === after.length &&
			first.data.every((byte, at) => byte === after[at]),
		out.changed ? `${dump(first.data)}\nbecame\n${dump(after)}\nfrom:\n${out.text}` : "the pass did nothing",
	);
}

/** A `&` the pass declines to write out: the song still normalizes, and says so. */
function expectSkipped(name: string, source: string): void {
	const outcome = normalize(source);
	const kept = outcome.ok && outcome.text.includes("&");
	const said = outcome.ok && outcome.diagnostics.some((d) => d.code === "SST0617" && d.severity === "info");
	check(
		`${name}: is left alone, and said so`,
		kept && said,
		outcome.ok ? `${describe(outcome.diagnostics)}\n${outcome.text}` : describe(outcome.diagnostics),
	);
}

expectSameBytes("a pitch slide", "#amk 4\n#0 o4 c4 & d4\n", (t) => t.includes("$DD $00 $30") && !t.includes("&"));
expectSameBytes("a slide onto a rest", "#amk 4\n#0 o4 c4 & r4\n", (t) => t.includes("$DD $00 $30 $C7"));
// The `$DD` bytes are appended when the *note* is parsed, so a command written
// between the two emits its own first and the run has to follow it.
expectSameBytes("a slide with a command in between", "#amk 4\n#0 o4 c4 & v100 d4\n", (t) => /v100\s+\$DD/.test(t));
// A `>` emits nothing, so the run can stay where the `&` was — which is also
// where `accumulateTiedLength` looks for it. The target byte is the one the
// octave change resolves to, since it is read off the note map rather than
// re-spelled: `$B2` is `o5 d`, written out in front of a `>` no pass touches.
expectSameBytes("a slide with an octave change in between", "#amk 4\n#0 o4 c4 & > d4\n", (t) =>
	/\$DD \$00 \$30 \$B2\s+>/.test(t),
);
// The remap is consumed by the note the slide lands on, and one byte is written
// twice — as the target and as the note. A written target would have taken the
// remap with it and left the note pitched.
expectSameBytes("a slide onto a drum", "#amk 4\n#0 o4 c4 @21 & d4\n", (t) => t.includes("$DD $00 $30 $D0"));
expectSameBytes("a slide onto a drum on #6", "#amk 4\n#6 o4 @21 c4 & d4\n");
expectSameBytes("a slide on Addmusic 4.05", "#am4\n#0 o4 c4 & d4\n");
expectSameBytes("a slide on AddmusicM", "#amm\n#0 o4 c4 & d4\n");
expectSameBytes("a slide inside a loop", "#amk 4\n#0 o4 [c4 & d4]2\n", (t) => count(t, /\$DD/g) === 1);
expectSameBytes("two slides in a row", "#amk 4\n#0 o4 c4 & d4 & e4\n", (t) => count(t, /\$DD/g) === 2);

// `accumulateTiedLength` rewinds the last tie out of the run in front of the
// text `$DD` on every target, but in front of a `&` only on the legacy ones
// (`parser.ts:3026-3032`). So on `#amk` the rewrite would gain a rewind the `&`
// never had, and the slide would start a tie later than it does.
expectSkipped("a slide after a tie", "#amk 4\n#0 o4 c4^8 & d4\n");
// And the other way: the legacy targets already rewound, so moving the run past
// a command that emits bytes would take that rewind away.
expectSkipped("a slide after a tie on Addmusic 4.05", "#am4\n#0 o4 c4^8 & v100 d4\n");
// A `&` whose note is already a `$DD`'s written target: `parseNote` appends the
// byte and returns before the note map is written, so there is no entry to read
// the slide's own target from.
expectSkipped("a slide onto a $DD target", "#amk 4\n#0 o4 c4 & $DD $00 $18 d8\n");

// ---------------------------------------------------------------------------
console.log("\nwhole songs");
// ---------------------------------------------------------------------------

expectNormalized(
	"the sample song",
	SAMPLE_SONG,
	// The header above `#0`, blank line included, comes through byte for byte.
	(t) => t.startsWith(SAMPLE_SONG.slice(0, SAMPLE_SONG.indexOf("#0"))) && t.includes("}\n\n#0 q7F @0 w255 t54"),
);

const SINK = `#amk 4
#spc
{
	#title "sink"
	#author "x"
}
#samples
{
	#default
}
#instruments
{
	@0 $FF $E0 $B8 $02 $00
}
(!1)[ $F4 $02 ]
#0 w200 t48 $EF $20 $40 $40 $F1 $02 $30 $01
@30 v200 y10 p20,10 q7F o4 l8
(1)[ c d e $DD $00 $18 g f ]2 r4 (!1, 1, 8) $ED $7F $E0 c8 & d8
/ [[ v150 c16 d16 ]]3 (1)2 *2 n1F c8 $F8 $00 $DF
#1 @1 o3 l16 q5F [ c d ]4 > $E4 $00 e f $E7 $C8 y15
#2 @21 c8 @22 d8 @23 e8
#3 o4 {c8 d8 e8} [ c8^16 r16 ]3
`;
expectNormalized("a song that uses a little of everything", SINK);

expectNormalized("a #1-only song with a command above it", "#amk 4\n$ED $7F $E0\n#1 o4 c8\n", (t) =>
	/#1 [^\n]*\$ED \$7F \$E0/.test(t),
);
expectNormalized("an #amk 1 song", "#amk 1\n#0 o4 [c8 d8]2 e8\n", (t) => t.includes("[c8 d8]2 e8"));
expectNormalized(
	"an #amm song",
	"#amm\n#0 o4 [c8 d8]2 e8 ; a comment\n",
	(t) => t.includes("[c8 d8]2 e8") && t.includes("; a comment"),
);

// ---------------------------------------------------------------------------
// One channel at a time
// ---------------------------------------------------------------------------

/**
 * The point of the scoped form is that another channel's trouble is not this
 * channel's: the roll edits one channel and refuses the ones it cannot splice,
 * so what it needs is that channel put in order and nothing else touched.
 */
console.log("\nnormalizing one channel");
{
	// The scoped form reaches inside #0's own loop body — the `{ }` there is
	// #0's own text — and touches nothing of #1's, its loop included.
	const source = "#amk 2\n#0 o4 [{c8 d8 e8}]2 e4\n#1 o4 [g4 a4]2 b4\n";
	const before = build(source);
	const scoped = normalizeSong(source, ARAM, OPTIONS, 0);
	check("one channel: normalizes", scoped.ok, scoped.ok ? "" : describe(scoped.diagnostics));
	if (scoped.ok && typeof before !== "string") {
		const after = build(scoped.text);
		check("one channel: the result compiles", typeof after !== "string", typeof after === "string" ? after : "");
		check(
			"one channel: the triplet inside #0's own body is written out",
			scoped.text.includes("[c12 d12 e12]2"),
			JSON.stringify(scoped.text),
		);
		check(
			"one channel: #1's loop is left exactly as it was",
			scoped.text.includes("#1 o4 [g4 a4]2 b4"),
			JSON.stringify(scoped.text),
		);
		if (typeof after !== "string") {
			const difference = timelinesAgree(
				{ timeline: before.timeline, noteMap: before.result.noteMap ?? [] },
				{ timeline: after.timeline, noteMap: after.result.noteMap ?? [] },
				{ writtenTempo: null },
			);
			check("one channel: plays the same music", difference === null, difference?.message ?? "");
		}
	}
}

// The default note length is one variable for the whole song, so a scoped run
// cannot take an `l` out: `#1`'s bare notes read `#0`'s, and a `[ ]` body's
// events carry channel 8 rather than the channel that wrote them. Rewriting
// those readers is rewriting text a scoped run has promised to leave alone, so
// the lengths pass stands down and the `l` stays.
{
	const source = "#amk 2\n#0 o4 l16 c d\n#1 o4 e f\n";
	const scoped = normalizeSong(source, ARAM, OPTIONS, 0);
	check(
		"one channel: an l another channel reads is left alone",
		scoped.ok && scoped.text.includes("l16 c d") && scoped.text.includes("#1 o4 e f"),
		scoped.ok ? JSON.stringify(scoped.text) : describe(scoped.diagnostics),
	);
}

{
	const source = "#amk 2\n#0 o4 l16 [c d]2 e\n";
	const scoped = normalizeSong(source, ARAM, OPTIONS, 0);
	check(
		"one channel: an l a loop body reads is left alone",
		scoped.ok && scoped.text.includes("l16"),
		scoped.ok ? JSON.stringify(scoped.text) : describe(scoped.diagnostics),
	);
}

{
	// A crossed pair on #1 is nothing normalize objects to any more — the text
	// stands and the roll's gate is what refuses the shape — so both scopes and
	// the whole song rewrite around it untouched.
	const source = "#amk 2\n#0 o4 [c4 d4]2 e4\n#1 o4 [ c4 $E6 $00 d4 ]2 e4 $E6 $01\n";
	const whole = normalize(source);
	const scoped = normalizeSong(source, ARAM, OPTIONS, 0);
	check(
		"a crossing on another channel: the whole song still normalizes",
		whole.ok && whole.text.includes("[ c4 $E6 $00 d4 ]2 e4 $E6 $01"),
		whole.ok ? JSON.stringify(whole.text) : describe(whole.diagnostics),
	);
	check(
		"a crossing on another channel: #0 alone normalizes too",
		scoped.ok,
		scoped.ok ? "" : describe(scoped.diagnostics),
	);
}

{
	// A body #0 declares and #1 recalls: scoped to #1 the body is #0's text and
	// is left as written, and the dialog is told so — the info note is what
	// stops "nothing to normalize" standing beside a shape the porter can see.
	const source = "#amk 2\n#0 o4 (1)[{c8 d8 e8}]2\n#1 o4 (1)2 g4\n";
	const scoped = normalizeSong(source, ARAM, OPTIONS, 1);
	check(
		"a body another channel declares: left as written and said so (SST0618)",
		scoped.ok && scoped.text.includes("{c8 d8 e8}") && scoped.diagnostics.some((d) => d.code === "SST0618"),
		scoped.ok ? `${describe(scoped.diagnostics)}\n${JSON.stringify(scoped.text)}` : describe(scoped.diagnostics),
	);

	// Scoped to #0 the body is its own, and the triplet inside it is written out.
	const own = normalizeSong(source, ARAM, OPTIONS, 0);
	check(
		"the same body scoped to its declarer: rewritten",
		own.ok && own.text.includes("(1)[c12 d12 e12]2"),
		own.ok ? JSON.stringify(own.text) : describe(own.diagnostics),
	);
}

{
	// A remote definition sits above the first `#N`, which is where the scoped
	// form's own channel starts — and it is not something any pass can rewrite,
	// so putting #0 in order has to leave it character for character.
	const source = "#amk 2\n(!1)[$F4 $02]\n#0 o4 [c4 d4]2 (!1, 1, 8) e4\n#1 o4 g4\n";
	const scoped = normalizeSong(source, ARAM, OPTIONS, 0);
	check("#0 under a remote definition: normalizes", scoped.ok, scoped.ok ? "" : describe(scoped.diagnostics));
	if (scoped.ok) {
		check(
			"#0 under a remote definition: the definition is untouched",
			scoped.text.includes("(!1)[$F4 $02]\n"),
			JSON.stringify(scoped.text),
		);
		check(
			"#0 under a remote definition: the call is untouched",
			scoped.text.includes("(!1, 1, 8)"),
			JSON.stringify(scoped.text),
		);
		check(
			"#0 under a remote definition: its own loop stands as written",
			scoped.text.includes("[c4 d4]2"),
			JSON.stringify(scoped.text),
		);
	}
}

{
	// Joining a channel's blocks moves text past other channels', so the scoped
	// form says so rather than doing it.
	const source = "#amk 2\n#0 c4\n#1 d4\n#0 e4\n";
	const scoped = normalizeSong(source, ARAM, OPTIONS, 0);
	check(
		"a channel written in two blocks: refused with SST0615",
		!scoped.ok && scoped.diagnostics.some((d) => d.code === "SST0615"),
		describe(scoped.diagnostics),
	);
}

summarise();
