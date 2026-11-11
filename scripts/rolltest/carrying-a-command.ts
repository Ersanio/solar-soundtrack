/** `rolltest`: carrying a command glyph to another tick. */

import "../localize";
import {
	commandMoveTargets,
	nearestTarget,
	REFUSE_MOVE_LOOPED,
	REFUSE_MOVE_REMOTE,
} from "../../web/src/app/editor/views/piano-roll/roll-command-move";
import { check, section } from "../harness";
import { build, expectMove, expectNoMove, strip } from "./support";

// --- carrying a command to another tick -------------------------------------
//
// `roll-command-move.ts`, which is the only edit here that changes where a
// command runs without touching a note. Every case asserts the same three things
// before anything about the text: the channel plays exactly what it played, no
// other channel moved, and the song is exactly as long. What is left to pin per
// case is the tick the driver ends up reading the command at, which is the thing
// the text alone cannot say — `p12,147` written before a rest and written before
// the note after it look equally plausible and are 64 ticks apart.

section("carrying a command");

/** `a=27` is 27 ticks, so the `p` runs at 27 — a tick no note begins on. */
const VIBRATO_SONG = "#amk 4\n\n#0 t53,245 o4 q7F @0\no4 a=27 p12,147 r3 c3\n";

expectMove("a command carried onto the note that reads it", VIBRATO_SONG, 0, "p12,147", 91, {
	tick: 91,
	contains: "r3 p12,147 c3",
	lacks: "a=27 p12,147",
});

// Earlier as well as later, and into the first unit's own leading `o` rather
// than in front of it: `growUnits` reaches back over that `o`, so the head of
// the unit is where the next strip build expects to find a command.
expectMove("a command carried back to the top of the channel", VIBRATO_SONG, 0, "p12,147", 0, {
	tick: 0,
	contains: "p12,147 o4 a=27",
});

// Let go where it already runs. The text is the same text — not merely one that
// compiles to the same thing — because the whole gesture is answered before an
// edit is built, so nothing reaches the undo history.
expectMove("a command let go on the tick it already runs at", VIBRATO_SONG, 0, "p12,147", 27, {
	tick: 27,
	text: VIBRATO_SONG,
});

// A rest is a target like any other: the lane is where a command in a gap is
// drawn, so a gap has to be somewhere it can be dragged to as well as from.
expectMove("a command carried onto a rest", "#amk 4\n\n#0 o4 c4 v200 r4 d4 r4 e4\n", 0, "v200", 144, {
	tick: 144,
	contains: "d4 v200 r4 e4",
});

// Out from between a note's head and its `^`. The two are then separated by
// whitespace alone, so `accumulateTiedLength` folds them into one note map entry
// where they were two — same music, fewer bytes, which is why "moves no note" is
// read through the tie fold rather than off the entries.
expectMove(
	"a command carried out of the note it was written inside",
	"#amk 4\n\n#0 o4 c4 v200 ^8 d4\n",
	0,
	"v200",
	72,
	{
		tick: 72,
		contains: "^8 v200 d4",
		lacks: "c4 v200 ^8",
	},
);

// A `'song'` command carries too. It acts on every channel at once, but it is
// written in one channel's text and snaps to that channel's boundaries, which is
// what its colour in the lane already says.
expectMove(
	"a song-wide command carried along the channel that wrote it",
	"#amk 4\n\n#0 o4 c4 t100 r4 d4\n",
	0,
	"t100",
	96,
	{
		tick: 96,
		contains: "r4 t100 d4",
	},
);

// A fade is one command and moves whole. Its ramp runs off the tick it is read
// at, so this is the case that says why a deletion may not move one for the
// porter: 96 ticks of difference is 96 ticks of a different ramp.
expectMove("a channel volume fade carried whole", "#amk 4\n\n#0 o4 c4 v24,200 r4 d4 r4 e4\n", 0, "v24,200", 144, {
	tick: 144,
	contains: "d4 v24,200 r4 e4",
});

// The intro marker, in a song of **one** channel: `loopTick` is the lowest tick
// any channel re-enters at, so a second channel marked on the old tick would
// hold the reading down and hide a command that had crossed the `/`. The text
// lands to the right of it because a unit never grows back over one.
expectMove("a command carried past the intro marker", "#amk 4\n\n#0 o4 c4 v200 r4 / d4 e4\n", 0, "v200", 96, {
	tick: 96,
	contains: "/ v200 d4",
	loopsWhereItDid: true,
});

// A second channel, so a splice that reached out of its own is caught. The `v200`
// lands on a note's own tick here, which takes it off the lane — the reading is
// the walk's and not the lane's for exactly this reason.
expectMove(
	"a command carried in a song with more than one channel",
	"#amk 4\n\n#0 o4 c4 v200 r4 d4\n#1 o4 e4 e4 e4 e4\n",
	0,
	"v200",
	96,
	{
		tick: 96,
		contains: "r4 v200 d4",
	},
);

// A command between a loop's brackets runs once per pass, where it stands; the
// lane's targets are single ticks, so the drag refuses in its own words rather
// than silently changing every pass. The channel itself edits.
expectNoMove("a command written inside a loop", "#amk 4\n\n#0 o4 [ c4 v200 r4 ]2 d4\n", 0, "v200", REFUSE_MOVE_LOOPED);

// The one refusal `channelStrip` does not make, and the lane cannot reach it:
// the walk does not step into a remote body, so the `v200` has no tick and no
// glyph. The guard is the function's own, and it earns its place — the body runs
// wherever a `$FC` fires it, so moving the command would change every call site.
expectNoMove(
	"a command written inside remote code",
	"#amk 4\n\n(!1)[ v200 ]\n#0 o4 c4 d4\n",
	0,
	"v200",
	REFUSE_MOVE_REMOTE,
);

// The targets themselves, without a compile in the way: one per item and none
// past the last, since a command written after a channel's last note is read at
// or beyond the walk's cut and has no tick to be drawn at.
{
	const built = build(VIBRATO_SONG);
	const bar = typeof built === "string" ? built : strip(VIBRATO_SONG, built, 0);
	if (typeof bar === "string") {
		check("the targets of a channel: it can be edited", false, bar);
	} else {
		const targets = commandMoveTargets(bar);
		check(
			"a target for every item and none past the last",
			targets.map((target) => target.tick).join(",") === "0,27,91",
			targets.map((target) => `${target.tick}@${target.at}`).join(" "),
		);
		check(
			"each target is its item's own head",
			targets.every((target, at) => target.at === bar.items[at].unitSpan.start),
			targets.map((target) => target.at).join(","),
		);
		check(
			"a drop equidistant between two targets takes the earlier",
			nearestTarget(targets, 13.5)?.tick === 0,
			String(nearestTarget(targets, 13.5)?.tick),
		);
	}
}
