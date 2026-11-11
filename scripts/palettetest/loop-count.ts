/** `palettetest`: reading a loop's count and writing it back, priced in notes played. */

import "../localize";
import { compiler } from "@amk/compiler";
import type { Span } from "@amk/core/types";
import { walkSong } from "@amk/spc/song-walk";
import { commandAt, commandStartingAt, tokenize } from "@amk/tokens";
import type { Edit } from "@amk/tokens/edits";
import { readLoops } from "@amk/tokens/commands/loops";
import {
	BRACKETS_UNPAIRED,
	CALL_NESTED,
	CALL_NONE,
	callVerdict,
	isCall,
} from "../../web/src/app/editor/command-palette/loop-wrap";
import {
	loopCountEdit,
	loopFocus,
	loopNameEdit,
	loopTargetEdit,
} from "../../web/src/app/output/loop-inspector/loop-focus";
import { check, section } from "../harness";
import { ARAM } from "./support";

// ---------------------------------------------------------------------------
section("reading a loop's count, and writing it back");
// ---------------------------------------------------------------------------
//
// The same standard once more, on the other half of the brackets: `loop-focus.ts`
// says what a construct repeats and where that number is written, and the
// compiler is asked whether it was right. The claim is priced in **notes played**
// rather than in text, because every one of the five spellings keeps its count
// somewhere else — on the second of two `]` commands, on no command at all, or
// one less than itself — and a reading that is wrong about which produces a
// perfectly plausible field over the wrong number.
{
	const errorsIn = (song: string) =>
		compiler
			.compile({ source: song, aramAddress: ARAM })
			.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
			.map((diagnostic) => diagnostic.code);

	/** What channel 0 plays, by written pitch and in order — the oracle for a retarget. */
	const notesIn = (song: string) => {
		const data = compiler.compile({ source: song, aramAddress: ARAM }).data;
		return data === null || data === undefined
			? null
			: walkSong(data, ARAM)
					.notes.filter((note) => note.channel === 0)
					.map((note) => note.note);
	};

	const played = (song: string) => notesIn(song)?.length ?? -1;

	const focusOn = (song: string, pick: string) => {
		const index = tokenize(song);
		const at = song.indexOf(pick);
		return loopFocus({ source: song, index, reading: readLoops(song, index), caret: at, hint: null })[0];
	};

	const applied = (song: string, edit: Edit | null) =>
		edit === null ? song : song.slice(0, edit.span.start) + edit.text + song.slice(edit.span.end);

	// Every spelling, its count read and then written, priced against the walk.
	// A body of one note means "notes played" *is* the count, so a reading one
	// out — the `$E6`'s byte, the `]]`'s second bracket — cannot hide.
	{
		const cases: { name: string; song: string; pick: string; plays: number }[] = [
			{ name: "a [ ]n loop", song: "#amk 4\n#0 o4 [c4]4 e4\n", pick: "]4", plays: 4 },
			{ name: "a [ ] with no count", song: "#amk 4\n#0 o4 [c4] e4\n", pick: "]", plays: 1 },
			{ name: "a [[ ]]n subloop", song: "#amk 4\n#0 o4 [[c4]]4 e4\n", pick: "]]4", plays: 4 },
			{
				name: "a hand-written $E6 pair",
				song: "#amk 4\n#0 o4 $E6 $00 c4 $E6 $03 e4\n",
				pick: "$E6 $03",
				plays: 4,
			},
			{ name: "a (n)m call", song: "#amk 4\n#0 o4 (0)[c4]2 (0)3 e4\n", pick: "(0)3", plays: 3 },
			{ name: "a *n call", song: "#amk 4\n#0 o4 [c4]2 *3 e4\n", pick: "*3", plays: 3 },
		];

		for (const { name, song, pick, plays } of cases) {
			const focus = focusOn(song, pick);
			check(`${name} reads its count`, focus?.count?.plays === plays, String(focus?.count?.plays));

			const out = applied(song, focus ? loopCountEdit(song, focus, plays + 2) : null);
			check(`${name}, written up by two, compiles`, errorsIn(out).length === 0, errorsIn(out).join(" "));
			check(
				`${name}, written up by two, plays two more notes`,
				played(out) === played(song) + 2,
				`${played(out)} against ${played(song)}`,
			);
		}
	}

	// The wart the loop reading exists to retire. `gather` gives `]]4` two `]`
	// commands and the count lands on the second, so the first is a command whose
	// Repeats row can never be filled — and a caret there does not even reach it,
	// `commandAt` being end-inclusive and handing back the note in front instead.
	// Three claims, so a change to any of them is caught.
	{
		const song = "#amk 4\n#0 o4 [[c4]]4 e4\n";
		const commands = tokenize(song).commands;
		const at = song.indexOf("]]");
		const first = commandStartingAt(commands, at);
		check("the first ] of a ]]4 gathers no count of its own", first?.args.length === 0, String(first?.args.length));
		check("and a caret on it does not even reach that bracket", commandAt(commands, at)?.name === "note");
		check("where the loop reading finds the 4", focusOn(song, "]]")?.count?.plays === 4);
	}

	// A count written through a replacement is in the expansion `gather` sees and
	// not in the digits, so a reading off the source would say "nothing written,
	// so 1". Writing it is refused for the same reason `edits.ts` refuses every
	// macro'd part: the splice would overwrite the use site.
	{
		const song = '#amk 4\n"REP=4"\n#0 o4 [c4]REP e4\n';
		const focus = focusOn(song, "]REP");
		check("a count through a replacement is read as 4", focus?.count?.plays === 4, String(focus?.count?.plays));
		check("and is not editable", focus?.count?.editable === false);
		check("and the splice refuses", focus !== undefined && loopCountEdit(song, focus, 5) === null);
	}

	// Retargeting a call. Counted in *pitches* rather than in note totals: two
	// bodies of one note each play the same number of notes either way, so only
	// what is heard can tell a retarget from a no-op.
	{
		const song = "#amk 4\n#0 o4 (0)[c4]2 (1)[d4]2 (0)3 e4\n";
		const focus = focusOn(song, "(0)3");
		check(
			"a call offers every label declared above it",
			focus?.recalls?.options.map((option) => option.value).join(",") === "0,1",
			focus?.recalls?.options.map((option) => option.label).join(" ") ?? "",
		);

		const out = applied(song, focus ? loopTargetEdit(song, focus, 1) : null);
		check("and pointing it at (1) compiles", errorsIn(out).length === 0, errorsIn(out).join(" "));
		const before = notesIn(song) ?? [];
		const after = notesIn(out) ?? [];
		check(
			"and the three notes it played are now the other body's",
			before.length === after.length && before.join() !== after.join(),
			`${before.join()} -> ${after.join()}`,
		);
	}

	// A label declared *below* a call is one AddmusicK refuses outright, which is
	// why the control is a select over what is above rather than a number field.
	{
		const song = "#amk 4\n#0 o4 (0)3 (0)[c4]2 e4\n";
		check(
			"a call offers nothing where its body is declared below it",
			focusOn(song, "(0)3")?.recalls?.options.length === 0,
		);
		check("and writing that call really is AMK0115", errorsIn(song).includes("AMK0115"), errorsIn(song).join(" "));
	}

	// A `*` names no body, so the select's own entry is the honest description of
	// what it plays; choosing a label writes the call that says it out loud.
	{
		const song = "#amk 4\n#0 o4 (0)[c4]2 *3 e4\n";
		const focus = focusOn(song, "*3");
		check("a * reports no label", focus?.recalls?.label === -1, String(focus?.recalls?.label));
		const out = applied(song, focus ? loopTargetEdit(song, focus, 0) : null);
		check("and naming its body writes a (0) call", out.includes("(0)3"), out);
		check("which compiles", errorsIn(out).length === 0, errorsIn(out).join(" "));
		check("and plays exactly what the * did", notesIn(out)?.join() === notesIn(song)?.join());
	}

	// A remote body is jumped into by a `$FC` rather than looped over, so a count
	// on it means nothing and AddmusicK says so.
	{
		const song = "#amk 4\n(!1)[$F4 $09]\n#0 o4 c4\n";
		const focus = focusOn(song, "$F4");
		check("a remote definition offers no count", focus?.kind === "remote" && focus.count === null);
		check(
			"and writing one really is AMK0164",
			errorsIn("#amk 4\n(!1)[$F4 $09]2\n#0 o4 c4\n").includes("AMK0164"),
			errorsIn("#amk 4\n(!1)[$F4 $09]2\n#0 o4 c4\n").join(" "),
		);
	}

	// Naming a body, which is what makes an unnamed hand-written loop reachable
	// by a call at all. The allocator counts a `(!n)` too, or it walks into
	// AMK0124 — the same rule the wrap's own label test above pins.
	{
		const song = "#amk 4\n#0 o4 [c4]2 e4\n";
		const focus = focusOn(song, "]2");
		check("an unnamed loop offers the lowest free label", focus?.name?.label === 0, String(focus?.name?.label));
		const out = applied(song, focus ? loopNameEdit(focus, 0) : null);
		check("and naming it writes the (0) hard against the [", out.includes("(0)[c4]2"), out);
		check("which compiles", errorsIn(out).length === 0, errorsIn(out).join(" "));
		check("and plays what it played", notesIn(out)?.join() === notesIn(song)?.join());
		check(
			"a loop that already has a name is not offered another",
			focusOn("#amk 4\n#0 o4 (0)[c4]2 e4\n", "]2")?.name === null,
		);

		// A label the parser carries: `(n)[` sets `loopLabel`, a `[[` met next leaves
		// it standing and the next `[` files it (`parser.ts:2479-2485`), so the
		// second loop here is `(5)` and the call below plays `e4`. The reading has to
		// say so too, or the panel calls a compiling song's call undeclared and
		// offers the body a second name that would orphan the first.
		const carried = "#amk 4\n#0 o4 (5)[[ d4 ]]4 [ e4 ]2 (5)3\n";
		check("a label carried past a subloop compiles", errorsIn(carried).length === 0, errorsIn(carried).join(" "));
		const took = readLoops(carried, tokenize(carried)).spans.find((span) => span.kind === "call");
		check("and is filed on the loop that took it", took?.label === 5, String(took?.label));
		check(
			"so the call finds its body",
			focusOn(carried, "(5)3")?.recalls?.options.some((option) => option.value === 5) === true,
		);
		check("and that body is not offered another name", focusOn(carried, "]2")?.name === null);
	}

	// A subloop's floor is 2 and a `[ ]`'s is 1, and both are the compiler's.
	{
		check("a subloop's count starts at 2", focusOn("#amk 4\n#0 o4 [[c4]]4\n", "]]4")?.count?.min === 2);
		check("a loop's starts at 1", focusOn("#amk 4\n#0 o4 [c4]4\n", "]4")?.count?.min === 1);
		check(
			"and ]]1 really is AMK0126",
			errorsIn("#amk 4\n#0 o4 [[c4]]1\n").includes("AMK0126"),
			errorsIn("#amk 4\n#0 o4 [[c4]]1\n").join(" "),
		);
	}

	// The list, and its order. A note inside a nested body is inside both, and
	// the innermost is the one an edit there is about.
	{
		const song = "#amk 4\n#0 o4 (1)[c4 [[d4]]3 ]2 (1)5\n";
		const index = tokenize(song);
		const at = (pick: string) =>
			loopFocus({
				source: song,
				index,
				reading: readLoops(song, index),
				caret: song.indexOf(pick, 10),
				hint: null,
			});

		check("a note in one body names one loop", at("c4").length === 1 && at("c4")[0].kind === "loop");
		check(
			"a note in a nested body names both, innermost first",
			at("d4")
				.map((focus) => focus.kind)
				.join() === "subloop,loop",
			at("d4")
				.map((focus) => focus.kind)
				.join(),
		);
		check("and a caret on a call's own text says so", at("(1)5")[0]?.onText === true);
		check("where a caret inside a body does not", at("d4")[0]?.onText === false);
	}

	// What the roll's press adds, and the only thing it adds: which of a body's
	// constructs the porter took hold of. The caret is on the body's first note
	// either way, so without the hint every press answers with the declaration.
	{
		const song = "#amk 4\n#0 o4 (1)[c4 d4]2 e4 (1)3\n";
		const index = tokenize(song);
		const reading = readLoops(song, index);
		const body = reading.spans[0];
		const recall = reading.recalls[0];
		const ask = (hint: { text: Span; body: Span } | null) =>
			loopFocus({ source: song, index, reading, caret: body.bodyFrom, hint })[0];

		check("with no hint the body's own declaration leads", ask(null)?.kind === "loop");
		check(
			"a press on the recall's box puts that call first",
			ask({
				text: { start: recall.from, end: recall.to, line: 1 },
				body: { start: body.bodyFrom, end: body.bodyTo, line: 1 },
			})?.kind === "call",
		);
		check(
			"and a hint for another body is ignored",
			ask({
				text: { start: recall.from, end: recall.to, line: 1 },
				body: { start: 0, end: 1, line: 1 },
			})?.kind === "loop",
		);
	}

	// The palette's own half: what **Loop call** writes, and when it will not.
	{
		const asked = (song: string, pick: string) => {
			const index = tokenize(song);
			return callVerdict({ source: song, index, reading: readLoops(song, index), caret: song.indexOf(pick) });
		};

		const song = "#amk 4\n#0 o4 (0)[c4]2 (1)[d4]2 e4\n";
		const offer = asked(song, "e4");
		check("a call is offered where a named loop stands above the caret", isCall(offer));
		if (isCall(offer)) {
			check("and it names the nearest one", offer.label === 1, String(offer.label));
			const out = song.slice(0, song.indexOf("e4")) + offer.text + song.slice(song.indexOf("e4"));
			check("and AddmusicK takes it silently", errorsIn(out).length === 0, errorsIn(out).join(" "));
			check(
				"and it plays the body it named",
				played(out) === played(song) + 2,
				`${played(out)} against ${played(song)}`,
			);
		}

		const none = asked("#amk 4\n#0 o4 [c4]2 e4\n", "e4");
		check("an unnamed loop is nothing a call can reach", !isCall(none) && none.refused === CALL_NONE);

		const above = asked("#amk 4\n#0 o4 c4 (0)[d4]2\n", "c4");
		check("nor is one written below the caret", !isCall(above) && above.refused === CALL_NONE);

		const inside = asked("#amk 4\n#0 o4 (0)[c4]2 [d4 e4]2\n", "e4");
		check("a call inside a [ ] body is refused", !isCall(inside) && inside.refused === CALL_NESTED);
		check(
			"and writing one really is AMK0112",
			errorsIn("#amk 4\n#0 o4 (0)[c4]2 [d4 (0)2]2\n").includes("AMK0112"),
			errorsIn("#amk 4\n#0 o4 (0)[c4]2 [d4 (0)2]2\n").join(" "),
		);

		const sub = asked("#amk 4\n#0 o4 (0)[c4]2 [[d4 e4]]2\n", "e4");
		check("but one inside a [[ ]] is not — a subloop leaves the channel alone", isCall(sub));

		const unpaired = asked("#amk 4\n#0 o4 (0)[c4]2 [d4 e4\n", "e4");
		check(
			"and brackets that do not pair up refuse a call",
			!isCall(unpaired) && unpaired.refused === BRACKETS_UNPAIRED,
			isCall(unpaired) ? "offered" : unpaired.refused,
		);
	}
}
