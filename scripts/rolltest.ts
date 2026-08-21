/**
 * The piano roll's edits: `roll-strip.ts` and `roll-edit.ts`, driven the way the
 * roll drives them and checked the way the normalizer's output is checked.
 *
 * A gesture is not verified by looking at the text it produced. It is verified
 * by **compiling that text and walking it**: every note the plan said the
 * channel would hold has to be there, on its tick, for its length and at the
 * pitch it was written at — and no other channel may have moved. That is the
 * only check that can tell a splice which looks right from one which is right,
 * because everything the roll writes is read back through `o`, `l` and `q` it
 * did not write.
 *
 * It also holds the two spelling rules the roll and the compiler have to agree
 * on — that `spellNote` names the same key `@amk/tokens`' `NOTE_NAMES` does, and
 * that a note's octave falls out of its written byte — and the refusals, each
 * with a song that earns it.
 *
 *   npm run rolltest
 */

import { compiler } from "@amk/compiler";
import { NOTE_MAX, NOTE_MIN } from "@amk/core/hardcoded-tables";
import { octaveFor, octaveOfNote, spellDuration, spellNote } from "@amk/core/mml-text";
import type { CompileResult } from "@amk/core/types";
import { loadDriver } from "@amk/spc/driver";
import { type SongTimeline, walkSong } from "@amk/spc/song-walk";
import { tokenize } from "@amk/tokens";
import { NOTE_NAMES } from "@amk/tokens/commands/units";
import type { Edit } from "@amk/tokens/edits";
import {
	type EditContext,
	type EditMode,
	type Gesture,
	type Plan,
	planEdits,
	planGesture,
} from "../web/src/app/editor/views/piano-roll/roll-edit";
import { type Strip, channelStrip, isStrip } from "../web/src/app/editor/views/piano-roll/roll-strip";

import { check, stubFetch, summarise } from "./harness";

stubFetch();

const driver = await loadDriver();
const ARAM = driver.manifest.localPos;
const OPTIONS = {
	sampleNames: driver.samples.map((sample) => sample.sampleName),
	sampleGroups: driver.manifest.sampleGroups,
};

interface Built {
	result: CompileResult;
	timeline: SongTimeline;
}

function build(source: string): Built | string {
	const result = compiler.compile({ source, aramAddress: ARAM, options: OPTIONS });
	if (!result.ok || !result.data) {
		return result.diagnostics
			.filter((d) => d.severity === "error")
			.map((d) => `${d.code} ${d.message}`)
			.join("; ");
	}

	return { result, timeline: walkSong(result.data, ARAM) };
}

function strip(source: string, built: Built, channel: number): Strip | string {
	const outcome = channelStrip({
		source,
		channel,
		noteMap: built.result.noteMap ?? [],
		timeline: built.timeline,
		index: tokenize(source),
		tempoRatio: built.result.stats?.tempoRatio ?? 1,
	});

	return isStrip(outcome) ? outcome : outcome.refused;
}

/** Applies a sorted, non-overlapping edit list from the end, as CodeMirror would. */
function apply(source: string, edits: readonly Edit[]): string {
	let text = source;
	for (const edit of [...edits].sort((a, b) => b.span.start - a.span.start || b.span.end - a.span.end)) {
		if (text.slice(edit.span.start, edit.span.end) !== edit.expect) {
			throw new Error(`expect mismatch at ${edit.span.start}`);
		}

		text = text.slice(0, edit.span.start) + edit.text + text.slice(edit.span.end);
	}

	return text;
}

/**
 * What a channel plays, read back out of the compiler's own note map.
 *
 * Not off the walk: `walkSong` ends the pass at the shortest channel and drops
 * everything after it (`song-walk.ts:1069-1080`), so a channel longer than the
 * shortest would report only its first few notes and every edit out in the tail
 * would look like it had done nothing. The map has the whole channel. Ties are
 * folded here rather than borrowed from `roll-strip.ts`, so the reading this is
 * checked against is a second one rather than the same one twice.
 */
function played(built: Built, channel: number): string[] {
	return notesOf(
		built,
		channel,
		new Map(
			built.timeline.notes
				.filter((note) => note.percussion !== null)
				.map((note) => [note.address, 21 + (note.percussion ?? 0)]),
		),
	);
}

/** The body of {@link played}, with the drum names handed in rather than read off the walk. */
function notesOf(built: Built, channel: number, drums: ReadonlyMap<number, number>): string[] {
	const out: string[] = [];
	let tick = 0;
	let held = -1;
	for (const entry of (built.result.noteMap ?? [])
		.filter((note) => note.channel === channel)
		.sort((a, b) => a.address - b.address)) {
		if (entry.note === 0xc6 && held >= 0) {
			const [start, ticks, pitch] = out[held].split(" ");
			out[held] = [start, String(Number(ticks) + entry.ticks), pitch].join(" ");
			tick += entry.ticks;
			continue;
		}

		if (entry.note !== 0xc7) {
			const drum = drums.get(entry.address);
			held = out.length;
			out.push([String(tick), String(entry.ticks), drum ? `@${drum}` : `$${entry.written.toString(16)}`].join(" "));
		}

		tick += entry.ticks;
	}

	return out.map((row) => {
		const [start, ticks, pitch] = row.split(" ");
		return `${start}+${ticks} ${pitch}`;
	});
}

/** What the plan said the channel would play, in the same words. */
function planned(plan: Plan): string[] {
	return [...plan.notes]
		.sort((a, b) => a.startTick - b.startTick)
		.map((note) => {
			const pitch = note.drum === null ? `$${note.written.toString(16)}` : `@${note.drum}`;
			return `${note.startTick}+${note.ticks} ${pitch}`;
		});
}

/** No drum names, because the walk is not what this reads. */
const NO_DRUMS: ReadonlyMap<number, number> = new Map();

/**
 * Every other channel, so an edit that reached out of its own is caught.
 *
 * Off the note map, for the reason {@link played} gives and one more: a case
 * that *opens* a channel makes that channel the shortest, and `walkSong` ends
 * the pass at the shortest — so every other channel's tail would drop out of the
 * comparison and read as though the edit had deleted it. The map has each
 * channel whole either way, which is the stronger check.
 */
function others(built: Built, channel: number): string {
	const out: string[] = [];
	for (let other = 0; other < 8; other++) {
		if (other !== channel) {
			out.push(`${other}:${notesOf(built, other, NO_DRUMS).join(",")}`);
		}
	}

	return out.join(" ");
}

interface Expectation {
	/** The text after the edit, for the cases where the spelling is the point. */
	text?: string;
	/** Substrings the result has to contain. */
	contains?: string | readonly string[];
	/** Substrings the result must not contain. */
	lacks?: string | readonly string[];
	/**
	 * The mode the gesture is planned under, `"flexible"` unless a case says otherwise.
	 *
	 * Most cases here never make two notes sound at once, and those read the same
	 * either way; the ones that do name the mode they are pinning.
	 */
	mode?: EditMode;
}

function expectEdit(
	name: string,
	source: string,
	channel: number,
	gesture: (strip: Strip) => Gesture,
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

	const context: EditContext = {
		source,
		strip: bar,
		targetAMKVersion: before.result.stats?.targetAMKVersion ?? 4,
		songTargetProgram: before.result.stats?.songTargetProgram ?? 0,
	};
	const plan = planGesture(bar, gesture(bar), expectation.mode ?? "flexible");
	const edits = planEdits(context, plan);
	if (edits === null) {
		check(`${name}: the gesture can be written`, false, plan.refused ?? "planEdits refused");
		return;
	}

	let after: string;
	try {
		after = apply(source, edits);
	} catch (error) {
		check(`${name}: the edits apply`, false, String(error));
		return;
	}

	const rebuilt = build(after);
	if (typeof rebuilt === "string") {
		check(`${name}: the result compiles`, false, `${rebuilt}\n        ${JSON.stringify(after)}`);
		return;
	}

	const want = planned(plan);
	const got = played(rebuilt, channel);
	check(
		`${name}: plays what the plan said`,
		want.join(" | ") === got.join(" | "),
		want.join(" | ") === got.join(" | ")
			? ""
			: `want ${want.join(" | ")}\n        got  ${got.join(" | ")}\n        text ${JSON.stringify(after)}`,
	);

	check(
		`${name}: leaves the other channels alone`,
		others(before, channel) === others(rebuilt, channel),
		`${others(before, channel)} -> ${others(rebuilt, channel)}`,
	);

	if (expectation.text !== undefined) {
		check(`${name}: writes what it should`, after === expectation.text, JSON.stringify(after));
	}

	for (const wanted of listOf(expectation.contains)) {
		check(`${name}: writes ${wanted}`, after.includes(wanted), JSON.stringify(after));
	}

	for (const unwanted of listOf(expectation.lacks)) {
		check(`${name}: does not write ${unwanted}`, !after.includes(unwanted), JSON.stringify(after));
	}
}

/** One substring or several, so a case can pin more than one thing about its result. */
function listOf(expectation: string | readonly string[] | undefined): readonly string[] {
	if (expectation === undefined) {
		return [];
	}

	return typeof expectation === "string" ? [expectation] : expectation;
}

/** A gesture the roll must decline: no edit, and a reason. */
function expectRefused(
	name: string,
	source: string,
	channel: number,
	gesture: (strip: Strip) => Gesture,
	mode: EditMode = "flexible",
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

	const context: EditContext = {
		source,
		strip: bar,
		targetAMKVersion: before.result.stats?.targetAMKVersion ?? 4,
		songTargetProgram: before.result.stats?.songTargetProgram ?? 0,
	};
	const plan = planGesture(bar, gesture(bar), mode);
	check(`${name}: refused`, planEdits(context, plan) === null, "an edit was produced");
}

/** A channel the strip declines to build at all. */
function expectNoStrip(name: string, source: string, channel: number, because: string): void {
	const before = build(source);
	if (typeof before === "string") {
		check(`${name}: compiles to begin with`, false, before);
		return;
	}

	const bar = strip(source, before, channel);
	check(
		`${name}: the channel is refused`,
		typeof bar === "string" && bar.includes(because),
		typeof bar === "string" ? bar : "a strip was built",
	);
}

/** The index of the nth note of the channel, which is what a gesture names. */
function noteAt(bar: Strip, nth: number): number {
	let seen = 0;
	for (let index = 0; index < bar.items.length; index++) {
		if (bar.items[index].kind === "note" && seen++ === nth) {
			return index;
		}
	}

	return -1;
}

// --- the spellings the roll and the compiler have to agree on ---------------

console.log("\nspelling");
{
	let agree = true;
	let roundTrips = true;
	for (let written = NOTE_MIN; written < NOTE_MAX; written++) {
		const octave = octaveFor(written);
		const text = octave === null ? null : spellNote(written, octave);
		if (octave === null || text === null) {
			agree = false;
			break;
		}

		agree &&= text === NOTE_NAMES[(written - NOTE_MIN) % 12];
		roundTrips &&= octaveOfNote(written, text) === octave;
	}

	check("spellNote names the key NOTE_NAMES does, for every note the driver plays", agree);
	check("a note's octave falls back out of its written byte", roundTrips);
	check("a length over a whole note is tied", spellDuration(421, 4) === "1^1^=37", spellDuration(421, 4) ?? "null");
	check("a whole note is one token", spellDuration(192, 4) === "1", spellDuration(192, 4) ?? "null");
}

// --- what the strip will and will not read ---------------------------------

console.log("\nthe gate");
expectNoStrip("a loop", "#amk 2\n#0 o4 [c4 d4]2 e4", 0, "`[`");
// A `(n)` call is not a command to the scanner, so the gate cannot name it —
// the walk is what catches it, by playing more notes than the channel writes.
expectNoStrip("a call", "#amk 2\n#0 o4 (1)[c4]2 d4\n#1 o4 (1)2", 1, "more notes than it has written");
expectNoStrip("a triplet", "#amk 2\n#0 o4 {c8 d8 e8} f4", 0, "{ }");
expectNoStrip("a replacement", '#amk 2\n"x=c4"\n#0 o4 x d4', 0, "replacement");
expectNoStrip("a tempo ratio", "#amk 2\n#halvetempo\n#0 o4 c4 d4", 0, "divides its tempo");
expectNoStrip("a pitch slide", "#amk 2\n#0 o4 c4 $DD $00 $18 e4", 0, "$DD");
// `<` and `>` are safe and must **not** be refused: a note's octave comes from
// its own written byte rather than from a running sum, so either note here
// repitches without disturbing the other.
expectEdit(
	"a note beside an octave shift",
	"#amk 2\n#0 o4 c4 > d4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 1)], deltaTicks: 0, deltaKeys: -12, copy: false }),
	{ contains: ">" },
);

// A channel longer than the shortest is the commonest shape a song has, and the
// walk cuts the pass at the shortest — so this must be editable, not refused.
expectEdit("a channel past the end of the pass", "#amk 2\n#0 o4 c4 d4 e4 f4\n#1 o4 g4", 0, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 3)],
	deltaTicks: 0,
	deltaKeys: 2,
	copy: false,
}));

// --- drawing, dragging, stretching -----------------------------------------

console.log("\ngestures");
expectEdit(
	"a note dragged up a semitone",
	"#amk 2\n#0 o4 c4 d4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 0, deltaKeys: 1, copy: false }),
	{ contains: "c+4" },
);

// The octave a note was written under is the one in force at it, so an edit that
// stays inside that octave says nothing about octaves at all.
expectEdit(
	"a drag inside the octave writes no octave",
	"#amk 2\n#0 o4 l4 c d e f",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 0, deltaKeys: 2, copy: false }),
	{ contains: "l4 d d e f", lacks: "o4 d" },
);

expectEdit(
	"a note dragged into the next octave, with the octave put back",
	"#amk 2\n#0 o4 c4 d4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 0, deltaKeys: 12, copy: false }),
	{ contains: "o5 c4 o4" },
);

expectEdit("a note dragged later, taking the time out of the rest after it", "#amk 2\n#0 o4 c4 r4 d4", 0, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 1)],
	deltaTicks: -24,
	deltaKeys: 0,
	copy: false,
}));

expectEdit("a note stretched, pushing the one after it", "#amk 2\n#0 o4 c4 d4 e4", 0, (bar) => ({
	kind: "stretch",
	items: [noteAt(bar, 0)],
	edge: "end",
	deltaTicks: 48,
}));

expectEdit(
	"a note stretched past a whole note, written as a tie",
	"#amk 2\n#0 o4 c4 r1 r1 d4",
	0,
	(bar) => ({ kind: "stretch", items: [noteAt(bar, 0)], edge: "end", deltaTicks: 240 }),
	{ contains: "^" },
);

expectEdit("a note shortened, which lengthens the rest after it", "#amk 2\n#0 o4 c4 r4 d4", 0, (bar) => ({
	kind: "stretch",
	items: [noteAt(bar, 0)],
	edge: "end",
	deltaTicks: -24,
}));

expectEdit("a note deleted", "#amk 2\n#0 o4 c4 d4 e4", 0, (bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }));

expectEdit("a note drawn into a rest", "#amk 2\n#0 o4 c4 r2 d4", 0, () => ({
	kind: "spawn",
	startTick: 72,
	ticks: 24,
	written: NOTE_MIN + 36 + 4,
	drum: null,
}));

expectEdit("a note drawn at the end of a channel", "#amk 2\n#0 o4 c4 r4", 0, () => ({
	kind: "spawn",
	startTick: 96,
	ticks: 48,
	written: NOTE_MIN + 36 + 7,
	drum: null,
}));

expectEdit("a drum moved to another lane", "#amk 2\n#6 @21 c8 @22 c8", 6, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 0)],
	deltaTicks: 0,
	deltaKeys: 0,
	copy: false,
}));

expectEdit(
	"a mid-note ramp keeps its place when the note is stretched",
	"#amk 2\n#0 o4 c4 v200 ^8 r4 d4",
	0,
	(bar) => ({ kind: "stretch", items: [noteAt(bar, 0)], edge: "end", deltaTicks: 24 }),
	{ contains: "v200" },
);

expectEdit(
	"a pitch drag does not spell a length in",
	"#amk 2\n#0 o4 l4 c d",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 0, deltaKeys: 2, copy: false }),
	{ contains: "d d", lacks: "d4 d" },
);

console.log("\nbulk");
expectEdit("legato closes the rests", "#amk 2\n#0 o4 c8 r8 d8 r8", 0, (bar) => ({
	kind: "legato",
	items: [noteAt(bar, 0), noteAt(bar, 1)],
}));

expectEdit("quantize pulls a note onto the beat", "#amk 2\n#0 o4 c8 r=4 d8 r4", 0, (bar) => ({
	kind: "quantize",
	items: [noteAt(bar, 1)],
	snap: 48,
}));

expectEdit("glue joins two touching notes", "#amk 2\n#0 o4 c8 c8 r4", 0, (bar) => ({
	kind: "glue",
	items: [noteAt(bar, 0), noteAt(bar, 1)],
}));

// A run transposed together must not write a restore after every note that the
// next note's own octave undoes on the spot.
expectEdit(
	"a run moved an octave writes one octave, not one per note",
	"#amk 2\n#0 o4 l4 c d e f",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0), noteAt(bar, 1), noteAt(bar, 2), noteAt(bar, 3)],
		deltaTicks: 0,
		deltaKeys: 12,
		copy: false,
	}),
	{ contains: "o5 c d e f", lacks: "o4 o5" },
);

// Deleting the first note puts a rest where it stood, and the two have to be one
// edit: an insertion inside a range being removed is merged rather than refused.
expectEdit("the first note of a channel deleted", "#amk 2\n#0 o4 l4 c d e", 0, (bar) => ({
	kind: "delete",
	items: [noteAt(bar, 0)],
}));

expectEdit("a whole selection moves as one edit list", "#amk 2\n#0 o4 r4 c8 d8 e8 f8 r1", 0, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 0), noteAt(bar, 1), noteAt(bar, 2), noteAt(bar, 3)],
	deltaTicks: 48,
	deltaKeys: 0,
	copy: false,
}));

// --- flexible mode: the notes in the way move aside ------------------------

console.log("\nflexible");
expectEdit("a note dragged onto the one after it, pushing it right", "#amk 2\n#0 o4 c4 d4 e4", 0, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 0)],
	deltaTicks: 24,
	deltaKeys: 0,
	copy: false,
}));

expectEdit("a note dragged onto the one before it, pushing it left", "#amk 2\n#0 o4 r4 c4 d4", 0, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 1)],
	deltaTicks: -24,
	deltaKeys: 0,
	copy: false,
}));

// The cascade's `fixed` set: the selection shoves the outsider and keeps its
// own spacing, rather than one of its notes moving the next.
expectEdit("a selection dragged onto an outsider pushes only the outsider", "#amk 2\n#0 o4 c8 d8 r4 e8", 0, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 0), noteAt(bar, 1)],
	deltaTicks: 60,
	deltaKeys: 0,
	copy: false,
}));

// In the octave already in force, so what is pinned here is the push rather
// than the spelling of a note that also has to carry an `o`.
expectEdit("a note drawn over the one after it, pushing it right", "#amk 2\n#0 o4 c4 r8 d4", 0, () => ({
	kind: "spawn",
	startTick: 48,
	ticks: 48,
	written: NOTE_MIN + 36 + 4,
	drum: null,
}));

console.log("\nrefusals");
expectRefused(
	"a note dragged onto its neighbour, strictly",
	"#amk 2\n#0 o4 c4 d4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0)],
		deltaTicks: 24,
		deltaKeys: 0,
		copy: false,
	}),
	"strict",
);

// The gesture the mode inverts: this is what `flexible` pushes through at :385.
expectRefused(
	"a note stretched into its neighbour, strictly",
	"#amk 2\n#0 o4 c4 d4 e4",
	0,
	(bar) => ({
		kind: "stretch",
		items: [noteAt(bar, 0)],
		edge: "end",
		deltaTicks: 24,
	}),
	"strict",
);

expectRefused("a note dragged onto the one before it with nowhere to push", "#amk 2\n#0 o4 c4 d4", 0, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 1)],
	deltaTicks: -24,
	deltaKeys: 0,
	copy: false,
}));

// Both notes are the gesture's own, so neither can be shoved out of the other's
// way and the overlap stands.
expectRefused("quantize pulling two notes onto one beat", "#amk 2\n#0 o4 c16 d16 r2", 0, (bar) => ({
	kind: "quantize",
	items: [noteAt(bar, 0), noteAt(bar, 1)],
	snap: 48,
}));

expectRefused("a note dragged off the bottom of the driver's range", "#amk 2\n#0 o1 c4 d4", 0, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 0)],
	deltaTicks: 0,
	deltaKeys: -12,
	copy: false,
}));

expectRefused("a stretch with nowhere to push", "#amk 2\n#0 o4 c4 d4", 0, (bar) => ({
	kind: "stretch",
	items: [noteAt(bar, 1)],
	edge: "start",
	deltaTicks: -48,
}));

expectRefused("a note shortened past the command written inside it", "#amk 2\n#0 o4 c4 v200 ^8 d4", 0, (bar) => ({
	kind: "stretch",
	items: [noteAt(bar, 0)],
	edge: "end",
	deltaTicks: -60,
}));

console.log("\nopening a channel");

// The whole text, because everything about the block is the point: the `#N`, the
// six defaults, the blank line above it, the rest that carries the note out to
// its tick — and that the note does not repeat the `o4` the block just wrote.
expectEdit(
	"a note drawn on a channel the song has not declared",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n",
	5,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 4, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 d4 e4 f4\n\n#5 o4 l8 q7F @0 v255 y10\nr4 e4\n" },
);

// The channel is already open, so no second `#5` and no defaults over the top of
// the `v200` the porter wrote.
expectEdit(
	"a note drawn on a channel that is declared but holds no music",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n#5 v200\n",
	5,
	() => ({ kind: "spawn", startTick: 0, ticks: 48, written: NOTE_MIN + 36, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 d4 e4 f4\n#5 v200\no4 c4\n" },
);

// A `;` runs to the end of its line, so a run written on the same line would be
// read as part of the comment and the note would never compile.
expectEdit(
	"a note drawn on a channel whose block ends in a comment",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n#5 v200 ; the bass comes in later",
	5,
	() => ({ kind: "spawn", startTick: 0, ticks: 48, written: NOTE_MIN + 36, drum: null }),
	{ contains: "later\no4 c4" },
);

// The opening's `@0` and the drum's own `@21` both, and the note on its lane.
expectEdit(
	"a drum drawn on a channel the song has not declared",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n",
	6,
	() => ({ kind: "spawn", startTick: 0, ticks: 24, written: NOTE_MIN + 24, drum: 21 }),
	{ contains: "#6 o4 l8 q7F @0 v255 y10\n@21 c8" },
);

// `@` switches instrument tuning on under Addmusic 4.05 rather than saying what
// is already true, so the opening leaves it out — `normalize.ts:writeDefaults`
// takes the same gate.
expectEdit(
	"a channel opened on a target where an `@` is not a no-op",
	"#am4\n#0 o4 c4 d4 e4 f4\n",
	5,
	() => ({ kind: "spawn", startTick: 0, ticks: 48, written: NOTE_MIN + 36, drum: null }),
	{ contains: "#5 o4 l8 q7F v255 y10", lacks: "@0" },
);

// `detectStartingChannel` probes the text for `#0` first, so writing one would
// take `c4 d4` off channel 1 and put it on the channel being drawn on. The songs
// here are `#am4` because AddmusicK refuses notes outside a channel altogether
// (AMK0140, `parser.ts:2880`), which is what makes this shape a legacy one.
expectNoStrip(
	"a channel below the lowest the song declares, with music above the first `#N`",
	"#am4\no4 c4 d4\n#1 o4 e4 f4",
	0,
	"above the first",
);

// The same song from the other side: `#5` never wins the probe, so nothing moves.
expectEdit(
	"a channel above the lowest the song declares, with music above the first `#N`",
	"#am4\no4 c4 d4\n#1 o4 e4 f4",
	5,
	() => ({ kind: "spawn", startTick: 0, ticks: 48, written: NOTE_MIN + 36, drum: null }),
	{ contains: "#5 o4 l8 q7F v255 y10" },
);

// No marker at all means the starting channel is 0 by fallback, and a `#3`
// written anywhere takes every note the song has over to channel 3.
expectNoStrip("a channel opened in a song with no `#N` at all", "#am4\no4 c4 d4", 3, "above the first");

summarise();
