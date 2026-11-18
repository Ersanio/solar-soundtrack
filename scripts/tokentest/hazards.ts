/** `tokentest`: command hazards, the bytes that compile clean and then break the song. */

import "../localize";
import { tokenize } from "@amk/tokens";
import { bendAnchor, commandHazards } from "@amk/tokens/command-hazards";
import { check, section } from "../harness";
import { said } from "./support";

section("command hazards — bytes that compile clean and then break the song");
{
	const anchorsIn = (source: string): string => {
		const index = tokenize(source);
		return index.commands
			.filter((command) => command.vcmd === 0xdd)
			.map((command) => said(bendAnchor(command, index)))
			.join();
	};

	const codesIn = (source: string): string =>
		commandHazards(tokenize(source))
			.map((d) => d.code)
			.join();

	// `$DD` is picked up by a peek at the byte standing at the track pointer
	// (`main.asm:L_10E4`) and its own dispatch slot is `$0000`, so what decides it
	// is a byte adjacency rather than anything about the operands. These are the
	// four answers the driver distinguishes.
	for (const [name, source, want] of [
		["a note of two ticks or more", "#amk 4\n#0 o4 c4 $DD $00 $18 $A4\n", "rides:48"],
		// A rest is a note byte to the driver: `$C7` runs the same path
		// (`main.asm:2393-2441`) and sets the same counters, so the slide arms on a
		// keyed-off voice and is inaudible rather than fatal.
		["a rest", "#amk 4\n#0 o4 r4 $DD $00 $18 $A4\n", "rides:48"],
		// The tie is a frame of its own: `accumulateTiedLength` rewinds it out of the
		// `$DD`'s way (`parser.ts:2813-2827`, Music.cpp:2224), so the peek gets 24
		// ticks and not the 72 the note is written as.
		["a tied note", "#amk 4\n#0 o4 c4^8 $DD $00 $18 $A4\n", "rides:24"],
		["a tie of one tick", "#amk 4\n#0 o4 c4^192 $DD $00 $18 $A4\n", "tooShort:1"],
		["a one-tick note", "#amk 4\n#0 o4 c192 $DD $00 $18 $A4\n", "tooShort:1"],
		// `emitNote` writes a note of `$80` ticks or more in `$60`-tick pieces, and
		// the peek runs in the last of them.
		["a whole note", "#amk 4\n#0 o4 c1 $DD $00 $18 $A4\n", "rides:96"],
		["a note of 129 ticks", "#amk 4\n#0 o4 c=129 $DD $00 $18 $A4\n", "rides:33"],
		["a note whose last piece is one tick", "#amk 4\n#0 o4 c=193 $DD $00 $18 $A4\n", "tooShort:193"],
		["nothing at all", "#amk 4\n#0 $DD $00 $18 $A4\n", "nothing"],
		["another channel's note", "#amk 4\n#0 o4 c4\n#1 $DD $00 $18 $A4\n", "nothing"],
		// The peek runs again once the slide before it has run out (`main.asm:3247-3249`).
		["a chained slide", "#amk 4\n#0 o4 c4 $DD $00 $18 e $DD $00 $18 g\n", "rides:48,rides:48"],
		// A `$C6` is a frame the peek runs in like any other.
		["a tie after a slide", "#amk 4\n#0 o4 c4 $DD $00 $08 $B0 ^4^8 $DD $00 $08 $B5 d4\n", "rides:48,rides:24"],
		["a written target's tie", "#amk 4\n#0 o4 c4 $DD $00 $08 e ^4 $DD $00 $08 g d4\n", "rides:48,rides:48"],
		// Nothing is rewound past the `q`, so the run is one frame of 72.
		["a tie a q apart from it", "#amk 4\n#0 o4 c4^8 q7F $DD $00 $18 $A4\n", "rides:72"],
		// Anything writing bytes is what the peek reads instead.
		["a volume", "#amk 4\n#0 o4 c4 v200 $DD $00 $18 $A4\n", "blocked:volume"],
		["a hex run", "#amk 4\n#0 o4 c4 $E7 $C8 $DD $00 $18 $A4\n", "blocked:volume"],
		["a loop bracket", "#amk 4\n#0 o4 c4 [ $DD $00 $18 $A4 ]2\n", "blocked:loop start"],
		// `label` raises no command at all, which is why this asks the whole index.
		["a loop call", "#amk 4\n#0 (1)[ o4 c4 ]2 c4 (1)3 $DD $00 $18 $A4\n", "blocked:loop call"],
		// `(!` is a one-character `(` with the `!` beside it, so the label alone
		// cannot tell a remote call from a loop call.
		["a remote call", "#amk 4\n(!1)[ v200 ]\n#0 o4 c4 (!1, 4) $DD $00 $18 $A4\n", "blocked:remote code call"],
		["a remote reset", "#amk 4\n#0 o4 c4 (!!0) $DD $00 $18 $A4\n", "blocked:remote code reset"],
		// and `l` are resolved at parse time.
		["an octave", "#amk 4\n#0 o4 c4 o5 $DD $00 $18 $A4\n", "rides:48"],
		["a default length", "#amk 4\n#0 o4 c4 l8 $DD $00 $18 $A4\n", "rides:48"],
		["a quantize", "#amk 4\n#0 o4 c4 q7F $DD $00 $18 $A4\n", "rides:48"],
		["a transpose letter", "#amk 4\n#0 o4 c4 h1 $DD $00 $18 $A4\n", "rides:48"],
		["a drum", "#amk 4\n#0 o4 c4 @21 $DD $00 $18 $A4\n", "rides:48"],
	] as const) {
		check(`a slide after ${name} is ${want}`, anchorsIn(source) === want, anchorsIn(source));
	}

	// The note each answer names, which is what the bend inspector draws the slide
	// from — the one in front of a blocker included.
	const ridesOn = (body: string): string => {
		const source = `#amk 4\n#0 ${body}\n`;
		const index = tokenize(source);
		const slide = index.commands.find((command) => command.vcmd === 0xdd);
		const anchor = slide ? bendAnchor(slide, index) : null;
		return anchor === null || anchor.kind === "nothing"
			? String(anchor?.kind)
			: `${anchor.kind}:${source.slice(anchor.note.start, anchor.note.end)}`;
	};

	for (const [name, body, want] of [
		["the note before it", "o4 c4 d4 e4 $DD $00 $18 $B0", "rides:e4"],
		["past what emits nothing", "o4 e4 h1 q7F @21 o5 $DD $00 $18 $B0", "rides:e4"],
		["a tied note", "o4 e4^8 $DD $00 $18 $B0", "rides:e4^8"],
		["a rest", "o4 e4 r4 $DD $00 $18 $B0", "rides:r4"],
		["a note too short", "o4 e192 $DD $00 $18 $B0", "tooShort:e192"],
		["a note behind a blocker", "o4 e4 v200 $DD $00 $18 $B0", "blocked:e4"],
	] as const) {
		check(`a slide names ${name}`, ridesOn(body) === want, ridesOn(body));
	}

	// The ticks a slide has before a key-on resets it. It steps only on ticks that
	// fetch nothing, so each frame gives one fewer than it lasts, and a tie after the
	// command keys nothing on. Every figure here is what the emulated driver gives.
	const windowIn = (source: string): string => {
		const index = tokenize(source);
		const slide = index.commands.find((command) => command.vcmd === 0xdd);
		const anchor = slide ? bendAnchor(slide, index) : null;
		return anchor?.kind === "rides" ? String(anchor.window) : String(anchor?.kind);
	};

	for (const [name, body, want] of [
		["a note alone", "c4 $DD $00 $FF $B0 d4", "47"],
		["an odd length", "c=7 $DD $00 $FF $B0 d4", "6"],
		["a tie after it", "c4 $DD $00 $FF $B0 ^4 d4", "94"],
		["a run of ties written against it", "a96 $DD $00 $FF $80^1^4^16^192 d4", "251"],
		["a whole note", "c1 $DD $00 $FF $B0 d4", "95"],
		["a long tie, in pieces", "c4 $DD $00 $FF $B0 ^=193 d4", "237"],
		["two ties, which fold into one", "c4 $DD $00 $FF $B0 ^4 ^8 d4", "118"],
		["two ties a command apart", "c4 $DD $00 $FF $B0 ^4 v180 ^8 d4", "117"],
		["a tie after a written target", "c4 $DD $00 $FF b ^4 d4", "94"],
		["a rest, which silences it", "c4 $DD $00 $FF $B0 r4 ^4 d4", "47"],
		["a loop, which is not followed", "c4 $DD $00 $FF $B0 [^4]2 d4", "47"],
		["ties that give their last piece up to the next slide", "c4 $DD $00 $08 $B0 ^4^8 $DD $00 $08 $B5 d4", "117"],
		["another channel's tie", "c4 $DD $00 $FF $B0\n#1 ^4", "47"],
	] as const) {
		const got = windowIn(`#amk 4\n#0 o4 ${body}\n`);
		check(`a slide has ${want} ticks with ${name}`, got === want, got);
	}

	// How far into the note the frame the slide arms in begins, which is what the
	// bend inspector says it starts after: `c4 $DD`, `c4^8 $DD` and `c1 $DD` arm 0,
	// 48 and 96 ticks in, the tie having been rewound into a frame of its own.
	const leadIn = (body: string): string => {
		const index = tokenize(`#amk 4\n#0 o4 ${body}\n`);
		const slide = index.commands.find((command) => command.vcmd === 0xdd);
		const anchor = slide ? bendAnchor(slide, index) : null;
		return anchor?.kind === "rides" ? String(anchor.lead) : String(anchor?.kind);
	};

	for (const [name, body, want] of [
		["a note of one piece", "c4 $DD $00 $18 $A4", "0"],
		["a tied note", "c4^8 $DD $00 $18 $A4", "48"],
		["a whole note", "c1 $DD $00 $18 $A4", "96"],
		["a note of 129 ticks", "c=129 $DD $00 $18 $A4", "96"],
	] as const) {
		check(`a slide after ${name} arms ${want} ticks in`, leadIn(body) === want, leadIn(body));
	}

	// Which tick of its frame the peek arms each slide on: the first that fetches
	// nothing, or the one after the slide before it has used its delay and its
	// steps. A duration of `$00` runs 256 steps with no delay and none behind one. A
	// key-on clears a running slide (`main.asm:465-466`) and a tie or a rest does
	// not, so one still running holds the peek off. Every figure is the emulated
	// driver's.
	const armsIn = (body: string): string => {
		const index = tokenize(`#amk 4\n#0 o4 ${body}\n`);
		return index.commands
			.filter((command) => command.vcmd === 0xdd)
			.map((command) => {
				const anchor = bendAnchor(command, index);
				return anchor.kind === "rides" ? `${anchor.frame}@${anchor.arms}` : said(anchor);
			})
			.join();
	};

	for (const [name, body, want] of [
		["chained and then on a tie", "g+2 $dd $00 $0c a $dd $0c $12 g ^4^2 $dd $00 $60 f", "96@1,96@13,96@1"],
		["behind one with a delay", "c4 $DD $08 $10 $B0 $DD $00 $08 $B5 d4", "48@1,48@25"],
		["on the frame's last tick", "c8 $DD $00 $16 e $DD $00 $01 g c4", "24@1,24@23"],
		["one tick too late", "c8 $DD $00 $17 e $DD $00 $01 g c4", "24@1,crowded"],
		["behind a duration of $00", "c1 $DD $00 $00 $B0 $DD $00 $08 $B5 c4", "96@1,crowded"],
		["behind a duration of $00 with a delay", "c4 $DD $08 $00 $B0 $DD $00 $08 $B5 c4", "48@1,48@2"],
		["behind one running on through a tie", "c4 $DD $00 $FF $B0 ^4 $DD $00 $08 $B5 c4", "48@1,crowded"],
		["behind one running on through a rest", "c4 $DD $00 $FF $B0 r4 $DD $00 $08 $B5 c4", "48@1,crowded"],
		["behind one ending on a tie's first tick", "c4 $DD $00 $30 $B0 ^4 $DD $00 $08 $B5 c4", "48@1,48@2"],
		["after a note keyed on in between", "c4 $DD $00 $FF $B0 d4 $DD $00 $08 $B5 c4", "48@1,48@1"],
		// Once one cannot arm the song stops there, so the rest of the run takes its answer.
		["past one that cannot arm", "c8 $DD $00 $18 e $DD $00 $18 g $DD $00 $01 a c4", "24@1,crowded,crowded"],
		["after a note too short", "c192 $DD $00 $08 e $DD $00 $08 g c4", "tooShort:1,tooShort:1"],
		["behind a blocker", "c4 v200 $DD $00 $08 e $DD $00 $08 g c4", "blocked:volume,blocked:volume"],
		["with a blocker inside the run", "c4 $DD $00 $08 e v200 $DD $00 $08 g c4", "48@1,blocked:volume"],
	] as const) {
		const got = armsIn(body);
		check(`a slide ${name} arms ${want}`, got === want, got);
	}

	// Behind another, a slide has what is left of the frame from the tick it arms on.
	const chained = tokenize("#amk 4\n#0 o4 c4 $DD $00 $08 e $DD $00 $08 g d4\n");
	const behind = bendAnchor(chained.commands.filter((command) => command.vcmd === 0xdd)[1], chained);
	check(
		"a slide behind another has 39 ticks",
		behind.kind === "rides" && behind.window === 39 && behind.lead + behind.arms === 9,
		JSON.stringify(behind),
	);

	// The last segment is what is cut into frames, and for a tied note that is the tie.
	check(
		"and names a tie of one tick as the tie",
		commandHazards(tokenize("#amk 4\n#0 o4 c4^192 $DD $00 $18 $A4\n"))[0].message.startsWith(
			"The tie before this $DD lasts one tick",
		),
	);
	check(
		"and a remote call as a remote call",
		commandHazards(tokenize("#amk 4\n(!1)[ v200 ]\n#0 o4 c4 (!1, 4) $DD $00 $18 $A4\n"))[0].message.startsWith(
			"The remote code call written",
		),
	);

	// Only the failures are reported, and each of them once.
	check("a reachable slide raises nothing", codesIn("#amk 4\n#0 o4 c4 $DD $00 $18 $A4\n") === "");
	check("a stranded one is SST0507", codesIn("#amk 4\n#0 $DD $00 $18 $A4\n") === "SST0507");
	check(
		"and says which command the driver read instead",
		commandHazards(tokenize("#amk 4\n#0 o4 c4 v200 $DD $00 $18 $A4\n"))[0].message.includes("The volume written"),
	);
	check(
		"and says when a long note's last piece is the one tick",
		commandHazards(tokenize("#amk 4\n#0 o4 c=193 $DD $00 $18 $A4\n"))[0].message.includes("pieces of 96"),
	);
	check("a chain that fits raises nothing", codesIn("#amk 4\n#0 o4 c4 $DD $00 $18 e $DD $00 $18 g\n") === "");
	const crowded = commandHazards(tokenize("#amk 4\n#0 o4 c8 $DD $00 $18 e $DD $00 $18 g\n"));
	check(
		"and one that does not says the slide before it is still running, on the second $DD",
		crowded.length === 1 &&
			crowded[0].message.startsWith("A slide written before this $DD is still running") &&
			crowded[0].span.start === 30,
		JSON.stringify(crowded),
	);

	// `Commands.asm:633` leaves the body commented out, so the label collapses onto
	// cmdF9 and the slot is `$0000` (main.bin @ $13A6). No argument redeems it, and
	// no dialect does either.
	for (const target of ["#amk 1", "#amk 2", "#amk 4", "#am4", "#amm"] as const) {
		check(`$F7 is SST0506 under ${target}`, codesIn(`${target}\n#0 $F7 $00 $00 $00 c4\n`) === "SST0506");
	}

	// Music.cpp:1863 — Addmusic 4.05 stored one more than was written, and only
	// there, so the finding is the dialect's rather than the byte's.
	check("$E4 under #am4 is SST0508", codesIn("#am4\n#0 $E4 $02 c4\n") === "SST0508");
	for (const target of ["#amk 1", "#amk 2", "#amk 4", "#amm"] as const) {
		check(`and nothing under ${target}`, codesIn(`${target}\n#0 $E4 $02 c4\n`) === "");
	}

	check(
		"SST0508 is a warning where the other two are severe",
		commandHazards(tokenize("#am4\n#0 $E4 $02 c4\n"))[0].severity === "warning" &&
			commandHazards(tokenize("#amk 4\n#0 $F7 $00 $00 $00 c4\n"))[0].severity === "severe",
	);

	// The span is the whole run, as the echo hazards' is, so the underline covers
	// the command a porter has to delete rather than its first byte.
	const spanned = commandHazards(tokenize("#amk 4\n#0 $F7 $00 $00 $00 c4\n"))[0];
	check(
		"and the span covers the whole run",
		spanned.span.end - spanned.span.start === 15,
		String(spanned.span.end - spanned.span.start),
	);
	check("and carries its line", spanned.span.line === 2, String(spanned.span.line));

	// Nothing here waits for `complete`, where the echo hazards do: no argument
	// redeems a `$F7` or moves a `$DD` off the byte in front of it, so there is no
	// half-written state either finding would be wrong about.
	check("a half-written $DD is still reported", codesIn("#amk 4\n#0 $DD $00\n") === "SST0507");

	// A `(!n)[ … ]` body compiles to the loop block, so nothing in it is adjacent to
	// the channel’s own stream — in either direction. It has to be written above the
	// first `#N` to be a definition at all (Music.cpp:1015), which is where `gather`
	// marks the body and both its brackets.
	check(
		"a remote body's own note anchors its slide",
		anchorsIn("#amk 4\n(!1)[ o4 c4 $DD $00 $18 $A4 ]\n#0 c4\n") === "rides:48",
	);
	check("and a note outside it does not", anchorsIn("#amk 4\no4 c4\n(!1)[ $DD $00 $18 $A4 ]\n#0 d4\n") === "nothing");
}
