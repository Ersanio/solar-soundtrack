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
import { type PitchSlide, type SongTimeline, walkSong } from "@amk/spc/song-walk";
import { type Command, type TokenIndex, tokenize } from "@amk/tokens";
import { NOTE_NAMES } from "@amk/tokens/commands/units";
import type { Edit } from "@amk/tokens/edits";
import { type TimelineCommand, commandTimeline } from "../web/src/app/state/command-timeline";
import { commandsInForceOf } from "../web/src/app/state/commands-in-force";
import {
	REFUSE_MOVE_BEND,
	REFUSE_MOVE_REMOTE,
	commandMoveRefusal,
	commandMoveTargets,
	nearestTarget,
	planCommandMove,
} from "../web/src/app/editor/views/piano-roll/roll-command-move";
import {
	type EditContext,
	type EditMode,
	type Gesture,
	type Plan,
	REFUSE_BEND_RIDER,
	REFUSE_CLASH,
	REFUSE_CROWDED,
	REFUSE_INSIDE,
	REFUSE_RAMP,
	REFUSE_RANGE,
	REFUSE_ROOM,
	isEdits,
	planGesture,
} from "../web/src/app/editor/views/piano-roll/roll-edit";
import { SEED_SONG, seedEdits, seededChannel } from "../web/src/app/editor/views/piano-roll/roll-seed";
import { planEdits } from "../web/src/app/editor/views/piano-roll/roll-write";
import {
	type ChannelTail,
	type Strip,
	channelStrip,
	channelTails,
	isStrip,
} from "../web/src/app/editor/views/piano-roll/roll-strip";
import { SAMPLE_SONG } from "../web/src/app/state/sample-song";

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
	/**
	 * The one scan of this source, shared by every reader below.
	 *
	 * `planEdits` compares the commands `channelStrip` holds against the ones
	 * {@link Built.inForce} answers with, by object identity. A second `tokenize`
	 * would hand out a second set of objects, every comparison would be false,
	 * and the reach rule would keep every command while looking like it worked.
	 */
	index: TokenIndex;
	/** What the walk had in force at a note, as {@link EditContext.inForce} wants it. */
	inForce: (address: number) => readonly Command[] | null;
}

function build(source: string): Built | string {
	const result = compiler.compile({ source, aramAddress: ARAM, options: OPTIONS });
	if (!result.ok || !result.data) {
		return result.diagnostics
			.filter((d) => d.severity === "error")
			.map((d) => `${d.code} ${d.message}`)
			.join("; ");
	}

	const timeline = walkSong(result.data, ARAM);
	const index = tokenize(source);
	const acting = commandsInForceOf({
		index,
		text: source,
		commands: new Map((result.commandMap ?? []).map((entry) => [entry.address, entry])),
		notes: new Map((result.noteMap ?? []).map((entry) => [entry.address, entry])),
	});
	const walked = new Map(timeline.notes.map((note) => [note.address, note]));

	return {
		result,
		timeline,
		index,
		inForce: (address) => {
			const note = walked.get(address);
			return note === undefined ? null : acting(note);
		},
	};
}

function strip(source: string, built: Built, channel: number): Strip | string {
	const outcome = channelStrip({
		source,
		channel,
		noteMap: built.result.noteMap ?? [],
		timeline: built.timeline,
		index: built.index,
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

/**
 * How long the song plays: its shortest channel that has any.
 *
 * `Music.cpp:3209`, kept by the port as `introTicks + loopTicks` (`index.ts:41-45`)
 * and read by `Playback.durationTicks`. It is what a channel being opened is
 * filled out to, and what {@link Expectation.playsAsLong} pins.
 */
function playable(built: Built): number {
	const stats = built.result.stats;
	return stats ? stats.introTicks + stats.loopTicks : 0;
}

/** Where the song loops back to, or null where it has no `/` at all. */
function introOf(built: Built): number | null {
	const stats = built.result.stats;
	return stats?.hasIntro === true ? stats.introTicks : null;
}

/** Every channel as somewhere rests can be appended, the way the roll builds it. */
function tailsOf(source: string, built: Built): readonly ChannelTail[] {
	return channelTails(source, built.index, built.result.stats?.channelTicks ?? []);
}

interface Expectation {
	/** The text after the edit, for the cases where the spelling is the point. */
	text?: string;
	/** Substrings the result has to contain. */
	contains?: string | readonly string[];
	/** Substrings the result must not contain. */
	lacks?: string | readonly string[];
	/**
	 * The song must play for exactly as long after the edit as before it.
	 *
	 * Opt-in rather than always: drawing at the end of an ordinary channel
	 * lengthens the song by design, and several cases here do. What it pins is a
	 * channel being *opened* — one filled out to the wrong length, or not filled
	 * out at all, makes itself the shortest and takes the rest of the song with it.
	 */
	playsAsLong?: boolean;
	/**
	 * The song must play for exactly this many ticks after the edit.
	 *
	 * What a gesture reaching past the end of the song is pinned by: the note is
	 * only heard if every channel that would cut the song short has been padded
	 * out to meet it, and the text alone cannot say whether they were — a rest
	 * one note too short reads exactly like a rest of the right length.
	 */
	playsFor?: number;
	/**
	 * The song must loop back to the same tick as it did.
	 *
	 * The walk's own `loopTick`, which is the lowest tick any channel reaches its
	 * re-entry point at — so a `/` written one note out of place pulls it down and
	 * this catches it, where comparing the text could not.
	 */
	loopsWhereItDid?: boolean;
	/**
	 * The mode the gesture is planned under, `"insert"` unless a case says otherwise.
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
		playableTicks: playable(before),
		introTicks: introOf(before),
		channels: tailsOf(source, before),
		inForce: before.inForce,
	};
	const plan = planGesture(bar, gesture(bar), expectation.mode ?? "insert");
	const outcome = planEdits(context, plan);
	if (!isEdits(outcome)) {
		check(`${name}: the gesture can be written`, false, outcome.refused);
		return;
	}

	const edits = outcome;

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

	if (expectation.playsAsLong === true) {
		check(
			`${name}: plays for as long as it did`,
			playable(before) === playable(rebuilt),
			`${playable(before)} -> ${playable(rebuilt)} ticks`,
		);
	}

	if (expectation.playsFor !== undefined) {
		check(
			`${name}: plays for ${expectation.playsFor} ticks`,
			playable(rebuilt) === expectation.playsFor,
			`${playable(before)} -> ${playable(rebuilt)} ticks`,
		);
	}

	if (expectation.loopsWhereItDid === true) {
		check(
			`${name}: loops back where it did`,
			before.timeline.loopTick === rebuilt.timeline.loopTick,
			`${before.timeline.loopTick} -> ${rebuilt.timeline.loopTick}`,
		);
	}

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

/** The plan a gesture makes, for the assertions that are about the plan itself. */
function planFor(
	name: string,
	source: string,
	channel: number,
	gesture: (strip: Strip) => Gesture,
	mode: EditMode,
): { plan: Plan; context: EditContext } | null {
	const before = build(source);
	if (typeof before === "string") {
		check(`${name}: compiles to begin with`, false, before);
		return null;
	}

	const bar = strip(source, before, channel);
	if (typeof bar === "string") {
		check(`${name}: the channel can be edited`, false, bar);
		return null;
	}

	const context: EditContext = {
		source,
		strip: bar,
		targetAMKVersion: before.result.stats?.targetAMKVersion ?? 4,
		songTargetProgram: before.result.stats?.songTargetProgram ?? 0,
		playableTicks: playable(before),
		introTicks: introOf(before),
		channels: tailsOf(source, before),
		inForce: before.inForce,
	};
	return { plan: planGesture(bar, gesture(bar), mode), context };
}

/**
 * A gesture the roll must decline: no edit, and a reason.
 *
 * `because` is the sentence the toolbar shows. Pinning it is what proves the
 * refusal reaches the porter: a reason threaded through the wrong branch says
 * the wrong thing about a real refusal, which is worse than the silence it
 * replaces, and no test of "was it refused" can tell the two apart.
 */
function expectRefused(
	name: string,
	source: string,
	channel: number,
	gesture: (strip: Strip) => Gesture,
	mode: EditMode = "insert",
	because?: string,
): void {
	const made = planFor(name, source, channel, gesture, mode);
	if (!made) {
		return;
	}

	const outcome = planEdits(made.context, made.plan);
	check(`${name}: refused`, !isEdits(outcome), "an edit was produced");
	if (because !== undefined && !isEdits(outcome)) {
		check(`${name}: says why`, outcome.refused === because, outcome.refused);
	}
}

/**
 * Which strip items a gesture is carrying, by their `from`.
 *
 * The roll draws these itself, in the preview, and leaves them out of the song's
 * own bars — so this list is what decides whether a dragged note is drawn once
 * or twice. `-1` is a note with no original to leave out: a copy, or one being
 * drawn.
 */
function expectCarried(
	name: string,
	source: string,
	channel: number,
	gesture: (strip: Strip) => Gesture,
	froms: readonly number[],
	because: string | null = null,
	mode: EditMode = "insert",
): void {
	const made = planFor(name, source, channel, gesture, mode);
	if (!made) {
		return;
	}

	const carried = made.plan.touched.map((note) => note.from).sort((a, b) => a - b);
	const want = [...froms].sort((a, b) => a - b);
	check(
		`${name}: carries ${JSON.stringify(want)}`,
		carried.length === want.length && carried.every((from, at) => from === want[at]),
		JSON.stringify(carried),
	);
	check(
		`${name}: ${because === null ? "is not refused" : `refused — ${because}`}`,
		made.plan.refused === because,
		String(made.plan.refused),
	);
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

/**
 * Every tick a command with this written text runs at on this channel.
 *
 * Read off the walk rather than off `commandTimeline`: a command moved onto a
 * note's own tick leaves the lane by construction, and what a move is answerable
 * for is where the driver reads it and not where it is drawn.
 */
function commandTicks(built: Built, source: string, channel: number, written: string): number[] {
	const spans = new Map((built.result.commandMap ?? []).map((entry) => [entry.address, entry.span]));
	const ticks: number[] = [];
	for (const run of built.timeline.commands) {
		const span = spans.get(run.address);
		if (span !== undefined && run.channel === channel && source.slice(span.start, span.end) === written) {
			ticks.push(run.tick);
		}
	}

	return ticks.sort((a, b) => a - b);
}

/** The lane as the roll draws it, which is the list a drag picks its glyph out of. */
function laneOf(built: Built): readonly TimelineCommand[] {
	return commandTimeline({
		timeline: built.timeline,
		index: built.index,
		commands: new Map((built.result.commandMap ?? []).map((entry) => [entry.address, entry])),
	});
}

interface MoveExpectation {
	/** The tick the command has to run at afterwards, which is the whole point. */
	tick: number;
	/** The text after the move, for the case where byte-identity is what is pinned. */
	text?: string;
	contains?: string | readonly string[];
	lacks?: string | readonly string[];
	loopsWhereItDid?: boolean;
}

/**
 * A lane glyph dragged to a tick and let go.
 *
 * Checked the way every other gesture here is — the text is compiled and read
 * back — but against a stronger claim, because a move touches no note at all:
 * the channel has to play exactly what it played, so `played` is compared before
 * against after rather than against a plan, and the song's length with it. A
 * move that shifted one note would be a move that had rewritten something it was
 * never asked to.
 */
function expectMove(
	name: string,
	source: string,
	channel: number,
	written: string,
	toTick: number,
	expectation: MoveExpectation,
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

	const glyphs = laneOf(before).filter(
		(event) => source.slice(event.command.span.start, event.command.span.end) === written,
	);
	if (glyphs.length !== 1) {
		check(`${name}: the lane draws ${written} exactly once`, false, `${glyphs.length} of them`);
		return;
	}

	const glyph = glyphs[0];
	const target = nearestTarget(commandMoveTargets(bar), toTick);
	if (target === null) {
		check(`${name}: there is somewhere to drop it`, false, "the channel offered no target");
		return;
	}

	const outcome = planCommandMove(source, bar, glyph.command, glyph.tick, target);
	if (!isEdits(outcome)) {
		check(`${name}: the move can be written`, false, outcome.refused);
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

	// Through the tie fold, so a command taken out from between a note's head and
	// its `^` — which leaves the two to be folded into one note map entry — reads
	// as the one note it always sounded like.
	check(
		`${name}: moves no note`,
		played(before, channel).join(" | ") === played(rebuilt, channel).join(" | "),
		`${played(before, channel).join(" | ")}\n        -> ${played(rebuilt, channel).join(" | ")}`,
	);
	check(
		`${name}: leaves the other channels alone`,
		others(before, channel) === others(rebuilt, channel),
		`${others(before, channel)} -> ${others(rebuilt, channel)}`,
	);
	check(
		`${name}: plays for as long as it did`,
		playable(before) === playable(rebuilt),
		`${playable(before)} -> ${playable(rebuilt)} ticks`,
	);

	const ticks = commandTicks(rebuilt, after, channel, written);
	check(
		`${name}: runs at tick ${expectation.tick}`,
		ticks.length === 1 && ticks[0] === expectation.tick,
		`${JSON.stringify(ticks)} ${JSON.stringify(after)}`,
	);

	if (expectation.loopsWhereItDid === true) {
		check(
			`${name}: loops back where it did`,
			before.timeline.loopTick === rebuilt.timeline.loopTick,
			`${before.timeline.loopTick} -> ${rebuilt.timeline.loopTick}`,
		);
	}

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

/** A command the move declines to carry, on a channel that can otherwise be edited. */
function expectNoMove(name: string, source: string, channel: number, written: string, because: string): void {
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

	const command = before.index.commands.find((each) => source.slice(each.span.start, each.span.end) === written);
	if (command === undefined) {
		check(`${name}: the scan holds ${written}`, false, "it does not");
		return;
	}

	check(
		`${name}: refused — ${because}`,
		commandMoveRefusal(bar, command) === because,
		String(commandMoveRefusal(bar, command)),
	);
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
// A subloop written as hex. The walk catches this one too where it lies inside
// the pass, but a subloop past the shortest channel has no played note to
// disagree with, so the gate has to name it in its own right.
expectNoStrip("a hex subloop", "#amk 2\n#0 o4 c4 $E6 $00 d4 $E6 $01 e4", 0, "$E6");
expectNoStrip("a hex subloop past the end of the pass", "#amk 2\n#0 o4 c4 $E6 $00 d4 $E6 $01 e4\n#1 o4 g4", 0, "$E6");
// A `&` is an operator, so `gather` raises no command for it and the scanner
// cannot say which channel it is on — one anywhere refuses all eight, which the
// second case is what pins. Normalize's `writePitchSlides` is the way out: it
// writes the `$DD` the `&` compiles to, byte for byte (`normalizetest`), and a
// channel using that form is editable, which the "a pitch slide" section below
// is what pins. Neither half is worth much without the other.
expectNoStrip("a legacy pitch slide", "#amk 2\n#0 o4 c4 & d4", 0, "`&`");
expectNoStrip("a legacy pitch slide on another channel", "#amk 2\n#0 o4 c4 & d4\n#1 o4 e4 f4", 1, "`&`");
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

// A remote definition can only sit above the first `#N` (Music.cpp:1015), so its
// `[ ]` gathers on the starting channel — but the body runs only where the `$FC`
// fires it, and channel 0 must stay editable.
expectEdit(
	"a channel under a remote code definition",
	"#amk 2\n(!1)[$F4 $02]\n#0 o4 c4 (!1, 1, 8) d4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 1)], deltaTicks: 0, deltaKeys: 2, copy: false }),
	{ contains: ["(!1)[$F4 $02]", "(!1, 1, 8)"] },
);
// A `[ ]` up there that no `(!n)` armed is the starting channel's own music, and
// still plays what is written in it more than once.
expectNoStrip("a loop above the first marker", "#amk 2\n[$F4 $02]2\n#0 o4 c4 d4", 0, "`[`");

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

// A unit swallows the `o` written beside its head and the one written after its
// tail (`roll-strip.ts:growUnits`), so removing one removes what put the octave
// in force for every note after it. The octave goes back at the head of the note
// that reads it, and only where the one standing is not already the one wanted —
// which is what this first case pins, since `o4` still stands over `e4`.
expectEdit("a note deleted", "#amk 2\n#0 o4 c4 d4 e4", 0, (bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }), {
	text: "#amk 2\n#0 o4 c4 r4 e4",
});

expectEdit(
	"a note deleted from under the octave the note after it reads",
	"#amk 2\n#1 l8\n@8\ny10\nq4f\n\n r4. o2 a8 d8 o3 d8\n",
	1,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0)] }),
	{ contains: "o2 d8" },
);

// The `o3` here is `c4`'s own trailing octave restore — the `r4` between it and
// `d4` keeps `d4`'s left scan off it — and it is inside `c4`'s unit and goes
// with it.
expectEdit(
	"a note deleted with the octave written after it",
	"#amk 2\n#0 o5 c4 o3 r4 d4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0)] }),
	{ contains: "o3 d4" },
);

// Once, however many notes went: it is the note that reads the octave that asks
// for it, rather than each note that dropped one.
expectEdit(
	"two notes deleted in front of one that reads their octave",
	"#amk 2\n#0 o4 c4 o5 d4 o6 e4 f4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1), noteAt(bar, 2)] }),
	{ contains: "o6 f4", lacks: "o6 o6" },
);

expectEdit(
	"two notes deleted with one left standing between them",
	"#amk 2\n#0 o4 c4 o5 d4 e4 o6 f4 g4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1), noteAt(bar, 3)] }),
	{ contains: ["o5 e4", "o6 g4"] },
);

expectEdit(
	"a note deleted where the note after it writes its own octave",
	"#amk 2\n#0 o4 c4 o5 d4 o3 e4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ lacks: "o5" },
);

// `octave` is global parser state and leaks past a `#N`, so a channel with no
// note left to hand its octave to keeps it where the last unit was — otherwise
// the `f4`s below move down two octaves, which is what "leaves the other
// channels alone" catches.
expectEdit(
	"notes deleted off the end of a channel the block below reads the octave of",
	"#amk 2\n#0 o4 c4 o5 d4 o6 e4\n#1 f4 f4 f4\n",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1), noteAt(bar, 2)] }),
	{ contains: "o4 c4 o6", lacks: "o5" },
);

expectEdit(
	"every note in a channel deleted",
	"#amk 2\n#0 o4 c4 o5 d4 o6 e4\n#1 f4 f4 f4\n",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0), noteAt(bar, 1), noteAt(bar, 2)] }),
	{ contains: "#0 o6", lacks: ["o4", "o5"] },
);

// A gap is realised over **runs** of rests rather than over one rest at a time,
// so a note deleted from between two of them leaves the one rest they now are.
// `note rest note rest` is the commonest shape a channel has, and every case
// here is checked by compiling and walking the result rather than by the text
// alone: `r4.` and `r4 r8` sound identical and only the text tells them apart.
expectEdit(
	"a note deleted from between two rests",
	"#amk 2\n#0 o4 c8 r8 d8 r8 e8",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c8 r4. e8" },
);

// Touching already, and still one rest afterwards: the run is being rewritten
// either way, and leaving `r4 r8` behind is the thing this is for.
expectEdit(
	"two rests already touching in a gap being rewritten",
	"#amk 2\n#0 o4 c8 r8 r8 d8 e8",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c8 r4. e8" },
);

// A run stops at anything that carries a position. The `v200` is two rests'
// distance from the note it was written for and stays there.
expectEdit(
	"a command written between the two rests",
	"#amk 2\n#0 o4 c8 r8 v200 d8 r8 e8",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c8 r4 v200 r8 e8" },
);

// The intro marker most of all: every channel resumes from its own on each pass
// (`parser.ts:parseIntro`), so a `/` swallowed into a merged rest moves the
// whole song's loop point — which is what `loopsWhereItDid` catches and what
// reading the text could not.
expectEdit(
	"the intro marker written between the two rests",
	"#amk 2\n#0 o4 c8 r8 / d8 r8 e8\n#1 o4 c8 r8 / d8 r8 e8",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c8 r4 / r8 e8\n#1 o4 c8 r8 / d8 r8 e8", loopsWhereItDid: true },
);

// And a gap whose ticks do not change is not rewritten at all, so two rests the
// porter wrote touching are only ever joined by a gesture that had to move them.
expectEdit(
	"two rests the porter wrote touching in a gap that does not move",
	"#amk 2\n#0 o4 c4 r4 r4 d4 e4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 2)], deltaTicks: 48, deltaKeys: 0, copy: false }),
	{ text: "#amk 2\n#0 o4 c4 r4 r4 d4 r4 e4" },
);

// The tail is the one stretch nothing rewrites — a channel may end wherever its
// music ends — so the run collapsed there is only the one this gesture joined.
expectEdit(
	"the last note deleted from between two trailing rests",
	"#amk 2\n#0 o4 c8 r8 d8 r8\n#1 o4 c2",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c8 r4\n#1 o4 c2" },
);

expectEdit(
	"trailing rests the porter wrote touching",
	"#amk 2\n#0 o4 c8 d8 r8 r8\n#1 o4 c2",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 0)] }),
	{ contains: "r8 r8" },
);

// `octave` is global parser state and leaks past a `#N`, so the last note off a
// channel leaves what it put in force where its unit was — which lands between
// the two removals a merged tail makes, and `coalesce` reads it in that order.
// `#1` writes no octave of its own, so "leaves the other channels alone" is what
// catches it going astray.
expectEdit(
	"the octave a deleted last note left, across a merged tail",
	"#amk 2\n#0 o4 c8 r8 o5 d8 r8\n#1 c8 c8 c8 c8",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c8 r4 o5\n#1 c8 c8 c8 c8" },
);

// `spellDuration` has `=ticks` for a length with no divisor and no dotted
// spelling, so a run comes to one rest however long it is.
expectEdit(
	"a run of three rests becoming one",
	"#amk 2\n#0 o4 c8 r8 d8 r8 e8 r8 f8",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1), noteAt(bar, 2)] }),
	{ text: "#amk 2\n#0 o4 c8 r=120 f8" },
);

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

// A note drawn at the octave already standing spells none of its own. What is in
// force is the previous note's own byte, carried over text that moves it nowhere.
expectEdit(
	"a note drawn at the octave already standing",
	"#amk 2\n#0 o4 c4 r2 d4",
	0,
	() => ({ kind: "spawn", startTick: 72, ticks: 24, written: NOTE_MIN + 36 + 4, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 r8 e8 r4 d4" },
);

// And a `>` between the two does move it, so the note spells one after all —
// which is the whole of what the scan over the gap is for. `d4` is left alone:
// the `>` had already put it in the octave the run leaves.
expectEdit(
	"a note drawn past an octave shift written in the gap",
	"#amk 2\n#0 o4 c4 > r2 d4",
	0,
	() => ({ kind: "spawn", startTick: 72, ticks: 24, written: NOTE_MIN + 48 + 4, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 > r8 o5 e8 r4 d4" },
);

// A run leaves its own octave standing, so the note that reads it is handed the
// one it was written under — at its own head, where the text settles anyway.
// The whole channel below would move with the drawn note otherwise.
expectEdit(
	"a note drawn an octave above the one after it",
	"#amk 2\n#0 o4 c4 r2 d4",
	0,
	() => ({ kind: "spawn", startTick: 72, ticks: 24, written: NOTE_MIN + 48, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 r8 o5 c8 r4 o4 d4" },
);

// The head is also past any `>`, which is not a command to the scanner at all —
// nothing can say which side of the run one written in the gap sits on, so the
// note after it is given its own octave rather than the run putting one back.
expectEdit(
	"a note drawn an octave above, before an octave shift",
	"#amk 2\n#0 o4 c4 r2 > d4",
	0,
	() => ({ kind: "spawn", startTick: 72, ticks: 24, written: NOTE_MIN + 48, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 r8 o5 c8 r4 > o5 d4" },
);

expectEdit(
	"a note drawn an octave above one that sets its own",
	"#amk 2\n#0 o4 c4 r2 o5 d4",
	0,
	() => ({ kind: "spawn", startTick: 72, ticks: 24, written: NOTE_MIN + 48, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 r8 o5 c8 r4 o5 d4" },
);

// Nothing between the two notes to write over, so the run is inserted at the
// head of the one it is drawn in front of and the octave lands on the same
// offset, which `coalesce` joins in the order the two were read.
expectEdit(
	"a note drawn an octave above, straight in front of another",
	"#amk 2\n#0 o4 c4 d4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 48, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 o5 c4 o4 d4" },
);

// `octave` is global parser state and leaks past a `#N`, so a run with no note
// left to hand it to carries it itself — which `#1`, whose notes write no octave
// of their own, is what catches.
expectEdit(
	"a note drawn an octave above at the end of a channel",
	"#amk 2\n#0 o4 c4 r4\n#1 c4 c4 c4 c4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 48, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 o5 c4 o4\n#1 c4 c4 c4 c4" },
);

// A drum's lane is its instrument and it writes no octave at all, so there is
// nothing standing for the note after it to be given back.
expectEdit(
	"a drum drawn in front of another",
	"#amk 2\n#6 @21 c8 r8 @22 c8",
	6,
	() => ({ kind: "spawn", startTick: 24, ticks: 24, written: NOTE_MIN + 48, drum: 23 }),
	{ lacks: "o" },
);

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

// --- insert mode: the notes in the way move aside --------------------------

console.log("\ninsert");
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

// --- overwrite mode: the notes already there give up the ticks -------------
//
// Every case here pins `playsAsLong`, and that is the point of the mode rather
// than a detail of it: a carve only ever takes ticks that were already the
// channel's, so the song has to be exactly as long afterwards. A carve that
// lengthened the song would mean `reach` had counted a note nothing moved.

console.log("\noverwrite");
expectEdit(
	"a note dragged onto the one after it, which gives up its head",
	"#amk 2\n#0 o4 c4 d4 e4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 24, deltaKeys: 0, copy: false }),
	{ mode: "overwrite", playsAsLong: true, contains: "d8" },
);

expectEdit(
	"a note dragged over one that gives up all of them",
	"#amk 2\n#0 o4 c4 d4 e4 f4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 48, deltaKeys: 0, copy: false }),
	{ mode: "overwrite", playsAsLong: true, lacks: "d" },
);

// --- a note carried *past* another ------------------------------------------
//
// The text is a sequence and a channel's positions are the running sum of its
// durations, so a note that crosses another has to be written somewhere else
// entirely: its unit comes out and it goes back in on the far side. Nothing but
// `plays what the plan said` catches a failure here — the text of a channel
// whose notes have all slid along reads perfectly well, and only walking it
// says they are on the wrong ticks.

expectEdit(
	"a note dragged right past the one after it",
	"#amk 2\n#0 o4 c8 d8 e8",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 48, deltaKeys: 0, copy: false }),
	// The whole shape of the fix in one line: `c8`'s unit is gone from the front,
	// a rest stands where it was, `d8` is handed back the `o4` that left with it,
	// and `c8` is written again on the far side. `e8` gave up all its ticks to it.
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 r8 o4 d8 c8" },
);

// The channel really is shorter afterwards, and that is not the carve: the last
// note is the one that moved, and it took the end of the channel with it. Only
// `c8`, which it landed on, gave up any ticks. `playsFor` rather than
// `playsAsLong` for that reason — the mode's promise is about what a carve
// costs, and a note leaving the end is a move.
expectEdit(
	"a note dragged left past the one before it",
	"#amk 2\n#0 o4 c8 d8 e8",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 2)], deltaTicks: -48, deltaKeys: 0, copy: false }),
	// One `o4` for the channel, and the run writes it. Both writers have a reason
	// to put another at `d8`'s head — the run leaves an octave standing, and the
	// main loop watched the unit carrying the channel's own `o4` be removed — and
	// neither does: it is already the octave `d8` was written under.
	{ mode: "overwrite", playsFor: 48, text: "#amk 2\n#0 o4 e8 d8" },
);

// A note still ending the channel holds its length, and then the crossing costs
// it nothing: `e8` goes to the front over `c8`, and the gap it left is a rest.
expectEdit(
	"a note dragged left past the one before it, with a note still ending the channel",
	"#amk 2\n#0 o4 c8 d8 e8 f8",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 2)], deltaTicks: -48, deltaKeys: 0, copy: false }),
	{ mode: "overwrite", playsAsLong: true },
);

expectEdit(
	"a note dragged past two of them at once",
	"#amk 2\n#0 o4 c8 d8 e8 f8 r2",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 72, deltaKeys: 0, copy: false }),
	{ mode: "overwrite", playsAsLong: true },
);

// Overwrite is where it is easy to reach, but the hole is in the writer, which
// every mode shares: a jump into free space clashes with nothing, so strict says
// yes to it too.
expectEdit(
	"a note dragged past another into free space, in strict",
	"#amk 2\n#0 o4 c8 d8 r4 e8",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 48, deltaKeys: 0, copy: false }),
	{ mode: "strict", playsAsLong: true },
);

// And insert, which pushes only what the drag lands on: a drag that clears its
// neighbour lands on nothing, so there is nothing to push and it commits the
// crossing like the other two. The hole was never in the modes — it was in the
// writer all three of them share.
expectEdit(
	"a note dragged past another into free space, inserting",
	"#amk 2\n#0 o4 c8 d8 r4 e8",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 48, deltaKeys: 0, copy: false }),
	{ mode: "insert", playsAsLong: true },
);

// Carried past another *and* past the end of the song, so the note that moved
// still has to pad every other channel out to meet it. `reach` reads the plan's
// own `touched`, which the lifting-out does not disturb — and `playsFor` is the
// only reading that catches a rest of the wrong length.
expectEdit(
	"a note carried past another and past the end of the song",
	"#amk 2\n#0 o4 c8 d8\n#1 o4 c8 d8\n",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 72, deltaKeys: 0, copy: false }),
	{ mode: "overwrite", playsFor: 96 },
);

// A crossing and a carve in the one gesture: `c8` passes over `d8` and lands on
// the head of `e4`.
expectEdit(
	"a note dragged past one note and onto the next",
	"#amk 2\n#0 o4 c8 d8 e4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 60, deltaKeys: 0, copy: false }),
	{ mode: "overwrite", playsAsLong: true },
);

// The whole selection crosses, so every one of them has to be written again.
expectEdit(
	"two notes dragged past a third together",
	"#amk 2\n#0 o4 c8 d8 e8 r2",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0), noteAt(bar, 1)],
		deltaTicks: 72,
		deltaKeys: 0,
		copy: false,
	}),
	{ mode: "overwrite", playsAsLong: true },
);

// A crossing keeps the note's own drum, since the lane is the instrument rather
// than the pitch and the `@21` travels with it.
expectEdit(
	"a drum dragged past the note after it",
	"#amk 2\n#0 o4 @21 c8 @0 o4 d8 e8",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 48, deltaKeys: 0, copy: false }),
	{ mode: "overwrite", playsAsLong: true, contains: "@21" },
);

expectEdit(
	"a note stretched into the one after it, which gives up its head",
	"#amk 2\n#0 o4 c4 d4 e4",
	0,
	(bar) => ({ kind: "stretch", items: [noteAt(bar, 0)], edge: "end", deltaTicks: 24 }),
	{ mode: "overwrite", playsAsLong: true, contains: ["c4.", "d8"] },
);

expectEdit(
	"a note stretched over the one after it, which gives up all of them",
	"#amk 2\n#0 o4 c4 d4 e4",
	0,
	(bar) => ({ kind: "stretch", items: [noteAt(bar, 0)], edge: "end", deltaTicks: 48 }),
	{ mode: "overwrite", playsAsLong: true, contains: "c2", lacks: "d" },
);

// The carve has no direction of its own — a push has to pick one and keep it,
// where this takes the ticks wherever the placed note landed on them.
expectEdit(
	"a left edge pulled back into the note before it, which gives up its tail",
	"#amk 2\n#0 o4 c4 d4 e4",
	0,
	(bar) => ({ kind: "stretch", items: [noteAt(bar, 1)], edge: "start", deltaTicks: -24 }),
	{ mode: "overwrite", playsAsLong: true, contains: ["c8", "d4."] },
);

// The `placed` set, which is `push`'s `fixed` set by another name: the two
// notes being dragged overlap nothing of each other's, and only the note they
// land on gives anything up.
expectEdit(
	"a selection dragged onto an outsider, which alone gives up ticks",
	"#amk 2\n#0 o4 c8 d8 r4 e8",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0), noteAt(bar, 1)],
		deltaTicks: 60,
		deltaKeys: 0,
		copy: false,
	}),
	{ mode: "overwrite", playsAsLong: true },
);

// The case the mode turns on: only the ticks under the note are lost, so what
// the note landed inside comes back as a head and a tail. The tail is a note
// being created — `plays what the plan said` is the proof, since the plan asks
// for two notes at that pitch and the note map has to read back as two.
expectEdit(
	"a note drawn inside a longer one, which survives either side of it",
	"#amk 2\n#0 o4 c1 d4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 4, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 c4 e4 c2 d4" },
);

// And the tail spells its own octave, because the note that split it moved the
// one in force. The note after the run reads what it always read, so nothing is
// put back at its head.
expectEdit(
	"a split whose tail has to spell the octave back",
	"#amk 2\n#0 o4 c1 d4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 48 + 7, drum: null }),
	{
		mode: "overwrite",
		playsAsLong: true,
		text: "#amk 2\n#0 o4 c4 o5 g4 o4 c2 d4",
	},
);

expectEdit(
	"a note drawn exactly over one, which gives up all its ticks",
	"#amk 2\n#0 o4 c4 d4 e4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 c4 g4 e4" },
);

// The octave put back goes at the head of the next *surviving* note. The note
// this same gesture removed is the first note item in the region, and an `o`
// written at its head is an edit inside a range being deleted — two edits over
// one run of text, which is what `planEdits` refuses outright.
expectEdit(
	"a note drawn an octave up over one, with the octave put back after it",
	"#amk 2\n#0 o4 c4 d4 e4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 48 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 c4 o5 g4 o4 e4" },
);

// A copy dropped on its own original: the original is not one of the notes the
// gesture is placing, so it is a victim like any other and gives up everything.
expectEdit(
	"a copy dropped on its own original, which it replaces",
	"#amk 2\n#0 o4 c4 d4",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 0, deltaKeys: 0, copy: true }),
	{ mode: "overwrite", playsAsLong: true },
);

// The `reach` guard. Every piece a carve leaves sits at a tick the channel had
// already reached, so none of them may pad the song: the tail here ends at 288
// in a song that plays 192, and counting it would drag `#1` out to meet a note
// nothing had moved. `playsAsLong` is the only reading that catches it — the
// text of `#1` looks equally plausible either way.
expectEdit(
	"a split out past the end of the song, which does not lengthen it",
	"#amk 2\n#0 o4 c2 c1\n#1 o4 c1",
	0,
	() => ({ kind: "spawn", startTick: 120, ticks: 72, written: NOTE_MIN + 36 + 4, drum: null }),
	{ mode: "overwrite", playsAsLong: true, contains: "c8 e4. c2" },
);

// Where the run lands relative to the intro marker. The `/` stands on the
// boundary the note before the region meets it at, and the run goes after it —
// written in front, the marker would come out a whole region late and every
// channel resumes from its own on each pass.
//
// The one channel is the point: `loopTick` is the *lowest* tick any channel
// re-enters at, so a second channel marked at 96 would hold the reading down at
// 96 and hide a marker that had slipped to 144. Alone, the edited channel is
// what sets it, and the song plays for the same 192 either way — which is what
// makes this the only reading that catches it.
expectEdit(
	"a note drawn over the one after the intro marker",
	"#amk 2\n#0 o4 c4 d4 / e4 f4",
	0,
	() => ({ kind: "spawn", startTick: 96, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{
		mode: "overwrite",
		playsAsLong: true,
		loopsWhereItDid: true,
		contains: "/ g4 f4",
	},
);

// A carve through the *tail* of a note with a command written inside it is
// fine: the note keeps its start, so the ramp keeps the tick it was written at
// and only the last continuation is shortened.
expectEdit(
	"a note drawn over the tail of one with a command written inside it",
	"#amk 2\n#0 o4 c4 v200 ^4 d4",
	0,
	() => ({ kind: "spawn", startTick: 72, ticks: 48, written: NOTE_MIN + 36 + 4, drum: null }),
	{ mode: "overwrite", playsAsLong: true, contains: ["v200", "^8"] },
);

// A carve that swallows every note leaves one region over the whole channel,
// with no surviving note for the run to be written in front of and every item in
// it a unit being removed. The run goes after the last of them: at a head it
// would land strictly inside a range `removeItem` is deleting, and two edits over
// one run of text is what `planEdits` refuses. Nothing is put back after it
// either, since the run spells the octave it leaves.
expectEdit(
	"a note drawn over every note of a channel",
	"#amk 2\n#0 o4 c4 d4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 96, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 g2" },
);

// And the command written between two notes it swallows is deleted with the
// note it defined: an erased note takes its `'note-state'` declarations with
// it, and the replacement inherits nothing.
expectEdit(
	"a note drawn over every note of a channel, past a command written between them",
	"#amk 2\n#0 o4 c4 v200 d4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 96, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 g2" },
);

// Mid-channel, where the region is bounded either side, the `v200` is the second
// swallowed note's declaration and `f4` still plays under it, so the run laid
// over both notes writes it out again on its own tick — which splits the drawn
// note into a head and a `^`, and a tie is still one note.
expectEdit(
	"a note drawn over two notes with a command written between them",
	"#amk 2\n#0 o4 c4 d4 v200 e4 f4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 96, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 c4 g4 v200 ^4 f4" },
);

// The one thing that is put back when the whole channel goes: `octave` is global
// parser state and leaks past a `#N`, so a run that leaves a different one than
// the channel did says so at the end.
expectEdit(
	"a note drawn an octave up over every note of a channel",
	"#amk 2\n#0 o4 c4 v200 d4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 96, written: NOTE_MIN + 48 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o5 g2 o4" },
);

// --- a removed item's commands are kept where something still plays under them ---------------------
//
// A `'note-state'` command written to run just before an item the gesture removes — its
// declaration — is dropped only where nothing in the edited song sounds under it. A surviving note
// counts and so does one the gesture is drawing, so the spot keeps its dynamics and what changed is
// which note sits there. The gesture is no part of the question: a Backspace and a note drawn over
// the top get the same answer.
//
// A kept command is left exactly where it was written. Only a run laid over the text that holds it
// has to move it, and there it is written out again on its own tick — which splits the note it
// lands inside into a head and a `^`.
//
// Song-wide commands, `o`/`l`, the intro `/` and the prefix of a channel's first item are outside
// the rule and always stay put, and an item only partly covered keeps everything.

// The reporting song: the drawn note begins on `y0`'s own tick and sounds under it, so `y0` stays
// exactly where it was written. The rest before it is not reached and keeps its bytes.
expectEdit(
	"a note drawn over the whole of one whose declaration stands at its head",
	"#amk 2\n\n#3 q7F\nl32 @17\no5 v85y20r16y0a^=1",
	3,
	() => ({ kind: "spawn", startTick: 12, ticks: 24, written: NOTE_MIN + 48 + 10, drum: null }),
	{
		mode: "overwrite",
		playsFor: 36,
		text: "#amk 2\n\n#3 q7F\nl32 @17\no5 v85y20r16y0 o5 a+8",
	},
);

// The symmetry the rule is for. Backspace on the last note leaves nothing to sound under its
// `v200`, so the command goes with it...
expectEdit(
	"a note deleted with nothing left to sound under its declaration",
	"#amk 2\n#0 o4 c4 v200 d4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c4" },
);

// ...and Backspace on the same note with one after it keeps the `v200` exactly where it was
// written, because `e4` still plays under it. The gesture is the same; the song is what differs.
expectEdit(
	"a note deleted with one after it still sounding under its declaration",
	"#amk 2\n#0 o4 c4 v200 d4 e4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ playsAsLong: true, text: "#amk 2\n#0 o4 c4 v200 r4 e4" },
);

// And the same note drawn over rather than deleted: one answer, not two.
expectEdit(
	"a note drawn over one whose declaration something after it still sounds under",
	"#amk 2\n#0 o4 c4 v200 d4 e4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 c4 v200 g4 e4" },
);

// The mirror shape: the erased note's neighbour is a rest with a declaration of
// its own, and the run stops short of both. The `v200` is the rest's, not the
// erased note's, and the rest was never reached.
expectEdit(
	"a note drawn over the whole of one, leaving the rest after it its declaration",
	"#amk 2\n#0 o4 c4 v200 r4 d4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 g4 v200 r4 d4" },
);

// A rest is asked the same question as a note — read off tick geometry rather than the carve, since
// `plan.erased` never names a rest — and here `d4` still plays under the `v200`, so it stays and the
// note drawn over the rest begins on its tick and sounds under it too.
expectEdit(
	"a note drawn over the whole of a rest with a declaration at its head",
	"#amk 2\n#0 o4 c4 v200 r4 d4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 c4 v200 g4 d4" },
);

// And a rest whose `v200` really does reach nothing: the run starts before the command's own tick,
// so the note drawn over it does not begin under it and there is nothing after it that does.
expectEdit(
	"a note drawn over a rest and the note in front of it, taking the rest's declaration",
	"#amk 2\n#0 o4 c4 v200 r4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 96, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 g2" },
);

// A `t` acts on the song and not on the note in front of it, so it is never a declaration to drop —
// and the `y0` beside it is one `e4` still plays under.
expectEdit(
	"a note drawn over the whole of one with a tempo at its head",
	"#amk 2\n#0 o4 c4 t60 y0 d4 e4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, contains: ["t60", "y0"] },
);

// The slot changing hands is where a command stops reaching, and the walk is what says so rather
// than a table restated here: `e4` plays under the `y15`, not the `y0`, so deleting `d4` takes the
// `y0` and leaves the `y15` alone.
expectEdit(
	"a note deleted whose declaration is replaced before the next note",
	"#amk 2\n#0 o4 c4 y0 d4 y15 e4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ playsAsLong: true, text: "#amk 2\n#0 o4 c4 r4 y15 e4" },
);

// The channel's first item keeps its prefix even erased: what stands above the
// first note or rest is the channel's setup rather than its declaration.
expectEdit(
	"a note drawn over the whole of a channel's first note, under its setup",
	"#amk 2\n#0 v200 c4 d4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, contains: "v200" },
);

// Two erased notes, two declarations, both still reaching `f4`. The `v200` stands on the tick the
// run begins at and stays put; the `y15` stands inside it and is written out again there.
expectEdit(
	"a note drawn over two notes that each carry a declaration",
	"#amk 2\n#0 c4 v200 d4 y15 e4 f4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 96, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 c4 v200 g4 y15 ^4 f4" },
);

// Two of them inside the one run, so the drawn note is split twice — and `played` folds the ties
// back, which is what says the three pieces are still one note of 144 ticks.
expectEdit(
	"a note drawn over three notes that each carry a declaration",
	"#amk 2\n#0 c4 v200 d4 y15 e4 v100 f4 g4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 144, written: NOTE_MIN + 36 + 7, drum: null }),
	{
		mode: "overwrite",
		playsAsLong: true,
		text: "#amk 2\n#0 c4 v200 g4 y15 ^4 v100 ^4 g4",
	},
);

// The gate is coverage, not the spawn gesture: a note dragged wholly onto another removes it the
// same way, and its `v200` is kept for the same reason — `e4` still plays under it.
expectEdit(
	"a note dragged wholly onto the next, which carries a declaration",
	"#amk 2\n#0 o4 c4 v200 d4 e4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0)],
		deltaTicks: 48,
		deltaKeys: 0,
		copy: false,
	}),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 r4 o4 c4 v200 e4" },
);

// A command written *inside* a note — between its head and a `^` continuation — is inside the span
// `removeItem` splices, so it goes with the note unless something is put in its way. Here nothing
// plays under it once the note is gone, so it is meant to go.
expectEdit(
	"a note deleted with a command inside it that reaches nothing",
	"#amk 2\n#0 o4 c4 d4 v200 ^4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c4" },
);

// The same note with a run being laid over its ticks: the run writes the command out again on its
// own tick, so the drawn note is split there.
expectEdit(
	"a note drawn over one with a command inside it",
	"#amk 2\n#0 o4 c4 d4 v200 ^4 e4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 96, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 c4 g4 v200 ^4 e4" },
);

// A command in a channel the walk could not reach is never dropped: `walkSong` ends the pass at the
// shortest channel, so `#0`'s `d4` has no note to check against and "nothing sounds under it" is a
// thing this cannot know. `#1` is what holds the pass short.
expectEdit(
	"a note deleted past the end of the pass, with a declaration at its head",
	"#amk 2\n#0 o4 c4 v200 d4\n#1 o4 c4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	{ text: "#amk 2\n#0 o4 c4 v200\n#1 o4 c4" },
);

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
	REFUSE_CLASH,
);

// The gesture the mode inverts: this is what `insert` pushes through, in the
// stretch case above.
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

// The one place overwrite is the stricter of the two: both notes are the
// gesture's own, so neither may eat the other and the overlap stands. Insert
// compounds the pushes here instead.
expectRefused(
	"two touching notes stretched into each other, overwriting",
	"#amk 2\n#0 o4 c8 d8 r2",
	0,
	(bar) => ({
		kind: "stretch",
		items: [noteAt(bar, 0), noteAt(bar, 1)],
		edge: "end",
		deltaTicks: 24,
	}),
	"overwrite",
);

// The other end of the same note is refused, and the reason is the command
// rather than the carve: the note would keep the ticks it kept but start later,
// so the `v200` written inside it would fire later than it was written to.
expectRefused(
	"a note drawn over the head of one with a command written inside it",
	"#amk 2\n#0 o4 c4 v200 ^4 d4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 24, written: NOTE_MIN + 36 + 4, drum: null }),
	"overwrite",
	REFUSE_INSIDE,
);

// The one refusal whose reason really is the length: the note is being cut to
// less than the ticks its first segment already holds, so the `v200` written
// after them has nowhere left inside the note to fire.
expectRefused(
	"a note with a command inside it shortened to less than its head",
	"#amk 2\n#0 o4 c4 v200 ^4 d4",
	0,
	(bar) => ({
		kind: "stretch",
		items: [noteAt(bar, 0)],
		edge: "end",
		deltaTicks: -72,
	}),
	"overwrite",
	REFUSE_RAMP,
);

expectRefused(
	"quantize pulling two notes onto one beat, overwriting",
	"#amk 2\n#0 o4 c16 d16 r2",
	0,
	(bar) => ({ kind: "quantize", items: [noteAt(bar, 0), noteAt(bar, 1)], snap: 48 }),
	"overwrite",
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

expectRefused(
	"a note dragged off the bottom of the driver's range",
	"#amk 2\n#0 o1 c4 d4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0)],
		deltaTicks: 0,
		deltaKeys: -12,
		copy: false,
	}),
	"insert",
	REFUSE_RANGE,
);

expectRefused(
	"a stretch with nowhere to push",
	"#amk 2\n#0 o4 c4 d4",
	0,
	(bar) => ({
		kind: "stretch",
		items: [noteAt(bar, 1)],
		edge: "start",
		deltaTicks: -48,
	}),
	"insert",
	REFUSE_ROOM,
);

expectRefused("a note shortened past the command written inside it", "#amk 2\n#0 o4 c4 v200 ^8 d4", 0, (bar) => ({
	kind: "stretch",
	items: [noteAt(bar, 0)],
	edge: "end",
	deltaTicks: -60,
}));

// Carrying a note past another takes its whole unit out and writes it again on
// the far side, and the command written inside this one sits in that unit. It
// would go with it, and which side of the note it belongs on afterwards is not
// something a drag says — so the crossing is refused rather than guessed at.
expectRefused(
	"a note with a command inside it dragged past another",
	"#amk 2\n#0 o4 c8 v200 ^8 d8 e8",
	0,
	(bar) => ({ kind: "move", items: [noteAt(bar, 0)], deltaTicks: 72, deltaKeys: 0, copy: false }),
	"overwrite",
);

console.log("\nwhat a drag carries");

// `Plan.touched` is what the roll draws in the preview and leaves out of the
// song's own bars, so these pin whether a dragged note is drawn once or twice.

expectCarried(
	"a dragged note",
	"#amk 2\n#0 o4 c4 r4 d4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0)],
		deltaTicks: 24,
		deltaKeys: 0,
		copy: false,
	}),
	[0],
);

// A note carried past another is written again on the far side, and it is still
// the note the porter has hold of. Which is why the lifting-out happens in
// `planEdits` and not in `planGesture`: the plan is what the roll draws, so a
// note demoted a step earlier would carry `from: -1` here, the song's own bar
// for it would stay on screen under the drag, and every crossing would look like
// a copy being made.
expectCarried(
	"a note carried past another is still carried",
	"#amk 2\n#0 o4 c8 d8 e8",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0)],
		deltaTicks: 48,
		deltaKeys: 0,
		copy: false,
	}),
	[0],
	null,
	"overwrite",
);

// A copy has no original to leave out, so `Ctrl`+drag keeps both bars on screen.
expectCarried(
	"a copied note",
	"#amk 2\n#0 o4 c4 r4 r4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0)],
		deltaTicks: 48,
		deltaKeys: 0,
		copy: true,
	}),
	[-1],
);

// A refusal that still knows where the note was going keeps it, so the bar stays
// under the pointer, red, until it is let go.
expectCarried(
	"a push with nowhere to go",
	"#amk 2\n#0 o4 c4 d4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 1)],
		deltaTicks: -24,
		deltaKeys: 0,
		copy: false,
	}),
	[1],
	REFUSE_ROOM,
);

// And one that does not: a pitch past the driver's range has no lane, so there
// is nowhere to draw it and every bar goes back where it was.
expectCarried(
	"a note dragged out of range",
	"#amk 2\n#0 o1 c4 d4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0)],
		deltaTicks: 0,
		deltaKeys: -12,
		copy: false,
	}),
	[],
	REFUSE_RANGE,
);

// And the copy written out, walked like any other gesture.
expectEdit("a note copied rather than moved", "#amk 2\n#0 o4 c4 r4 r4", 0, (bar) => ({
	kind: "move",
	items: [noteAt(bar, 0)],
	deltaTicks: 48,
	deltaKeys: 0,
	copy: true,
}));

// `Ctrl`+drag and `Ctrl`+B both copy the whole **selection**, so a region takes
// as many notes at once as the porter had chosen. One note per region would
// refuse the commonest shape there is — a run of notes copied a bar right.
expectEdit(
	"a run of notes copied together",
	"#amk 2\n#0 o4 c4 d4 r4 r4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0), noteAt(bar, 1)],
		deltaTicks: 96,
		deltaKeys: 0,
		copy: true,
	}),
	{ contains: ["c4", "d4"] },
);

// The run carries the octave from note to note, so the second copy spells its
// own `o` and going back down spells one again.
expectEdit(
	"copies an octave apart each spell their own octave",
	"#amk 2\n#0 o4 c4 o5 c4 r4 r4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0), noteAt(bar, 1)],
		deltaTicks: 96,
		deltaKeys: 0,
		copy: true,
	}),
	{ contains: ["o5 c4"] },
);

// A drum leaves the octave standing rather than replacing it, so the note after
// a copied drum is spelled against whatever the run last put in force.
expectEdit(
	"a run holding a drum copied together",
	"#amk 2\n#0 o4 @21 c4 @0 o4 d4 r4 r4",
	0,
	(bar) => ({
		kind: "move",
		items: [noteAt(bar, 0), noteAt(bar, 1)],
		deltaTicks: 96,
		deltaKeys: 0,
		copy: true,
	}),
	{ contains: ["@21"] },
);

console.log("\npast the end of the song");

// A note past the shortest channel is written, compiled and never heard — see
// `padChannels` for why. Every channel that would cut the song short is padded
// out to meet it instead, and `playsFor` is the only reading that catches a rest
// of the wrong length: the text looks equally plausible either way, and `others`
// cannot see a rest at all.

expectEdit(
	"a note drawn past the end of the song",
	"#amk 2\n#0 o4 c4 d4\n#1 o4 e4 f4\n",
	0,
	() => ({ kind: "spawn", startTick: 96, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 d4 g4\n#1 o4 e4 f4\nr4\n", playsFor: 144 },
);

// Adding a rest to the end of a channel needs no note map and no agreement with
// the walk, so a channel `channelStrip` will not build a strip for is padded
// like any other — and most real songs have one.
expectEdit(
	"the channel holding the song back is one the roll cannot edit",
	"#amk 2\n#0 o4 c4 d4\n#1 o4 [e4]2\n",
	0,
	() => ({ kind: "spawn", startTick: 96, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 d4 g4\n#1 o4 [e4]2\nr4\n", playsFor: 144 },
);

// The push cascade counts too: `f4` is shoved out past the end by the note drawn
// in front of it, and a note the gesture moved there is one the gesture is
// answerable for. Without this it would go quiet where it had been sounding.
expectEdit(
	"a note pushed past the end of the song",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n#1 o4 c1\n",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ contains: "#1 o4 c1\nr4", playsFor: 240 },
);

// The rests go on the end, so the `/` every channel re-enters at does not move.
expectEdit(
	"padding a channel does not move the loop point",
	"#amk 2\n#0 o4 c4 d4 / e4 f4\n#1 o4 c1\n",
	0,
	() => ({ kind: "spawn", startTick: 192, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ contains: "#1 o4 c1\nr4", playsFor: 240, loopsWhereItDid: true },
);

// A channel with no ticks is holding nothing back — `index.ts:43` passes over it
// — so giving it ticks it never had is not what drawing a note asked for.
expectEdit(
	"a channel with no ticks of its own is not padded",
	"#amk 2\n#0 o4 c4 d4\n#1 v200\n",
	0,
	() => ({ kind: "spawn", startTick: 96, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 d4 g4\n#1 v200\n", playsFor: 144 },
);

// And one already past where the note reaches needs nothing either. It stays the
// long channel, which is the ordinary shape `SST0502` reports.
expectEdit(
	"a channel already past the new end is not padded",
	"#amk 2\n#0 o4 c4 d4\n#1 o4 c1 c1\n",
	0,
	() => ({ kind: "spawn", startTick: 96, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 d4 g4\n#1 o4 c1 c1\n", playsFor: 144 },
);

// The channel drawn on already runs past the song, so its own length does not
// move: the note is written into the rest it lands in and the padding answers to
// where the *note* reaches, not to where that channel ends.
expectEdit(
	"a note drawn past the end of the song into a channel that already runs past it",
	"#amk 2\n#0 o4 c2 r1\n#1 o4 c2\n",
	0,
	() => ({ kind: "spawn", startTick: 144, ticks: 48, written: NOTE_MIN + 36 + 2, drum: null }),
	{ text: "#amk 2\n#0 o4 c2 r4 d4 r2\n#1 o4 c2\nr2\n", playsFor: 192 },
);

// Nothing was moved, so nothing reaches past the end and the song keeps its
// length — a channel already running long stays long rather than dragging every
// other one out to its tail.
expectEdit(
	"a note deleted from a channel that runs past the song does not lengthen it",
	"#amk 2\n#0 o4 c2 d2 e2 f2\n#1 o4 c2\n",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 2)] }),
	{ playsAsLong: true },
);

console.log("\nopening a channel");

// The whole text, because everything about the block is the point: the `#N`, the
// five defaults, the blank line above it, the rest that carries the note out to
// its tick, the rest that runs the channel out to the song's own 192 — and that
// the note does not repeat the `o4` the block just wrote.
expectEdit(
	"a note drawn on a channel the song has not declared",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n",
	5,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 4, drum: null }),
	{
		text: "#amk 2\n#0 o4 c4 d4 e4 f4\n\n#5 o4 q7F @0 v255 y10\nr4 e4 r2\n",
		playsAsLong: true,
		// A song with no `/` gives the channel none either.
		lacks: "/",
	},
);

// The channel is already open, so no second `#5` and no defaults over the top of
// the `v200` the porter wrote — but it is still empty, so it is still filled out.
expectEdit(
	"a note drawn on a channel that is declared but holds no music",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n#5 v200\n",
	5,
	() => ({ kind: "spawn", startTick: 0, ticks: 48, written: NOTE_MIN + 36, drum: null }),
	{ text: "#amk 2\n#0 o4 c4 d4 e4 f4\n#5 v200\no4 c4 r2.\n", playsAsLong: true },
);

// A `;` runs to the end of its line, so a run written on the same line would be
// read as part of the comment and the note would never compile.
expectEdit(
	"a note drawn on a channel whose block ends in a comment",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n#5 v200 ; the bass comes in later",
	5,
	() => ({ kind: "spawn", startTick: 0, ticks: 48, written: NOTE_MIN + 36, drum: null }),
	{ contains: "later\no4 c4 r2.", playsAsLong: true },
);

// The opening's `@0` and the drum's own `@21` both, and the note on its lane.
expectEdit(
	"a drum drawn on a channel the song has not declared",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n",
	6,
	() => ({ kind: "spawn", startTick: 0, ticks: 24, written: NOTE_MIN + 24, drum: 21 }),
	{ contains: "#6 o4 q7F @0 v255 y10\n@21 c8 r2..", playsAsLong: true },
);

// A note drawn past the end pads by nothing on its own channel and takes every
// other one out to meet it, so the song lengthens from 192 to 216 rather than
// leaving the note out past its own end unheard.
//
// The two insertions land on the same offset here — `#0`'s text ends where an
// undeclared `#5`'s block would be written — so this is also what pins their
// order: the rest belongs to `#0`, and the other way round it is `#5`'s.
expectEdit(
	"a note drawn past the end of the song on a channel the song has not declared",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n",
	5,
	() => ({ kind: "spawn", startTick: 168, ticks: 48, written: NOTE_MIN + 36, drum: null }),
	{
		text: "#amk 2\n#0 o4 c4 d4 e4 f4\nr8\n\n#5 o4 q7F @0 v255 y10\nr2.. c4\n",
		playsFor: 216,
	},
);

// `@` switches instrument tuning on under Addmusic 4.05 rather than saying what
// is already true, so the opening leaves it out — `normalize.ts:writeDefaults`
// takes the same gate.
expectEdit(
	"a channel opened on a target where an `@` is not a no-op",
	"#am4\n#0 o4 c4 d4 e4 f4\n",
	5,
	() => ({ kind: "spawn", startTick: 0, ticks: 48, written: NOTE_MIN + 36, drum: null }),
	{ contains: "#5 o4 q7F v255 y10\nc4 r2.", lacks: "@0", playsAsLong: true },
);

// Every channel resumes from its own `/` on each pass round the loop, so a
// channel opened without one restarts at its top instead — and one whose marker
// is on the wrong tick is worse, because it drags the whole song's loop point
// down with it. `loopsWhereItDid` is what pins that; the text alone could not.
// The song here runs `c4 d4 / e4 f4`: 192 ticks, and the intro ends at 96.

// The tick falls inside the rest that fills the channel out, so it is two rests.
expectEdit(
	"a channel opened in a song with an intro, with the marker landing in a rest",
	"#amk 2\n#0 o4 c4 d4 / e4 f4\n",
	5,
	() => ({ kind: "spawn", startTick: 0, ticks: 48, written: NOTE_MIN + 36, drum: null }),
	{
		text: "#amk 2\n#0 o4 c4 d4 / e4 f4\n\n#5 o4 q7F @0 v255 y10\nc4 r4 / r2\n",
		playsAsLong: true,
		loopsWhereItDid: true,
	},
);

// And on a boundary, where nothing has to be split at all.
expectEdit(
	"a channel opened in a song with an intro, with the marker landing on a note's end",
	"#amk 2\n#0 o4 c4 d4 / e4 f4\n",
	5,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 4, drum: null }),
	{
		text: "#amk 2\n#0 o4 c4 d4 / e4 f4\n\n#5 o4 q7F @0 v255 y10\nr4 e4 / r2\n",
		playsAsLong: true,
		loopsWhereItDid: true,
	},
);

// Inside the note, which is written as a head and a `^` continuation: still one
// note, because a tie emits `$C6` and the driver carries the note through it.
// `plays what the plan said` is what proves that — the plan asks for one note of
// 48 ticks at tick 72, and the note map has to read back as one.
expectEdit(
	"a channel opened in a song with an intro, with the marker landing inside the note",
	"#amk 2\n#0 o4 c4 d4 / e4 f4\n",
	5,
	() => ({ kind: "spawn", startTick: 72, ticks: 48, written: NOTE_MIN + 36 + 4, drum: null }),
	{
		text: "#amk 2\n#0 o4 c4 d4 / e4 f4\n\n#5 o4 q7F @0 v255 y10\nr4. e8 / ^8 r4.\n",
		playsAsLong: true,
		loopsWhereItDid: true,
	},
);

// A second note goes into the rests the first one was filled out with, and must
// not eat them: the tail region carries `ticks: -1` for "may be any length", and
// reading that as nothing to fill took the channel back to where the new note
// stopped — and the whole song with it. The sources here are what the three
// cases above write.
expectEdit(
	"a second note drawn into the rests a channel was opened with",
	"#amk 2\n#0 o4 c4 d4 e4 f4\n\n#5 o4 q7F @0 v255 y10\nr4 e4 r2\n",
	5,
	() => ({ kind: "spawn", startTick: 120, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{
		text: "#amk 2\n#0 o4 c4 d4 e4 f4\n\n#5 o4 q7F @0 v255 y10\nr4 e4 r8 g4 r8\n",
		playsAsLong: true,
	},
);

// With an intro the `/` stands between two rests, so the region holds more than
// one and only the rest the note falls inside is rewritten — everything between
// them, the marker included, stays on its own tick.
expectEdit(
	"a second note drawn after the `/` a channel was opened with",
	"#amk 2\n#0 o4 c4 d4 / e4 f4\n\n#5 o4 q7F @0 v255 y10\nc4 r4 / r2\n",
	5,
	() => ({ kind: "spawn", startTick: 120, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{
		text: "#amk 2\n#0 o4 c4 d4 / e4 f4\n\n#5 o4 q7F @0 v255 y10\nc4 r4 / r8 g4 r8\n",
		playsAsLong: true,
		loopsWhereItDid: true,
	},
);

expectEdit(
	"a second note drawn before the `/` a channel was opened with",
	"#amk 2\n#0 o4 c4 d4 / e4 f4\n\n#5 o4 q7F @0 v255 y10\nc4 r4 / r2\n",
	5,
	() => ({ kind: "spawn", startTick: 48, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	{
		text: "#amk 2\n#0 o4 c4 d4 / e4 f4\n\n#5 o4 q7F @0 v255 y10\nc4 g4 / r2\n",
		playsAsLong: true,
		loopsWhereItDid: true,
	},
);

// A note that starts in one rest and ends in another would have to move the run
// written between them, and only the porter knows which side it belongs on.
expectRefused(
	"a note drawn across the `/` a channel was opened with",
	"#amk 2\n#0 o4 c4 d4 / e4 f4\n\n#5 o4 q7F @0 v255 y10\nc4 r4 / r2\n",
	5,
	() => ({ kind: "spawn", startTick: 72, ticks: 48, written: NOTE_MIN + 36 + 7, drum: null }),
	"insert",
	REFUSE_CROWDED,
);

// A run may take over a `'note-state'` command and nothing else. A `t` acts on the whole song, so
// which of the two notes it belonged with is not something the run can decide, and it refuses.
expectRefused(
	"a note drawn over two notes with a tempo written between them",
	"#amk 2\n#0 o4 c4 d4 t60 e4 f4",
	0,
	() => ({ kind: "spawn", startTick: 48, ticks: 96, written: NOTE_MIN + 36 + 7, drum: null }),
	"overwrite",
	REFUSE_CROWDED,
);

// And where no run is being laid, a command inside the note being removed has no tick left to stand
// on: `e4` still plays under this `v200`, so it cannot go, and nothing can say which side of the
// deletion the porter meant it to follow.
expectRefused(
	"a note deleted with a command inside it that something still plays under",
	"#amk 2\n#0 o4 c4 d4 v200 ^4 e4",
	0,
	(bar) => ({ kind: "delete", items: [noteAt(bar, 1)] }),
	"overwrite",
	REFUSE_INSIDE,
);

// Glue is the same removal by another name: the second note is swallowed by the first, and the
// command written inside it is in the span that goes.
expectRefused(
	"two notes glued, the second with a command inside it",
	"#amk 2\n#0 o4 c4 d4 v200 ^4 e4",
	0,
	(bar) => ({ kind: "glue", items: [noteAt(bar, 0), noteAt(bar, 1)] }),
	"overwrite",
	REFUSE_INSIDE,
);

// Only an item wholly covered is asked the question at all: this one reaches half a rest, so the
// rest keeps its `v200` whatever anything else plays. It stands inside the run being laid, so the
// run writes it out again on its tick rather than refusing the gesture.
expectEdit(
	"a note drawn over one note and half the rest that follows it",
	"#amk 2\n#0 o4 c4 v200 r4 d4",
	0,
	() => ({ kind: "spawn", startTick: 0, ticks: 72, written: NOTE_MIN + 36 + 7, drum: null }),
	{ mode: "overwrite", playsAsLong: true, text: "#amk 2\n#0 o4 g4 v200 ^8 r8 d4" },
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
	{ contains: "#5 o4 q7F v255 y10", playsAsLong: true },
);

// No marker at all means the starting channel is 0 by fallback, and a `#3`
// written anywhere takes every note the song has over to channel 3.
expectNoStrip("a channel opened in a song with no `#N` at all", "#am4\no4 c4 d4", 3, "above the first");

// --- carrying a command to another tick -------------------------------------
//
// `roll-command-move.ts`, which is the only edit here that changes where a
// command runs without touching a note. Every case asserts the same three things
// before anything about the text: the channel plays exactly what it played, no
// other channel moved, and the song is exactly as long. What is left to pin per
// case is the tick the driver ends up reading the command at, which is the thing
// the text alone cannot say — `p12,147` written before a rest and written before
// the note after it look equally plausible and are 64 ticks apart.

console.log("\ncarrying a command");

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

// The channel gate the drag borrows whole. A `[ ]` plays one written run more
// than once, so an item's written tick is not the tick the driver reaches it at
// and there is nothing to snap against.
expectNoStrip("a command on a channel with a loop in it", "#amk 4\n\n#0 o4 [ c4 v200 r4 ]2 d4\n", 0, "uses `[`");

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
console.log("\na pitch slide");

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
	// The all-hex form involves no note at all, and used to be refused with a
	// sentence about a target note that was not there.
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
	// `roll-write.ts` can say so: `reachesSomething` asks what still sounds after
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

// --- seeding a song with no playable music ----------------------------------

// `roll-seed.ts` runs when the roll is opened on a song that fails AMK0302 or
// AMK0303: one batch of splices gives the song its first rest, so a `Strip` can
// exist at all. Seeded songs are checked the way every edit here is — by
// compiling the result — and the refusals pin that a song failing for its own
// reasons is never written to.
console.log("\nthe seed");
{
	const seeded = (source: string): string | null => {
		const result = compiler.compile({ source, aramAddress: ARAM, options: OPTIONS });
		const edits = seedEdits(source, result, tokenize(source));
		return edits === null ? null : apply(source, edits);
	};

	const playedTicks = (source: string | null, channel: number): number | string => {
		if (source === null) {
			return "no seed";
		}

		const built = build(source);
		return typeof built === "string" ? built : (built.result.stats?.channelTicks[channel] ?? -1);
	};

	check("a blank document becomes the seed song", seeded("") === SEED_SONG, String(seeded("")));
	check("whitespace is a blank document", seeded("  \n\n") === SEED_SONG);
	check(
		"the seed song plays a whole rest on channel 0",
		playedTicks(SEED_SONG, 0) === 192,
		String(playedTicks(SEED_SONG, 0)),
	);
	check(
		"and its channel is a strip of one rest",
		(() => {
			const built = build(SEED_SONG);
			if (typeof built === "string") {
				return false;
			}

			const made = strip(SEED_SONG, built, 0);
			return typeof made !== "string" && made.items.length === 1 && made.items[0].kind === "rest";
		})(),
	);

	// A header alone raises no command anywhere, so the seeded channel carries the defaults.
	const headed = seeded("#amk 4\n");
	check("a header alone keeps its header", headed === `#amk 4\n\n${seededChannel(0)}\n`, String(headed));
	check("and plays", playedTicks(headed, 0) === 192, String(playedTicks(headed, 0)));

	// An `#spc` block raises no command either — its braces are a block, not music.
	const tagged = seeded('#amk 4\n\n#spc\n{\n    #title "x"\n}\n');
	check("an #spc block still gets the defaults", tagged?.includes(seededChannel(0)) === true, String(tagged));
	check("and it plays", playedTicks(tagged, 0) === 192, String(playedTicks(tagged, 0)));

	// With a `#N` declared the defaults are the porter's to write: the rest goes
	// in alone, at the end of the last-declared channel's block.
	const declared = seeded("#amk 4\n#0\n");
	check("a declared channel is given only its rest", declared === "#amk 4\n#0\nr1\n", String(declared));
	check("which plays", playedTicks(declared, 0) === 192, String(playedTicks(declared, 0)));

	const voiced = seeded("#amk 4\n#0 v200\n");
	check("a channel with only commands keeps them", voiced === "#amk 4\n#0 v200\nr1\n", String(voiced));
	check("and still plays", playedTicks(voiced, 0) === 192, String(playedTicks(voiced, 0)));

	// A command above the first `#N` gathers on the starting channel
	// (Music.cpp:383-406), and everything the scaffold writes is tick-0
	// last-writer-wins state — so no defaults, or they would win over it.
	const tempoed = seeded("#amk 4\nt60\n");
	check("a command above the channels is not stomped", tempoed === "#amk 4\nt60\n\n#0 r1\n", String(tempoed));
	check("and the song plays", playedTicks(tempoed, 0) === 192, String(playedTicks(tempoed, 0)));

	const twin = seeded("#amk 4\n#0\n#1\n");
	check(
		"the rest lands on the last-declared channel",
		playedTicks(twin, 1) === 192 && playedTicks(twin, 0) === 0,
		String(twin),
	);

	// `@0` is not written on Addmusic 4.05, where an `@` switches instrument
	// tuning on rather than saying what is already true.
	const legacy = seeded("#am4\n");
	check("a legacy target is seeded without `@0`", legacy !== null && !legacy.includes("@0"), String(legacy));
	check("and its rest plays", playedTicks(legacy, 0) === 192, String(playedTicks(legacy, 0)));

	// A song failing for its own reasons is never written to.
	check("a song missing its header is left alone", seeded("#0 c8\n") === null, String(seeded("#0 c8\n")));
	check("a song for a newer AddmusicK is left alone", seeded("#amk 9\n") === null);
	check("a song that compiles is left alone", seeded(SAMPLE_SONG) === null);
}

summarise();
