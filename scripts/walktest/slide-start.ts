/** `walktest`: the note the bend inspector draws a slide from. */

import "../localize";
import { tokenize } from "@amk/tokens";
import { bendAnchor } from "@amk/tokens/command-hazards";
import { slideStart } from "../../web/src/app/output/command-inspector/bend-command/slide-start";
import { check, section } from "../harness";
import { build } from "./support";

// ---------------------------------------------------------------------------
section("the note the bend inspector draws a slide from");
// ---------------------------------------------------------------------------
{
	// The byte the compiler emitted for the note the last `$DD`'s anchor names, off
	// the note map, or the target of the slide before it. `typed` is the document
	// as it stands while `source` is still the text that compiled, which is the
	// window a slider's commit opens.
	const startOf = (source: string, typed = source): string => {
		const { result } = build(source);
		const index = tokenize(typed);
		const slides = index.commands.filter((command) => command.vcmd === 0xdd);
		const slide = slides[slides.length - 1];
		if (slide === undefined) {
			return "no $DD";
		}

		const start = slideStart(bendAnchor(slide, index), { text: source, notes: result.noteMap ?? [] }, typed);
		return (start.kind === "note" || start.kind === "slide") && start.byte !== null
			? `${start.kind}:$${start.byte.toString(16)}`
			: start.kind;
	};

	const plain = "#amk 4\n#0 o4 e4 $DD $00 $18 $B0 d4\n";
	check("a slide is drawn from the note before it", startOf(plain) === "note:$a8", startOf(plain));

	// Two derivations of one interval: the walk reads the note and the target off
	// the bytes the driver runs.
	const walked = build(plain).timeline.notes[0];
	check(
		"which is the interval the walk finds",
		walked.bend !== null && walked.bend.target - walked.note === 0xb0 - 0xa8,
		`${JSON.stringify(walked.bend)} on $${walked.note.toString(16)}`,
	);

	// `h` is in the note's byte and not in a hex target, so the byte drawn from is
	// the emitted one rather than the one the letter names.
	const shifted = "#amk 4\n#0 h2 o4 c4 $DD $00 $18 $B0 d4\n";
	const shiftedNote = build(shifted).timeline.notes[0].note;
	check(
		"under h, the emitted byte and not the written one",
		startOf(shifted) === `note:$${shiftedNote.toString(16)}` && shiftedNote !== 0xa4,
		`${startOf(shifted)} against $${shiftedNote.toString(16)}`,
	);

	for (const [name, source, want] of [
		["a tied note, by its head", "#amk 4\n#0 o4 e4^8 $DD $00 $18 $B0 d4\n", "note:$a8"],
		["a rest", "#amk 4\n#0 o4 e4 r4 $DD $00 $18 $B0 d4\n", "rest"],
		["a drum", "#amk 4\n#0 o4 @21 c4 $DD $00 $18 $B0 d4\n", "drum"],
		["nothing", "#amk 4\n#0 $DD $00 $18 $B0 o4 c4\n", "nothing"],
		// A tie keys nothing on, so the pitch is still the note's.
		["a tie, by the note it extends", "#amk 4\n#0 o4 e4 v200 ^8 $DD $00 $08 $B0 d4\n", "note:$a8"],
		// Behind another, the pitch is where the first one ended.
		["another slide, at its target", "#amk 4\n#0 o4 e4 $DD $00 $08 $B0 $DD $00 $08 $B5 d4\n", "slide:$b0"],
		["another slide's written target", "#amk 4\n#0 o4 e4 $DD $00 $08 g $DD $00 $08 $B5 d4\n", "slide"],
	] as const) {
		check(`a slide after ${name} is ${want}`, startOf(source) === want, startOf(source));
	}

	// Nothing after a note changes its byte, so a compile that agrees up to the
	// note's end still names it — the slide's own operands included.
	const operand = startOf(plain, "#amk 4\n#0 o4 e4 $DD $00 $30 $B5 d4\n");
	check("an edit after the note keeps the answer", operand === "note:$a8", operand);
	const earlier = startOf(plain, "#amk 4\n#0 o5 e4 $DD $00 $18 $B0 d4\n");
	check("an edit before it waits for the compile", earlier === "unknown", earlier);

	const index = tokenize(plain);
	const slide = index.commands.find((command) => command.vcmd === 0xdd);
	const uncompiled = slide ? slideStart(bendAnchor(slide, index), null, plain).kind : "no $DD";
	check("and no compile names nothing", uncompiled === "unknown", uncompiled);
}
