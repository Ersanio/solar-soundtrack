/** `walktest`: ties, gates and the pitched range. */

import "../localize";
import { NOTE_DURATIONS, noteSoundingTicks, WAIT_TIME } from "@amk/core/hardcoded-tables";
import { check, section } from "../harness";
import { build } from "./support";

// ---------------------------------------------------------------------------
section("ties, gates and the pitched range");
// ---------------------------------------------------------------------------
{
	const tied = build("#amk 4\n#0 o4 c1^1^1^1 d4\n").timeline;
	check("a tie chain is one note", tied.notes.length === 2, `${tied.notes.length} notes`);
	check("and it is as long as its parts", tied.notes[0].ticks === 192 * 4, `${tied.notes[0].ticks} ticks`);

	const gated = build("#amk 4\n#0 o4 q7F c4 q44 d4\n").timeline;

	// Even `q7F` does not sound for the whole slot, and not for 255/256 of it
	// either: the read-ahead keys off when the duration counter reaches
	// `!WaitTime` if the gate counter has not run out first (`main.asm:3237-3243`),
	// so a 48-tick quarter sounds for 46. The emulator section below is what says
	// this is the driver and not a reading of it.
	check("q7F keys a quarter off two ticks early", gated.notes[0].gateTicks === 46, `${gated.notes[0].gateTicks} of 48`);
	check(
		"a short gate sounds for less",
		gated.notes[1].gateTicks < gated.notes[0].gateTicks && gated.notes[1].gateTicks > 0,
		`${gated.notes[1].gateTicks} against ${gated.notes[0].gateTicks}`,
	);

	// `$F4 $02` flips `!WaitTime` between 2 and 1 for the whole song.
	const light = build("#amk 4\n#0 o4 $F4 $02 q7F c4 $F4 $02 c4\n").timeline;
	check(
		"light staccato keys off one tick early, and toggles back",
		light.notes[0].gateTicks === 47 && light.notes[1].gateTicks === 46,
		light.notes.map((note) => note.gateTicks).join(", "),
	);
	const across = build("#amk 4\n#0 o4 $F4 $02 q7F c4 c4\n#1 o4 q7F r4 c4\n").timeline;
	check(
		"and is one switch for every channel",
		across.notes.every((note) => note.gateTicks === 47),
		across.notes.map((note) => `#${note.channel} ${note.gateTicks}`).join(", "),
	);

	// `noteSoundingTicks` is what the note inspector prices a dragged length with,
	// worked out rather than walked from bytes. It restates `emitNote`'s pieces, so it
	// is held to the walk at every length and every gate, and under a tempo ratio,
	// which shrinks the pieces with the notes.
	let disagreed = "";
	for (const [ratio, prefix] of [
		[1, ""],
		[2, "#halvetempo\n"],
	] as const) {
		for (let gate = 0; gate < 8; gate++) {
			const lengths = Array.from({ length: 300 }, (_, at) => (at + 1) * ratio);
			const swept = build(`#amk 4\n${prefix}#0 o4 q${gate}F ${lengths.map((n) => `c=${n}`).join(" ")}\n`).timeline;
			if (swept.notes.length !== lengths.length) {
				disagreed += ` ratio ${ratio} q${gate}x: ${swept.notes.length} notes`;
				continue;
			}

			for (const note of swept.notes) {
				const expected = noteSoundingTicks(note.ticks, NOTE_DURATIONS[gate], WAIT_TIME, ratio);
				if (note.gateTicks !== expected) {
					disagreed += ` ratio ${ratio} q${gate}x ${note.ticks}t: ${note.gateTicks}!=${expected}`;
				}
			}
		}
	}

	check("noteSoundingTicks agrees with the walk at every length and gate", disagreed === "", disagreed.slice(0, 300));

	// The two ends of the keyboard, on the notes themselves rather than through
	// an aggregate: `key` is what a row is chosen by, and `$80` is o1 c.
	const range = build("#amk 4\n#0 o1 c4 o6 a4\n").timeline;
	check("the lowest key is o1 c", range.notes[0].key === 0, `${String(range.notes[0].key)}`);
	check("the highest key is o6 a", range.notes[1].key === 69, `${String(range.notes[1].key)}`);
}
