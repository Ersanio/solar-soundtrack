/**
 * Where a song's loop brackets are, what each construct repeats and names, and
 * which label numbers it has already used.
 *
 * AddmusicK allows exactly one `[ ]` and one `[[ ]]` open at a time, in either
 * order (`parser.ts:parseLoopStart`, Music.cpp:1216 and :1229), and the two
 * variables that decide it are `channel === 8` and `inE6Loop`. This reads those
 * two off the token stream, for a palette that has to answer "may a loop go
 * here" *before* the text exists — the same job `availability.ts` does for the
 * dialect rules, and held to the compiler the same way by `palettetest`.
 *
 * The same pass answers what a construct *is*, which the descriptor tables
 * cannot: a `ParamDescriptor` is bound to one argument of one command, and
 * a loop's count sits on the second of two `]` commands, or on no command at all
 * for a `(n)m`, or one less than itself for a `$E6`. {@link loopAt} is that
 * question, and {@link loopTargets} is the set of bodies a call may name.
 *
 * A construct is read off the bytes a spelling leaves rather than off the
 * dispatch character: `[[ ]]n` and a hand-written `$E6 $00` … `$E6 $nn` are one
 * construct and are counted as one, which is the reading `parser.ts:loopEventOf`
 * has to take too. `[[` is told from `[` by **adjacency**, because that is what
 * the parser tests — `text[this.pos] === "["`, with no space skipped — so `[ [`
 * is a nested standard loop and an error rather than a subloop.
 */

import type { Command, Token, TokenIndex } from "../tokens";

/** A range of the source, as this module deals in them: offsets, no line. */
export interface LoopRange {
	start: number;
	end: number;
}

/**
 * Where a construct's repeat count is written, and what it comes to.
 *
 * Read off the {@link Command} wherever a spelling gathers one, which is four of
 * the five: a count written through a replacement is in the expansion `gather`
 * sees and not in the digits, so `"n=4"` used as `[ c4 ]n` really does play four
 * times. Only `(n)m` has no command to read — `label` is not a letter command
 * kind — and its digits are literal by construction.
 */
export interface LoopCount {
	/** The digits' own range, or an empty one at the offset a count would be written at. */
	at: LoopRange;
	/**
	 * Where the command whose first argument this is begins — what
	 * `commandStartingAt` takes — or `null` for a `(n)m`, which raises none.
	 *
	 * Recorded rather than looked up again: for a `]]n` it is the *second* `]`,
	 * which nothing downstream could work out from {@link at} alone.
	 */
	on: number | null;
	/**
	 * Passes, as AddmusicK counts them. `null` where none is written and none is
	 * implied, which is a subloop: `]]` with no count is AMK0128, where `]`, `*`
	 * and `(n)m` all default a missing `getInt` to 1.
	 */
	plays: number | null;
	/** `$E6 $nn` writes one less than the count; every other spelling writes it plain. */
	lessOne: boolean;
}

/** One paired loop construct: its two brackets, and the body between them. */
export interface LoopSpan {
	/** `"call"` for a `[ ]` body, which moves the parser to channel 8; `"sub"` for `[[ ]]` and `$E6`. */
	kind: "call" | "sub";
	/** The opening construct's first character, reaching back over an abutting `(n)` or `(!n)`. */
	from: number;
	/** Just past the opening construct — the body's first character. */
	bodyFrom: number;
	/** The closing construct's first character. */
	bodyTo: number;
	/** Just past the closing construct, its repeat count included. */
	to: number;
	/**
	 * The `n` of the `(n)` written hard against the `[`, which is what a `(n)m`
	 * recalls it by. `null` for a bare `[`, for every subloop, and for a `(!n)`,
	 * whose number is a remote slot rather than a label a call may name.
	 *
	 * A `(n)` is carried past a `[[` to the next `[` by the parser — `loopLabel`
	 * survives from `(n)[` until the matching `]` (`parser.ts:parseLoopStart`) —
	 * and that is not read here: the label is taken only where it is hard against
	 * the bracket it names, so `(5)[[d]]4 [e]2` leaves the second loop unnamed
	 * rather than named wrongly. {@link LoopReading.slots} is unaffected, so the
	 * allocator still sees the slot as taken.
	 */
	label: number | null;
	/** The digits between that `(` and its `)`, for a reader that rewrites them. */
	labelAt: LoopRange | null;
	/** A `(!n)[ … ]` definition. Its body cannot repeat at all — AMK0164. */
	remote: boolean;
	count: LoopCount;
}

/** A `$E9` written where it stands rather than closing a body: a `(n)m` or a `*n`. */
export interface LoopRecall {
	/** Told apart because only one of the two names the body it plays. */
	kind: "label" | "star";
	from: number;
	to: number;
	/** The `n` of a `(n)m`; `null` for a `*n`, which names its body by position. */
	label: number | null;
	labelAt: LoopRange | null;
	count: LoopCount;
}

/** Either of the two, for a reader that asks "what construct is this". */
export type LoopConstruct = LoopSpan | LoopRecall;

/** Everything a reader needs to know about a song's loops, from one pass. */
export interface LoopReading {
	/** Every `[ ]` and `[[ ]]` that paired up, in the order they closed. */
	spans: readonly LoopSpan[];
	recalls: readonly LoopRecall[];
	/**
	 * Every label slot the song has already spoken for.
	 *
	 * A `(n)` takes slot `n + 1` and a `(!n)` takes slot `n`, because
	 * `parseLabelLoop` offsets by one so that label 0 is usable and
	 * `parseRemoteDefinition` does not (`parser.ts:2460`, `:2517-2518`). So `(0)`
	 * and `(!1)` are the same slot, and writing both is AMK0124.
	 */
	slots: ReadonlySet<number>;
	/**
	 * Whether every bracket paired up under the rules above.
	 *
	 * False for a song the compiler would reject — a `[` inside a `[`, a `[[`
	 * inside a `[[`, a `[[[`, a close with nothing open, a marker crossed while
	 * something is open, or anything left open at the end. A reader that is about
	 * to write a bracket has nothing to reason from when this is false.
	 */
	sound: boolean;
}

/** The highest `n` a `(n)` may be written with: `parseLabelLoop` rejects `n + 1 >= 0x10000`. */
export const MAX_LOOP_LABEL = 0xfffe;

export function readLoops(source: string, index: TokenIndex): LoopReading {
	const byStart = new Map<number, Command>();
	for (const command of index.commands) {
		byStart.set(command.span.start, command);
	}

	const spans: LoopSpan[] = [];
	const recalls: LoopRecall[] = [];
	const slots = new Set<number>();
	let sound = true;

	type Named = Pick<LoopSpan, "label" | "labelAt" | "remote">;
	let call: (Named & { from: number; bodyFrom: number }) | null = null;
	let sub: { from: number; bodyFrom: number } | null = null;

	/**
	 * The `(n)[` met on an earlier token, waiting for its bracket.
	 *
	 * Not cleared between the two: `at` is the `(`'s own offset and the bracket
	 * matches on it through `labelBefore`, which only reaches back over a `)`
	 * hard against it — so a label left standing can never be claimed by a `[`
	 * written somewhere else.
	 */
	let declared: (Named & { at: number }) | null = null;

	const tokens = index.tokens;
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		const twin = tokens[i + 1];

		if (token.kind === "channel") {
			// `parseChannelDirective` writes `channel` outright, so a marker met
			// inside an open `[` leaves the `]` with nothing to close (AMK0129).
			if (call !== null || sub !== null) {
				sound = false;
			}
		} else if (token.kind === "loopStart") {
			if (twin?.kind === "loopStart" && twin.start === token.end) {
				const third = tokens[i + 2];
				if ((third?.kind === "loopStart" && third.start === twin.end) || sub !== null) {
					sound = false; // AMK0120, AMK0121
				}

				sub = { from: token.start, bodyFrom: twin.end };
				i++;
			} else {
				if (call !== null) {
					sound = false; // AMK0123
				}

				const from = labelBefore(source, token.start);
				const named = declared !== null && declared.at === from ? declared : null;
				call = {
					from,
					bodyFrom: token.end,
					label: named?.label ?? null,
					labelAt: named?.labelAt ?? null,
					remote: named?.remote ?? false,
				};
			}
		} else if (token.kind === "loopEnd") {
			if (twin?.kind === "loopEnd" && twin.start === token.end) {
				// The count is on the *second* `]`, which is the token `gather`
				// gave it to; the first closes nothing and takes no argument.
				const count = gatheredCount(byStart.get(twin.start), twin.end, false, null);
				if (sub === null) {
					sound = false; // AMK0127
				} else {
					spans.push({
						kind: "sub",
						...sub,
						bodyTo: token.start,
						to: count.at.end,
						label: null,
						labelAt: null,
						remote: false,
						count,
					});
				}

				sub = null;
				i++;
			} else {
				const count = gatheredCount(byStart.get(token.start), token.end, false, 1);
				if (call === null) {
					sound = false; // AMK0129
				} else {
					spans.push({ kind: "call", ...call, bodyTo: token.start, to: count.at.end, count });
				}

				call = null;
			}
		} else if (token.kind === "loopCall") {
			// `*n`. No check that a previous loop exists, because the compiler has
			// none either (`parser.ts:parseStarLoop`) — it is still a `$E9`.
			const count = gatheredCount(byStart.get(token.start), token.end, false, 1);
			recalls.push({ kind: "star", from: token.start, to: count.at.end, label: null, labelAt: null, count });
		} else if (token.kind === "label" && token.end === token.start + 1 && source[token.start] === "(") {
			const close = closingLabel(source, tokens, i);
			const named = close === null ? null : labelIn(source.slice(token.end, close.start));
			if (close !== null && named !== null) {
				slots.add(named.slot);
				// The digits themselves, so a rewrite touches the number and not
				// the parentheses round it. A `(!n)` names a remote slot rather
				// than a label a call may reach, so it offers none.
				const labelAt = named.remote ? null : { start: token.end, end: close.start };
				// A `(n)` with a `[` hard against it declares the body, and that `[`
				// raises the span; anything else is a recall and emits its own `$E9`.
				if (source[close.end] === "[") {
					declared = { at: token.start, label: named.remote ? null : named.written, labelAt, remote: named.remote };
				} else if (!named.remote) {
					const count = writtenCount(source, close.end);
					recalls.push({
						kind: "label",
						from: token.start,
						to: count.at.end,
						label: named.written,
						labelAt,
						count,
					});
				}
			}
		} else if (token.kind === "hex") {
			const command = byStart.get(token.start);
			if (command?.vcmd !== 0xe6) {
				continue;
			}

			if (command.args[0]?.value === 0) {
				if (sub !== null) {
					sound = false; // AMK0159
				}

				sub = { from: command.span.start, bodyFrom: command.span.end };
			} else if (sub === null) {
				sound = false; // AMK0160
			} else {
				// The driver plays arg + 1 passes, which is what `]]n` writes n - 1
				// for (`parser.ts:parseLoopEnd`), so the count and the byte differ.
				const count = gatheredCount(command, command.span.end, true, null);
				spans.push({
					kind: "sub",
					...sub,
					bodyTo: command.span.start,
					to: command.span.end,
					label: null,
					labelAt: null,
					remote: false,
					count,
				});
				sub = null;
			}
		}
	}

	return { spans, recalls, slots, sound: sound && call === null && sub === null };
}

/**
 * The construct whose own text `offset` sits in — a bracket, its count, its
 * label, a `(n)m`, a `*n` or either `$E6` arm.
 *
 * **Not** its body, which is {@link loopStateAt}'s question. Inclusive at both
 * ends, the convention `commandAt` takes, and the narrowest run wins so a
 * subloop's bracket inside a loop answers for the subloop.
 */
export function loopAt(reading: LoopReading, offset: number): LoopConstruct | null {
	let best: LoopConstruct | null = null;
	let width = Number.POSITIVE_INFINITY;

	const take = (construct: LoopConstruct, from: number, to: number): void => {
		if (offset >= from && offset <= to && to - from < width) {
			width = to - from;
			best = construct;
		}
	};

	for (const span of reading.spans) {
		// Two runs, not one: the body between them belongs to the notes in it, and
		// the opening run stops one short of `bodyFrom` for exactly that reason —
		// the body's first character is a note's, and a caller that suppresses a
		// command's own readout here must not suppress that note's.
		take(span, span.from, span.bodyFrom - 1);
		take(span, span.bodyTo, span.to);
	}

	for (const recall of reading.recalls) {
		take(recall, recall.from, recall.to);
	}

	return best;
}

/**
 * Every construct `offset` is inside at all — its brackets, its body, its count
 * or its label — innermost first.
 *
 * The wider question {@link loopAt} narrows: a note in the middle of a body is
 * inside the loop that plays it and is on no bracket of it, and both readings
 * are wanted. Ordered by how much text each covers, so a subloop is named ahead
 * of the loop around it.
 */
export function loopsAt(reading: LoopReading, offset: number): readonly LoopConstruct[] {
	const found: LoopConstruct[] = [];
	for (const span of reading.spans) {
		if (offset >= span.from && offset <= span.to) {
			found.push(span);
		}
	}

	for (const recall of reading.recalls) {
		if (offset >= recall.from && offset <= recall.to) {
			found.push(recall);
		}
	}

	return found.sort((a, b) => a.to - a.from - (b.to - b.from));
}

/**
 * The labelled bodies a call written at `before` may name — `loopPointers`' own
 * contents at that point in the parse.
 *
 * Opened above the offset, because that is where `parseLoopStart` writes the
 * pointer (`parser.ts:2727`) and `parseLabelLoop` refuses a label it cannot
 * find there (AMK0115). Never a `(!n)`: it takes a slot, so the allocator counts
 * it, but a `$E9` into a remote body is not a call any reader here should offer.
 */
export function loopTargets(reading: LoopReading, before: number): readonly LoopSpan[] {
	return reading.spans.filter(
		(span) => span.kind === "call" && !span.remote && span.label !== null && span.from < before,
	);
}

/** Whether `offset` sits inside a body of each kind — the parser's two variables. */
export function loopStateAt(reading: LoopReading, offset: number): { inCall: boolean; inSub: boolean } {
	let inCall = false;
	let inSub = false;
	for (const span of reading.spans) {
		if (offset < span.bodyFrom || offset > span.bodyTo) {
			continue;
		}

		if (span.kind === "call") {
			inCall = true;
		} else {
			inSub = true;
		}
	}

	return { inCall, inSub };
}

/** What a run of text holds, and whether any construct has only one end inside it. */
export interface LoopContents {
	/** A `[ ]` body, a `(n)m` or a `*n` — everything that emits a `$E9`. */
	holdsCall: boolean;
	/** A `[[ ]]` or a hand-written `$E6` pair. */
	holdsSub: boolean;
	/** A construct with one bracket inside the run and the other outside it. */
	crosses: boolean;
}

export function loopContents(reading: LoopReading, start: number, end: number): LoopContents {
	const within = (at: number): boolean => at >= start && at < end;
	let holdsCall = false;
	let holdsSub = false;
	let crosses = false;

	for (const span of reading.spans) {
		const opens = within(span.from);
		if (opens !== within(span.bodyTo)) {
			crosses = true;
		} else if (opens) {
			if (span.kind === "call") {
				holdsCall = true;
			} else {
				holdsSub = true;
			}
		}
	}

	for (const recall of reading.recalls) {
		if (within(recall.from)) {
			holdsCall = true;
		}
	}

	return { holdsCall, holdsSub, crosses };
}

/**
 * The lowest `n` a fresh `(n)` may be written with, or `null` where every one is
 * taken.
 *
 * From 0 up, which is what the `i++` at `Music.cpp:1156` exists to allow.
 */
export function nextLoopLabel(slots: ReadonlySet<number>): number | null {
	for (let label = 0; label <= MAX_LOOP_LABEL; label++) {
		if (!slots.has(label + 1)) {
			return label;
		}
	}

	return null;
}

/**
 * The count a `]`, a `]]`, a `*` or a `$E6` gathered, or the empty offset one
 * would be written at.
 *
 * Off the {@link Command} rather than off the digits, because those are not the
 * same thing: `"n=4"` used as `[ c4 ]n` gathers a 4 from the expansion where the
 * source at that offset holds no digits at all. It is also what carries
 * `edits.ts`'s per-part macro interlock through to the writer.
 *
 * `missing` is what the spelling plays when no count is written — 1 for `]`, `*`
 * and `(n)m`, and `null` for a subloop, where a missing count is AMK0128.
 */
function gatheredCount(command: Command | undefined, at: number, lessOne: boolean, missing: number | null): LoopCount {
	const on = command?.span.start ?? null;
	const arg = command?.args[0];
	if (arg === undefined) {
		return { at: { start: at, end: at }, on, plays: missing, lessOne };
	}

	return {
		at: { start: arg.span.start, end: arg.span.end },
		on,
		plays: lessOne ? arg.value + 1 : arg.value,
		lessOne,
	};
}

/** The same for a `(n)m`, whose digits no command gathers — `label` is not a letter command kind. */
function writtenCount(source: string, at: number): LoopCount {
	const end = countEnd(source, at);
	return {
		at: { start: at, end },
		on: null,
		plays: end > at ? Number.parseInt(source.slice(at, end), 10) : 1,
		lessOne: false,
	};
}

/** The digits a count is written with, read as `getInt` reads them: no spaces skipped. */
function countEnd(source: string, at: number): number {
	let end = at;
	while (end < source.length && source[end] >= "0" && source[end] <= "9") {
		end++;
	}

	return end;
}

/**
 * The `(n)` or `(!n)` written hard against a `[`, in `widenOverLabel`'s mould
 * (`roll-strip.ts`) — a declaration's construct begins at its label, so a reader
 * asking whether the construct is inside a run has to see the whole of it.
 */
function labelBefore(source: string, at: number): number {
	if (source[at - 1] !== ")") {
		return at;
	}

	let back = at - 2;
	while (back >= 0 && /[\d!\t ]/.test(source[back])) {
		back--;
	}

	return back >= 0 && source[back] === "(" && back < at - 2 ? back : at;
}

/**
 * The `)` that closes the `(` at `i`, or `null` where the run is not a label.
 *
 * Within four tokens, which is as far as `(`, `!`, the number and `)` reach; a
 * `("kick.brr", $02)` sample load runs longer than that and names no label.
 */
function closingLabel(source: string, tokens: readonly Token[], i: number): Token | null {
	for (let j = i + 1; j < tokens.length && j <= i + 4; j++) {
		if (tokens[j].kind === "label") {
			return source[tokens[j].start] === ")" ? tokens[j] : null;
		}
	}

	return null;
}

/**
 * The slot `(…)` names, or `null` where it names none.
 *
 * `(!!n)` is the reset form, whose number is an event type rather than a label
 * (`parser.ts:parseRemoteCall`), so it takes no slot. The remote form tolerates
 * spaces where `(n)` does not, since `parseRemoteDefinition` calls `skipSpaces`
 * and `getInt` skips none.
 */
function labelIn(text: string): { slot: number; written: number; remote: boolean } | null {
	if (text.startsWith("!!")) {
		return null;
	}

	const remote = text.startsWith("!");
	const digits = remote ? text.slice(1).trim() : text;
	if (!/^\d+$/.test(digits)) {
		return null;
	}

	const written = Number.parseInt(digits, 10);
	return { slot: remote ? written : written + 1, written, remote };
}
