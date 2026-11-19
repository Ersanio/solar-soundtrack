/** An `$FB` sequence whose count disagrees with the notes written after it, and the count that fits them. */

import { FIRST_VCMD, LAST_VCMD, VCMD } from "@amk/core/hardcoded-tables";
import { hex2 } from "@amk/core/hex";
import { SST } from "@amk/core/messages/sst";
import type { Diagnostic, Span } from "@amk/core/types";
import { type Command, type CommandTarget, type Token, type TokenIndex, expectedArgs } from "./tokens";

/**
 * `$FB`'s first byte is the number of note bytes after its duration (`parser.ts:parseHexCommand`
 * sets `hexLeft` from it), and AddmusicK takes it at its word either way. Too few notes, and the
 * run is still open at the next character that is not a `$` byte, which is AMK0155
 * (`parser.ts:scan`) — a `|` included, since that test comes before the `|` resets the run. Too
 * many, and each note past the count is dispatched as a command of its own, which a byte below
 * `$DA` under `#amk`, or `$FF` anywhere, is not: AMK0151 and AMK0152.
 *
 * So AddmusicK already refuses every song this finds. What it does not say is why, and the answer
 * is one byte: the count. A pure pass over the undebounced scan, as `command-hazards.ts` is, so
 * the warning and its fix are there while the song does not compile — which here is always.
 */

const CODE = "SST0518";

/** The byte that marks a sequence's loop point (`Commands.asm:1212-1213`). */
const LOOP_POINT = 0x80;

/** The longest sequence a count can ask for; `$80` and up are the trill and the glissando. */
const MAX_COUNT = 0x7f;

/** An `$FB` sequence whose count and notes disagree. */
export interface ArpeggioCountMismatch {
	command: Command;
	/** The count as written. */
	count: number;
	/** The note bytes written after the duration, the ones past the count included. */
	written: number;
	/** `short`: fewer notes than the count; `long`: more. */
	kind: "short" | "long";
	/** The run, and in the `long` case the notes past the count with it. */
	span: Span;
	/**
	 * In the `long` case, a counted note that reads as a command whose arguments are the bytes past
	 * the count, so the count may be too large rather than too small; `null` where none does.
	 */
	swallowed: number | null;
	/** The count that fits the notes written; `null` where no one count does. */
	fitting: number | null;
}

/** The index of the first token starting at or after `offset`. */
function tokenIndexAt(tokens: readonly Token[], offset: number): number {
	let low = 0;
	let high = tokens.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (tokens[middle].start < offset) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}

	return low;
}

/**
 * The `$XX` bytes standing straight after `command` that AddmusicK refuses as commands, with the
 * last one's token. Comments are skipped, since `preprocess.ts` takes them out before the parser
 * reads on; the first byte it would dispatch, and anything not a byte, ends the run.
 */
function refusedAfter(index: TokenIndex, text: string, command: Command): { bytes: number[]; last: Token | null } {
	const { tokens } = index;
	const bytes: number[] = [];
	let last: Token | null = null;
	for (let at = tokenIndexAt(tokens, command.span.end); at < tokens.length; at++) {
		const token = tokens[at];
		if (token.kind === "comment") {
			continue;
		}

		if (token.kind !== "hexArg") {
			break;
		}

		const value = Number.parseInt(text.slice(token.start + 1, token.end), 16);
		// `parser.ts:parseHexCommand` — legacy songs write bytes below `$DA` on purpose, with a warning.
		const refused = value > LAST_VCMD || (value < FIRST_VCMD && command.target.amkVersion !== 0);
		if (!refused) {
			break;
		}

		bytes.push(value);
		last = token;
	}

	return { bytes, last };
}

/** Whether `bytes` read from the first as whole commands, each taking the arguments `expectedArgs` gives it. */
function wholeCommands(bytes: readonly number[], target: CommandTarget): boolean {
	let at = 0;
	while (at < bytes.length) {
		const head = bytes[at];
		if (head < FIRST_VCMD || head > LAST_VCMD) {
			return false;
		}

		const args: { value: number }[] = [];
		let next = at + 1;
		for (;;) {
			const wanted = expectedArgs(head, args, target);
			if (wanted !== null && args.length >= wanted) {
				break;
			}

			if (next >= bytes.length) {
				return false;
			}

			args.push({ value: bytes[next] });
			next++;
		}

		at = next;
	}

	return true;
}

/**
 * The counted note that could be a command written after a shorter sequence: one in `$DA`-`$FE`
 * from which the rest of the counted notes and the refused bytes read as whole commands.
 */
function swallowedCommand(notes: readonly number[], refused: readonly number[], target: CommandTarget): number | null {
	for (let k = 0; k < notes.length; k++) {
		if (notes[k] >= FIRST_VCMD && notes[k] <= LAST_VCMD && wholeCommands([...notes.slice(k), ...refused], target)) {
			return notes[k];
		}
	}

	return null;
}

/**
 * A sequence the driver cannot play: a loop point in the last slot, a list of nothing but loop
 * points among them, sends it past the end and into the song after it (`SST0519`).
 */
function loopsPastEnd(notes: readonly number[]): boolean {
	return notes.length > 0 && notes[notes.length - 1] === LOOP_POINT;
}

/** The count, or `null` where it would not be a sequence or would be one the driver cannot play. */
function fitFor(notes: readonly number[]): number | null {
	return notes.length === 0 || notes.length > MAX_COUNT || loopsPastEnd(notes) ? null : notes.length;
}

/** What one `$FB` gets wrong about its count, or `null` where nothing does. */
function mismatchOf(index: TokenIndex, text: string, command: Command): ArpeggioCountMismatch | null {
	const count = command.args[0]?.value;
	if (count === undefined || count === 0 || count > MAX_COUNT || command.args.length < 2) {
		return null;
	}

	const notes = command.args.slice(2).map((arg) => arg.value);
	if (!command.complete) {
		// Ended only by something the parser does not read on through: a comment is gone before it
		// reads, and the end of the document is a run still being typed.
		const next = index.tokens.slice(tokenIndexAt(index.tokens, command.span.end)).find((t) => t.kind !== "comment");
		if (next === undefined || next.kind === "hex" || next.kind === "hexArg") {
			return null;
		}

		return {
			command,
			count,
			written: notes.length,
			kind: "short",
			span: { ...command.span },
			swallowed: null,
			fitting: fitFor(notes),
		};
	}

	const { bytes, last } = refusedAfter(index, text, command);
	if (last === null) {
		return null;
	}

	const swallowed = swallowedCommand(notes, bytes, command.target);
	const all = [...notes, ...bytes];
	return {
		command,
		count,
		written: all.length,
		kind: "long",
		span: { start: command.span.start, end: last.end, line: command.span.line },
		swallowed,
		fitting: swallowed === null ? fitFor(all) : null,
	};
}

/** Every `$FB` sequence in the document whose count disagrees with the notes written after it. */
export function arpeggioCountMismatches(index: TokenIndex, text: string): ArpeggioCountMismatch[] {
	const out: ArpeggioCountMismatch[] = [];
	for (const command of index.commands) {
		if (command.vcmd !== VCMD.Arpeggio) {
			continue;
		}

		const mismatch = mismatchOf(index, text, command);
		if (mismatch !== null) {
			out.push(mismatch);
		}
	}

	return out;
}

/** What the count gets wrong, in the words for its form. */
function describe(mismatch: ArpeggioCountMismatch): string {
	const count = `$${hex2(mismatch.count)}`;
	if (mismatch.kind === "short") {
		return mismatch.written === 0 ? SST["0518.none"](count) : SST["0518.short"](count, mismatch.written);
	}

	if (mismatch.swallowed !== null) {
		return SST["0518.ambiguous"](count, mismatch.written, `$${hex2(mismatch.swallowed)}`);
	}

	return SST["0518.long"](count, mismatch.written);
}

/** SST0518 on every `$FB` sequence whose count disagrees with its notes. */
export function arpeggioCounts(index: TokenIndex, text: string): Diagnostic[] {
	return arpeggioCountMismatches(index, text).map((mismatch) => ({
		severity: "warning",
		code: CODE,
		message: describe(mismatch),
		span: mismatch.span,
	}));
}
