/**
 * The normalizer: rewrites a song into the shape an editor can splice.
 *
 * Seven passes, each a text-to-text rewrite driven by the parse trace of the
 * text it is given, and each leaving a song that compiles to the same music:
 *
 *   A. `resolvePreprocessor` — `#define`/`#if…` lines and untaken branches go.
 *   B. `inlineReplacements`  — every `"find=value"` use site becomes its value.
 *   D. `flattenTriplets`     — notes inside `{ }` get the length they compiled to.
 *   C. `unrollLoops`         — `[ ]n`, `(n)[ ]n`, `(n)m`, `*n` and `[[ ]]n`
 *                              become n copies of the body. Repeated until none
 *                              are left, because a copy can contain a subloop.
 *   E. `orderChannels`       — one block per channel, `#0` to `#7`, the music
 *                              above the first `#N` under the starting channel.
 *   F. `writeDefaults`       — `o`, `l`, `q`, `@` and `t` written out where a
 *                              channel left them implied; `<` and `>` absolute.
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
import { spellLength, spellOctave, spellQ } from "@amk/core/mml-text";
import type { CompileResult, Diagnostic, ParseEvent, ParseState, ParseTrace, Span } from "@amk/core/types";
import { preprocess } from "./preprocess";

export interface NormalizeInput {
	text: string;
	result: CompileResult;
	trace: ParseTrace;
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
 * and after a bracket or a marker that byte is `-1`; the walk does not read
 * `$DD`'s arguments, so this is the one parse-time fact the caller's comparison
 * cannot see. A slide or a `$DD` operand still pending at a bracket or a marker
 * is the same hazard from the other side. `tuning[n]=` changes the table every
 * later note is tuned by, and the trace carries one table rather than one per
 * note.
 */
export function precheck(input: NormalizeInput): Diagnostic[] {
	const { text, trace } = input;
	const out: Diagnostic[] = [];
	trace.events.forEach((event, index) => {
		const before = stateBefore(trace, index);
		if (isNote(event) && before.inPitchSlide && before.prevNoteLength === -1) {
			out.push(
				diagnostic(
					"AMK0607",
					"A pitch slide takes its duration from a loop or channel boundary, which cannot be written out.",
					event.span,
				),
			);
		}

		const boundary = event.loop !== undefined || isMarker(text, event);
		const pending = (state: ParseState): boolean => state.inPitchSlide || state.nextNoteIsForDD;
		if (boundary && (pending(before) || pending(event.state))) {
			out.push(
				diagnostic("AMK0607", "A pitch slide or $DD note is still pending at a loop or channel boundary.", event.span),
			);
		}

		if (event.char === "t" && eventText(text, event).startsWith("tuning[")) {
			out.push(
				diagnostic("AMK0608", "Songs that retune an instrument with tuning[n]= cannot be normalized.", event.span),
			);
		}

		if (event.loop?.kind === "call" && event.loop.at === 0xffff) {
			out.push(
				diagnostic("AMK0602", "This * repeats a loop that was never written, which cannot be unrolled.", event.span),
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
				diagnostic("AMK0613", "A replacement that defines another replacement cannot be written out.", definition.span),
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
						"AMK0610",
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
	const open: { index: number; at: number; remote: boolean; sub: boolean }[] = [];

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
				open.push({ index, at: -1, remote: false, sub: true });
				break;

			case "close": {
				const opened = open.pop();
				if (!opened || opened.sub) {
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
					break;
				}

				constructs.push({
					kind: "subloop",
					start: events[opened.index].span.start,
					end: event.span.end,
					first: opened.index,
					last: index,
					count: loop.count,
					body: {
						start: events[opened.index].span.end,
						end: event.span.start,
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
									"AMK0602",
									"This * repeats a loop that was never written, which cannot be unrolled.",
									event.span,
								)
							: diagnostic("AMK0603", "A loop call could not be matched to its body.", event.span),
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
						diagnostic("AMK0610", `An octave of ${to.octave} cannot be written with o.`, events[construct.first].span),
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
							"AMK0610",
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
					const code = notesFrom === body.openIndex + 1 ? "AMK0604" : "AMK0605";
					const message =
						code === "AMK0604"
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
	const { text, trace } = input;
	const events = trace.events;
	const lineEnd = eol(text);
	const markers = events.map((_, index) => index).filter((index) => isMarker(text, events[index]));
	if (markers.length === 0) {
		return unchanged(text);
	}

	const diagnostics: Diagnostic[] = [];
	for (const index of markers) {
		const state = stateBefore(trace, index);
		if (state.inPitchSlide || state.nextNoteIsForDD || state.triplet) {
			diagnostics.push(
				diagnostic(
					"AMK0609",
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
						"AMK0612",
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
					diagnostics.push(diagnostic("AMK0610", `An octave of ${piece.start.octave} cannot be written with o.`));
				} else {
					prefix.push(octave);
				}
			}

			if (carried.defaultNoteLength !== piece.start.defaultNoteLength) {
				const length = spellLength(piece.start.defaultNoteLength, "l", trace.targetAMKVersion);
				if (length === null) {
					diagnostics.push(
						diagnostic(
							"AMK0610",
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
 * Writes out what each channel's first block left implied: `o`, `l`, `q` and
 * `@` with the values its first note was parsed under, and `t` at the top of
 * the lowest channel for a song that never sets one. Each only where no such
 * command already precedes the channel's first note, so a song that says
 * everything is left alone. Every `<` and `>` becomes the absolute `o` it
 * produced.
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
		if (channel === lowest && !options.tempoAtStart) {
			const ratio = trace.targetAMKVersion >= 4 ? trace.tempoRatio : 1;
			const tempo = options.bootTempo * ratio;
			if (Number.isInteger(tempo) && tempo >= 0 && tempo <= 255) {
				parts.push(`t${tempo}`);
			} else {
				diagnostics.push(
					diagnostic(
						"AMK0611",
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
					diagnostic("AMK0610", `An octave of ${entering.octave} cannot be written with o.`, events[index].span),
				);
			}
		}

		if (!seen.has("l")) {
			const length = spellLength(entering.defaultNoteLength, "l", trace.targetAMKVersion);
			if (length !== null) {
				parts.push(`l${length}`);
			} else if (hasNote) {
				diagnostics.push(
					diagnostic(
						"AMK0610",
						`A default length of ${entering.defaultNoteLength} ticks has no l this target can write.`,
						events[index].span,
					),
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
		if (!isPitched(event) || event.state.inRemoteDefinition) {
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
