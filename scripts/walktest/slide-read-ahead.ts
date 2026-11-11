/** `walktest`: the pitch slide a note reads ahead into. */

import "../localize";
import { check, section } from "../harness";
import { build } from "./support";

// ---------------------------------------------------------------------------
section("the pitch slide a note reads ahead into");
// ---------------------------------------------------------------------------
{
	// `$DD` is not dispatched — the note before it picks it up by peeking at the
	// track pointer (`main.asm:3256-3287`) — so it is reported on that note and
	// not as a state a later note inherits.
	const slid = build("#amk 4\n#0 o4 c4 $DD $00 $18 $A6 d4 e4\n").timeline;
	check(
		"the note in front of it carries it",
		JSON.stringify(slid.notes[0].bend) ===
			JSON.stringify({ delay: 0, duration: 0x18, target: 0xa6, afterTicks: 0, frameTicks: 48 }),
		JSON.stringify(slid.notes[0].bend),
	);
	check("and the notes after it do not", slid.notes[1].bend === null && slid.notes[2].bend === null, "carried on");

	// A `&` compiles to exactly that: the two spellings are one command to the walk.
	const amp = build("#amk 4\n#0 o4 c4 & d4\n").timeline;
	check(
		"a legacy & reads the same",
		JSON.stringify(amp.notes[0].bend) ===
			JSON.stringify({ delay: 0, duration: 0x30, target: 0xa6, afterTicks: 0, frameTicks: 48 }),
		JSON.stringify(amp.notes[0].bend),
	);

	// The reading the three bytes alone cannot give. `Music.cpp:2224` rewinds a
	// tie out of the way of a `$DD` precisely because the peek happens again on
	// the tie's own ticks, so the same operands behind a `$C6` are a slide that
	// starts a tie later — and a walk that reported only the operands would call
	// the two songs identical.
	const late = build("#amk 4\n#0 o4 c4^4 $DD $00 $18 $A6 d4\n").timeline;
	check(
		"a tie before it moves when the slide starts",
		late.notes[0].bend?.afterTicks === 48 && late.notes[0].bend.frameTicks === 48 && late.notes[0].ticks === 96,
		`${JSON.stringify(late.notes[0].bend)} on a note of ${late.notes[0].ticks}`,
	);

	// And a tie written *after* it leaves the note running behind the four bytes,
	// so the `$DD` sits between two of its frames rather than after them all. The
	// operands and the note's length together cannot say that: `c1 $DD` is 192
	// ticks arming at 96, and this is 192 ticks arming at 0.
	const behind = build("#amk 4\n#0 o4 f+2 $DD $00 $D6 a+^2 g4\n").timeline;
	check(
		"a tie after it leaves the arm where it is, with note still to come",
		behind.notes[0].bend?.afterTicks === 0 && behind.notes[0].bend.frameTicks === 96 && behind.notes[0].ticks === 192,
		`${JSON.stringify(behind.notes[0].bend)} on a note of ${behind.notes[0].ticks}`,
	);
}
