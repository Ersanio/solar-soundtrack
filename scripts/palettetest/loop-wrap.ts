/** `palettetest`: putting brackets round a selection: an offer compiles, and a refusal written out by hand does not. */

import "../localize";
import { compiler } from "@amk/compiler";
import { walkSong } from "@amk/spc/song-walk";
import { tokenize } from "@amk/tokens";
import { readLoops } from "@amk/tokens/commands/loops";
import {
	BRACKETS_UNPAIRED,
	isWrap,
	type WrapKind,
	type WrapOffer,
	WRAP_CHANNELS,
	WRAP_DEEP,
	WRAP_INTRO,
	WRAP_NO_NOTES,
	WRAP_NOTHING,
	WRAP_REPLACEMENT,
	WRAP_SPLIT,
	wrapVerdict,
} from "../../web/src/app/editor/command-palette/loop-wrap";
import { check, section } from "../harness";
import { ARAM } from "./support";

// ---------------------------------------------------------------------------
section("putting brackets round a selection");
// ---------------------------------------------------------------------------
//
// The same standard as `formAvailability` above, applied to a rule about
// structure rather than about dialect: `loop-wrap.ts` says which of the two
// constructs may be written round a run *before* the brackets exist, and the
// compiler is asked afterwards whether it was right. An offer that does not
// compile is the promise broken; a refusal that would have compiled is a button
// dead for nothing, so both directions are checked — the construct the verdict
// declined is written out by hand and has to fail.
{
	const wrapped = (song: string, pick: string, want: WrapKind) => {
		const index = tokenize(song);
		const at = song.indexOf(pick);
		return wrapVerdict({
			source: song,
			index,
			reading: readLoops(song, index),
			run: at < 0 || pick === "" ? null : { start: at, end: at + pick.length },
			want,
		});
	};

	const applied = (song: string, offer: WrapOffer) =>
		song.slice(0, offer.at.start) +
		offer.open +
		song.slice(offer.at.start, offer.at.end) +
		offer.close +
		song.slice(offer.at.end);

	const errorsIn = (song: string) =>
		compiler
			.compile({ source: song, aramAddress: ARAM })
			.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
			.map((diagnostic) => diagnostic.code);

	/** Notes the pass plays on channel 0 — how a wrap is proved to have repeated them. */
	const played = (song: string) => {
		const data = compiler.compile({ source: song, aramAddress: ARAM }).data;
		return data === null || data === undefined
			? -1
			: walkSong(data, ARAM).notes.filter((note) => note.channel === 0).length;
	};

	/** An offer, compiled; the label says what was asked for and where. */
	const offers = (label: string, song: string, pick: string, want: WrapKind, kind: WrapKind) => {
		const verdict = wrapped(song, pick, want);
		if (!isWrap(verdict)) {
			check(label, false, `refused: ${verdict.refused}`);
			return null;
		}

		check(label, verdict.kind === kind, `offered the ${verdict.kind}`);
		const out = applied(song, verdict);
		check(`${label}, and AddmusicK takes it silently`, errorsIn(out).length === 0, errorsIn(out).join(" "));
		return out;
	};

	const refuses = (label: string, song: string, pick: string, want: WrapKind, because: string) => {
		const verdict = wrapped(song, pick, want);
		check(label, !isWrap(verdict) && verdict.refused === because, isWrap(verdict) ? "offered" : verdict.refused);
	};

	// The plain case, and the claim that gives a wrap its point.
	{
		const song = "#amk 4\n#0 o4 c4 d4 e4 f4\n";
		const out = offers("a run outside every bracket takes a loop", song, "c4 d4", "loop", "loop");
		check("and the loop is labelled from 0", out?.includes("(0)[") === true, out ?? "");
		check(
			"and the two notes inside it now play twice",
			out !== null && played(out) === played(song) + 2,
			`${out === null ? "?" : played(out)} against ${played(song)}`,
		);
	}

	// The switch the feature is named for, in both directions.
	offers(
		"a run inside a loop takes the subloop instead",
		"#amk 4\n#0 o4 (0)[ c4 d4 e4 ]2\n",
		"c4 d4",
		"loop",
		"subloop",
	);
	offers("a run inside a subloop takes the loop", "#amk 4\n#0 o4 [[ c4 d4 ]]2 e4\n", "c4 d4", "loop", "loop");
	offers(
		"a run holding a loop takes the subloop round it",
		"#amk 4\n#0 o4 (0)[ c4 d4 ]2 e4\n",
		"(0)[ c4 d4 ]2",
		"loop",
		"subloop",
	);
	offers(
		"and a hand-written $E6 pair counts as the subloop it is",
		"#amk 4\n#0 o4 $E6 $00 c4 d4 $E6 $01\n",
		"c4 d4",
		"loop",
		"loop",
	);

	// Both levels spent. The proof it is a real limit and not a guess: writing
	// either construct there by hand is one of the two errors named below.
	{
		const song = "#amk 4\n#0 o4 [ c4 [[ d4 e4 ]]2 f4 ]3\n";
		refuses("a run inside both is refused", song, "d4 e4", "loop", WRAP_DEEP);
		check(
			"and a loop written there really is AMK0123",
			errorsIn(song.replace("d4 e4", "[ d4 e4 ]2")).includes("AMK0123"),
			errorsIn(song.replace("d4 e4", "[ d4 e4 ]2")).join(" "),
		);
		check(
			"and a subloop really is AMK0121",
			errorsIn(song.replace("d4 e4", "[[ d4 e4 ]]2")).includes("AMK0121"),
			errorsIn(song.replace("d4 e4", "[[ d4 e4 ]]2")).join(" "),
		);
	}

	// The swap in the other direction: the depth is what runs out, not the button.
	offers(
		"a subloop asked for inside a subloop takes the loop instead",
		"#amk 4\n#0 o4 [[ c4 d4 ]]2\n",
		"c4 d4",
		"subloop",
		"loop",
	);
	refuses(
		"and asked for inside both it is refused in the same words",
		"#amk 4\n#0 o4 [ c4 [[ d4 e4 ]]2 f4 ]3\n",
		"d4 e4",
		"subloop",
		WRAP_DEEP,
	);

	// With the brackets unpaired there is nothing to reason from, and the compiler
	// would refuse the song anyway.
	refuses("brackets that do not pair up refuse a wrap", "#amk 4\n#0 o4 [ c4 d4\n", "c4 d4", "loop", BRACKETS_UNPAIRED);

	// The refusals that are about the run rather than about the depth.
	refuses("nothing selected", "#amk 4\n#0 o4 c4 d4\n", "", "loop", WRAP_NOTHING);
	refuses("a selection with no note in it", "#amk 4\n#0 o4 c4 d4\n", "o4", "loop", WRAP_NO_NOTES);
	refuses("a run across a bracket", "#amk 4\n#0 o4 (0)[ c4 d4 ]2 e4\n", "d4 ]2 e4", "loop", WRAP_SPLIT);
	refuses("a run across a channel marker", "#amk 4\n#0 o4 c4\n#1 o4 d4\n", "c4\n#1 o4 d4", "loop", WRAP_CHANNELS);
	refuses("a run holding the intro marker", "#amk 4\n#0 o4 c4 / d4\n", "c4 / d4", "loop", WRAP_INTRO);
	refuses(
		"a run written through a replacement",
		'#amk 4\n"two=c4 d4"\n#0 o4 two e4\n',
		"two e4",
		"loop",
		WRAP_REPLACEMENT,
	);

	// The label, which is the one piece of state a wrap has to read off the whole
	// song. `parseLabelLoop` stores `n + 1` and `parseRemoteDefinition` stores `n`
	// (`parser.ts:2210`, `:2287-2288`), so `(0)` and `(!1)` are one slot and
	// writing both is AMK0124 — which is exactly what an allocator that counted
	// only its own kind would walk into.
	{
		const next = (song: string, pick: string) => {
			const verdict = wrapped(song, pick, "loop");
			return isWrap(verdict) ? verdict.label : null;
		};

		check("a song with no loops offers 0", next("#amk 4\n#0 o4 c4\n", "c4") === 0);
		check("a song already using (0) offers 1", next("#amk 4\n#0 o4 (0)[ c4 ]2 d4\n", "d4") === 1);
		check(
			"and a remote (!1) takes 0's slot, so the wrap offers 1",
			next("#amk 4\n(!1)[$F4 $09]\n#0 o4 c4\n", "c4") === 1,
			String(next("#amk 4\n(!1)[$F4 $09]\n#0 o4 c4\n", "c4")),
		);
		check(
			"and writing (0) beside that (!1) really is AMK0124",
			errorsIn("#amk 4\n(!1)[$F4 $09]\n#0 o4 (0)[ c4 ]2\n").includes("AMK0124"),
			errorsIn("#amk 4\n(!1)[$F4 $09]\n#0 o4 (0)[ c4 ]2\n").join(" "),
		);
	}

	// A `$DD` is read by the note in front of it rather than dispatched
	// (`main.asm:L_10E4`), so a closing bracket written between the two puts the
	// body's own `$00` where the slide was.
	{
		const out = offers(
			"a slide riding on the last note goes inside the brackets",
			"#amk 4\n#0 o4 c4 $DD $00 $18 $A4 d4\n",
			"c4",
			"loop",
			"loop",
		);
		check("and the bracket really is past it", out?.includes("$A4 ]2") === true, out ?? "");
	}

	// A drum's `@21`-`@29` comes inside with its note: `[` copies the remap into
	// slot 8 and the note there clears slot 8 alone (`parser.ts:2473`, `:2753`),
	// so one left outside would still be standing when the loop ends.
	{
		const out = offers("a drum takes its own @ in with it", "#amk 4\n#0 @21 c4 d4\n", "c4", "loop", "loop");
		check("and the @ is inside the brackets", out?.includes("[ @21 c4 ]") === true, out ?? "");
	}
}
