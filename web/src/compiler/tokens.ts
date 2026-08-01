/**
 * A resumable scanner over MML source.
 *
 * Two things want to know what is written where: the command inspector, which
 * asks "what is under the caret", and — later — syntax highlighting. Rather
 * than write that twice, the core here is a line-oriented stepper carrying a
 * small copyable state, which is the shape CodeMirror's `StreamLanguage`
 * wants. `tokenize` below is one wrapper over it; the editor will be another.
 *
 * Two properties are load-bearing and `tokentest` checks both:
 *
 *   1. `step` never looks behind its own `at`, and never at another line. All
 *      context crosses a line boundary inside {@link ScanState}. That is what
 *      lets CodeMirror restart scanning at any line it likes.
 *   2. {@link copyState} is a real copy. CodeMirror keeps one state per line and
 *      would otherwise see them all mutate together.
 *
 * This deliberately does *not* go through the compiler. Compiler spans are
 * offsets into the preprocessed text — `preprocess.ts` drops the `#amk` marker,
 * `#define` lines and comments without preserving positions — whereas the
 * editor needs offsets into what the user actually typed. Scanning the raw text
 * also keeps working while the song does not compile, which is most of the time
 * while someone is typing.
 *
 * The trade is that this sees only what is written: commands introduced by a
 * `"a=b"` replacement or by `#define` are invisible here, and the inspector
 * shows nothing for them rather than showing something wrong.
 *
 * The dispatch mirrors `Music::parseHexCommand` / `Music::scan` as ported in
 * `parser.ts` — in particular the `hexLeft` / `currentHex` / `currentHexSub`
 * state machine at `parser.ts:195-199`, which is why a hex command split across
 * a line break still resolves. What it does not mirror is the target-program
 * forks (`#am4`'s `$ED` and `$E5`, `#amk 1`'s `$FC`): those need the directives
 * parsed, and getting them wrong costs a mis-coloured argument rather than a
 * wrong byte.
 */

import type { Span } from "../core/types";
import { FIRST_VCMD, HEX_LENGTHS, LAST_VCMD, VCMD_NAMES } from "./tables";

export type TokenKind =
	| "comment"
	| "directive"
	| "channel"
	| "note"
	| "rest"
	| "tie"
	| "octave"
	| "octaveShift"
	| "defaultLength"
	| "instrument"
	| "volume"
	| "globalVolume"
	| "pan"
	| "tempo"
	| "quantize"
	| "transpose"
	| "vibrato"
	| "noise"
	| "loopStart"
	| "loopEnd"
	| "loopCall"
	| "label"
	| "remote"
	| "replacement"
	| "string"
	| "hex"
	| "hexArg"
	| "number"
	| "operator"
	| "unknown";

/**
 * `TokenKind` to the `@lezer/highlight` tag that should colour it.
 *
 * Named rather than imported: `compiler/` runs under plain Node in the
 * harnesses and must not depend on CodeMirror. The editor resolves these
 * against `tags` when it builds the `tokenTable`.
 */
export const TOKEN_TAGS: Readonly<Record<TokenKind, string>> = {
	comment: "comment",
	directive: "meta",
	channel: "labelName",
	note: "literal",
	rest: "literal",
	tie: "literal",
	octave: "variableName",
	octaveShift: "variableName",
	defaultLength: "variableName",
	instrument: "variableName",
	volume: "variableName",
	globalVolume: "variableName",
	pan: "variableName",
	tempo: "variableName",
	quantize: "variableName",
	transpose: "variableName",
	vibrato: "variableName",
	noise: "variableName",
	loopStart: "bracket",
	loopEnd: "bracket",
	loopCall: "operator",
	label: "bracket",
	remote: "bracket",
	replacement: "string",
	string: "string",
	hex: "keyword",
	hexArg: "number",
	number: "number",
	operator: "operator",
	unknown: "invalid",
};

/** Human names for the single-letter commands, to match {@link VCMD_NAMES}. */
const LETTER_NAMES: Readonly<Record<string, string>> = {
	t: "tempo",
	v: "volume",
	w: "global volume",
	y: "pan",
	q: "quantization",
	l: "default length",
	o: "octave",
	"@": "instrument",
	h: "transpose",
	n: "noise",
	p: "vibrato",
	"<": "octave down",
	">": "octave up",
	"[": "loop start",
	"]": "loop end",
	"*": "loop call",
};

/** Which `TokenKind` a command letter introduces. */
const LETTER_KINDS: Readonly<Record<string, TokenKind>> = {
	t: "tempo",
	v: "volume",
	w: "globalVolume",
	y: "pan",
	q: "quantize",
	l: "defaultLength",
	o: "octave",
	"@": "instrument",
	h: "transpose",
	n: "noise",
	p: "vibrato",
};

/**
 * Everything the scanner must carry across a line boundary.
 *
 * Flat and small on purpose: CodeMirror copies it once per line, and anything
 * here that were a reference into the document would break that.
 */
export interface ScanState {
	/** Arguments still expected, mirroring the parser's own `hexLeft`. */
	hexLeft: number;
	/** The `$XX` those arguments belong to; `0` when none is open. */
	currentHex: number;
	/** Second byte, tracked only for `$FA`, as `parser.ts:2454` does. */
	currentHexSub: number;
	/**
	 * `$FB` takes its length from the byte after it (`parser.ts:2413-2424`), so
	 * that one byte has to be recognised as a count rather than an argument.
	 */
	awaitingArpCount: boolean;
	/** Inside a `"…"` run, which may span lines. */
	inString: boolean;
	/** Open `[` brackets, for future bracket matching. */
	loopDepth: number;
}

export function startState(): ScanState {
	return {
		hexLeft: 0,
		currentHex: 0,
		currentHexSub: 0,
		awaitingArpCount: false,
		inString: false,
		loopDepth: 0,
	};
}

export function copyState(state: ScanState): ScanState {
	return { ...state };
}

export interface StepResult {
	/** `null` for whitespace, which carries no highlight and is not a token. */
	kind: TokenKind | null;
	/** Offset just past the token. Always greater than the `at` passed in. */
	end: number;
}

const isSpace = (c: string): boolean =>
	c === " " || c === "\t" || c === "\r" || c === "\v" || c === "\f";
const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isAlpha = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
const isHexDigit = (c: string): boolean =>
	isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");

/** Notes, rests and ties — the `parser.ts:437-439` arm of the dispatch. */
const isNoteLetter = (c: string): boolean =>
	c === "c" || c === "d" || c === "e" || c === "f" || c === "g" || c === "a" || c === "b";

/**
 * Consumes one token from `line` starting at `at`, advancing `state`.
 *
 * Always makes progress: the fallback consumes a single character as `unknown`,
 * so no caller can spin. `at` must be less than `line.length`.
 */
export function step(line: string, at: number, state: ScanState): StepResult {
	const c = line[at];

	// A string may run past the end of a line, so it is checked before anything
	// else can claim the character.
	if (state.inString) return scanString(line, at, state);

	if (isSpace(c)) {
		let end = at + 1;
		while (end < line.length && isSpace(line[end])) end++;
		return { kind: null, end };
	}

	// `parser.ts:399` reports a stray character inside an unfinished hex command
	// and then dispatches it anyway — `hexLeft` is left standing rather than the
	// character being skipped. That is deliberately not special-cased here: the
	// compiler already raises AMK0155, and letting the character take its normal
	// arm is what lets `|` clear a half-written run (`parser.ts:435`), and what
	// colours the note in `$F5 $7F c4` as a note.

	switch (c) {
		case ";": {
			// `preprocess.ts` strips these before the parser sees them, so the
			// parser only ever meets AddmusicM comments — but they are comments in
			// the source either way, and the source is what is being scanned.
			return { kind: "comment", end: line.length };
		}

		case "$":
			return scanHex(line, at, state);

		case '"':
			return scanString(line, at, state);

		case "#":
			return scanHash(line, at);

		case "|":
			// `parser.ts:435` — a bar line abandons any half-written hex command.
			state.hexLeft = 0;
			state.currentHex = 0;
			state.awaitingArpCount = false;
			return { kind: "operator", end: at + 1 };

		case "[":
			state.loopDepth++;
			return { kind: "loopStart", end: at + 1 };

		case "]":
			if (state.loopDepth > 0) state.loopDepth--;
			return { kind: "loopEnd", end: at + 1 };

		case "*":
			return { kind: "loopCall", end: at + 1 };

		// `(` opens either a label loop or a sample load (`parser.ts:1694`). Both
		// are left to tokenise from their parts, so `("kick.brr", $02)` colours
		// its name as a string and its tuning as a number without this having to
		// know which form it is looking at.
		case "(":
		case ")":
			return { kind: "label", end: at + 1 };

		case "<":
		case ">":
			return { kind: "octaveShift", end: at + 1 };

		case "^":
			return { kind: "tie", end: at + 1 };

		case "?":
		case "/":
		case "&":
		case "{":
		case "}":
		case ",":
			return { kind: "operator", end: at + 1 };

		default:
			break;
	}

	// `=48` is an exact tick count attached to the note before it, and dots
	// extend a duration, so both belong to the number rather than floating free.
	if (isDigit(c) || (c === "=" && isDigit(line[at + 1]))) return scanNumber(line, at);

	const lower = c.toLowerCase();

	if (lower === "r") return { kind: "rest", end: scanNoteBody(line, at + 1) };
	if (isNoteLetter(lower)) return { kind: "note", end: scanNoteBody(line, at + 1) };

	const kind = LETTER_KINDS[lower] ?? LETTER_KINDS[c];
	if (kind) return { kind, end: at + 1 };

	return { kind: "unknown", end: at + 1 };
}

/** A note's accidental, if it has one — `getPitch`, `parser.ts:529-535`. */
function scanNoteBody(line: string, at: number): number {
	return line[at] === "+" || line[at] === "-" ? at + 1 : at;
}

function scanNumber(line: string, at: number): StepResult {
	let end = at;
	if (line[end] === "=") end++;
	while (end < line.length && isDigit(line[end])) end++;
	// Dotted durations. `..` is legal and doubles down, so the run is greedy.
	while (end < line.length && line[end] === ".") end++;
	return { kind: "number", end };
}

/**
 * `#amk 4` and friends versus a `#0` channel directive — `parser.ts:707-712`.
 */
function scanHash(line: string, at: number): StepResult {
	let end = at + 1;
	if (isAlpha(line[end])) {
		while (end < line.length && isAlpha(line[end])) end++;
		return { kind: "directive", end };
	}
	while (end < line.length && isDigit(line[end])) end++;
	return { kind: "channel", end };
}

/**
 * A quoted run, which is either a replacement directive or a sample name.
 *
 * `\"` escapes a quote inside the body, as `getQuotedString` allows
 * (`parser.ts:620-622`). An unterminated string stays open into the next line,
 * which is why `inString` is part of the state.
 */
function scanString(line: string, at: number, state: ScanState): StepResult {
	let end = at;
	if (!state.inString) {
		end++; // the opening quote
		state.inString = true;
	}
	while (end < line.length) {
		if (line[end] === "\\" && end + 1 < line.length) {
			end += 2;
			continue;
		}
		if (line[end] === '"') {
			state.inString = false;
			return { kind: "string", end: end + 1 };
		}
		end++;
	}
	return { kind: "string", end: line.length };
}

/**
 * One `$XX` token, and the argument bookkeeping that goes with it.
 *
 * Mirrors `parseHexCommand` (`parser.ts:2372`): the first `$XX` of a run is the
 * command and sets how many arguments follow, and each one after that counts
 * down. A byte outside `$DA-$FE` opens nothing — that is what keeps the `$02`
 * inside `("kick.brr", $02)` from being mistaken for a command.
 */
function scanHex(line: string, at: number, state: ScanState): StepResult {
	let end = at + 1;
	let digits = 0;
	let value = 0;
	while (end < line.length && digits < 2 && isHexDigit(line[end])) {
		value = value * 16 + parseInt(line[end], 16);
		digits++;
		end++;
	}

	// A bare `$` with nothing behind it: half-typed, not yet meaningful.
	if (digits === 0) return { kind: "unknown", end };

	if (state.awaitingArpCount) {
		// `parser.ts:2420` — `$FB`'s length byte. A high bit means the two-byte
		// form; otherwise the count is the number of note bytes that follow.
		state.awaitingArpCount = false;
		state.hexLeft = value >= 0x80 ? 2 : value + 1;
		return { kind: "hexArg", end };
	}

	if (state.hexLeft === 0) {
		if (value < FIRST_VCMD || value > LAST_VCMD) {
			// Not a command byte. Left as a plain hex literal so the argument of a
			// sample load reads as one.
			return { kind: "hexArg", end };
		}
		state.currentHex = value;
		state.currentHexSub = 0;
		if (value === 0xfb) {
			state.awaitingArpCount = true;
			state.hexLeft = 0;
		} else {
			state.hexLeft = HEX_LENGTHS[value - FIRST_VCMD] - 1;
		}
		return { kind: "hex", end };
	}

	state.hexLeft -= 1;
	if (state.hexLeft === 1 && state.currentHex === 0xfa) state.currentHexSub = value;
	// `parser.ts:2458` — `$FA $FE` takes a further byte when the high bit is set.
	if (state.hexLeft === 0 && state.currentHex === 0xfa && state.currentHexSub === 0xfe && value >= 0x80) {
		state.hexLeft++;
	}
	return { kind: "hexArg", end };
}

// ===========================================================================
// Whole-document wrapper
// ===========================================================================

export interface Token {
	kind: TokenKind;
	start: number;
	end: number;
	/** 1-based, matching `Span`. */
	line: number;
}

/** A command with its arguments gathered: `$F5 $7F …`, or `t144`. */
export interface Command {
	/** `"hex"` for a `$XX` run, otherwise the letter — `"t"`, `"@"`, `"v"`. */
	kind: string;
	/** The VCMD byte, for hex commands only. */
	vcmd?: number;
	/** `VCMD_NAMES[vcmd]`, or the letter's name. */
	name: string;
	/** The whole run, including its arguments. */
	span: Span;
	args: { value: number; span: Span }[];
	/** Every argument the command expects is present. */
	complete: boolean;
	/**
	 * The `#0`-`#7` channel this was written under, or `undefined` before any.
	 *
	 * Source order within one channel is execution order, which is what lets a
	 * reader say "this command runs after that one". Across channels it is not:
	 * the driver interleaves them by time, so nothing here should compare two
	 * commands from different channels and call one later.
	 */
	channel?: number;
}

export interface TokenIndex {
	tokens: Token[];
	commands: Command[];
}

/** Kinds that introduce a letter command and can therefore take arguments. */
const LETTER_COMMAND_KINDS = new Set<TokenKind>([
	"tempo",
	"volume",
	"globalVolume",
	"pan",
	"quantize",
	"defaultLength",
	"octave",
	"instrument",
	"transpose",
	"noise",
	"vibrato",
	"note",
	"rest",
	"loopStart",
	"loopEnd",
	"loopCall",
]);

/**
 * Scans a whole document.
 *
 * Line by line with the state carried across, which is exactly what CodeMirror
 * will do — so this and the editor cannot drift apart, and `tokentest` asserts
 * the two agree.
 */
export function tokenize(text: string): TokenIndex {
	const tokens: Token[] = [];
	const state = startState();

	let offset = 0;
	let lineNumber = 1;
	while (offset <= text.length) {
		let lineEnd = text.indexOf("\n", offset);
		if (lineEnd === -1) lineEnd = text.length;
		const line = text.slice(offset, lineEnd);

		let at = 0;
		while (at < line.length) {
			const { kind, end } = step(line, at, state);
			// `step` is contractually required to advance; this is the belt to that
			// brace, so a bug there cannot hang the editor.
			const next = end > at ? end : at + 1;
			if (kind) tokens.push({ kind, start: offset + at, end: offset + next, line: lineNumber });
			at = next;
		}

		if (lineEnd === text.length) break;
		offset = lineEnd + 1;
		lineNumber++;
	}

	return { tokens, commands: gather(tokens, text) };
}

/** Groups the flat token list into commands with their arguments. */
function gather(tokens: Token[], text: string): Command[] {
	const commands: Command[] = [];
	const spanOf = (token: Token): Span => ({ start: token.start, end: token.end, line: token.line });
	let channel: number | undefined;

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];

		if (token.kind === "channel") {
			// `#0`-`#7`. A malformed one leaves the previous channel standing,
			// which is also what the parser does — it reports and carries on.
			const parsed = Number.parseInt(text.slice(token.start + 1, token.end), 10);
			if (!Number.isNaN(parsed)) channel = parsed;
			continue;
		}

		if (token.kind === "hex") {
			const vcmd = parseInt(text.slice(token.start + 1, token.end), 16);
			const args: { value: number; span: Span }[] = [];
			let last = token;
			let j = i + 1;
			while (j < tokens.length && tokens[j].kind === "hexArg") {
				args.push({
					value: parseInt(text.slice(tokens[j].start + 1, tokens[j].end), 16),
					span: spanOf(tokens[j]),
				});
				last = tokens[j];
				j++;
			}
			const expected = expectedArgs(vcmd, args);
			commands.push({
				kind: "hex",
				vcmd,
				name: VCMD_NAMES[vcmd] ?? "unknown command",
				span: { start: token.start, end: last.end, line: token.line },
				args,
				complete: expected !== null && args.length >= expected,
				channel,
			});
			i = j - 1;
			continue;
		}

		if (!LETTER_COMMAND_KINDS.has(token.kind)) continue;

		// `y10,1,2` and `t144` alike: consecutive numbers, optionally separated by
		// commas, belong to the command that opened them.
		const args: { value: number; span: Span }[] = [];
		let last = token;
		let j = i + 1;
		while (j < tokens.length) {
			const next = tokens[j];
			if (next.kind === "number") {
				args.push({ value: numberValue(text, next), span: spanOf(next) });
				last = next;
				j++;
				continue;
			}
			if (next.kind === "operator" && text[next.start] === "," && tokens[j + 1]?.kind === "number") {
				j++;
				continue;
			}
			break;
		}

		const letter = text[token.start];
		commands.push({
			kind: letter,
			name: LETTER_NAMES[letter.toLowerCase()] ?? nameForNote(token.kind),
			span: { start: token.start, end: last.end, line: token.line },
			args,
			complete: true,
			channel,
		});
		i = j - 1;
	}

	return commands;
}

function nameForNote(kind: TokenKind): string {
	if (kind === "rest") return "rest";
	if (kind === "tie") return "tie";
	return "note";
}

function numberValue(text: string, token: Token): number {
	const raw = text.slice(token.start, token.end).replace(/^=/, "").replace(/\.+$/, "");
	return raw.length === 0 ? -1 : parseInt(raw, 10);
}

/**
 * How many arguments a VCMD takes, or `null` when it cannot be known here.
 *
 * `$FB`'s length lives in its first argument, so it is derived rather than
 * looked up. The target-program forks are the `null` cases: without the
 * directives parsed there is no way to tell `#am4`'s three-argument `$E5` from
 * AddmusicK's, so those are reported as complete rather than falsely flagged.
 */
function expectedArgs(vcmd: number, args: { value: number }[]): number | null {
	if (vcmd < FIRST_VCMD || vcmd > LAST_VCMD) return null;
	if (vcmd === 0xfb) {
		if (args.length === 0) return null;
		const count = args[0].value;
		return count >= 0x80 ? 3 : count + 2;
	}
	return HEX_LENGTHS[vcmd - FIRST_VCMD] - 1;
}

// ===========================================================================
// Lookup
// ===========================================================================

/**
 * The command containing `offset`, or the one it sits at the very end of.
 *
 * The end is inclusive so that a caret parked just after the last argument —
 * where it lands after typing one — still inspects the command it just
 * finished, rather than nothing.
 */
export function commandAt(commands: Command[], offset: number): Command | null {
	let low = 0;
	let high = commands.length - 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		const { span } = commands[mid];
		if (offset < span.start) high = mid - 1;
		else if (offset > span.end) low = mid + 1;
		else return commands[mid];
	}
	return null;
}

/**
 * The token containing `offset`, notes included.
 *
 * The inspector does not need this — it works in whole commands — but mapping a
 * position back to something highlightable does, which is what a playhead
 * following the driver would want. Half-open, unlike {@link commandAt}: a
 * playhead is a position in the music, not a caret between characters.
 */
export function tokenAt(tokens: Token[], offset: number): Token | null {
	let low = 0;
	let high = tokens.length - 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		const token = tokens[mid];
		if (offset < token.start) high = mid - 1;
		else if (offset >= token.end) low = mid + 1;
		else return token;
	}
	return null;
}
