/** `walktest`: the note map keeps the pitch that was written. */

import "../localize";
import { check } from "../harness";
import { build } from "./support";

// ---------------------------------------------------------------------------
console.log("\nthe note map keeps the pitch that was written");
// ---------------------------------------------------------------------------
{
	// The byte has `h` or the instrument's transposition folded in; the map
	// keeps the letter's own pitch beside it, since nothing downstream can get
	// it back — and that is the row the piano roll draws on.
	const { result, timeline } = build("#amk 4\n#0 @2 o5 g4 h7 o4 c4 h12 o0 c4 r4 o4 @21 c4\n");
	const entries = (result.noteMap ?? []).filter((entry) => entry.channel === 0);
	const at = (n: number) => entries[n];
	check("five entries, the rest among them", entries.length === 5, `${entries.length}`);
	check(
		"@2 takes five semitones off the byte and none off the written pitch",
		at(0).note === 0xb2 && at(0).written === 0xb7,
		`$${at(0).note.toString(16)} written $${at(0).written.toString(16)}`,
	);
	check(
		"h7 adds seven to the byte and none to the written pitch",
		at(1).note === 0xab && at(1).written === 0xa4,
		`$${at(1).note.toString(16)} written $${at(1).written.toString(16)}`,
	);
	check(
		"h12 o0 c is $80 on the wire and o0 c as written",
		at(2).note === 0x80 && at(2).written === 0x74,
		`$${at(2).note.toString(16)} written $${at(2).written.toString(16)}`,
	);
	check("a rest is written as it is emitted", at(3).note === 0xc7 && at(3).written === 0xc7);
	check(
		"a drum keeps the letter it was written under",
		at(4).note === 0xd0 && at(4).written === 0xa4,
		`$${at(4).note.toString(16)} written $${at(4).written.toString(16)}`,
	);
	check("and the walk still reads the bytes", timeline.notes.map((n) => n.note).join(",") === "178,171,128,208");

	// `$FA $02` is the driver's own version of `h`, added to the note number at
	// play time, so it is state a note reports rather than a change to the byte.
	const tuned = build("#amk 4\n#0 o4 c4 $FA $02 $03 c4 $FA $02 $FD c4\n").timeline;
	check(
		"$FA $02 is reported as the channel's tune",
		tuned.notes.map((n) => n.state.tune).join(",") === "0,3,-3",
		tuned.notes.map((n) => n.state.tune).join(","),
	);
	check(
		"and moves no note byte",
		tuned.notes.every((n) => n.note === 0xa4),
	);

	// A song-wide command is read by every channel's next note, not only by the
	// channel that ran it: the other channels' frozen state must be dropped too.
	const wide = build("#amk 4\n#0 o4 c4 t120 $E4 $02 c4\n#1 o4 c4 c4\n").timeline;
	const second = wide.notes.filter((n) => n.channel === 1);
	check("channel 1's first note is before the change", second[0].state.tempo === 0 && second[0].state.transpose === 0);
	check(
		"and its second note reports the tempo and transposition channel 0 set",
		second[1].state.tempo === 120 && second[1].state.transpose === 2,
		`t${second[1].state.tempo} $E4 ${second[1].state.transpose}`,
	);
}
