/** `walktest`: the loops the walk plays through. */

import "../localize";
import { walkSong } from "@amk/spc/song-walk";
import { check, section } from "../harness";
import { ARAM, build } from "./support";

// ---------------------------------------------------------------------------
section("the loops the walk plays through");
// ---------------------------------------------------------------------------
//
// `SongTimeline.loops` is the roll's only ground truth for loop structure:
// which voice replays which body, how many times, entering at which tick.
// Nothing else can say it — a `(1)n` call may be another channel's text, and a
// body's `noteMap` entries are the loop block's — and a run that mis-prices one
// pass draws a group where nothing repeats, with no visual tell. The spelling
// here also pins the declaration/recall distinction on the one fact that
// carries it: a `]n`'s `$E9` is dropped from the command map (`parser.ts:508`)
// where a `(n)m`, `*n` or `$E6` is not.
{
	const shown = (source: string) => {
		const { result, timeline } = build(source);
		const mapped = new Set((result.commandMap ?? []).map((entry) => entry.address));
		return timeline.loops
			.map((run) => {
				const label = run.kind === "call" ? (mapped.has(run.from) ? "recall" : "decl") : "sub";
				return `${label}#${run.channel}x${run.count}@` + run.passes.map((p) => `${p.tick}+${p.ticks}`).join(",");
			})
			.join(" ");
	};

	const declared = shown("#amk 4\n#0 o4 [c8d8]4 e4\n");
	check("a [ ]n is one run of n passes", declared === "decl#0x4@0+48,48+48,96+48,144+48", declared);

	const sub = shown("#amk 4\n#0 o4 [[c8d8]]2 e4\n");
	check("a ]]n plays n times", sub === "sub#0x2@0+48,48+48", sub);

	// The hex spelling goes through `cmdE6`'s own arithmetic (`Commands.asm:376-392`):
	// the byte is one less than the times the body plays.
	const hex = shown("#amk 4\n#0 o4 $E6 $00 c8d8 $E6 $02 e4\n");
	check("a hex $E6 $02 plays three times", hex === "sub#0x3@0+48,48+48,96+48", hex);

	const recalled = shown("#amk 4\n#0 o4 (1)[c8]2 d4 (1)3\n");
	check(
		"a label recall is its own run, told from the declaration by the command map",
		recalled === "decl#0x2@0+24,24+24 recall#0x3@96+24,120+24,144+24",
		recalled,
	);

	const star = shown("#amk 4\n#0 o4 [c8]2 d4 *3\n");
	check("a * is a recall too", star === "decl#0x2@0+24,24+24 recall#0x3@96+24,120+24,144+24", star);

	// Each outer pass opens and closes the subloop afresh, so nesting is already
	// enumerated: readers multiply nothing.
	const nested = shown("#amk 4\n#0 o4 [ [[c8]]2 d8]3 f4\n");
	check(
		"a subloop inside a loop is one run per outer pass",
		nested === "decl#0x3@0+72,72+72,144+72 sub#0x2@0+24,24+24 sub#0x2@72+24,96+24 sub#0x2@144+24,168+24",
		nested,
	);

	const across = shown("#amk 4\n#0 o4 (1)[c8 d8]2 e4\n#1 o4 (1)3 f4\n");
	check(
		"a cross-channel recall runs on the calling voice",
		across === "decl#0x2@0+48,48+48 recall#1x3@0+48,48+48,96+48",
		across,
	);

	{
		const { result, timeline } = build("#amk 4\n#0 o4 [c8 d8]2 e4\n");
		const run = timeline.loops[0];
		const body = (result.noteMap ?? []).filter((entry) => entry.channel === 8);
		const rest = (result.noteMap ?? []).filter((entry) => entry.channel !== 8);
		check(
			"the body range holds exactly the loop block's notes",
			body.length === 2 &&
				body.every((entry) => entry.address >= run.body.start && entry.address < run.body.end) &&
				rest.every((entry) => entry.address < run.body.start || entry.address >= run.body.end),
			`body ${run.body.start}..${run.body.end}, notes at ${(result.noteMap ?? []).map((e) => `#${e.channel}:${e.address}`).join(" ")}`,
		);
	}

	// The full walk keeps a run whose every pass is past the pass cut, exactly
	// as `channelTicks` is a full-walk figure — the roll's tail items need it.
	const past = shown("#amk 4\n#0 o4 c4\n#1 o4 c4 [d4 e4]2\n");
	check("a run past the end of the pass is still recorded", past === "decl#1x2@48+96,144+96", past);

	// An unterminated `$E6 $00` opens a subloop nothing closes: it plays exactly
	// what it says, once, and there is no run to report. The note in front is
	// what lets it compile — ticks inside an open subloop are only counted at
	// its close, and a song of zero counted ticks is AMK0303.
	const unterminated = shown("#amk 4\n#0 o4 e4 $E6 $00 c8 d8\n");
	check("an unterminated $E6 $00 is no run", unterminated === "", unterminated);

	// A remote body is jumped into by the driver, not looped over — no `$E9` is
	// emitted for it and the walk does not follow `$FC`.
	const remote = shown("#amk 4\n(!1)[$E7 $30]\n#0 o4 (!1,-1) c4 d4\n");
	check("a remote definition and its call are no run", remote === "", remote);

	// A crossed pair, as `Music.cpp:1208-1290` lets through: the subloop's close
	// jumps back into the loop's body, the channel ends on that body's `$00`
	// with the call counter spent, and what really played is one call run and a
	// one-pass sub whose body range partially overlaps it — the shape the roll
	// refuses, pinned here so the refusal has a stable input.
	const crossed = shown("#amk 4\n#0 o4 [c4 $E6 $00 d4]2 e4 $E6 $01\n");
	check(
		"a crossed loop and subloop file what really played",
		crossed === "decl#0x2@0+96,96+96 sub#0x1@144+96",
		crossed,
	);

	// `cmdE9` (`Commands.asm:400-417`) never tests its count, so a zero still enters the body, and
	// the body's `$00` finds `$C0+x` at zero and ends the phrase (`main.asm:2345-2346`): the note
	// after the call is never reached. Only bytes can spell it: `]0` is AMK0116 at parse.
	{
		const at = (offset: number) => [(ARAM + offset) & 0xff, (ARAM + offset) >> 8];
		const blob = Uint8Array.from([
			...at(4), // the one phrase: channel starts at offset 4
			0x00,
			0x00, // end of the phrase table
			...at(20), // channel 0
			...new Array<number>(14).fill(0), // channels 1-7 unused
			0xe9,
			...at(27),
			0x00, // a call of count 0, targeting the body at 27
			0x30,
			0x81, // the note after the call
			0x00,
			0x30,
			0x80, // the body
			0x00,
		]);
		const zero = walkSong(blob, ARAM);
		check(
			"a $E9 of count zero plays its body once, as no run, and ends there",
			zero.loops.length === 0 &&
				zero.notes.map((note) => note.note).join() === "128" &&
				zero.ticks === 0x30 &&
				zero.problems.length === 0,
			`${zero.loops.length} runs, notes ${zero.notes.map((note) => note.note).join()}, ${zero.ticks} ticks, ${zero.problems.join(" | ")}`,
		);
	}
}
