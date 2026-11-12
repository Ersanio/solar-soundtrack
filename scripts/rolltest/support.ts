/** What every `rolltest` section shares: the driver, building and stripping a song, applying edits, and the `expect*` checks. */

import "../localize";
import { compiler } from "@amk/compiler";
import type { CompileResult } from "@amk/core/types";
import { loadDriver } from "@amk/spc/driver";
import { type SongTimeline, walkSong } from "@amk/spc/song-walk";
import { type Command, type TokenIndex, tokenize } from "@amk/tokens";
import type { Edit } from "@amk/tokens/edits";
import { commandTimeline, type TimelineCommand } from "../../web/src/app/state/command-timeline";
import { commandsInForceOf } from "../../web/src/app/state/commands-in-force";
import {
	commandMoveRefusal,
	commandMoveTargets,
	nearestTarget,
	planCommandMove,
} from "../../web/src/app/editor/views/piano-roll/roll-command-move";
import {
	type EditContext,
	type EditMode,
	frameAt,
	type Gesture,
	isEdits,
	type Plan,
	planGesture,
} from "../../web/src/app/editor/views/piano-roll/roll-edit";
import { planEdits } from "../../web/src/app/editor/views/piano-roll/roll-write/plan-edits";
import {
	channelStrip,
	type ChannelTail,
	channelTails,
	isStrip,
	type Strip,
} from "../../web/src/app/editor/views/piano-roll/roll-strip";
import { check, stubFetch } from "../harness";

stubFetch();

const driver = await loadDriver();
export const ARAM = driver.manifest.localPos;
export const OPTIONS = {
	sampleNames: driver.samples.map((sample) => sample.sampleName),
	sampleGroups: driver.manifest.sampleGroups,
};

export interface Built {
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

export function build(source: string): Built | string {
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
	const walkedNotes = new Map(timeline.notes.map((note) => [note.address, note]));

	return {
		result,
		timeline,
		index,
		inForce: (address) => {
			const note = walkedNotes.get(address);
			return note === undefined ? null : acting(note);
		},
	};
}

export function strip(source: string, built: Built, channel: number): Strip | string {
	const outcome = channelStrip({
		source,
		channel,
		noteMap: built.result.noteMap ?? [],
		commandMap: built.result.commandMap ?? [],
		timeline: built.timeline,
		index: built.index,
		tempoRatio: built.result.stats?.tempoRatio ?? 1,
	});

	return isStrip(outcome) ? outcome : outcome.refused;
}

/** Applies a sorted, non-overlapping edit list from the end, as CodeMirror would. */
export function apply(source: string, edits: readonly Edit[]): string {
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
 * everything after it (`song-walk.ts:1116-1127`), so a channel longer than the
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
 * `Music.cpp:3209`, kept by the port as `introTicks + loopTicks` (`index.ts:42-46`)
 * and read by `Playback.durationTicks`. It is what a channel being opened is
 * filled out to, and what {@link Expectation.playsAsLong} pins.
 */
export function playable(built: Built): number {
	const stats = built.result.stats;
	return stats ? stats.introTicks + stats.loopTicks : 0;
}

/** Where the song loops back to, or null where it has no `/` at all. */
export function introOf(built: Built): number | null {
	const stats = built.result.stats;
	return stats?.hasIntro === true ? stats.introTicks : null;
}

/** Every channel as somewhere rests can be appended, the way the roll builds it. */
export function tailsOf(source: string, built: Built): readonly ChannelTail[] {
	return channelTails(source, built.index, built.result.stats?.channelTicks ?? [], built.result.noteMap ?? []);
}

export interface Expectation {
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
	/**
	 * The frame a spawn runs in, for drawing into a loop body — its ticks are
	 * then that frame's own. A gesture with items derives the frame from them,
	 * and a draw is routed by `frameAt` off the song tick it names.
	 */
	frame?: number;
	/**
	 * One **other** voice's whole walk, as `[channel, plays]`, for the edit that
	 * is meant to reach it.
	 *
	 * A body declared on one channel and recalled from another is one text both
	 * voices play, so a note drawn into it lands on both — the one case where
	 * "leaves the other channels alone" is the wrong question. Spelling that
	 * voice's walk out is what says the reach was the shared body itself and not
	 * a splice that wandered into another channel's block.
	 */
	alsoPlays?: readonly [number, string];
	/**
	 * How long one **other** voice must run afterwards, as `[channel, ticks]`.
	 *
	 * {@link Expectation.playsFor} reads the song, which is the shortest channel,
	 * so a channel padded further than the gesture asked is invisible there: the
	 * over-pad stops it being the shortest and the figure does not move. This is
	 * the reading that says a pad landed once.
	 */
	channelTicks?: readonly [number, number];
}

/**
 * The plan's ordinals name the notes the commit wrote.
 *
 * `planEdits` lays a frame's notes down in the plan's own tick order, and
 * `plannedOrdinals` is the roll reading that back: it is what a selection is
 * carried across an edit on, since a strip index moves the moment an item is
 * added or removed, a tick moves for every note after a length change, and an
 * address moves for every byte written before it. Nothing else here can see it —
 * a channel plays the same music whichever ordinal a note is at — so the day a
 * region is written in an order the plan did not have it in, this is the only
 * check that fails.
 */
export function expectOrdinals(name: string, plan: Plan, after: Strip, frame: number): void {
	const bar = after.frames[frame];
	if (!bar) {
		check(`${name}: the plan's frame is still there`, false, `frame ${frame}`);
		return;
	}

	// A drum is named by its instrument alone: its letter says nothing, so the
	// row's own `c` and whatever letter the text carries are the same note.
	const spell = (written: number, drum: number | null): string => (drum === null ? String(written) : `@${drum}`);

	const got: string[] = [];
	for (let index = bar.from; index < bar.to; index++) {
		const item = after.items[index];
		if (item.kind === "note") {
			got.push(spell(item.written, item.drum?.args[0]?.value ?? null));
		}
	}

	const want = plan.notes.map((note) => spell(note.written, note.drum));
	check(
		`${name}: the plan's ordinals name the notes it wrote`,
		want.join(" ") === got.join(" "),
		`want ${want.join(" ")}\n        got  ${got.join(" ")}`,
	);
}

export function expectEdit(
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

	const made = gesture(bar);
	const frame = bar.frames[frameFor(bar, made, expectation.frame)];
	const context: EditContext = {
		source,
		strip: bar,
		targetAMKVersion: before.result.stats?.targetAMKVersion ?? 4,
		songTargetProgram: before.result.stats?.songTargetProgram ?? 0,
		playableTicks: playable(before),
		introTicks: introOf(before),
		channels: tailsOf(source, before),
		frame,
		inForce: before.inForce,
	};
	const plan = planGesture(bar, made, expectation.mode ?? "insert", frame);
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

	// A channel the roll can no longer frame — every note in it deleted, say — has
	// no ordinals to speak of, and no strip for the selection to be put back on
	// either. `expectNoStrip` is where a refusal is pinned.
	const again = strip(after, rebuilt, channel);
	if (typeof again !== "string") {
		expectOrdinals(name, plan, again, bar.frames.indexOf(frame));
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

	if (expectation.channelTicks !== undefined) {
		const [voice, wanted] = expectation.channelTicks;
		const ran = rebuilt.result.stats?.channelTicks?.[voice] ?? -1;
		check(`${name}: #${voice} runs ${wanted} ticks`, ran === wanted, `${ran}`);
	}

	if (expectation.loopsWhereItDid === true) {
		check(
			`${name}: loops back where it did`,
			before.timeline.loopTick === rebuilt.timeline.loopTick,
			`${before.timeline.loopTick} -> ${rebuilt.timeline.loopTick}`,
		);
	}

	if (expectation.text !== undefined) {
		check(
			`${name}: writes what it should`,
			after === expectation.text,
			`expected ${JSON.stringify(expectation.text)}\n        got      ${JSON.stringify(after)}`,
		);
	}

	for (const wanted of listOf(expectation.contains)) {
		check(`${name}: writes ${wanted}`, after.includes(wanted), JSON.stringify(after));
	}

	for (const unwanted of listOf(expectation.lacks)) {
		check(`${name}: does not write ${unwanted}`, !after.includes(unwanted), JSON.stringify(after));
	}
}

/** One substring or several, so a case can pin more than one thing about its result. */
export function listOf(expectation: string | readonly string[] | undefined): readonly string[] {
	if (expectation === undefined) {
		return [];
	}

	return typeof expectation === "string" ? [expectation] : expectation;
}

/**
 * The frame a case's gesture runs in, decided the way the press decides it.
 *
 * A gesture with items takes its first one's frame; a draw has no item, so it is
 * routed by `frameAt`, and the `base` that comes back turns the **song** tick a
 * case is written in into the frame-local one the plan wants — which is what
 * `roll-gesture.ts` does with `Drag.origin`. So a draw at a tick inside a pass
 * this channel plays lands in the body, and one inside a pass some *other* voice
 * plays over that body does not.
 *
 * An expectation naming a frame outright keeps it, its ticks being that frame's
 * already.
 */
export function frameFor(bar: Strip, made: Gesture, named: number | undefined): number {
	if (named !== undefined) {
		return named;
	}

	if (made.kind === "spawn") {
		const drawn = frameAt(bar, made.startTick);
		made.startTick -= drawn.base;
		return drawn.frame;
	}

	const first = "items" in made && made.items.length > 0 ? made.items[0] : undefined;
	return first !== undefined ? (bar.items[first]?.frame ?? 0) : 0;
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

	const made = gesture(bar);
	const frame = bar.frames[frameFor(bar, made, undefined)];
	const context: EditContext = {
		source,
		strip: bar,
		targetAMKVersion: before.result.stats?.targetAMKVersion ?? 4,
		songTargetProgram: before.result.stats?.songTargetProgram ?? 0,
		playableTicks: playable(before),
		introTicks: introOf(before),
		channels: tailsOf(source, before),
		frame,
		inForce: before.inForce,
	};
	return { plan: planGesture(bar, made, mode, frame), context };
}

/**
 * A gesture the roll must decline: no edit, and a reason.
 *
 * `because` is the sentence the toolbar shows. Pinning it is what proves the
 * refusal reaches the porter: a reason threaded through the wrong branch says
 * the wrong thing about a real refusal, which is worse than the silence it
 * replaces, and no test of "was it refused" can tell the two apart.
 */
export function expectRefused(
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
export function expectCarried(
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
export function expectNoStrip(name: string, source: string, channel: number, because: string): void {
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
export function noteAt(bar: Strip, nth: number): number {
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
export function expectMove(
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
export function expectNoMove(name: string, source: string, channel: number, written: string, because: string): void {
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
