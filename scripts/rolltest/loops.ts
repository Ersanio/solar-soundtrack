/** `rolltest`: editing notes inside loops, checked against the walk of every pass. */

import "../localize";
import { NOTE_MIN } from "@amk/core/hardcoded-tables";
import {
	type EditContext,
	type Gesture,
	isEdits,
	planFrames,
	REFUSE_LOOP_WALL,
	REFUSE_REMAP_FED,
	REFUSE_SPLIT,
} from "../../web/src/app/editor/views/piano-roll/roll-edit";
import { planGroupEdits } from "../../web/src/app/editor/views/piano-roll/roll-write/plan-edits";
import type { Strip } from "../../web/src/app/editor/views/piano-roll/roll-strip";
import { check, section } from "../harness";
import {
	apply,
	build,
	type Built,
	type Expectation,
	expectOrdinals,
	expectOutcome,
	expectRefused,
	frameFor,
	introOf,
	noteAt,
	playable,
	strip,
	tailsOf,
} from "./support";

// --- loops -------------------------------------------------------------------
//
// A loop channel's oracle is different from a plain one's: `played` reads the
// note map by channel and a `[ ]` body's entries are the loop block's, so the
// walk is what says what sounds — every pass its own note — and the rebuilt
// strip's own expansion agreement is what re-joins the edited text to it. The
// helper pins both, plus the other channels' walks whole, replays included.

section("loops");

/** Every note of one voice as the walk plays it, pass by pass. */
export function walked(built: Built, channel: number): string {
	return built.timeline.notes
		.filter((note) => note.channel === channel)
		.map((note) => `${note.tick}+${note.ticks}:$${note.note.toString(16)}`)
		.join(" ");
}

/** The walks of every other voice, for the edit that must not reach them. */
export function walkedOthers(built: Built, channel: number): string {
	const out: string[] = [];
	for (let other = 0; other < 8; other++) {
		if (other !== channel) {
			out.push(walked(built, other));
		}
	}

	return out.join(" | ");
}

/**
 * An edit inside a loop-bearing channel: planned in the frame the expectation
 * or the gesture's items name, written, applied, recompiled — and then held to
 * `plays`, the edited voice's whole walk spelled out by hand, which is the one
 * reading that covers every pass of every body. The expectation's own readings
 * are {@link expectOutcome}'s, as for `expectEdit`.
 *
 * Through `planFrames` and `planGroupEdits` rather than `planGesture` and
 * `planEdits`, which is the road the roll takes: a gesture moving no tick may
 * name items in several frames, and the two degenerate to the single-frame pair
 * for every gesture that does not.
 */
export function expectLoopEdit(
	name: string,
	source: string,
	channel: number,
	gesture: (strip: Strip) => Gesture,
	plays: string,
	expectation: Expectation = {},
): void {
	const before = build(source);
	if (typeof before === "string") {
		check(`${name}: compiles to begin with`, false, before);
		return;
	}

	const bar = strip(source, before, channel);
	if (typeof bar === "string") {
		check(`${name}: the channel can be edited`, false, bar);
		return;
	}

	const made = gesture(bar);
	const held = frameFor(bar, made, expectation.frame);
	const context: EditContext = {
		source,
		strip: bar,
		targetAMKVersion: before.result.stats?.targetAMKVersion ?? 4,
		songTargetProgram: before.result.stats?.songTargetProgram ?? 0,
		playableTicks: playable(before),
		introTicks: introOf(before),
		channels: tailsOf(source, before),
		frame: bar.frames[held],
		inForce: before.inForce,
	};
	const parts = planFrames(bar, made, expectation.mode ?? "insert", held);
	const outcome = planGroupEdits(context, parts);
	if (!isEdits(outcome)) {
		check(`${name}: the gesture can be written`, false, outcome.refused);
		return;
	}

	let after: string;
	try {
		after = apply(source, outcome);
	} catch (error) {
		check(`${name}: the edits apply`, false, String(error));
		return;
	}

	const rebuilt = build(after);
	if (typeof rebuilt === "string") {
		check(`${name}: the result compiles`, false, `${rebuilt}\n        ${JSON.stringify(after)}`);
		return;
	}

	// The strongest single check there is: the rebuilt strip's expansion re-joins
	// the edited text to the new walk note by note, so a splice that bent the
	// loop structure fails to build at all.
	const again = strip(after, rebuilt, channel);
	check(
		`${name}: the result still frames`,
		typeof again !== "string",
		typeof again === "string" ? `${again}\n        ${JSON.stringify(after)}` : "",
	);

	// Per frame, and at the frame's own index: a gesture reaching into a body
	// opens no bracket, so the frame it was planned in is the frame it comes back
	// as, which is what the roll's carried anchors are numbered by.
	if (typeof again !== "string") {
		for (const part of parts) {
			expectOrdinals(name, part.plan, again, bar.frames.indexOf(part.frame));
		}
	}

	check(
		`${name}: every pass plays as asked`,
		walked(rebuilt, channel) === plays,
		`want ${plays}\n        got  ${walked(rebuilt, channel)}\n        text ${JSON.stringify(after)}`,
	);

	if (expectation.alsoPlays === undefined) {
		check(
			`${name}: leaves the other channels alone`,
			walkedOthers(before, channel) === walkedOthers(rebuilt, channel),
			`${walkedOthers(before, channel)} -> ${walkedOthers(rebuilt, channel)}`,
		);
	} else {
		const [voice, sounds] = expectation.alsoPlays;
		check(
			`${name}: #${voice} plays as asked`,
			walked(rebuilt, voice) === sounds,
			`want ${sounds}\n        got  ${walked(rebuilt, voice)}\n        text ${JSON.stringify(after)}`,
		);
	}

	expectOutcome(name, before, rebuilt, after, expectation);
}

// The strip's own shape on the headline song: one root frame holding the
// construct and the tail note, one body frame whose items carry an instance per
// pass, joined to the walk inside it and unverified past it.
{
	const source = "#amk 2\n#0 o4 [c4 d4]2 e4";
	const before = build(source);
	if (typeof before === "string") {
		check("the frames: compiles", false, before);
	} else {
		const bar = strip(source, before, 0);
		if (typeof bar === "string") {
			check("the frames: builds", false, bar);
		} else {
			check("the frames: root and one body", bar.frames.length === 2, `${bar.frames.length}`);
			const shape = bar.items
				.map(
					(item) =>
						`${item.kind[0]}@${item.startTick}+${item.ticks}#${item.frame}[${item.instances.map((each) => each.tick).join(",")}]`,
				)
				.join(" ");
			check(
				"the frames: items, local ticks and instances",
				shape === "c@0+192#0[0] n@192+48#0[192] n@0+48#1[0,96] n@48+48#1[48,144]",
				shape,
			);
			check(
				"the frames: every note instance joined to a walk note",
				bar.items.every((item) => item.kind !== "note" || item.instances.every((each) => each.note !== null)),
			);
			check(
				"the frames: the body is where writes go",
				source.slice(bar.frames[1].span.start, bar.frames[1].span.end) === "c4 d4",
				JSON.stringify(source.slice(bar.frames[1].span.start, bar.frames[1].span.end)),
			);
		}
	}
}

// Repitching a note inside the body rewrites the one text and every pass plays
// it — requirement four of the feature, in its smallest form.
expectLoopEdit(
	"a body note repitched on every pass",
	"#amk 2\n#0 o4 [c4 d4]2 e4",
	0,
	// The root's notes come first in `noteAt`'s count — e4 is note 0 — and the
	// body's follow: c4 is 1, d4 is 2. The same holds for every case below.
	(bar) => ({ kind: "move", items: [noteAt(bar, 2)], deltaTicks: 0, deltaKeys: 2, copy: false }),
	"0+48:$a4 48+48:$a8 96+48:$a4 144+48:$a8 192+48:$a8",
	{ contains: "[c4 e4]2", playsFor: 240 },
);

// The same in a body written with shifts, where the note being repitched carries
// its own leading `o` — the octave standing over it and the octave its unit says
// are then the same number with a `<` between them, and dropping the `o` as
// redundant hands the note to that `<`. Every pass moves, so the walk says it
// five times over.
expectLoopEdit(
	"a body note repitched under a shift, with its own octave in front of it",
	"#amk 2\n#0 (1)[o2 r64 > c+32 r64 < o3 c32 o2 r64 > c+32 < r64]5",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 1)], deltaTicks: 0, deltaKeys: 1, copy: false }),
	// `$99` is o3 c+, which all three of the body's notes now are — the middle one
	// on the row the porter dropped it on rather than an octave under it.
	"3+6:$99 12+6:$99 21+6:$99 33+6:$99 42+6:$99 51+6:$99 63+6:$99 72+6:$99 81+6:$99 93+6:$99 102+6:$99 111+6:$99 123+6:$99 132+6:$99 141+6:$99",
	{ contains: "< o3 c+32 o2" },
);

// Stretching a body note is the length change: the body grows, every pass
// grows with it, and everything after the loop moves by passes times the delta.
expectLoopEdit(
	"a body note stretched, moving the song after the loop",
	"#amk 2\n#0 o4 [c4 d4]2 e4",
	0,
	(bar) => ({ kind: "stretch", items: [noteAt(bar, 2)], edge: "end", deltaTicks: 48 }),
	"0+48:$a4 48+96:$a6 144+48:$a4 192+96:$a6 288+48:$a8",
	{ contains: "[c4 d2]2", playsFor: 336 },
);

// Drawing on any pass's region mirrors into the body — the note lands in the
// text once and appears on every pass.
expectLoopEdit(
	"a note drawn into a recalled pass lands in the body",
	"#amk 2\n#0 o4 [c4 r4]2 e4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	"0+48:$a4 48+48:$ab 96+48:$a4 144+48:$ab 192+48:$a8",
	{ frame: 1, contains: "[c4 g4]2", playsFor: 240 },
);

// A frame carries every voice's runs of its body, because a length change moves
// both voices and the shift, the pad and the preview all read them to say so.
// A **draw** is the one reader those extra runs are wrong for: `#1` is inside
// its own `r1` here, and the pass covering tick 48 is `#0`'s. The note is `#1`'s
// own music, written in `#1`, sounding once.
expectLoopEdit(
	"a note drawn over another voice's pass of a shared body stays in this channel",
	"#amk 2\n#0 o4 (1)[c4 r4]2 r1\n#1 o4 r1 (1)2",
	1,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	"48+48:$ab 192+48:$a4 288+48:$a4",
	{ playsFor: 384, lacks: "[c4 g4]" },
);

// And the same draw inside a pass `#1` really does play lands in the body, where
// both voices pick it up — the promise the sibling washes make, which the guard
// above must not take away.
expectLoopEdit(
	"a note drawn into this channel's own pass of a shared body lands on both voices",
	"#amk 2\n#0 o4 (1)[c4 r4]2 r1\n#1 o4 r1 (1)2",
	1,
	() => ({ kind: "spawn", startTick: 240, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	"192+48:$a4 240+48:$ab 288+48:$a4 336+48:$ab",
	{
		contains: "(1)[c4 g4]2",
		alsoPlays: [0, "0+48:$a4 48+48:$ab 96+48:$a4 144+48:$ab"],
		playsFor: 384,
	},
);

// Deleting a body note deletes it from every pass — the gap a rest, so the
// loop keeps its length and its groove.
expectLoopEdit(
	"a body note deleted from every pass",
	"#amk 2\n#0 o4 [c4 d4]2 e4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	"48+48:$a6 144+48:$a6 192+48:$a8",
	{ contains: "r4 d4]2", playsFor: 240 },
);

// The body's **last** note is its tail, and a body is a channel in miniature:
// the tail keeps its length, so deleting it leaves a rest and nothing after the
// brackets moves. Shortening the loop is the box's right-end resize.
expectLoopEdit(
	"a body's last note deleted keeps the loop's length",
	"#amk 2\n#0 o4 [c4 d4]2 e4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 2)] }),
	"0+48:$a4 96+48:$a4 192+48:$a8",
	{ contains: "[c4 r4]2", playsFor: 240 },
);

// The body's whole group moved as one gesture — a multi-note selection drag.
// Every note travels together, the vacated head is a rest, and the group's
// reach into the tail is the length change it always is.
expectLoopEdit(
	"the body's whole group moved together",
	"#amk 2\n#0 o4 [c4 d4]2 e4",
	0,
	(bar) => ({
		kind: "move",
		items: [bar.frames[1].from, bar.frames[1].from + 1],
		deltaTicks: 48,
		deltaKeys: 0,
		copy: false,
	}),
	"48+48:$a4 96+48:$a6 192+48:$a4 240+48:$a6 288+48:$a8",
	{ contains: "[r4 c4 d4]2", playsFor: 336 },
);

// The hex subloop, in both spellings' shared reading: the body is inline and
// its passes are the driver's n+1.
expectLoopEdit(
	"a hex subloop's note repitched on both passes",
	"#amk 2\n#0 o4 c4 $E6 $00 d4 $E6 $01 e4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 2)], deltaTicks: 0, deltaKeys: 2, copy: false }),
	"0+48:$a4 48+48:$a8 96+48:$a8 144+48:$a8",
	{ contains: "$E6 $00 e4 $E6 $01" },
);

// A subloop entirely past the walk's cut: no instance is corroborated, and the
// note edits all the same. A moved instance is made audible — the pad brings
// #1 out to the last one, exactly as a root note moved past the end is.
expectLoopEdit(
	"a subloop past the end of the pass still edits",
	"#amk 2\n#0 o4 c4 $E6 $00 d4 $E6 $01 e4\n#1 o4 g4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 2)], deltaTicks: 0, deltaKeys: 2, copy: false }),
	"0+48:$a4 48+48:$a8 96+48:$a8",
	{ contains: "$E6 $00 e4 $E6 $01", playsFor: 144 },
);

// Nesting multiplies instances through the outer passes — four for a note in a
// subloop inside a loop — and an edit reaches all of them.
expectLoopEdit(
	"a note nested two deep edits on all four passes",
	"#amk 2\n#0 o4 [ [[c4]]2 d4]2 e4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 2)], deltaTicks: 0, deltaKeys: 2, copy: false }),
	"0+48:$a6 48+48:$a6 96+48:$a6 144+48:$a6 192+48:$a6 240+48:$a6 288+48:$a8",
	{ contains: "[[d4]]2" },
);

// A `*` recall is the declaration's body played again: five passes from one
// written note, all repitched by the one edit.
expectLoopEdit(
	"a note recalled by * edits on every pass",
	"#amk 2\n#0 o4 [c4]2 d4 *3",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 1)], deltaTicks: 0, deltaKeys: 2, copy: false }),
	"0+48:$a6 48+48:$a6 96+48:$a6 144+48:$a6 192+48:$a6 240+48:$a6",
	{ contains: "[d4]2" },
);

// The old instrument-hazard refusal (`@0` declared, `@17` recalled) is the
// headline song loop editing exists for: unroll refused it outright, and the
// frames edit it — the byte is fixed at the parse, the state is per pass.
expectLoopEdit(
	"a loop recalled under another instrument still edits",
	"#amk 2\n#0 @0 o4 (1)[c4 d4]2 @17 (1)2",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 1)], deltaTicks: 0, deltaKeys: 2, copy: false }),
	"0+48:$a4 48+48:$a8 96+48:$a4 144+48:$a8 192+48:$a4 240+48:$a8 288+48:$a4 336+48:$a8",
	{ contains: "(1)[c4 e4]2" },
);

// A root note dragged onto a loop's ticks hits a wall: the loop's music is not
// something a neighbour may enter.
expectRefused(
	"a note dragged onto a loop",
	"#amk 2\n#0 o4 [c4]2 d4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: -96, deltaKeys: 0, copy: false }),
	"overwrite",
	REFUSE_LOOP_WALL,
);

// A selection spanning a bracket has no one frame to be local to.
expectRefused(
	"a drag of notes on both sides of a bracket",
	"#amk 2\n#0 o4 [c4]2 d4",
	0,
	(bar) => ({
		kind: "move",
		items: [bar.frames[1].from, noteAt(bar, 0)],
		deltaTicks: 48,
		deltaKeys: 0,
		copy: false,
	}),
	"insert",
	REFUSE_SPLIT,
);

// A body head fed by a drum loaded before the `[`: rewriting it would move the
// remap's consumption onto the next pitched note, so it refuses in its own words.
expectRefused(
	"a body note fed by a drum loaded before the loop",
	"#amk 2\n#0 o4 @21 [c4 d4]2",
	0,
	(bar) => ({ kind: "move", items: [bar.frames[1].from], deltaTicks: 48, deltaKeys: 0, copy: false }),
	"insert",
	REFUSE_REMAP_FED,
);

// A cross-frame delete commits both frames' removals as one step: the body's
// `d4` and the root's `e4` in one gesture, split by `planFrames` and written by
// `planGroupEdits`, which is the road `roll-gesture.ts:run` takes.
expectLoopEdit(
	"a delete across a bracket lands in one text",
	"#amk 2\n#0 o4 [c4 d4]2 e4",
	0,
	(bar) => ({ kind: "delete", items: [bar.frames[1].from + 1, noteAt(bar, 0)] }),
	"0+48:$a4 96+48:$a4",
	{ contains: "[c4 r4]2 r4" },
);
