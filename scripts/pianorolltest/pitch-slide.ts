/** `pianorolltest`: notes carrying a `$DD` pitch slide. */

import "../localize";
import type { PitchSlide } from "@amk/spc/song-walk";
import { REFUSE_MOVE_BEND } from "../../web/src/app/editor/views/piano-roll/roll-command-move";
import { REFUSE_BEND_RIDER } from "../../web/src/app/editor/views/piano-roll/roll-edit";
import { check, section } from "../harness";
import { ARAM, build, type Built, expectEdit, expectNoMove, expectRefused, noteAt, strip } from "./support";

// ===========================================================================
// A `$DD` pitch slide
// ===========================================================================

// `$DD` is not dispatched: the preceding note's read-ahead peeks at the byte
// standing at the track pointer (`main.asm:L_10E4`), and its slot in the
// dispatch table holds `$0000`. So its position is a **byte** adjacency rather
// than a tick, which no other command in the roll has, and every case here is
// about something the text can be made to say while the song stops playing.
//
// Its last parameter may also be a written note (Music.cpp:2012-2042), which
// emits nothing of its own and reads the octave in force where it stands.
section("a pitch slide");

/**
 * The byte `$DD` really slides to, read out of the song data.
 *
 * The only reading that catches a silent retarget: the target's text does not
 * change when the octave in force at it does, so `played()` — which is off
 * `noteMap`, and the target is in no note map — reports nothing either way.
 */
function bendTarget(built: Built, source: string, written: string): number | null {
	const data = built.result.data;
	if (!data) {
		return null;
	}

	for (const entry of built.result.commandMap ?? []) {
		if (!source.slice(entry.span.start, entry.span.end).startsWith(written)) {
			continue;
		}

		const at = entry.address - ARAM;
		if (data[at] === 0xdd) {
			return data[at + 3];
		}
	}

	return null;
}

{
	// The all-hex form involves no note at all, so no refusal about a
	// target note applies to it.
	const hex = "#amk 2\n#0 o4 c4 $DD $00 $18 $A4 d4 e4";
	expectEdit(
		"a slide to a byte",
		hex,
		0,
		(bar) => ({ kind: "move", items: [noteAt(bar, 2)], deltaTicks: 0, deltaKeys: 2, copy: false }),
		{ contains: "$DD $00 $18 $A4" },
	);

	// The form the issue is about. Both notes stay where they are, and the `e` is
	// the command's third byte rather than a note of its own.
	const note = "#amk 2\n#0 o4 c4 $DD $00 $18 e g4 a4";
	expectEdit(
		"a slide to a note",
		note,
		0,
		(bar) => ({ kind: "move", items: [noteAt(bar, 2)], deltaTicks: 0, deltaKeys: 2, copy: false }),
		{ contains: "$DD $00 $18 e" },
	);

	// A `$DD` on one channel said nothing about another even before, but the
	// refusal was per-channel by a filter it is worth keeping honest.
	expectEdit(
		"a slide on another channel",
		"#amk 2\n#0 o4 c4 $DD $00 $18 e g4\n#1 o4 c4 d4",
		1,
		(bar) => ({ kind: "move", items: [noteAt(bar, 1)], deltaTicks: 0, deltaKeys: 2, copy: false }),
		{ contains: "$DD $00 $18 e" },
	);

	// Opening a gap after the note a slide rides on. The rest must go **after**
	// the whole construct: written between the two, the read-ahead misses and the
	// command loop reaches a `$0000`. `playsFor` is what catches it — the text
	// reads perfectly either way.
	expectEdit(
		"a gap opened under a slide",
		hex,
		0,
		(bar) => ({ kind: "move", items: [noteAt(bar, 1)], deltaTicks: 24, deltaKeys: 0, copy: false }),
		{ contains: "c4 $DD $00 $18 $A4", lacks: "c4 r" },
	);
	expectEdit(
		"a gap opened under a slide to a note",
		note,
		0,
		(bar) => ({ kind: "move", items: [noteAt(bar, 1)], deltaTicks: 24, deltaKeys: 0, copy: false }),
		{ contains: "c4 $DD $00 $18 e", lacks: "c4 r" },
	);

	// The octave the target reads. `exitOctaveFor` would otherwise write no
	// restore at all here, because the note after the slide writes its own — and
	// the target, which is in no `segments`, reads the octave in between.
	const before = build(note);
	if (typeof before !== "string") {
		check(
			"the target's byte to begin with",
			bendTarget(before, note, "$DD") === 0xa8,
			String(bendTarget(before, note, "$DD")),
		);
	}

	expectEdit(
		"both notes moved an octave, with a slide between them",
		note,
		0,
		(bar) => ({
			kind: "move",
			items: [noteAt(bar, 0), noteAt(bar, 1)],
			deltaTicks: 0,
			deltaKeys: 12,
			copy: false,
		}),
		{ contains: "o4 $DD" },
	);

	// Deleting the note a slide rides on strands it, and nothing else in
	// `roll-write/` can say so: `reachesSomething` asks what still sounds after
	// a command, where the loss here is in front of it.
	expectRefused(
		"deleting the note a slide rides on",
		note,
		0,
		(bar) => ({ kind: "delete", items: [noteAt(bar, 0)] }),
		"insert",
		REFUSE_BEND_RIDER,
	);

	// And a drag of the glyph. Every target `commandMoveTargets` offers is a
	// unit's head, so a dropped `$DD` always lands in front of a note where it
	// has to land behind one.
	// The last route by which the target's byte can change under the roll. A
	// drum `@` makes it a drum byte (`parser.ts:parseNote`), and the note the
	// slide rides on has cleared the remap everywhere but `#6` and `#7` of an
	// AddmusicK song — where `parseTimeInForce` keeps it standing, so moving the
	// rider between lanes rewrites its `@` and the target follows.
	// A drum `@` still in force at the target makes its byte a drum byte
	// (`parser.ts:parseNote`), which only `#6` and `#7` of an AddmusicK song
	// reach — everywhere else the note the slide rides on has cleared the remap.
	// Deliberately not guarded: a slide targeting a drum byte is outside the
	// documented `$80`-`$C5` range and was never meaningful, and the target
	// following its channel's instrument is the only thing the text can say.
	// What is pinned is that the byte reads as a drum byte at all, since it is
	// the one reading that says the remap reached the target.
	const drum = "#amk 2\n#6 @21 c8 $DD $00 $18 e";
	const drumBuilt = build(drum);
	check(
		"a drum @ in force at a target makes its byte a drum byte",
		typeof drumBuilt !== "string" && bendTarget(drumBuilt, drum, "$DD") === 0xd0,
		typeof drumBuilt === "string" ? drumBuilt : String(bendTarget(drumBuilt, drum, "$DD")),
	);
	check(
		"and off #6 the note it rides on has cleared the remap",
		(() => {
			const pitched = "#amk 2\n#0 @21 c8 $DD $00 $18 e";
			const made = build(pitched);
			return typeof made !== "string" && bendTarget(made, pitched, "$DD") === 0xa8;
		})(),
	);

	expectNoMove("a slide", hex, 0, "$DD $00 $18 $A4", REFUSE_MOVE_BEND);
	// And the span a `$DD` with a note target has, which reaches over the note —
	// so `commandAt` answers this command for a caret on the `e`.
	expectNoMove("a slide to a note", note, 0, "$DD $00 $18 e", REFUSE_MOVE_BEND);

	/** The walk's reading of the slide the channel's `at`th *note* carries. */
	const slideOf = (source: string, at: number, channel = 0): PitchSlide | null | string => {
		const built = build(source);
		if (typeof built === "string") {
			return built;
		}

		const made = strip(source, built, channel);
		if (typeof made === "string") {
			return made;
		}

		return made.items.filter((item) => item.kind === "note")[at]?.slide ?? null;
	};

	const armAt = (source: string, at = 0): number | string => {
		const found = slideOf(source, at);
		return typeof found === "string" ? found : (found?.afterTicks ?? -1);
	};

	// `bend` is the token in the text and `slide` is what the driver does with it.
	// Only the second can say when the slide arms, and these three prove it: one
	// set of operands, three arms. The last has no tie written anywhere — a note of
	// 192 ticks is chunked by `emitNote` inside one `noteMap` entry, so its frame
	// boundary reaches no `segments` and no text.
	const arm0 = "#amk 2\n#0 o4 c4 $DD $00 $18 $A4 d4";
	const arm48 = "#amk 2\n#0 o4 c4^4 $DD $00 $18 $A4 d4";
	const arm96 = "#amk 2\n#0 o4 c1 $DD $00 $18 $A4 d4";
	check("a slide on a one-frame note arms at its head", armAt(arm0) === 0, String(armAt(arm0)));
	check("a tie in front of it arms on the tie", armAt(arm48) === 48, String(armAt(arm48)));
	check("and a chunked note arms on a boundary its text has not got", armAt(arm96) === 96, String(armAt(arm96)));
	check(
		"while the operands are the same three bytes throughout",
		[arm0, arm48, arm96].every((source) => {
			const found = slideOf(source, 0);
			return typeof found !== "string" && found?.delay === 0x00 && found.duration === 0x18 && found.target === 0xa4;
		}),
	);
	check(
		"and each names the frame it was read in, which is the note's last",
		[arm0, arm48, arm96].every((source, at) => {
			const found = slideOf(source, 0);
			return typeof found !== "string" && found?.frameTicks === [48, 48, 96][at];
		}),
	);

	// The one shape where the frame the peek reads it in is *not* the note's last:
	// a tie written after the command leaves 96 ticks of note behind the four
	// bytes. `item.bend` has to reach inside the unit to find it, `growUnits`
	// ending that unit at the `^2` past the `$DD`.
	const behind = "#amk 2\n#0 o4 f+2 $DD $00 $D6 a+^2 g4";
	check(
		"a tie after it arms at the head of a note that runs on",
		(() => {
			const found = slideOf(behind, 0);
			return typeof found !== "string" && found?.afterTicks === 0 && found.frameTicks === 96;
		})(),
		JSON.stringify(slideOf(behind, 0)),
	);
	check(
		"and the note it rides on is the whole 192 ticks",
		(() => {
			const built = build(behind);
			if (typeof built === "string") {
				return false;
			}

			const made = strip(behind, built, 0);
			return typeof made !== "string" && made.items[0].ticks === 192;
		})(),
	);
	check(
		"and the token is found inside the unit, not only after it",
		(() => {
			const built = build(behind);
			if (typeof built === "string") {
				return false;
			}

			const made = strip(behind, built, 0);
			return typeof made !== "string" && made.items[0].bend?.vcmd === 0xdd;
		})(),
	);

	check("a note with no slide carries none", slideOf(arm0, 1) === null);
	check("nor does one on another channel", slideOf("#amk 2\n#0 o4 c4 $DD $00 $18 $A4\n#1 o4 c4 d4", 0, 1) === null);

	// A rest clears `track.held`, so the read-ahead reaches no note at all — and
	// `item.bend` still finds the token, since it reads unit boundaries.
	check("a slide behind a rest rides on nothing", slideOf("#amk 2\n#0 o4 c4 r4 $DD $00 $18 $A4 d4", 0) === null);

	// Past the end of the pass there is no walk note to ask, and no fallback to
	// the token: an approximate slide that sounds like the real one is worse than
	// none, which is the reading `commands-in-force.ts` already takes.
	const cut = "#amk 2\n#0 o4 c4 c4 $DD $00 $18 $A4\n#1 o4 c4";
	check("and a note past the end of the pass carries none", slideOf(cut, 1) === null, JSON.stringify(slideOf(cut, 1)));
}
