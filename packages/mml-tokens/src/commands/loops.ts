/**
 * Where a song's loop brackets are, and which label numbers it has already used.
 *
 * AddmusicK allows exactly one `[ ]` and one `[[ ]]` open at a time, in either
 * order (`parser.ts:parseLoopStart`, Music.cpp:1216 and :1229), and the two
 * variables that decide it are `channel === 8` and `inE6Loop`. This reads those
 * two off the token stream, for a palette that has to answer "may a loop go
 * here" *before* the text exists — the same job `availability.ts` does for the
 * dialect rules, and held to the compiler the same way by `palettetest`.
 *
 * A construct is read off the bytes a spelling leaves rather than off the
 * dispatch character: `[[ ]]n` and a hand-written `$E6 $00` … `$E6 $nn` are one
 * construct and are counted as one, which is the reading `parser.ts:loopEventOf`
 * has to take too. `[[` is told from `[` by **adjacency**, because that is what
 * the parser tests — `text[this.pos] === "["`, with no space skipped — so `[ [`
 * is a nested standard loop and an error rather than a subloop.
 */

import type { Command, Token, TokenIndex } from "../tokens";

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
}

/** A `$E9` written where it stands rather than closing a body: a `(n)m` or a `*n`. */
export interface LoopRecall {
	from: number;
	to: number;
}

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

	let call: { from: number; bodyFrom: number } | null = null;
	let sub: { from: number; bodyFrom: number } | null = null;

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

				call = { from: labelBefore(source, token.start), bodyFrom: token.end };
			}
		} else if (token.kind === "loopEnd") {
			if (twin?.kind === "loopEnd" && twin.start === token.end) {
				if (sub === null) {
					sound = false; // AMK0127
				} else {
					spans.push({ kind: "sub", ...sub, bodyTo: token.start, to: countEnd(source, twin.end) });
				}

				sub = null;
				i++;
			} else {
				if (call === null) {
					sound = false; // AMK0129
				} else {
					spans.push({ kind: "call", ...call, bodyTo: token.start, to: countEnd(source, token.end) });
				}

				call = null;
			}
		} else if (token.kind === "loopCall") {
			// `*n`. No check that a previous loop exists, because the compiler has
			// none either (`parser.ts:parseStarLoop`) — it is still a `$E9`.
			recalls.push({ from: token.start, to: countEnd(source, token.end) });
		} else if (token.kind === "label" && token.end === token.start + 1 && source[token.start] === "(") {
			const close = closingLabel(source, tokens, i);
			const named = close === null ? null : labelIn(source.slice(token.end, close.start));
			if (close !== null && named !== null) {
				slots.add(named.slot);
				// A `(n)` with a `[` hard against it declares the body, and that `[`
				// raises the span; anything else is a recall and emits its own `$E9`.
				if (!named.remote && source[close.end] !== "[") {
					recalls.push({ from: token.start, to: countEnd(source, close.end) });
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
				spans.push({ kind: "sub", ...sub, bodyTo: command.span.start, to: command.span.end });
				sub = null;
			}
		}
	}

	return { spans, recalls, slots, sound: sound && call === null && sub === null };
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
function labelIn(text: string): { slot: number; remote: boolean } | null {
	if (text.startsWith("!!")) {
		return null;
	}

	const remote = text.startsWith("!");
	const digits = remote ? text.slice(1).trim() : text;
	if (!/^\d+$/.test(digits)) {
		return null;
	}

	const written = Number.parseInt(digits, 10);
	return { slot: remote ? written : written + 1, remote };
}
