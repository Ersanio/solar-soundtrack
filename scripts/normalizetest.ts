/**
 * The normalizer: `@amk/compiler/normalize`, driven the way the app drives it
 * through `web/src/app/state/normalize-song.ts`.
 *
 * Every song that normalizes is held to four things, and the last three are
 * what make the first worth having: it compiles, it **plays the same music** —
 * the walk of the result agrees with the walk of the original on every note,
 * its tick, its state and the pitch it was written at — it has nothing left
 * that the roll cannot splice (no loop, call, triplet, replacement or
 * preprocessor line outside a remote definition), and it is a **fixed point**:
 * normalizing the result changes nothing. The songs that are refused are
 * refused for a named reason, and the reason is pinned too.
 *
 *   npm run normalizetest
 */

import { compiler } from "@amk/compiler";
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
 * What may still be there afterwards: remote code, and the quoted names and
 * braces of the header blocks. Anything else the roll would trip on is named.
 */
function residue(text: string): string | null {
	const stripped = text
		.replace(/#(spc|samples|instruments)\s*\{[^}]*\}/gi, "")
		.replace(/#path\s+"[^"]*"/gi, "")
		.replace(/\("[^"]*"\s*,[^)]*\)/g, "")
		.replace(/\(![^)]*\)\[[^\]]*\]/g, "")
		.replace(/\(![^)]*\)/g, "");
	const left = /[[\]*{}"]|\(\d+\)|#(define|undef|ifdef|ifndef|if|endif)\b/.exec(stripped);
	return left ? left[0] : null;
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
	check(`${name}: nothing left to unroll`, left === null, `found ${left ?? ""} in:\n${outcome.text}`);

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

expectNormalized(
	"a [ ] body with an octave step inside",
	"#amk 4\n#0 o4 [c8 d8 > e8 f8]3 g8\n",
	(t) => count(t, /c8/g) === 3,
);
expectNormalized("a drum remap standing at the [", "#amk 4\n#0 @21 [ c8 ]2 d8\n", (t) => count(t, /@21/g) === 3);
expectNormalized(
	"the same on #6, where a note does not consume it",
	"#amk 4\n#6 @21 [ c8 ]2 d8\n",
	(t) => count(t, /@21/g) === 3,
);
expectNormalized("a drum remap set inside the body", "#amk 4\n#0 [ @21 c8 ]2 d8\n", (t) =>
	t.includes("@21 c8 @21 c8 d8"),
);
expectNormalized("a * call", "#amk 4\n#0 [c8 d8]2 *3 e8\n", (t) => count(t, /c8/g) === 5);
expectNormalized(
	"a label loop called from another channel under another o and l",
	"#amk 4\n#0 o4 l8 (1)[c d e]2\n#1 o3 l16 (1)3 f\n",
	(t) => t.includes("o4 l8 c d e") && t.includes("o3 l16 f") && count(t, /c d e/g) === 5,
);
expectNormalized("a subloop inside a loop", "#amk 4\n#0 [ c8 [[ d8 ]]3 e8 ]2\n", (t) => count(t, /d8/g) === 6);
expectNormalized("a loop inside a subloop", "#amk 4\n#0 [[ c8 [ d8 ]2 e8 ]]2\n", (t) => count(t, /d8/g) === 4);
expectNormalized("a q inside the body", "#amk 4\n#0 q7F [ q3F c8 ]2 d8\n", (t) => t.includes("q7F q3F c8"));
expectNormalized(
	"a custom instrument set inside the body",
	"#amk 4\n#instruments\n{\n@0 $FF $E0 $B8 $02 $00\n}\n#0 @0 [ @30 c8 ]2 d8\n",
	(t) => t.includes("@30 c8 @30 c8 d8"),
);
expectNormalized(
	"h inside a body called from a channel without h",
	"#amk 4\n#0 (1)[ h3 c8 d8 ]2\n#1 o4 (1)2 e8\n",
	(t) => count(t, /h3 c8 d8/g) === 4 && t.includes("#1 e8"),
);
expectNormalized("a ] with no count", "#amk 4\n#0 [c8 d8] e8\n", (t) => count(t, /c8/g) === 1);
expectNormalized(
	"remote code is left alone",
	"#amk 4\n(!1)[ $F4 $02 ]\n#0 (!1, 1, 8) c8\n",
	(t) => t.includes("(!1)[ $F4 $02 ]") && t.includes("(!1, 1, 8) c8"),
);
expectNormalized(
	"the loop the roll cannot answer from the text",
	"#amk 4\n#0 v255 (1)[ c8 d8 e8 ]2 v200 (1)5\n",
	(t) => count(t, /c8 d8 e8/g) === 7,
);

expectRefused("a * before any loop", "#amk 4\n#0 *2 c4\n", "SST0602");
expectRefused("a call under a differently tuned instrument", "#amk 4\n#0 @0 (1)[c8]2\n#1 @2 (1)2\n", "SST0604");
expectRefused("an @ inside the body that would retune what follows", "#amk 4\n#0 @0 [ @2 c8 ]2 d8\n", "SST0605");
expectRefused("a pitch slide across a bracket", "#amk 4\n#0 c8 & [ d8 ]2\n", "SST0607");
expectRefused("a song that retunes an instrument", "#amk 4\ntuning[0]=2\n#0 [c8]2\n", "SST0608");

// ---------------------------------------------------------------------------
console.log("\ntriplets");
// ---------------------------------------------------------------------------

expectNormalized("a triplet", "#amk 4\n#0 {c8 d8 e8} f8\n", (t) => t.includes("c12 d12 e12 f8"));
expectNormalized("a triplet with an l inside", "#amk 4\n#0 {l16 c d} e\n", (t) => t.includes("l16 c24 d24 e"));
expectNormalized("a triplet only =N can spell", "#amk 4\n#0 {c3} d8\n", (t) => t.includes("c=43 d8"));
expectNormalized("a tied note in a triplet", "#amk 4\n#0 {c8^8} d8\n", (t) => t.includes("c6 d8"));

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

// ---------------------------------------------------------------------------
console.log("\ndefaults");
// ---------------------------------------------------------------------------

expectNormalized("a song that says nothing gets every default once", "#amk 4\n#0 c8 d8\n", (t) =>
	t.includes("#0 t53 o4 l8 q7F @0 c8 d8"),
);
{
	const said = "#amk 4\n#0 t53 o4 l8 q7F @0 c8 d8\n";
	expectNormalized("a song that says everything is left as it is", said, (t) => t === said);
}

expectNormalized("an o leaked from another channel is written as what it was", "#amk 4\n#0 o5 l16 c\n#1 d\n", (t) =>
	t.includes("#1 o5 l16 q7F @0 d"),
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
expectNormalized("< and > become absolute", "#amk 4\n#0 o4 c8 > d8 < e8\n", (t) => t.includes("o4 c8 o5 d8 o4 e8"));
expectNormalized("a > past o6 stays as written", "#amk 4\n#0 o6 c8 > < d8\n", (t) => t.includes("o6 c8 > o6 d8"));

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
console.log("\nwhole songs");
// ---------------------------------------------------------------------------

expectNormalized(
	"the sample song",
	SAMPLE_SONG,
	// The header above `#0`, blank line included, comes through byte for byte.
	(t) => t.startsWith(SAMPLE_SONG.slice(0, SAMPLE_SONG.indexOf("#0"))) && t.includes("}\n\n#0 l8 q7F @0 w255 t54"),
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
expectNormalized("an #amk 1 song", "#amk 1\n#0 o4 [c8 d8]2 e8\n", (t) => count(t, /c8/g) === 2);
expectNormalized(
	"an #amm song",
	"#amm\n#0 o4 [c8 d8]2 e8 ; a comment\n",
	(t) => count(t, /c8/g) === 2 && t.includes("; a comment"),
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
	const source = "#amk 2\n#0 o4 [c4 d4]2 e4\n#1 o4 [g4 a4]2 b4\n";
	const before = build(source);
	const scoped = normalizeSong(source, ARAM, OPTIONS, 0);
	check("one channel: normalizes", scoped.ok, scoped.ok ? "" : describe(scoped.diagnostics));
	if (scoped.ok && typeof before !== "string") {
		const after = build(scoped.text);
		check("one channel: the result compiles", typeof after !== "string", typeof after === "string" ? after : "");
		check(
			"one channel: #0's loop is gone",
			count(scoped.text.split("#1")[0], /\[/g) === 0,
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

{
	// A loop that cannot be unrolled on #1 must not stop #0 being put in order —
	// this is the whole reason the scoped form exists rather than being the
	// whole-song one with a filter bolted on afterwards.
	const source = "#amk 2\n#0 o4 [c4 d4]2 e4\n#1 @0 [ @2 g4 ]2 a4\n";
	const whole = normalize(source);
	const scoped = normalizeSong(source, ARAM, OPTIONS, 0);
	check("a channel the whole song cannot manage: the whole song is refused", !whole.ok, "it normalized");
	check(
		"a channel the whole song cannot manage: #0 alone still normalizes",
		scoped.ok,
		scoped.ok ? "" : describe(scoped.diagnostics),
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
			"#0 under a remote definition: its own loop is still unrolled",
			count(scoped.text.split("#1")[0], /\[/g) === 1,
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
