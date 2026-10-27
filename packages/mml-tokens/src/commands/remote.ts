/**
 * Remote code calls and resets — `(!n, type[, wait])` and `(!!n)` — and the body
 * a call runs.
 *
 * Neither raises a {@link Command}: `(` is not a letter command kind, and the
 * parts scan as a label, an unknown `!`, numbers and commas. So this reads them
 * off the text the way `parser.ts:parseRemoteCall` does (Music.cpp:1003-1123),
 * for an inspector that has to show each part and rewrite it.
 */

import { TICKS_PER_WHOLE } from "@amk/core/hardcoded-tables";
import { channelsBeginAt, songTarget } from "../dialect";
import { type Command, type CommandTarget, type TokenIndex, resolveDefaultLength, resolveNoteSegment } from "../tokens";
import { commandScope } from "./in-force";
import type { LoopRange, LoopReading, LoopSpan } from "./loops";

/** A call's third argument, which only types 1 and 2 read. */
export interface RemoteWait {
	/** The whole spelling: `$` and its digits, or a length with its `=` and dots. */
	at: LoopRange;
	/** What the driver counts, 1-256. 256 is written as 0 (Music.cpp:1099-1102), and `$00` counts 256. */
	ticks: number;
	/** Written as `$hh` rather than as a length. */
	hex: boolean;
}

/** `(!n, type[, wait])`, below the first channel. */
export interface RemoteCall {
	kind: "call";
	/** The `(`. */
	from: number;
	/** Just past the `)`. */
	to: number;
	label: number;
	labelAt: LoopRange;
	/** As written; `-1` is emitted as `$FF`. */
	type: number;
	typeAt: LoopRange;
	wait: RemoteWait | null;
	/** What was written between the first comma and the type, for a writer that adds a wait. */
	separator: string;
}

/** `(!!n)`: 0 cancels both slots, -1 the key-on slot, anything else the other (Music.cpp:1017-1061). */
export interface RemoteReset {
	kind: "reset";
	from: number;
	to: number;
	which: number;
	whichAt: LoopRange;
}

export type RemoteConstruct = RemoteCall | RemoteReset;

/** One event type, named for what `cmdFC` does with it (Commands.asm:1242-1352). */
export interface RemoteEvent {
	/** As a call writes it. */
	type: number;
	/** What a select shows after the number. */
	name: string;
	/** What it does, in a sentence. */
	note: string;
}

/**
 * Every type the driver tests for, in the readme's order. 5 and 6 are "reserved"
 * there and are what the compiler itself emits for `#amk 1` gain; 7, 8 and -1 are
 * documented only in the syntax reference. COMMANDS.html's `$FC` table is the
 * longer account.
 */
export const REMOTE_EVENTS: readonly RemoteEvent[] = [
	{
		type: 0,
		name: "cancel every remote code",
		note: "Cancels this channel's remote code, the key-on kind included. Nothing is run.",
	},
	{
		type: 1,
		name: "run after a set time",
		note: "Runs the code this long after each note keys on. Ties and rests do not count, and a wait longer than the note never fires.",
	},
	{
		type: 2,
		name: "run before a note ends",
		note: "Runs the code this long before each note is cut, which its q decides.",
	},
	{
		type: 3,
		name: "run on key-off, instead of the note cut",
		note: "Runs the code where each note would be cut, and the note keeps sounding until the next one.",
	},
	{
		type: 4,
		name: "run once, right now",
		note: "Runs the code once, here, alongside whatever else is set.",
	},
	{
		type: 5,
		name: "reserved; behaves as 2",
		note: "Reserved. The driver handles it exactly as type 2.",
	},
	{
		type: 6,
		name: "reserved; a key-on slot that fires at key-off",
		note: "Reserved. Stored as key-on code, and run at key-off like type 3.",
	},
	{
		type: 7,
		name: "cancel all but the key-on code",
		note: "Cancels this channel's remote code except the key-on kind. Nothing is run.",
	},
	{
		type: 8,
		name: "cancel the key-on code",
		note: "Cancels this channel's key-on code. Nothing is run.",
	},
	{
		type: -1,
		name: "run on key-on, alongside the rest",
		note: "Runs the code as each note keys on, before it sounds. It can run alongside any other type.",
	},
];

/** A type the driver never tests for is stored in the normal slot and never run (Commands.asm:1260-1269). */
export const UNKNOWN_EVENT_NOTE =
	"No such type: the code is stored and never run, but it replaces a running type 1, 2, 3 or 5.";

/** The two types that count from a note, and so the two a wait is read for (Music.cpp:1085). */
export function takesWait(type: number): boolean {
	return type === 1 || type === 2;
}

/** Types 0, 7 and 8 discard the address (Commands.asm:1247-1258), so no body is run. */
export function runsCode(type: number): boolean {
	return ![0x00, 0x07, 0x08].includes(type & 0xff);
}

/** Every call and reset in the song, in source order. Constructs that would not compile are left out. */
export function readRemote(source: string, index: TokenIndex): RemoteConstruct[] {
	const target = songTarget(index);
	const channels = channelsBeginAt(index);
	// AMK0117 below `#amk 2`; above the first channel a `(!n)` is a definition.
	if (target.amkVersion < 2 || channels === null) {
		return [];
	}

	const found: RemoteConstruct[] = [];
	const tokens = index.tokens;
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		const opens =
			token.kind === "label" &&
			token.end === token.start + 1 &&
			source[token.start] === "(" &&
			source[token.end] === "!";
		if (!opens || token.start < channels) {
			continue;
		}

		const read = readOne(source, token.start, target, () => standingLength(source, index.commands, token.start));
		if (read === null) {
			continue;
		}

		// `getInt` and `getHex` expand a replacement first (`parser.ts:558-620`),
		// which a reading of the literal text cannot follow.
		let replaced = false;
		let j = i + 1;
		for (; j < tokens.length && tokens[j].start < read.to; j++) {
			replaced ||= tokens[j].kind === "replacement";
		}

		if (!replaced) {
			found.push(read);
		}

		i = j - 1;
	}

	return found;
}

/** The construct whose text `offset` is in, inclusive at both ends as `commandAt` is. */
export function remoteAt(constructs: readonly RemoteConstruct[], offset: number): RemoteConstruct | null {
	return constructs.find((each) => offset >= each.from && offset <= each.to) ?? null;
}

/**
 * The body a call runs: what `loopPointers[n]` holds when the call is parsed
 * (`parser.ts:2489`). Slot 0 is never recorded, and a body declared below the
 * call is not recorded yet, so both answer `null` — the SST0509 case.
 */
export function remoteBody(loops: LoopReading, call: RemoteCall): LoopSpan | null {
	if (call.label <= 0) {
		return null;
	}

	return loops.spans.find((span) => span.slot === call.label && span.from < call.from) ?? null;
}

/** The commands written inside a body, less its own loop brackets and anything else structural. */
export function bodyCommands(index: TokenIndex, body: LoopSpan): Command[] {
	return index.commands.filter(
		(command) =>
			command.span.start >= body.bodyFrom && command.span.end <= body.bodyTo && commandScope(command) !== "structure",
	);
}

function readOne(source: string, from: number, target: CommandTarget, standing: () => number): RemoteConstruct | null {
	// `parseLabelLoop` steps over `(!` and the spaces after it (Music.cpp:1007-1013).
	let pos = skipSpaces(source, from + 2);

	if (target.amkVersion >= 3 && source[pos] === "!") {
		const which = signedAt(source, pos + 1);
		if (which === null) {
			return null; // AMK0138
		}

		pos = skipSpaces(source, which.at.end);
		if (source[pos] !== ")") {
			return null; // AMK0139
		}

		return { kind: "reset", from, to: pos + 1, which: which.value, whichAt: which.at };
	}

	const label = digitsAt(source, pos);
	if (label === null) {
		return null; // AMK0143
	}

	pos = skipSpaces(source, label.at.end);
	if (source[pos] !== ",") {
		return null; // AMK0144
	}

	const afterComma = pos + 1;
	pos = skipSpaces(source, afterComma);
	const separator = source.slice(afterComma, pos);
	const type = signedAt(source, pos);
	if (type === null) {
		return null; // AMK0145
	}

	pos = skipSpaces(source, type.at.end);

	let wait: RemoteWait | null = null;
	if (takesWait(type.value)) {
		if (source[pos] !== ",") {
			return null; // AMK0146
		}

		pos = skipSpaces(source, pos + 1);
		wait = source[pos] === "$" ? hexWait(source, pos) : lengthWait(source, pos, target, standing);
		if (wait === null) {
			return null; // AMK0147, AMK0148, AMK0010
		}

		pos = skipSpaces(source, wait.at.end);
	}

	if (source[pos] !== ")") {
		return null; // AMK0149
	}

	if (source[pos + 1] === "[") {
		return null; // AMK0153
	}

	return {
		kind: "call",
		from,
		to: pos + 1,
		label: label.value,
		labelAt: label.at,
		type: type.value,
		typeAt: type.at,
		wait,
		separator,
	};
}

/** `getHex`: at most two digits (`parser.ts:594-620`). */
function hexWait(source: string, dollar: number): RemoteWait | null {
	let pos = dollar + 1;
	while (pos < source.length && pos - dollar <= 2 && isHexDigit(source[pos])) {
		pos++;
	}

	if (pos === dollar + 1) {
		return null;
	}

	const value = Number.parseInt(source.slice(dollar + 1, pos), 16);
	return { at: { start: dollar, end: pos }, ticks: value === 0 ? 0x100 : value, hex: true };
}

/**
 * `getNoteLength(getInt())` (`parser.ts:637-666`), through the scanner's own
 * reading of it. A wait inside `{ }` would take the triplet as well, which this
 * leaves out.
 */
function lengthWait(source: string, at: number, target: CommandTarget, standing: () => number): RemoteWait | null {
	let pos = at;
	while (isDigit(source[pos])) {
		pos++;
	}

	let dotted = true;
	if (pos === at && source[pos] === "=") {
		pos++;
		const digits = pos;
		while (isDigit(source[pos])) {
			pos++;
		}

		if (pos === digits) {
			return null; // AMK0010
		}

		// Exact counts take no dots below `#amk 4` (`parser.ts:647-650`).
		dotted = target.amkVersion >= 4;
	}

	while (dotted && source[pos] === ".") {
		pos++;
	}

	const ticks = resolveNoteSegment(source.slice(at, pos), standing(), false, target).ticks;
	if (ticks > 0x100) {
		return null; // AMK0148
	}

	return { at: { start: at, end: pos }, ticks: ticks === 0 ? 0x100 : ticks, hex: false };
}

/** The `l` standing at `before`, which a wait with no digits falls back to (`parser.ts:651-652`). */
function standingLength(source: string, commands: readonly Command[], before: number): number {
	let ticks = TICKS_PER_WHOLE / 8; // parser.ts:defaultNoteLength
	for (const command of commands) {
		if (command.span.start >= before) {
			break;
		}

		const arg = command.args[0];
		if (command.kind === "l" && arg !== undefined) {
			const raw = arg.replacement === undefined ? source.slice(arg.span.start, arg.span.end) : String(arg.value);
			ticks = resolveDefaultLength(raw, ticks, command.target);
		}
	}

	return ticks;
}

/** `getInt`: digits, nothing skipped first, no sign. */
function digitsAt(source: string, at: number): { value: number; at: LoopRange } | null {
	let pos = at;
	while (isDigit(source[pos])) {
		pos++;
	}

	return pos === at ? null : { value: Number.parseInt(source.slice(at, pos), 10), at: { start: at, end: pos } };
}

/** `getIntWithNegative`: an optional `-`, then digits. */
function signedAt(source: string, at: number): { value: number; at: LoopRange } | null {
	const digits = digitsAt(source, source[at] === "-" ? at + 1 : at);
	if (digits === null) {
		return null;
	}

	return { value: source[at] === "-" ? -digits.value : digits.value, at: { start: at, end: digits.at.end } };
}

/** `skipSpaces`, which crosses lines (`parser.ts:548-556`). */
function skipSpaces(source: string, at: number): number {
	let pos = at;
	while (pos < source.length && isSpace(source[pos])) {
		pos++;
	}

	return pos;
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";

const isHexDigit = (c: string): boolean => isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");

const isSpace = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\v" || c === "\f";
