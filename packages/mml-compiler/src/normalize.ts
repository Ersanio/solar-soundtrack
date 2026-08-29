/**
 * The normalizer: rewrites a song into the shape an editor can splice.
 *
 * Nine passes, each a text-to-text rewrite driven by the parse trace of the
 * text it is given, and each leaving a song that compiles to the same music:
 *
 *   A. `resolvePreprocessor` — `#define`/`#if…` lines and untaken branches go.
 *   B. `inlineReplacements`  — every `"find=value"` use site becomes its value.
 *   D. `flattenTriplets`     — notes inside `{ }` get the length they compiled to.
 *   H. `writeNoteLengths`    — every note carries its own length, and no `l` is
 *                              left for a later one to read.
 *   C. `unrollLoops`         — `[ ]n`, `(n)[ ]n`, `(n)m`, `*n`, `[[ ]]n` and the
 *                              same subloop written `$E6 $00`/`$E6 $nn` become
 *                              n copies of the body. Repeated until none are
 *                              left, because a copy can contain a subloop.
 *   E. `orderChannels`       — one block per channel, `#0` to `#7`, the music
 *                              above the first `#N` under the starting channel.
 *   F. `writeDefaults`       — `o`, `q`, `@` and `t` written out where a channel
 *                              left them implied; `<` and `>` absolute.
 *   I. `writePitchSlides`    — every legacy `&` becomes the `$DD` it compiles
 *                              to, so the slide is a command with a channel
 *                              rather than an operator nothing can place.
 *   G. `drumPerNote`         — the drum `@` immediately before every drum note.
 *
 * A `[ ]` body is compiled once, under the parse-time state standing at its
 * `[`, and replayed from bytes. Copying its text n times is not the same thing:
 * `<`, `>` and the drum remap's clearing would run n times, and a `(1)n` called
 * from another channel would parse the body under that channel's octave,
 * length and transposition. So every copy is preceded by whatever re-creates
 * the state the body was compiled under, and the last is followed by whatever
 * restores the state that stood after the construct — both read off the trace.
 *
 * What a pass cannot re-create it refuses, with a diagnostic saying why. The
 * caller compiles and walks the result of every pass against the original and
 * applies nothing unless they agree, so a refusal here names a reason; the walk
 * is what guarantees the music.
 */

import { FIRST_CUSTOM_INSTRUMENT, FIRST_PERCUSSION_INSTRUMENT, TICKS_PER_WHOLE } from "@amk/core/hardcoded-tables";
import { hex2 } from "@amk/core/hex";
import { spellDuration, spellLength, spellOctave, spellQ } from "@amk/core/mml-text";
import type { CompileResult, Diagnostic, ParseEvent, ParseState, ParseTrace, Span } from "@amk/core/types";
import { preprocess } from "./preprocess";

export interface NormalizeInput {
	text: string;
	result: CompileResult;
	trace: ParseTrace;
	/**
	 * Rewrite only this channel's music, and leave every other channel of the
	 * song exactly as it was.
	 *
	 * The piano roll edits one channel at a time and refuses the ones it cannot
	 * splice, so what a porter wants when a channel is in the way is that
	 * channel put in order — not the whole song rewritten, and above all not a
	 * refusal because some *other* channel has a loop that cannot be unrolled.
	 * Every pass that works construct by construct takes this as a filter; the
	 * two that are global by nature (the preprocessor and the replacements) run
	 * whole either way, `orderChannels` refuses rather than moving another
	 * channel's blocks about, and `writeNoteLengths` stands down, the default
	 * note length being one variable every channel reads.
	 *
	 * The oracle does not change: the caller still walks the result and compares
	 * it against the original, so a scoped rewrite is held to the same standard
	 * as a whole one.
	 */
	onlyChannel?: number;
}

export interface PassResult {
	text: string;
	diagnostics: Diagnostic[];
	/** False when the pass found nothing to do, so the caller can skip the recompile. */
	changed: boolean;
}

/** How many times `unrollLoops` may run before the caller gives up on the song. */
export const UNROLL_ROUNDS = 8;

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

interface TextEdit {
	start: number;
	end: number;
	text: string;
}

const NOWHERE: Span = { start: 0, end: 0, line: 1 };
const NOTE_LETTERS = new Set(["c", "d", "e", "f", "g", "a", "b"]);
const DRUM_CONSUMED = 0xff;

const isDrum = (instrument: number): boolean =>
	instrument >= FIRST_PERCUSSION_INSTRUMENT && instrument < FIRST_CUSTOM_INSTRUMENT;
const isPitched = (event: ParseEvent): boolean => NOTE_LETTERS.has(event.char);
const isNote = (event: ParseEvent): boolean => isPitched(event) || event.char === "r" || event.char === "^";
const eventText = (text: string, event: ParseEvent): string => text.slice(event.span.start, event.span.end);
const isMarker = (text: string, event: ParseEvent): boolean =>
	event.char === "#" && /^#\d+$/.test(eventText(text, event));
const markerChannel = (text: string, event: ParseEvent): number => Number.parseInt(eventText(text, event).slice(1), 10);
const eol = (text: string): string => (text.includes("\r\n") ? "\r\n" : "\n");

function diagnostic(
	code: string,
	message: string,
	span: Span = NOWHERE,
	severity: Diagnostic["severity"] = "error",
): Diagnostic {
	return { severity, code, message, span: { ...span } };
}

const unchanged = (text: string): PassResult => ({ text, diagnostics: [], changed: false });

/** Applies non-overlapping edits, built against one text, in one go. */
function applyEdits(text: string, edits: readonly TextEdit[]): string {
	const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
	let out = "";
	let at = 0;
	for (const edit of sorted) {
		if (edit.start < at) {
			throw new Error(`normalize: overlapping edits at ${edit.start}`);
		}

		out += text.slice(at, edit.start) + edit.text;
		at = edit.end;
	}

	return out + text.slice(at);
}

/** Sorted and merged, touching ranges joined. */
function mergeRanges(ranges: readonly { start: number; end: number }[]): { start: number; end: number }[] {
	const sorted = ranges.map((r) => ({ start: r.start, end: r.end })).sort((a, b) => a.start - b.start);
	const out: { start: number; end: number }[] = [];
	for (const range of sorted) {
		const last = out[out.length - 1];
		if (last && range.start <= last.end) {
			last.end = Math.max(last.end, range.end);
		} else {
			out.push(range);
		}
	}

	return out;
}

/**
 * Deletions, widened to the whole line wherever the line would be left holding
 * nothing but whitespace or a `;` comment — a `#define` line goes with its line
 * ending, and a comment that trailed it goes too.
 */
function deletionEdits(text: string, ranges: readonly { start: number; end: number }[]): TextEdit[] {
	const merged = mergeRanges(ranges);
	const widened: { start: number; end: number }[] = [];
	let group: { start: number; end: number }[] = [];
	let lineStart = -1;
	let lineEnd = -1;

	const flush = (): void => {
		if (group.length === 0) {
			return;
		}

		let remaining = "";
		let at = lineStart;
		for (const range of group) {
			remaining += text.slice(at, Math.max(at, range.start));
			at = Math.max(at, Math.min(range.end, lineEnd));
		}

		remaining += text.slice(at, lineEnd);
		if (/^\s*(;.*)?$/s.test(remaining)) {
			const terminator = text[lineEnd] === "\n" ? 1 : 0;
			widened.push({ start: lineStart, end: lineEnd + terminator });
		} else {
			widened.push(...group);
		}

		group = [];
	};

	for (const range of merged) {
		const start = text.lastIndexOf("\n", range.start - 1) + 1;
		if (start !== lineStart) {
			flush();
			lineStart = start;
			const newline = text.indexOf("\n", Math.max(range.end, start));
			lineEnd = newline === -1 ? text.length : newline;
		} else if (range.end > lineEnd) {
			const newline = text.indexOf("\n", range.end);
			lineEnd = newline === -1 ? text.length : newline;
		}

		group.push(range);
	}

	flush();
	return mergeRanges(widened).map((range) => ({ ...range, text: "" }));
}

function initialState(trace: ParseTrace): ParseState {
	const channel = Math.max(0, trace.startingChannel);
	return {
		channel,
		prevChannel: channel,
		octave: 4,
		defaultNoteLength: TICKS_PER_WHOLE / 8,
		prevNoteLength: -1,
		triplet: false,
		hTranspose: 0,
		usingHTranspose: false,
		instrument: new Array<number>(9).fill(0),
		q: new Array<number>(9).fill(0x7f),
		ignoreTuning: new Array<boolean>(9).fill(trace.songTargetProgram === 1),
		inRemoteDefinition: false,
		inE6Loop: false,
		prevLoop: -1,
		loopLabel: 0,
		channelDefined: false,
		inPitchSlide: false,
		nextNoteIsForDD: false,
	};
}

/** The state standing when the dispatch at `index` began. */
function stateBefore(trace: ParseTrace, index: number): ParseState {
	return index <= 0 ? initialState(trace) : trace.events[index - 1].state;
}

// ---------------------------------------------------------------------------
// Before any pass
// ---------------------------------------------------------------------------

/**
 * What no pass can rewrite, found before any runs.
 *
 * A legacy `&` emits the standing duration byte as `$DD`'s (`parser.ts:parseNote`),
 * and after a bracket or a marker that byte is `-1`, which reaches the stream as
 * `$FF`: no length any text can name, so {@link writePitchSlides} cannot write
 * it out and every pass that moves a bracket would change it. A slide or a `$DD`
 * operand still pending at a bracket or a marker is the same hazard from the
 * other side. `tuning[n]=` changes the table every later note is tuned by, and
 * the trace carries one table rather than one per note.
 */
export function precheck(input: NormalizeInput): Diagnostic[] {
	const { text, trace, onlyChannel } = input;
	const out: Diagnostic[] = [];
	trace.events.forEach((event, index) => {
		// `tuning[n]=` is a fact about the whole song's tuning table, so it refuses
		// whatever is being rewritten; everything else here is about one run of
		// music and refuses only the channel it is on.
		const mine = onlyChannel === undefined || event.channel === onlyChannel;
		const before = stateBefore(trace, index);
		if (mine && isNote(event) && before.inPitchSlide && before.prevNoteLength === -1) {
			out.push(
				diagnostic(
					"SST0607",
					"A pitch slide takes its duration from a loop or channel boundary, which cannot be written out.",
					event.span,
				),
			);
		}

		const boundary = event.loop !== undefined || isMarker(text, event);
		const pending = (state: ParseState): boolean => state.inPitchSlide || state.nextNoteIsForDD;
		if (mine && boundary && (pending(before) || pending(event.state))) {
			out.push(
				diagnostic("SST0607", "A pitch slide or $DD note is still pending at a loop or channel boundary.", event.span),
			);
		}

		if (event.char === "t" && eventText(text, event).startsWith("tuning[")) {
			out.push(
				diagnostic("SST0608", "Songs that retune an instrument with tuning[n]= cannot be normalized.", event.span),
			);
		}

		if (mine && event.loop?.kind === "call" && event.loop.at === 0xffff) {
			out.push(
				diagnostic("SST0602", "This * repeats a loop that was never written, which cannot be unrolled.", event.span),
			);
		}
	});
	return out;
}

// ---------------------------------------------------------------------------
// A. The preprocessor
// ---------------------------------------------------------------------------

/**
 * Deletes what `preprocess` would: the `#define` family and the text of every
 * untaken branch. The target marker stays, comments stay, and a line left
 * empty goes whole.
 */
export function resolvePreprocessor(input: NormalizeInput): PassResult {
	const { text } = input;
	const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
	// Padded as `parse()` pads, so a directive on the last line is read the same way.
	const pre = preprocess(`${text.slice(bom)}                `);
	const ranges = pre.removed
		.filter((range) => range.reason !== "marker")
		.map((range) => ({ start: range.start + bom, end: Math.min(range.end + bom, text.length) }))
		.filter((range) => range.end > range.start);
	if (ranges.length === 0) {
		return unchanged(text);
	}

	return { text: applyEdits(text, deletionEdits(text, ranges)), diagnostics: [], changed: true };
}

// ---------------------------------------------------------------------------
// B. Replacements
// ---------------------------------------------------------------------------

/**
 * Writes every replacement out at its use site and deletes the definitions.
 *
 * The expansion is the parser's own: `doReplacement` stamps every character it
 * produces with the use site's origin, so the characters of the final buffer
 * that carry an origin inside a use site are exactly what that site became —
 * through transitive definitions and through the expansions that begin in the
 * middle of a number, which the scanner in `@amk/tokens` deliberately does not
 * follow.
 */
export function inlineReplacements(input: NormalizeInput): PassResult {
	const { text, trace } = input;
	const sites = mergeRanges(trace.expansions);
	const definitions = trace.events.filter((event) => event.char === '"');
	if (sites.length === 0 && definitions.length === 0) {
		return unchanged(text);
	}

	const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
	const values = sites.map(() => "");
	for (let i = 0; i < trace.buffer.length; i++) {
		const origin = trace.origins[i] + bom;
		let low = 0;
		let high = sites.length;
		while (low < high) {
			const mid = (low + high) >> 1;
			if (sites[mid].end <= origin) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}

		if (low < sites.length && sites[low].start <= origin) {
			values[low] += trace.buffer[i];
		}
	}

	const diagnostics: Diagnostic[] = [];
	for (const definition of definitions) {
		if (sites.some((site) => definition.span.start >= site.start && definition.span.start < site.end)) {
			diagnostics.push(
				diagnostic("SST0613", "A replacement that defines another replacement cannot be written out.", definition.span),
			);
		}
	}

	if (diagnostics.length > 0) {
		return { text, diagnostics, changed: false };
	}

	const edits: TextEdit[] = sites.map((site, at) => ({ ...site, text: values[at] }));
	edits.push(
		...deletionEdits(
			text,
			definitions.map((definition) => definition.span),
		),
	);
	return { text: applyEdits(text, edits), diagnostics, changed: true };
}

// ---------------------------------------------------------------------------
// D. Triplets
// ---------------------------------------------------------------------------

/**
 * Every note inside `{ }` is re-spelled with the length it compiled to, and the
 * braces go. The note map holds the ticks after the tempo ratio was applied
 * (`parser.ts:parseNote`), so the written length is that times the ratio.
 */
export function flattenTriplets(input: NormalizeInput): PassResult {
	const { text, trace, result } = input;
	const events = trace.events;
	const byStart = new Map((result.noteMap ?? []).map((entry) => [entry.span.start, entry]));
	const ratio = trace.targetAMKVersion >= 4 ? trace.tempoRatio : 1;
	const edits: TextEdit[] = [];
	const diagnostics: Diagnostic[] = [];

	let open = -1;
	events.forEach((event, index) => {
		if (input.onlyChannel !== undefined && event.channel !== input.onlyChannel) {
			return;
		}

		if (event.char === "{") {
			open = index;
			return;
		}

		if (event.char !== "}" || open < 0) {
			return;
		}

		edits.push({ ...events[open].span, text: "" }, { ...event.span, text: "" });
		for (let at = open + 1; at < index; at++) {
			const note = events[at];
			const entry = isNote(note) ? byStart.get(note.span.start) : undefined;
			if (!entry) {
				continue;
			}

			const spelling = spellLength(entry.ticks * ratio, "note", trace.targetAMKVersion);
			const head = /^([a-gA-G][+-]?|[rR]|\^)/.exec(eventText(text, note));
			if (!spelling || !head) {
				diagnostics.push(
					diagnostic(
						"SST0610",
						`A note of ${entry.ticks * ratio} ticks has no length this target can write.`,
						note.span,
					),
				);
				continue;
			}

			edits.push({ ...note.span, text: head[0] + spelling });
		}

		open = -1;
	});

	if (edits.length === 0 || diagnostics.length > 0) {
		return { text, diagnostics, changed: false };
	}

	return { text: applyEdits(text, edits), diagnostics, changed: true };
}

// ---------------------------------------------------------------------------
// H. Lengths
// ---------------------------------------------------------------------------

/** A note, rest or tie head and the length written after it. One segment. */
const SEGMENT = /([a-gA-G][+-]?|[rR]|\^)((?:=\d+|\d*)\.*)/g;

/** Whether a segment's length text names no length, so the note reads the `l`. */
const implied = (length: string): boolean => /^\.*$/.test(length);

/**
 * Deletions, widened to the whole line only where the line would be left holding
 * nothing at all.
 *
 * Not {@link deletionEdits}, which widens over a trailing `;` comment too: a
 * comment beside a `#define` is about the directive and goes with it, where one
 * beside an `l` is about the music and outlives it.
 */
function emptiedLines(text: string, ranges: readonly { start: number; end: number }[]): TextEdit[] {
	return mergeRanges(ranges).map((range) => {
		const lineStart = text.lastIndexOf("\n", range.start - 1) + 1;
		const newline = text.indexOf("\n", range.end);
		const lineEnd = newline === -1 ? text.length : newline;
		const remaining = text.slice(lineStart, range.start) + text.slice(range.end, lineEnd);
		return /^\s*$/.test(remaining)
			? { start: lineStart, end: lineEnd + (newline === -1 ? 0 : 1), text: "" }
			: { ...range, text: "" };
	});
}

/**
 * What `dots` dots add to `ticks`: the running value halved at each step, with
 * the floor taken every time (Music.cpp:2950, `parser.ts:getNoteLengthModifier`).
 *
 * The composition is the reason a length cannot be written in front of the dots
 * already there. Under a 36-tick default `c.` is 36 + 18, and `spellLength` puts
 * 36 as `8.`, so `c8..` would be 24 + 12 + 6 — a different note.
 */
function dotted(ticks: number, dots: number): number {
	let frac = ticks;
	let out = ticks;
	for (let dot = 0; dot < dots; dot++) {
		frac = Math.floor(frac / 2);
		out += frac;
	}

	return out;
}

/**
 * Whether an argument written as `text` reads the default note length, the way
 * `getNoteLength` decides it (`parser.ts:748-778`): a `$` is a hex byte and an
 * `=n` is exact, and anything else falls back to the default unless it is a
 * plain 1-192.
 */
function readsTheDefault(text: string): boolean {
	const argument = text.trim();
	if (argument.startsWith("$") || /^=\d+/.test(argument)) {
		return false;
	}

	const digits = /^\d+/.exec(argument);
	if (!digits) {
		return true;
	}

	const n = Number.parseInt(digits[0], 10);
	return n < 1 || n > TICKS_PER_WHOLE;
}

/**
 * Every note's own length written out, and every `l` gone.
 *
 * The default note length is one variable for the whole song — `#N`, `[`, `]`,
 * `(n)`, `*`, `/` and `{ }` all leave it standing (`parser.ts:parseHash`) — so a
 * note written without digits reads whatever was last set anywhere above it.
 * That is the one piece of parse state a splice cannot work around, and writing
 * it onto the note is what makes a length a property of the note.
 *
 * Segment by segment, not note by note: `accumulateTiedLength` folds a run
 * across whitespace and nothing else (`parser.ts:2977-3016`), so `c4^` is one
 * note of an explicit 48 and an implied 24, and `r4 r r` is one rest of three.
 * Each segment's own dots are re-spelled with it, since dots compose rather than
 * add — see {@link dotted}.
 *
 * `spellDuration` rather than `spellLength`, because `l=n` range-checks nothing
 * (`parser.ts:parseDefaultLength`) and dots raise it further, so a segment can
 * be longer than the whole note one token stops at; the ties it writes fold back
 * into the same note. Nothing is written in a remote definition, which cannot
 * hold a note at all (AMK0165, `parser.ts:2882`), so an `l` in one is left where
 * it is and governs nothing once every note outside carries its own length.
 *
 * **Whole songs only.** Scoping the rewrite does not scope the reader: one `l` is
 * read by every later channel's bare notes and by every `[ ]` body, whose events
 * carry channel 8. Deleting one channel's `l` while another channel still reads
 * it changes the music, and rewriting the notes that read it means rewriting
 * text a scoped run has promised to leave alone. So a scoped run stands down and
 * the channel keeps its `l`s, as `orderChannels` stands down rather than joining
 * one channel's blocks — and the roll is unharmed either way, since a note's
 * length is read off its own written text.
 */
export function writeNoteLengths(input: NormalizeInput): PassResult {
	const { text, trace } = input;
	const events = trace.events;
	const diagnostics: Diagnostic[] = [];
	const edits: TextEdit[] = [];
	const gone: { start: number; end: number }[] = [];
	// Music.cpp:2960 — Addmusic 4.05 stops reading after two dots.
	const mostDots = trace.songTargetProgram === 1 ? 2 : Number.POSITIVE_INFINITY;

	if (input.onlyChannel !== undefined) {
		return unchanged(text);
	}

	for (const [index, event] of events.entries()) {
		if (event.char === "l" && !event.state.inRemoteDefinition) {
			// The whitespace in front goes too, so `o4 l8 q7F` closes up rather
			// than being left holding a gap.
			let start = event.span.start;
			while (start > 0 && (text[start - 1] === " " || text[start - 1] === "\t")) {
				start--;
			}

			gone.push({ start, end: event.span.end });
			continue;
		}

		// A `(!n, type, n)` reads the default too, and is the only thing that is
		// not a note that does (`parser.ts:2552`). There is nowhere to write the
		// length onto a note here, and the walk need not notice a `$FC` argument
		// moving, so it is refused rather than left to the oracle.
		if (event.char === "(") {
			const call = /^\(\s*!\s*\d+\s*,[^,)]*,([^)]*)\)/.exec(eventText(text, event));
			if (call && readsTheDefault(call[1])) {
				diagnostics.push(
					diagnostic(
						"SST0606",
						"This remote code call takes its length from the l in force, which cannot be written onto a note.",
						event.span,
					),
				);
			}

			continue;
		}

		if (!isNote(event)) {
			continue;
		}

		// `$DD`'s last parameter is a note that names a pitch and nothing else:
		// `parseNote` appends the byte and returns before it reads a length
		// (`parser.ts:2971-2975`), so one written here is not read by anything
		// and is left behind as a stray digit.
		if (stateBefore(trace, index).nextNoteIsForDD) {
			continue;
		}

		const written = eventText(text, event);
		for (const match of written.matchAll(SEGMENT)) {
			const [whole, head, length] = match;
			if (!implied(length)) {
				continue;
			}

			const dots = Math.min(length.length, mostDots);
			const ticks = dotted(event.state.defaultNoteLength, dots);
			const spelling = spellDuration(ticks, trace.targetAMKVersion);
			if (spelling === null) {
				diagnostics.push(
					diagnostic("SST0610", `A note of ${ticks} ticks has no length this target can write.`, event.span),
				);
				continue;
			}

			const at = event.span.start + match.index + head.length;
			edits.push({ start: at, end: at + (whole.length - head.length), text: spelling });
		}
	}

	if (diagnostics.length > 0) {
		return { text, diagnostics, changed: false };
	}

	if (edits.length === 0 && gone.length === 0) {
		return unchanged(text);
	}

	return { text: applyEdits(text, [...edits, ...emptiedLines(text, gone)]), diagnostics, changed: true };
}

// ---------------------------------------------------------------------------
// C. Loops
// ---------------------------------------------------------------------------

/** The text between a pair of brackets, and the events inside it. */
interface Body {
	start: number;
	end: number;
	openIndex: number;
	closeIndex: number;
	remote: boolean;
}

interface Construct {
	kind: "loop" | "subloop" | "call";
	/** The source range the copies replace. */
	start: number;
	end: number;
	/** The construct's own events, first to last inclusive. */
	first: number;
	last: number;
	count: number;
	body: Body;
	/** The channel the construct runs on. */
	channel: number;
}

/** A construct whose opening has been met and whose close has not. */
interface Opened {
	index: number;
	at: number;
	remote: boolean;
	sub: boolean;
	from?: number;
}

/** The parse-time state a note reads, seen from one slot. */
interface View {
	octave: number;
	length: number;
	q: number;
	usingH: boolean;
	h: number;
	instrument: number;
	ignoreTuning: boolean;
}

const view = (state: ParseState, slot: number): View => ({
	octave: state.octave,
	length: state.defaultNoteLength,
	q: state.q[slot],
	usingH: state.usingHTranspose,
	h: state.hTranspose,
	instrument: state.instrument[slot],
	ignoreTuning: state.ignoreTuning[slot],
});

/**
 * Whether a pitched note from `from` to `to` would emit a different byte with
 * `instrument` in `slot` instead of what the parser had there, before an `@`
 * puts the two back in step.
 *
 * Follows the instrument into a `[ ]` opened on the slot, since `[` copies it
 * into the loop block, and consumes a drum remap on the first pitched note as
 * `parseNote` does — on every channel but 6 and 7 under AddmusicK.
 */
function instrumentHazard(
	trace: ParseTrace,
	from: number,
	to: number,
	slot: number,
	instrument: number,
	ignoreTuning: boolean,
	sfx: boolean,
): boolean {
	const textual = { instrument, ignoreTuning };
	let inner: { instrument: number; ignoreTuning: boolean } | null = null;

	for (let at = from; at < to; at++) {
		const event = trace.events[at];
		const before = stateBefore(trace, at);
		const onSlot = event.channel === slot;
		const onInner = slot < 8 && event.channel === 8 && before.prevChannel === slot;
		if (!onSlot && !onInner) {
			continue;
		}

		const current = onSlot ? textual : inner;
		if (current === null) {
			continue;
		}

		if (event.char === "@") {
			current.instrument = event.state.instrument[event.channel];
			current.ignoreTuning = event.state.ignoreTuning[event.channel];
			if (onSlot) {
				return false;
			}

			continue;
		}

		if (onSlot && event.loop?.kind === "open" && !event.loop.remote) {
			inner = { ...textual };
			continue;
		}

		if (!isPitched(event)) {
			continue;
		}

		const original = { instrument: before.instrument[event.channel], ignoreTuning: before.ignoreTuning[event.channel] };
		const drumO = isDrum(original.instrument);
		const drumT = isDrum(current.instrument);
		if (drumO !== drumT || (drumO && original.instrument !== current.instrument)) {
			return true;
		}

		if (!drumO && !before.usingHTranspose) {
			const termO = original.ignoreTuning ? 0 : trace.transposeMap[original.instrument];
			const termT = current.ignoreTuning ? 0 : trace.transposeMap[current.instrument];
			if (termO !== termT) {
				return true;
			}
		}

		if (drumT && !(trace.songTargetProgram === 0 && sfx)) {
			current.instrument = DRUM_CONSUMED;
		}
	}

	return false;
}

/**
 * Unrolls every top-level loop construct once. A copy of a body may hold a
 * subloop, and a subloop's copy a loop, so the caller runs this until it
 * reports no change.
 */
export function unrollLoops(input: NormalizeInput): PassResult {
	const { text, trace } = input;
	const events = trace.events;
	const diagnostics: Diagnostic[] = [];
	const bodies = new Map<number, Body>();
	const constructs: Construct[] = [];
	const open: Opened[] = [];

	/**
	 * A loop and a subloop that cross — one opened inside the other and closed
	 * outside it. AddmusicK guards nesting and not crossing (Music.cpp:1208-1290,
	 * 1985-2005), so it builds one, and the driver answers it with the one
	 * subloop return each voice has (`Commands.asm:365`): the close jumps into
	 * the other construct's body, and from there the channel either ends on that
	 * body's `$00` with the call counter already spent (`main.asm:2345`) or
	 * re-enters the `$E9` and starts its count again. Neither is a number of
	 * copies of anything, so it is refused.
	 *
	 * Both ends meet the mismatch, so it is said once, and on the channel the
	 * loop is written on: a dispatch inside a loop body reports channel 8.
	 */
	let crossed = false;
	const crossing = (loop: Opened | undefined, message: string, span: Span): void => {
		if (crossed || loop === undefined) {
			return;
		}

		const channel = events[loop.index].channel;
		if (input.onlyChannel !== undefined && channel !== input.onlyChannel) {
			return;
		}

		crossed = true;
		diagnostics.push(diagnostic("SST0616", message, span));
	};

	events.forEach((event, index) => {
		const loop = event.loop;
		if (!loop) {
			return;
		}

		switch (loop.kind) {
			case "open":
				open.push({ index, at: loop.at, remote: loop.remote, sub: false });
				break;

			case "subOpen":
				open.push({ index, at: -1, remote: false, sub: true, from: loop.from });
				break;

			case "close": {
				const opened = open.pop();
				if (!opened || opened.sub) {
					// A subloop opened inside this loop is still open at the `]`. The
					// loop is the entry below it, and is there whenever this reports:
					// written the other way round, `subClose` meets the mismatch first
					// and has already said so.
					crossing(
						open[open.length - 1],
						"A subloop opens inside this loop and closes outside it. Its close jumps back into the loop's body, so nothing written after it is played.",
						event.span,
					);
					break;
				}

				const body: Body = {
					start: events[opened.index].span.end,
					end: event.span.start,
					openIndex: opened.index,
					closeIndex: index,
					remote: opened.remote,
				};
				bodies.set(opened.at, body);
				if (opened.remote) {
					break;
				}

				// `(n)[` is two dispatches; the label is part of the construct.
				let first = opened.index;
				const label = events[first - 1];
				if (first > 0 && label.char === "(" && label.span.end === events[first].span.start) {
					first--;
				}

				constructs.push({
					kind: "loop",
					start: events[first].span.start,
					end: event.span.end,
					first,
					last: index,
					count: loop.count,
					body,
					channel: events[first].channel,
				});
				break;
			}

			case "subClose": {
				const opened = open.pop();
				if (!opened?.sub) {
					// A loop opened inside this subloop and closed outside it, so the
					// entry popped is that loop itself.
					crossing(
						opened,
						"This subloop opens outside a loop and closes inside its body. Its close re-enters the loop, so the loop's count starts again.",
						event.span,
					);
					break;
				}

				// Written as hex, the event sits on the argument byte and the run
				// began at `from`; written as `[[`/`]]n`, the event's own span is
				// the whole construct. Either end may be either spelling.
				constructs.push({
					kind: "subloop",
					start: opened.from ?? events[opened.index].span.start,
					end: event.span.end,
					first: opened.index,
					last: index,
					count: loop.count,
					body: {
						start: events[opened.index].span.end,
						end: loop.from ?? event.span.start,
						openIndex: opened.index,
						closeIndex: index,
						remote: false,
					},
					channel: event.channel,
				});
				break;
			}

			case "call": {
				const body = bodies.get(loop.at);
				if (!body) {
					diagnostics.push(
						loop.at === 0xffff
							? diagnostic(
									"SST0602",
									"This * repeats a loop that was never written, which cannot be unrolled.",
									event.span,
								)
							: diagnostic("SST0603", "A loop call could not be matched to its body.", event.span),
					);
					break;
				}

				constructs.push({
					kind: "call",
					start: event.span.start,
					end: event.span.end,
					first: index,
					last: index,
					count: loop.count,
					body,
					channel: event.channel,
				});
				break;
			}
		}
	});

	if (diagnostics.length > 0) {
		return { text, diagnostics, changed: false };
	}

	const contains = (outer: Construct, inner: Construct): boolean =>
		outer !== inner && outer.start <= inner.start && inner.end <= outer.end;
	const topLevel = constructs.filter(
		(construct) =>
			(input.onlyChannel === undefined || construct.channel === input.onlyChannel) &&
			!stateBefore(trace, construct.first).inRemoteDefinition &&
			!constructs.some((other) => contains(other, construct)),
	);
	if (topLevel.length === 0) {
		return unchanged(text);
	}

	const lineEnd = eol(text);
	const edits: TextEdit[] = [];
	for (const construct of topLevel) {
		const channel = construct.channel;
		const slot = construct.kind === "subloop" ? channel : 8;
		const sfx = trace.songTargetProgram === 0 && (channel === 6 || channel === 7);
		const { body } = construct;
		const before = view(stateBefore(trace, construct.first), channel);
		const defined = view(events[body.openIndex].state, slot);
		const left = view(events[body.closeIndex - 1].state, slot);
		const after = view(events[construct.last].state, channel);

		/**
		 * What puts `to` in force where `from` stands, as text. The instrument
		 * is only writable as a drum remap — `@n` for anything else emits a
		 * `$DA` the original has not got — so a difference there is checked
		 * against the notes that would read it instead.
		 */
		const reassert = (from: View, to: View, notesFrom: number, notesTo: number, slotOf: number): string | null => {
			const parts: string[] = [];
			if (to.usingH) {
				if (!from.usingH || from.h !== to.h) {
					parts.push(`h${to.h}`);
				}
			} else if (from.usingH) {
				parts.push(`#${channel}`);
			}

			if (from.octave !== to.octave) {
				const octave = spellOctave(to.octave);
				if (octave === null) {
					diagnostics.push(
						diagnostic("SST0610", `An octave of ${to.octave} cannot be written with o.`, events[construct.first].span),
					);
					return null;
				}

				parts.push(octave);
			}

			if (from.length !== to.length) {
				const length = spellLength(to.length, "l", trace.targetAMKVersion);
				if (length === null) {
					diagnostics.push(
						diagnostic(
							"SST0610",
							`A default length of ${to.length} ticks has no l this target can write.`,
							events[construct.first].span,
						),
					);
					return null;
				}

				parts.push(`l${length}`);
			}

			if (from.q !== to.q) {
				parts.push(spellQ(to.q));
			}

			if (from.instrument !== to.instrument || from.ignoreTuning !== to.ignoreTuning) {
				if (isDrum(to.instrument) && from.ignoreTuning === to.ignoreTuning) {
					parts.push(`@${to.instrument}`);
				} else if (instrumentHazard(trace, notesFrom, notesTo, slotOf, from.instrument, from.ignoreTuning, sfx)) {
					const code = notesFrom === body.openIndex + 1 ? "SST0604" : "SST0605";
					const message =
						code === "SST0604"
							? "This loop is played under a differently tuned instrument than it was written under, so its copies would sound different."
							: "An instrument set inside this loop would retune the notes after it once unrolled.";
					diagnostics.push(diagnostic(code, message, events[construct.first].span));
					return null;
				}
			}

			return parts.join(" ");
		};

		const bodyRange: [number, number] = [body.openIndex + 1, body.closeIndex];
		const afterRange: [number, number] = [construct.last + 1, events.length];
		const firstCopy = reassert(before, defined, ...bodyRange, slot === 8 ? 8 : channel);
		const nextCopy = construct.count > 1 ? reassert(left, defined, ...bodyRange, slot === 8 ? 8 : channel) : "";
		const restore = reassert(left, after, ...afterRange, channel);
		if (firstCopy === null || nextCopy === null || restore === null) {
			continue;
		}

		let source = text.slice(body.start, body.end).replace(/^[ \t]+|[ \t]+$/g, "");
		const separator = source.includes("\n") || source.includes(";") ? lineEnd : " ";
		const copies: string[] = [];
		for (let copy = 0; copy < construct.count; copy++) {
			// A label defined inside a subloop is defined once; later copies of
			// the body keep the loop and drop the label.
			if (copy === 1) {
				source = source.replace(/\(\d+\)(?=\[)/g, "");
			}

			const prefix = copy === 0 ? firstCopy : nextCopy;
			copies.push(prefix ? `${prefix} ${source}` : source);
		}

		let replacement = copies.join(separator);
		if (restore) {
			replacement += ` ${restore}`;
		}

		edits.push({ start: construct.start, end: construct.end, text: replacement });
	}

	if (diagnostics.length > 0) {
		return { text, diagnostics, changed: false };
	}

	return { text: applyEdits(text, edits), diagnostics, changed: true };
}

// ---------------------------------------------------------------------------
// E. Channels
// ---------------------------------------------------------------------------

const HEADER_DIRECTIVE = /^#(samples|instruments|spc|path|pad|option|halvetempo|amk|am4|amm)\b/i;

/** One run of a channel's text: what follows one `#N` up to the next. */
interface Piece {
	channel: number;
	text: string;
	/** The state the piece was parsed under, and the one it left. */
	start: ParseState;
	end: ParseState;
	/** Whether a pitched note comes before any `h` — what a dropped `#N` would change. */
	noteBeforeH: boolean;
	/** The piece this one followed in the original, or null for the first. */
	previous: Piece | null;
}

/**
 * One block per channel, in channel order.
 *
 * The text above the first `#N` is split into the header — directives and remote
 * code, which have to stay above every channel — and music, which the parser
 * writes to the starting channel and which goes under a `#N` for it. A channel
 * written in several blocks becomes one; the `#N` between two of its blocks
 * stays only where the later block relied on it to switch `h` off. A block that
 * no longer follows what it followed is given the `o` and `l` it was parsed
 * under, since both leak from whatever came before.
 */
export function orderChannels(input: NormalizeInput): PassResult {
	const { text, trace, onlyChannel } = input;
	const events = trace.events;
	const lineEnd = eol(text);
	const markers = events.map((_, index) => index).filter((index) => isMarker(text, events[index]));
	if (markers.length === 0) {
		return unchanged(text);
	}

	const diagnostics: Diagnostic[] = [];

	// Merging one channel's blocks moves text past other channels' blocks and
	// changes the `o` and `l` they inherit, so there is no scoped version of
	// this pass: a channel already written in one place needs nothing, and one
	// written in several is a whole-song rewrite whether or not it was asked for.
	if (onlyChannel !== undefined) {
		const own = markers.filter((index) => markerChannel(text, events[index]) === onlyChannel);
		if (own.length > 1) {
			return {
				text,
				diagnostics: [
					diagnostic(
						"SST0615",
						`Channel ${onlyChannel} is written in more than one block, and joining them would move the other channels' music. Normalize the whole song instead.`,
						events[own[1]].span,
					),
				],
				changed: false,
			};
		}

		return unchanged(text);
	}
	for (const index of markers) {
		const state = stateBefore(trace, index);
		if (state.inPitchSlide || state.nextNoteIsForDD || state.triplet) {
			diagnostics.push(
				diagnostic(
					"SST0609",
					"A pitch slide, $DD note or triplet is still open at this channel marker.",
					events[index].span,
				),
			);
		}
	}

	// --- the text above the first marker ------------------------------------
	const firstMarker = markers[0];
	const preludeEnd = events[firstMarker].span.start;
	// 0 is neutral: whitespace and comments, which go with whatever they sit beside.
	const HEADER = 1;
	const MUSIC = 2;
	const classes = new Uint8Array(preludeEnd);
	const paint = (span: Span, kind: number): void => {
		classes.fill(kind, span.start, Math.min(span.end, preludeEnd));
	};

	// The target marker is removed before the parser sees the text, so it has no
	// event to classify it by; `preprocess` says where it was.
	const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
	for (const range of preprocess(`${text.slice(bom)}                `).removed) {
		if (range.reason === "marker") {
			paint({ start: range.start + bom, end: range.end + bom, line: 1 }, HEADER);
		}
	}

	let remoteOpen = -1;
	let sawMusic = false;
	for (let index = 0; index < firstMarker; index++) {
		const event = events[index];
		if (event.loop?.kind === "open" && event.loop.remote) {
			remoteOpen = index;
			const label = events[index - 1];
			const from = index > 0 && label.char === "(" ? label.span : event.span;
			paint({ ...from, end: event.span.end }, HEADER);
			continue;
		}

		if (remoteOpen >= 0) {
			paint(event.span, HEADER);
			if (sawMusic && "olqh<>".includes(event.char)) {
				diagnostics.push(
					diagnostic(
						"SST0612",
						"A remote code definition changes the octave, length, quantization or transposition after music above the first channel.",
						event.span,
					),
				);
			}

			if (event.loop?.kind === "close") {
				remoteOpen = -1;
			}

			continue;
		}

		// The `(` of `(!n)[` is a label rather than music, and the `[` on the next
		// iteration is what paints it — reaching back for it, since only the `[`
		// carries the loop event. This runs first, so without it the definition's
		// own label is read as music and the body's first `o`, `l`, `q` or `h` is
		// refused on the strength of it.
		const opens = events[index + 1]?.loop;
		if (event.char === "(" && opens?.kind === "open" && opens.remote) {
			continue;
		}

		if (event.char === "#" && HEADER_DIRECTIVE.test(eventText(text, event))) {
			paint(event.span, HEADER);
		} else {
			paint(event.span, MUSIC);
			sawMusic = true;
		}
	}

	if (diagnostics.length > 0) {
		return { text, diagnostics, changed: false };
	}

	// Lines are kept as slices, line endings included, so a prelude that is
	// already in shape comes out byte for byte. A neutral line — blank, or a
	// comment — goes with the classified line after it.
	const headerLines: string[] = [];
	const musicLines: string[] = [];
	let pendingNeutral: string[] = [];
	let lineStart = 0;
	while (lineStart < preludeEnd) {
		const newline = text.indexOf("\n", lineStart);
		const contentEnd = newline === -1 || newline >= preludeEnd ? preludeEnd : newline;
		const lineStop = contentEnd < preludeEnd ? contentEnd + 1 : preludeEnd;
		const lineText = text.slice(lineStart, lineStop);
		let firstMusic = -1;
		let anyHeader = false;
		for (let at = lineStart; at < contentEnd; at++) {
			if (classes[at] === MUSIC && firstMusic < 0) {
				firstMusic = at;
			} else if (classes[at] === HEADER) {
				anyHeader = true;
			}
		}

		if (firstMusic < 0 && !anyHeader) {
			pendingNeutral.push(lineText);
		} else if (firstMusic < 0) {
			headerLines.push(...pendingNeutral, lineText);
			pendingNeutral = [];
		} else if (!anyHeader || firstMusic === lineStart) {
			musicLines.push(...pendingNeutral, lineText);
			pendingNeutral = [];
		} else {
			headerLines.push(...pendingNeutral, text.slice(lineStart, firstMusic).replace(/[ \t]+$/, "") + lineEnd);
			musicLines.push(text.slice(firstMusic, lineStop));
			pendingNeutral = [];
		}

		lineStart = lineStop;
	}

	headerLines.push(...pendingNeutral);

	// --- the blocks ---------------------------------------------------------
	const startingChannel = Math.max(0, trace.startingChannel);
	const pieces: Piece[] = [];
	const pieceOf = (channel: number, body: string, from: number, to: number, previous: Piece | null): Piece => {
		let noteBeforeH = false;
		for (let at = from; at < to; at++) {
			if (events[at].char === "h") {
				break;
			}

			if (isPitched(events[at])) {
				noteBeforeH = true;
				break;
			}
		}

		return {
			channel,
			text: body,
			start: from === 0 ? initialState(trace) : events[from - 1].state,
			end: to === 0 ? initialState(trace) : events[to - 1].state,
			noteBeforeH,
			previous,
		};
	};

	const prelude = musicLines.length > 0 ? pieceOf(startingChannel, musicLines.join(""), 0, firstMarker, null) : null;
	let previous = prelude;
	markers.forEach((index, at) => {
		const next = at + 1 < markers.length ? markers[at + 1] : events.length;
		const end = at + 1 < markers.length ? events[next].span.start : text.length;
		const piece = pieceOf(
			markerChannel(text, events[index]),
			text.slice(events[index].span.end, end),
			index + 1,
			next,
			previous,
		);
		pieces.push(piece);
		previous = piece;
	});

	const ordered = [...(prelude ? [prelude] : []), ...pieces].sort((a, b) => a.channel - b.channel);

	let out = headerLines.join("");
	const emitted = new Set<number>();
	let last: Piece | null = null;
	for (const piece of ordered) {
		const needsMarker = !emitted.has(piece.channel) || (last !== null && last.end.usingHTranspose && piece.noteBeforeH);
		emitted.add(piece.channel);

		const carried = last === null ? initialState(trace) : last.end;
		const prefix: string[] = [];
		if (piece.previous !== last) {
			if (carried.octave !== piece.start.octave) {
				const octave = spellOctave(piece.start.octave);
				if (octave === null) {
					diagnostics.push(diagnostic("SST0610", `An octave of ${piece.start.octave} cannot be written with o.`));
				} else {
					prefix.push(octave);
				}
			}

			if (carried.defaultNoteLength !== piece.start.defaultNoteLength) {
				const length = spellLength(piece.start.defaultNoteLength, "l", trace.targetAMKVersion);
				if (length === null) {
					diagnostics.push(
						diagnostic(
							"SST0610",
							`A default length of ${piece.start.defaultNoteLength} ticks has no l this target can write.`,
						),
					);
				} else {
					prefix.push(`l${length}`);
				}
			}
		}

		// A piece may end in a `;` comment, which would otherwise swallow the next.
		if (out.length > 0 && !out.endsWith("\n")) {
			out += lineEnd;
		}

		if (needsMarker) {
			out += `#${piece.channel}`;
		}

		if (prefix.length > 0) {
			out += ` ${prefix.join(" ")}`;
		}

		out +=
			piece.text.startsWith(" ") ||
			piece.text.startsWith("\t") ||
			piece.text.startsWith("\r") ||
			piece.text.startsWith("\n") ||
			piece.text.length === 0
				? piece.text
				: ` ${piece.text}`;
		last = piece;
	}

	if (diagnostics.length > 0) {
		return { text, diagnostics, changed: false };
	}

	return out === text ? unchanged(text) : { text: out, diagnostics, changed: true };
}

// ---------------------------------------------------------------------------
// F. Defaults
// ---------------------------------------------------------------------------

export interface DefaultsOptions {
	/** Whether the song already sets a tempo on tick 0, in which case none is written. */
	tempoAtStart: boolean;
	/** The `t` the driver boots at, for a song that never sets one. */
	bootTempo: number;
}

/**
 * Writes out what each channel's first block left implied: `o`, `q` and `@`
 * with the values its first note was parsed under, and `t` at the top of the
 * lowest channel for a song that never sets one. Each only where no such
 * command already precedes the channel's first note, so a song that says
 * everything is left alone. Every `<` and `>` becomes the absolute `o` it
 * produced.
 *
 * No `l`: {@link writeNoteLengths} has already put every note's length on the
 * note, so one written here would state what nothing reads.
 *
 * `@` is written on AddmusicK targets only: on Addmusic 4.05 an `@` switches
 * instrument tuning on (`parser.ts:parseInstrument`), and on AddmusicM a stock
 * `@` resets `h`, so neither is a no-op there. No `h` is ever written — `h`
 * replaces the instrument's tuning rather than adding to it, so `h0` is not
 * "no transposition" (`parser.ts:parseNote`).
 */
export function writeDefaults(input: NormalizeInput, options: DefaultsOptions): PassResult {
	const { text, trace } = input;
	const events = trace.events;
	const diagnostics: Diagnostic[] = [];
	const edits: TextEdit[] = [];

	events.forEach((event) => {
		if (input.onlyChannel !== undefined && event.channel !== input.onlyChannel) {
			return;
		}

		if ((event.char === "<" || event.char === ">") && !event.state.inRemoteDefinition) {
			const octave = spellOctave(event.state.octave);
			if (octave !== null) {
				edits.push({ ...event.span, text: octave });
			}
		}
	});

	const firstOf = new Map<number, number>();
	const markers = events.map((_, index) => index).filter((index) => isMarker(text, events[index]));
	for (const index of markers) {
		const channel = markerChannel(text, events[index]);
		if (!firstOf.has(channel)) {
			firstOf.set(channel, index);
		}
	}

	const lowest = Math.min(...firstOf.keys());
	for (const [channel, index] of firstOf) {
		if (input.onlyChannel !== undefined && channel !== input.onlyChannel) {
			continue;
		}

		const next = markers.find((marker) => marker > index) ?? events.length;
		const entering = events[index].state;
		let hasNote = false;
		const seen = new Set<string>();
		for (let at = index + 1; at < next; at++) {
			const event = events[at];
			if (isNote(event)) {
				hasNote = true;
				break;
			}

			seen.add(event.char === "<" || event.char === ">" ? "o" : event.char);
		}

		const parts: string[] = [];
		// Not when only one channel is being rewritten: `t` is the song's tempo
		// however local the block it sits in, and a porter putting one channel in
		// order has not asked for a command that reaches all eight.
		if (channel === lowest && !options.tempoAtStart && input.onlyChannel === undefined) {
			const ratio = trace.targetAMKVersion >= 4 ? trace.tempoRatio : 1;
			const tempo = options.bootTempo * ratio;
			if (Number.isInteger(tempo) && tempo >= 0 && tempo <= 255) {
				parts.push(`t${tempo}`);
			} else {
				diagnostics.push(
					diagnostic(
						"SST0611",
						"The driver's default tempo cannot be written under this song's tempo ratio, so none was.",
						events[index].span,
						"info",
					),
				);
			}
		}

		if (!seen.has("o")) {
			const octave = spellOctave(entering.octave);
			if (octave !== null) {
				parts.push(octave);
			} else if (hasNote) {
				diagnostics.push(
					diagnostic("SST0610", `An octave of ${entering.octave} cannot be written with o.`, events[index].span),
				);
			}
		}

		if (!seen.has("q")) {
			parts.push(spellQ(entering.q[channel]));
		}

		if (!seen.has("@") && trace.songTargetProgram === 0) {
			const instrument = entering.instrument[channel];
			if (instrument !== DRUM_CONSUMED && (instrument <= 18 || instrument >= FIRST_PERCUSSION_INSTRUMENT)) {
				parts.push(`@${instrument}`);
			}
		}

		if (parts.length > 0) {
			edits.push({ start: events[index].span.end, end: events[index].span.end, text: ` ${parts.join(" ")}` });
		}
	}

	if (diagnostics.some((d) => d.severity === "error")) {
		return { text, diagnostics, changed: false };
	}

	if (edits.length === 0) {
		return { text, diagnostics, changed: false };
	}

	return { text: applyEdits(text, edits), diagnostics, changed: true };
}

// ---------------------------------------------------------------------------
// I. Pitch slides
// ---------------------------------------------------------------------------

/**
 * The tie run standing before a `&`, and whether the two are whitespace-adjacent.
 *
 * `accumulateTiedLength` folds a `^` chain across whitespace and nothing else
 * (`parser.ts:3003-3042`), and on the legacy targets it has already rewound the
 * last tie out of the run in front of a `&` — so the note event before the `&`
 * is not the whole run, and the chain has to be gathered back up across events.
 * `segments` is what a rewind would split, counted off the text, which is exact
 * only because `writeNoteLengths` has already made every length explicit.
 */
function slideRun(text: string, events: readonly ParseEvent[], slide: number): { segments: number; adjacent: boolean } {
	const blank = (from: number, to: number): boolean => /^\s*$/.test(text.slice(from, to));
	let at = slide - 1;
	if (at < 0 || !isNote(events[at])) {
		return { segments: 0, adjacent: false };
	}

	const adjacent = blank(events[at].span.end, events[slide].span.start);
	let segments = 0;
	for (;;) {
		segments += [...eventText(text, events[at]).matchAll(SEGMENT)].length;
		const previous = at > 0 ? events[at - 1] : undefined;
		if (previous === undefined || !isNote(previous)) {
			break;
		}

		const head = eventText(text, events[at])[0]?.toLowerCase();
		const ties = head === "^" || (head === "r" && eventText(text, previous)[0]?.toLowerCase() === "r");
		if (!ties || !blank(previous.span.end, events[at].span.start)) {
			break;
		}

		at--;
	}

	return { segments, adjacent };
}

/**
 * Every legacy `&` written out as the `$DD` it compiles to.
 *
 * `parsePitchSlide` only raises a flag (`parser.ts:2260-2267`); the note after it
 * emits `$DD $00 <prevNoteLength> <note>` and then plays as well
 * (`parser.ts:2963-2969`). So the text has to name a duration the note *before*
 * the `&` decided — which is why an editor cannot touch that note's length while
 * the `&` stands — and a target byte the octave, `h`, the instrument's tuning and
 * the drum remap decided together. The trace carries the first and the note map
 * the second.
 *
 * The target is written as a **byte** and never as a note. A written target is
 * consumed by `parseNote`, which takes the drum remap with it
 * (`parser.ts:2948-2960`) and leaves the note that follows pitched; it errors
 * AMK0161 wherever a `q` is pending (`parser.ts:3451`); and it cannot spell a
 * rest or a tie at all (`isNoteLetter`, `parser.ts:167`). A `&` reaches all three.
 */
export function writePitchSlides(input: NormalizeInput): PassResult {
	const { text, trace, result } = input;
	const events = trace.events;
	const byStart = new Map((result.noteMap ?? []).map((entry) => [entry.span.start, entry]));
	const emitted = new Set((result.commandMap ?? []).map((entry) => entry.span.start));
	const ratio = trace.targetAMKVersion >= 4 ? trace.tempoRatio : 1;
	const edits: TextEdit[] = [];
	const diagnostics: Diagnostic[] = [];

	events.forEach((event, index) => {
		if (input.onlyChannel !== undefined && event.channel !== input.onlyChannel) {
			return;
		}

		const before = stateBefore(trace, index);
		if (!isNote(event) || !before.inPitchSlide) {
			return;
		}

		// `precheck` refuses a slide whose duration comes from a bracket or a
		// marker before any pass runs — `-1` reaches the stream as `$FF`, and no
		// length written here names that. Asserted where it is read rather than
		// inherited from the eight passes in between.
		if (before.prevNoteLength < 0) {
			return;
		}

		let slide = index - 1;
		while (slide >= 0 && events[slide].char !== "&") {
			slide--;
		}

		// `inPitchSlide` is raised only by `&` and lowered only by the note that
		// consumes it, and a second `&` in a row is AMK0099, so the nearest one
		// above this note is always the one it belongs to.
		if (slide < 0) {
			return;
		}

		const spot = events[slide].span;
		const skip = (message: string): void => {
			diagnostics.push(diagnostic("SST0617", message, spot, "info"));
		};

		// A note that is itself a `$DD`'s written target appends its byte and
		// returns before the note map is written (`parser.ts:2971-2975`), so there
		// is no entry to take the target byte from.
		const entry = before.nextNoteIsForDD ? undefined : byStart.get(event.span.start);
		if (entry === undefined) {
			skip("This pitch slide lands on a note that is already a $DD's target, so it was left as it is.");
			return;
		}

		// Where the run goes. The `$DD` bytes are appended when the *note* is
		// parsed, so anything between that emits bytes of its own emits them first
		// and the run has to follow it; `recordCommand` files a command only where
		// the channel's bytes grew (`parser.ts:649`), so an event in the gap that
		// is in no command map wrote nothing. With nothing in the way the run
		// stays where the `&` was, which is where the tie lookahead below expects
		// to find it.
		let at = spot.start;
		for (let gap = slide + 1; gap < index; gap++) {
			if (emitted.has(events[gap].span.start)) {
				at = event.span.start;
			}
		}

		// A drum `@` leading the note keeps its place in front of it, so that
		// `drumPerNote` still reads the two as one unit rather than writing a
		// second `@` between them on the round after this.
		const lead = events[index - 1];
		if (at === event.span.start && lead.char === "@" && !emitted.has(lead.span.start)) {
			at = lead.span.start;
		}

		// `accumulateTiedLength` rewinds the last tie out of the run in front of a
		// `$DD` (`parser.ts:3026-3032`) — for the written command on every target,
		// but for a `&` only on the legacy ones. So the rewrite turns a rewind on
		// where `&` had none, and turns one off by moving the run past something.
		// Either way the tie moves and the slide starts somewhere else, which no
		// re-spelling here can put back.
		const run = slideRun(text, events, slide);
		const reads = run.adjacent && at === spot.start;
		if (run.segments >= 2 && run.adjacent && reads === (trace.songTargetProgram === 0)) {
			skip("This pitch slide follows a tie that writing it as $DD would move, so it was left as it is.");
			return;
		}

		// Hex arguments are divided by the tempo ratio (`parser.ts:3489-3492`)
		// where `&`'s byte is appended raw, already divided, so the text carries
		// the undivided value. `emitNote` holds `prevNoteLength` under
		// `divideByTempoRatio(0x80)` (`parser.ts:3071`, `:3080`), so that is at
		// most 127 and always fits the byte. The note byte is masked because a
		// pitch below the driver's range only warns below `#amk 4` (AMK0206,
		// `parser.ts:2934-2945`) and stays negative, where `append` would mask it.
		const written = `$DD $00 $${hex2(before.prevNoteLength * ratio)} $${hex2(entry.note & 0xff)} `;

		// The trailing spaces go with the `&` so that replacing it in place does
		// not leave a double one; the run brings its own.
		let end = spot.end;
		while (text[end] === " " || text[end] === "\t") {
			end++;
		}

		if (at === spot.start) {
			edits.push({ start: spot.start, end, text: written });
			return;
		}

		edits.push({ start: spot.start, end, text: "" }, { start: at, end: at, text: written });
	});

	if (edits.length === 0) {
		return { text, diagnostics, changed: false };
	}

	return { text: applyEdits(text, edits), diagnostics, changed: true };
}

// ---------------------------------------------------------------------------
// G. Drums
// ---------------------------------------------------------------------------

/**
 * The drum `@` immediately before every note it folds into, so that a drum note
 * is one `@2N x` unit wherever it is. `@21`-`@29` emit nothing and set what is
 * already set, so the bytes do not move; on channels 6 and 7, where one `@21`
 * covers every note after it, this is what makes one of them movable on its own.
 */
export function drumPerNote(input: NormalizeInput): PassResult {
	const { text, trace } = input;
	const events = trace.events;
	const edits: TextEdit[] = [];

	events.forEach((event, index) => {
		if (input.onlyChannel !== undefined && event.channel !== input.onlyChannel) {
			return;
		}

		// No remote-definition test: a remote body cannot hold a note at all
		// (AMK0165, `parser.ts:2882`), so a pitched event is never in one.
		if (!isPitched(event)) {
			return;
		}

		const before = stateBefore(trace, index);
		const instrument = before.instrument[event.channel];
		if (!isDrum(instrument)) {
			return;
		}

		const previous = events[index - 1];
		if (
			index > 0 &&
			previous.char === "@" &&
			previous.channel === event.channel &&
			previous.state.instrument[event.channel] === instrument
		) {
			return;
		}

		edits.push({ start: event.span.start, end: event.span.start, text: `@${instrument} ` });
	});

	if (edits.length === 0) {
		return unchanged(text);
	}

	return { text: applyEdits(text, edits), diagnostics: [], changed: true };
}
