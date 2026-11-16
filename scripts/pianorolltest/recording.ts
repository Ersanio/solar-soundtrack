/** `pianorolltest`: a take played in on a MIDI keyboard, and the channels it is written to. */

import "../localize";
import { compiler } from "@amk/compiler";
import { NOTE_MIN } from "@amk/core/hardcoded-tables";
import { REFUSE_CLASH } from "../../web/src/app/editor/views/piano-roll/roll-edit";
import {
	emptyTake,
	keyDown,
	keyUp,
	releaseAll,
	type Take,
	takeNotes,
	writtenOfKey,
} from "../../web/src/app/editor/views/piano-roll/roll-take";
import { songReading, takeEdits } from "../../web/src/app/editor/views/piano-roll/roll-write/take-edits";
import { check, section } from "../harness";
import { ARAM, OPTIONS, apply, build, expectEdit, expectRefused, playable, played } from "./support";

section("a recorded take");

const C4 = NOTE_MIN + 36;

// --- the keys -------------------------------------------------------------

check("MIDI 60 is o4 c", writtenOfKey(60) === C4, String(writtenOfKey(60)));
check("MIDI 24 is the driver's lowest key", writtenOfKey(24) === NOTE_MIN);
check("MIDI 93 is its highest", writtenOfKey(93) === 0xc5);
check("a key either side of the range names nothing", writtenOfKey(23) === null && writtenOfKey(94) === null);

// --- which channel a key takes --------------------------------------------

{
	const down = (take: Take, key: number, tick: number): Take => keyDown(take, key, tick)?.take ?? take;
	const channelOf = (take: Take, key: number): number | undefined =>
		take.held.find((each) => each.key === key)?.channel;

	// Given out of order, taken lowest first.
	let take = emptyTake([5, 0, 4]);
	take = down(take, 60, 0);
	check("one key takes the lowest channel", channelOf(take, 60) === 0, String(channelOf(take, 60)));

	take = down(take, 64, 0);
	take = down(take, 67, 0);
	check(
		"three keys take the three channels in order",
		channelOf(take, 64) === 4 && channelOf(take, 67) === 5,
		`${channelOf(take, 64)} ${channelOf(take, 67)}`,
	);

	check("a fourth key is dropped", keyDown(take, 72, 0) === null);
	check(
		"a key already down is not taken twice",
		keyDown(emptyTake([0, 1]), 60, 0) !== null && keyDown(take, 60, 5) === null,
	);
	check("a key outside the range takes no channel", keyDown(emptyTake([0]), 100, 0) === null);

	take = keyUp(take, 60, 48);
	check("a key coming up is a note played", take.played.length === 1 && take.played[0].endTick === 48);
	take = down(take, 72, 48);
	check("and its channel is free for the next key", channelOf(take, 72) === 0, String(channelOf(take, 72)));

	take = releaseAll(take, 96);
	check("stopping lets every held key go", take.held.length === 0 && take.played.length === 4);
}

// --- snapping ---------------------------------------------------------------

{
	const one = (startTick: number, endTick: number, more: readonly [number, number][] = []): Take => ({
		channels: [0],
		held: [],
		played: [[startTick, endTick] as const, ...more].map(([from, to]) => ({
			channel: 0,
			written: C4,
			startTick: from,
			endTick: to,
		})),
	});
	const said = (take: Take, snap: number): string =>
		takeNotes(take, 0, snap)
			.map((note) => `${note.startTick}+${note.ticks}`)
			.join(" ");

	check("both ends round to the grid", said(one(10, 40), 24) === "0+48", said(one(10, 40), 24));
	check("a tap is one step long", said(one(23, 25), 24) === "24+24", said(one(23, 25), 24));
	check("with no grid a note keeps its ticks", said(one(10.4, 40.6), 0) === "10+31", said(one(10.4, 40.6), 0));
	check("and is never shorter than one", said(one(10.4, 10.6), 0) === "10+1", said(one(10.4, 10.6), 0));

	// Snapping can land two notes played one after the other on top of each
	// other; a channel plays one note at a time, so the earlier is cut.
	const run = one(0, 60, [[50, 100]]);
	check("a note snapped onto the next is cut at it", said(run, 24) === "0+48 48+48", said(run, 24));

	const crushed = one(0, 5, [[6, 30]]);
	check("and one left with no ticks is dropped", said(crushed, 24) === "0+24", said(crushed, 24));
}

// --- one channel, as a gesture ---------------------------------------------

expectEdit(
	"a take played into a rest",
	"#amk 2\n#0 o4 c4 r2 d4\n#1 o4 c1\n",
	0,
	() => ({
		kind: "take",
		notes: [
			{ startTick: 48, ticks: 24, written: C4 + 4 },
			{ startTick: 96, ticks: 48, written: C4 + 7 },
		],
	}),
	{ playsAsLong: true },
);

expectEdit(
	"a take played over notes takes their ticks in overwrite",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n#1 o4 c1\n",
	0,
	() => ({
		kind: "take",
		notes: [
			{ startTick: 24, ticks: 48, written: C4 + 12 },
			{ startTick: 120, ticks: 24, written: C4 + 14 },
		],
	}),
	{ mode: "overwrite", playsAsLong: true },
);

expectEdit(
	"and shoves them aside in insert",
	"#amk 2\n#0 o4 c4 d4 r2\n#1 o4 c1\n",
	0,
	() => ({ kind: "take", notes: [{ startTick: 48, ticks: 48, written: C4 + 12 }] }),
	{ mode: "insert", playsAsLong: true },
);

expectRefused(
	"and is refused in strict",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n",
	0,
	() => ({ kind: "take", notes: [{ startTick: 24, ticks: 48, written: C4 + 12 }] }),
	"strict",
	REFUSE_CLASH,
);

expectEdit(
	"a take running past the end of the song pads the other channel",
	"#amk 2\n#0 o4 c4 d4\n#1 o4 e4 f4\n",
	0,
	() => ({
		kind: "take",
		notes: [
			{ startTick: 96, ticks: 48, written: C4 + 7 },
			{ startTick: 168, ticks: 24, written: C4 + 9 },
		],
	}),
	{ playsFor: 192 },
);

// --- several channels, as one edit -------------------------------------------

{
	const read = (text: string) =>
		songReading(text, compiler.compile({ source: text, aramAddress: ARAM, options: OPTIONS }), ARAM);
	const key = (written: number): string => `$${written.toString(16)}`;

	/** Writes a take and reads every channel named back out of the compile. */
	const written = (
		name: string,
		source: string,
		takes: Parameters<typeof takeEdits>[1],
	): { after: string; dropped: number; plays: (channel: number) => string; ticks: number } | null => {
		const outcome = takeEdits(source, takes, "overwrite", read);
		if ("refused" in outcome) {
			check(`${name}: the take can be written`, false, outcome.refused);
			return null;
		}

		const after = outcome.edit ? apply(source, [outcome.edit]) : source;
		const rebuilt = build(after);
		if (typeof rebuilt === "string") {
			check(`${name}: the result compiles`, false, `${rebuilt}\n        ${JSON.stringify(after)}`);
			return null;
		}

		return {
			after,
			dropped: outcome.dropped,
			plays: (channel) => played(rebuilt, channel).join(" | "),
			ticks: playable(rebuilt),
		};
	};

	// A chord on a channel with music, one holding a rest and one the song has
	// never declared, the last note past the end: every channel is carried out
	// to it, and the whole of it is one edit.
	const chord = written("a chord over three channels", "#amk 2\n#0 o4 c4 d4 e4 f4\n#4 o4 r1\n", [
		{ channel: 5, notes: [{ startTick: 192, ticks: 48, written: C4 + 7 }] },
		{ channel: 0, notes: [{ startTick: 48, ticks: 48, written: C4 + 12 }] },
		{ channel: 4, notes: [{ startTick: 48, ticks: 96, written: C4 + 4 }] },
	]);
	if (chord) {
		check(
			"a chord over three channels: the first channel takes its note",
			chord.plays(0) === `0+48 ${key(C4)} | 48+48 ${key(C4 + 12)} | 96+48 ${key(C4 + 4)} | 144+48 ${key(C4 + 5)}`,
			chord.plays(0),
		);
		check(
			"a chord over three channels: the second takes its own",
			chord.plays(4) === `48+96 ${key(C4 + 4)}`,
			chord.plays(4),
		);
		check(
			"a chord over three channels: the third is opened for its note",
			chord.after.includes("#5 ") && chord.plays(5) === `192+48 ${key(C4 + 7)}`,
			`${chord.plays(5)}\n        ${JSON.stringify(chord.after)}`,
		);
		check("a chord over three channels: the song reaches the last note", chord.ticks === 240, `${chord.ticks}`);
	}

	// A loop is a wall no gesture enters, so the note that landed on one is left
	// out and counted rather than refusing the notes either side of it.
	const walled = written("a take across a loop", "#amk 2\n#0 o4 r4 [d4]2 r4\n", [
		{
			channel: 0,
			notes: [
				{ startTick: 0, ticks: 48, written: C4 },
				{ startTick: 60, ticks: 24, written: C4 + 4 },
				{ startTick: 144, ticks: 48, written: C4 + 7 },
			],
		},
	]);
	if (walled) {
		check("a take across a loop: the note on the loop is dropped", walled.dropped === 1, `${walled.dropped}`);
		check(
			"a take across a loop: the notes either side are written",
			walled.after.includes("[d4]2") && walled.ticks === 192,
			`${walled.ticks} ${JSON.stringify(walled.after)}`,
		);
	}

	const nothing = takeEdits("#amk 2\n#0 o4 c4\n", [{ channel: 0, notes: [] }], "overwrite", read);
	check("a take with no notes writes nothing", !("refused" in nothing) && nothing.edit === null);

	// A channel the roll cannot splice refuses the take in the strip's own words.
	const triplet = takeEdits(
		"#amk 2\n#0 o4 c4 d4\n#1 o4 {c8 d8 e8} r4\n",
		[
			{ channel: 0, notes: [{ startTick: 0, ticks: 24, written: C4 }] },
			{ channel: 1, notes: [{ startTick: 48, ticks: 24, written: C4 }] },
		],
		"overwrite",
		read,
	);
	check("a channel that cannot be edited refuses the whole take", "refused" in triplet && triplet.refused.length > 0);
}
