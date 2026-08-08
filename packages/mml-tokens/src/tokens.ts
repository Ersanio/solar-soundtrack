/**
 * A resumable scanner over MML source.
 *
 * A line-oriented stepper carrying a small copyable state, which is the shape
 * CodeMirror's `StreamLanguage` wants; {@link tokenize} is one wrapper over it and
 * the editor's `mmlLanguage` is the other. Two properties are load-bearing and
 * `tokentest` checks both: {@link step} never looks behind its own `at` or at
 * another line, and {@link copyState} is a real copy.
 *
 * Deliberately not routed through the compiler — its spans are offsets into
 * preprocessed text, and the editor needs offsets into what was typed. README.md
 * has where this mirrors `parser.ts`, and the three places it cannot.
 */

import type { Span } from "@amk/core/types";
import {
	FIRST_CUSTOM_INSTRUMENT,
	FIRST_VCMD,
	HEX_LENGTHS,
	INSTRUMENT_TO_SAMPLE,
	LAST_VCMD,
	TICKS_PER_WHOLE,
	VCMD_NAMES,
} from "@amk/core/tables";

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
	/** A letter command's argument that is read as hex — see {@link HEX_ARG_LETTERS}. */
	| "hexNumber"
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
	// Same colour as a decimal argument: the radix is a fact about the command,
	// not something the reader should have to notice from the highlighting.
	hexNumber: "number",
	operator: "operator",
	unknown: "invalid",
};

/**
 * Letters whose argument `parser.ts` reads with `getHex` rather than `getInt`.
 *
 * `q7F` is quantization `$7F` (`parser.ts:1405`) and `n1F` is noise clock `$1F`
 * (`parser.ts:1665`), so reading either as decimal is wrong twice over: the value
 * is wrong, and `F` would otherwise be taken for a note.
 */
export const HEX_ARG_LETTERS = new Set(["q", "n"]);

/** Human names for the single-letter commands, to match {@link VCMD_NAMES}. */
export const LETTER_NAMES: Readonly<Record<string, string>> = {
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
export const LETTER_KINDS: Readonly<Record<string, TokenKind>> = {
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

/** One `"find=value"` definition — `parser.ts:664`. */
export interface Replacement {
	find: string;
	value: string;
}

/**
 * The replacements in scope at one point in the document.
 *
 * Immutable: {@link withReplacement} returns a new table rather than mutating
 * this one, which is what lets {@link copyState} keep sharing the reference and
 * stay O(1). A table that grew in place would be seen by every state that ever
 * pointed at it, including states for lines above the definition.
 *
 * `byFirstChar` is the whole reason lookup is affordable. `tokenize` runs on
 * every keystroke, undebounced (`editor-store.ts:172`), and the match is tried
 * at every dispatch position; a linear pass over every definition each time is
 * tens of milliseconds on a large song. Buckets are sorted longest-first, which
 * is exactly equivalent to AMK's global longest-first sort (`parser.ts:682`) —
 * two entries that can both match at one position necessarily share a first
 * character, so a global sort would never break a tie differently.
 */
export interface ReplacementTable {
	readonly entries: readonly Replacement[];
	readonly byFirstChar: ReadonlyMap<string, readonly Replacement[]>;
}

export const NO_REPLACEMENTS: ReplacementTable = { entries: [], byFirstChar: new Map() };

/** `parser.ts:664` — a repeated `find` overwrites, as `Map.set` does. */
function withReplacement(table: ReplacementTable, find: string, value: string): ReplacementTable {
	const entries = table.entries.filter((entry) => entry.find !== find).concat({ find, value });
	const byFirstChar = new Map<string, Replacement[]>();
	for (const entry of entries) {
		const bucket = byFirstChar.get(entry.find[0]);
		if (bucket) {
			bucket.push(entry);
		} else {
			byFirstChar.set(entry.find[0], [entry]);
		}
	}

	for (const bucket of byFirstChar.values()) {
		bucket.sort((a, b) => b.find.length - a.find.length);
	}

	return { entries, byFirstChar };
}

/**
 * The longest definition matching at `at`, or `null`.
 *
 * A bare `startsWith` with no word boundary, because `parser.ts:690` has none:
 * `"e=$EF"` really does replace every `e` in the song. It looks like a bug and
 * is not one.
 */
function matchReplacement(line: string, at: number, table: ReplacementTable): Replacement | null {
	const bucket = table.byFirstChar.get(line[at]);
	if (!bucket) {
		return null;
	}

	for (const entry of bucket) {
		if (line.startsWith(entry.find, at)) {
			return entry;
		}
	}

	return null;
}

/**
 * The dialect in force where a command was written, in the parser's vocabulary
 * (`parser.ts:181-182`, `applyTarget` at `parser.ts:389-417`). The scanner
 * carries the same two numbers flat in {@link ScanState}; this is the gathered,
 * per-command form the inspector dispatches on.
 */
export interface CommandTarget {
	/** 0 = AddmusicK, 1 = Addmusic 4.05 (`#am4`), 2 = AddmusicM (`#amm`). */
	readonly program: number;
	/** The `#amk` version; 0 for the legacy programs. */
	readonly amkVersion: number;
}

/** What the parser assumes before any marker (`parser.ts:181-182`). */
const DEFAULT_TARGET: CommandTarget = { program: 0, amkVersion: 4 };

/**
 * Everything the scanner must carry across a line boundary.
 *
 * Flat and small on purpose: CodeMirror copies it once per line, and anything
 * here that were a reference into the document would break that. The one
 * compound field, {@link ReplacementTable}, is safe precisely because it is
 * never mutated — sharing it is sharing a value, not aliasing the document.
 */
export interface ScanState {
	/** Arguments still expected, mirroring the parser's own `hexLeft`. */
	hexLeft: number;
	/** The `$XX` those arguments belong to; `0` when none is open. */
	currentHex: number;
	/**
	 * Second byte, tracked for `$FA` as `parser.ts:2454` does — and, under
	 * `#am4`, for `$ED`, whose sub-byte picks the HFD form (`parser.ts:3286`).
	 */
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
	/** The definitions in scope here. Shared by reference; never mutated. */
	replacements: ReplacementTable;
	/**
	 * The next token is the `"` of a sample load, not a replacement directive.
	 *
	 * `parser.ts:1732` sends a `("` straight to `parseSampleLoad`, which reads
	 * the name itself, so that quote never reaches the `"` arm of the dispatch
	 * and never defines anything. Carried as a one-shot flag set by `(` because
	 * `step` may not look behind its own `at` to find the paren.
	 */
	sampleName: boolean;
	/**
	 * The next token is a hex argument — see {@link HEX_ARG_LETTERS}.
	 *
	 * One-shot, like {@link sampleName}, but consumed *after* the replacement
	 * arm rather than before it: `getHex` opens with `doReplacement`
	 * (`parser.ts:532`), so `nx` with `"x=1F"` really does read `$1F`. Letting
	 * the flag survive into the expansion is what reproduces that. It is cleared
	 * by whatever token comes next whether or not that token is a hex digit,
	 * which reproduces the other half: `getHex` skips no spaces, so `n 1F` fails.
	 */
	hexArgNext: boolean;
	/**
	 * The next bare word is a directive's argument, not music.
	 *
	 * `#option smwvtable` reaches `matchWord` through the parser's own
	 * `skipSpaces` (`parser.ts:871-926`), which crosses line breaks — so without
	 * this the argument would scan as `s`, `m`, a global volume, a volume, two
	 * notes… Set for the directives whose argument is a bare word — `#option`,
	 * and the preprocessor's `#define`/`#undef`/`#ifdef`/`#ifndef`/`#if`
	 * (`preprocess.ts:175`) — and consumed by the next non-whitespace token,
	 * word or not, so it cannot leak onto later music.
	 */
	directiveWord: boolean;
	/**
	 * `#instruments` has been seen and the block's `{` has not.
	 *
	 * Not a one-shot: the brace is usually on the following line.
	 */
	pendingInstruments: boolean;
	/**
	 * Between an `#instruments` block's braces.
	 *
	 * Load-bearing, not cosmetic. An instrument's ADSR and GAIN bytes land in
	 * `$DA`-`$FE` — `$FE $6A $B8` is the commonest setting in the stock table —
	 * so without this the block's second byte opens a VCMD and swallows the rest
	 * of the entry as its arguments.
	 */
	inInstruments: boolean;
	/**
	 * The target program in force at this point, in the parser's vocabulary
	 * (`parser.ts:181-182`): 0 = AddmusicK, 1 = Addmusic 4.05 (`#am4`),
	 * 2 = AddmusicM (`#amm`).
	 *
	 * Positional, where the compiler's is final: `preprocess.ts` resolves the
	 * markers before the parser runs, so the file's *last* effective marker
	 * governs the whole song — but a resumable scanner can only apply a marker
	 * from its line down. Well-formed songs put the marker before any music,
	 * where the two agree; the mid-file divergence is pinned in `tokentest`.
	 */
	songTargetProgram: number;
	/**
	 * The `#amk` version; 0 under `#am4`/`#amm`, and 4 before any marker, both
	 * matching the parser (`parser.ts:181`, `applyTarget` at `parser.ts:389`).
	 */
	targetAMKVersion: number;
	/**
	 * A `#amk` directive was seen and its version number has not.
	 *
	 * One-shot in the {@link directiveWord} mould: the number is a separate
	 * token, reached through whitespace. It also survives a line break, which
	 * `preprocess.ts`'s newline-bounded argument read does not — an accepted
	 * approximation pinned in `tokentest`, since a real `#amk` with its number
	 * on the next line fails AMK0401 and compiles nothing.
	 */
	awaitingAmkVersion: boolean;
	/**
	 * The next `$xx` is the sub-byte of an `#am4` `$ED` — `parseHFDHex`
	 * (`parser.ts:3286`, Music.cpp:1466): `$80` writes a DSP register, `$81`
	 * tunes, `$82` uploads a block, `$83` is an error, and anything else is a
	 * plain ADSR command. One-shot like {@link awaitingArpCount}, because the
	 * sub-byte picks how many arguments follow.
	 */
	awaitingHfdSub: boolean;
	/**
	 * High byte of an `$ED $82` upload's 16-bit data count, held from the third
	 * header argument until the fourth extends the run by count+1 data bytes
	 * (`parser.ts:3381-3396`).
	 */
	hfdCountHi: number;
}

export function startState(): ScanState {
	return {
		hexLeft: 0,
		currentHex: 0,
		currentHexSub: 0,
		awaitingArpCount: false,
		inString: false,
		loopDepth: 0,
		replacements: NO_REPLACEMENTS,
		sampleName: false,
		hexArgNext: false,
		directiveWord: false,
		pendingInstruments: false,
		inInstruments: false,
		songTargetProgram: DEFAULT_TARGET.program,
		targetAMKVersion: DEFAULT_TARGET.amkVersion,
		awaitingAmkVersion: false,
		awaitingHfdSub: false,
		hfdCountHi: 0,
	};
}

export function copyState(state: ScanState): ScanState {
	return { ...state };
}

/** A token from inside an expansion, which has no source text of its own. */
export interface ExpandedToken {
	kind: TokenKind;
	text: string;
}

export interface StepResult {
	/** `null` for whitespace, which carries no highlight and is not a token. */
	kind: TokenKind | null;
	/** Offset just past the token. Always greater than the `at` passed in. */
	end: number;
	/**
	 * Present only on a `"replacement"` token: what the macro stands for.
	 *
	 * Positions are gone by design. The text came from a definition somewhere
	 * else entirely, so the caller stamps every one of these with the use site's
	 * span — the collapse `doReplacement` performs on `origins` at
	 * `parser.ts:691-698`.
	 */
	expansion?: ExpandedToken[];
}

/** Nested expansions. Small: a chain this long is already pathological. */
const MAX_EXPANSION_DEPTH = 8;
/**
 * Characters one top-level {@link step} may expand, across the whole tree.
 *
 * The backstop against branching blowup — `"g=g g"` doubles at every level, so
 * a depth cap alone bounds nothing. Budgeting total characters makes the worst
 * case per call flat, which is what a per-keystroke scan needs.
 */
const MAX_EXPANSION_CHARS = 1024;

const isSpace = (c: string): boolean => c === " " || c === "\t" || c === "\r" || c === "\v" || c === "\f";
const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isAlpha = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
const isHexDigit = (c: string): boolean => isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
/**
 * A character a directive's bare-word argument may contain. Wider than
 * {@link isAlpha} because `#option amk109hotpatch` carries digits and a
 * preprocessor define is conventionally named `!like_this`.
 */
const isWordChar = (c: string): boolean => isAlpha(c) || isDigit(c) || c === "_" || c === "!";

/**
 * Directives whose first argument is a bare word rather than a number, a `$`
 * value or a string — `#option`'s keyword (`parser.ts:926-982`) and the
 * preprocessor's define names (`preprocess.ts:175`). They set
 * {@link ScanState.directiveWord} so the word is not scanned as music.
 */
const WORD_ARG_DIRECTIVES = new Set(["#option", "#define", "#undef", "#ifdef", "#ifndef", "#if"]);

/**
 * The three directives followed by a `{ }` block (`parser.ts:823-856`). Their
 * brace is consumed by `parseBlock` and never reaches `parseTripletOpen`, so
 * `gather` has to tell it apart from a triplet's.
 */
const BLOCK_DIRECTIVES = new Set(["#spc", "#samples", "#instruments"]);

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
	return stepInner(line, at, state, [], { chars: MAX_EXPANSION_CHARS });
}

/**
 * @param active `find` strings currently being expanded, so a definition cannot
 *   re-enter itself. This is what stops `"zz=zz $00"` and the mutually
 *   recursive `"p1=p2"` / `"p2=p1"` dead in their tracks; the budget alone
 *   would only stop them slowly.
 * @param budget Characters left to expand, shared across the whole tree.
 */
function stepInner(
	line: string,
	at: number,
	state: ScanState,
	active: string[],
	budget: { chars: number },
): StepResult {
	const c = line[at];

	// Read-and-clear, unconditionally and first, so the flag can never outlive
	// the single token after the `(` that set it.
	const sampleName = state.sampleName;
	state.sampleName = false;

	// A string may run past the end of a line, so it is checked before anything
	// else can claim the character.
	if (state.inString) {
		return scanString(line, at, state, sampleName);
	}

	// `doReplacement` sits at the top of the dispatch loop (`parser.ts:415`),
	// ahead of the whitespace and `"` arms alike, so a replacement may match on
	// the opening quote of a directive. A sample load is the one exception:
	// `parseSampleLoad` walks past `("` itself without expanding anything.
	if (!sampleName && state.replacements.entries.length > 0) {
		const hit = matchReplacement(line, at, state.replacements);
		if (hit && !active.includes(hit.find)) {
			const expansion: ExpandedToken[] = [];
			active.push(hit.find);
			scanExpansion(hit.value, state, expansion, active, budget);
			active.pop();
			// `find` is non-empty by construction, so this still advances.
			return { kind: "replacement", end: at + hit.find.length, expansion };
		}
	}

	// Deliberately below the replacement arm; see `ScanState.hexArgNext`.
	if (state.hexArgNext) {
		state.hexArgNext = false;
		if (isHexDigit(c)) {
			let end = at;
			// `getHex` stops at two digits (`parser.ts:536`).
			while (end < line.length && end - at < 2 && isHexDigit(line[end])) {
				end++;
			}

			return { kind: "hexNumber", end };
		}
	}

	if (isSpace(c)) {
		let end = at + 1;
		while (end < line.length && isSpace(line[end])) {
			end++;
		}

		return { kind: null, end };
	}

	// Below the whitespace arm on purpose: the argument is separated from its
	// directive by spaces — or a line break, since the parser reaches it through
	// its newline-crossing `skipSpaces` — and none of that may consume the flag.
	// Any other token does, word or not, so it never leaks onto later music.
	if (state.directiveWord) {
		state.directiveWord = false;
		if (isWordChar(c)) {
			let end = at;
			while (end < line.length && isWordChar(line[end])) {
				end++;
			}

			return { kind: "directive", end };
		}
	}

	// `#amk`'s version argument — preprocess.ts:323-338 — read here because it
	// is a separate token. Guarded the way preprocess guards it: once `#am4` or
	// `#amm` has been seen (`version < 0` there, a non-zero program here), a
	// later `#amk` is ignored. `#amk=1` (preprocess.ts:163-171) arrives as the
	// number token `=1`, which `scanNumber` already reads. Falls through so the
	// token still scans as the plain number it is.
	if (state.awaitingAmkVersion) {
		state.awaitingAmkVersion = false;
		if (isDigit(c) || (c === "=" && isDigit(line[at + 1]))) {
			let digit = c === "=" ? at + 1 : at;
			let version = 0;
			while (digit < line.length && isDigit(line[digit])) {
				version = version * 10 + (line.charCodeAt(digit) - 0x30);
				digit++;
			}

			if (state.songTargetProgram === 0) {
				state.targetAMKVersion = version;
			}
		}
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
			return scanString(line, at, state, sampleName);

		case "#":
			return scanHash(line, at, state);

		case "|":
			// `parser.ts:435` — a bar line abandons any half-written hex command.
			state.hexLeft = 0;
			state.currentHex = 0;
			state.awaitingArpCount = false;
			state.awaitingHfdSub = false;
			return { kind: "operator", end: at + 1 };

		case "[":
			state.loopDepth++;
			return { kind: "loopStart", end: at + 1 };

		case "]":
			if (state.loopDepth > 0) {
				state.loopDepth--;
			}

			return { kind: "loopEnd", end: at + 1 };

		case "*":
			return { kind: "loopCall", end: at + 1 };

		// `(` opens either a label loop or a sample load (`parser.ts:1694`). Both
		// are left to tokenise from their parts, so `("kick.brr", $02)` colours
		// its name as a string and its tuning as a number without this having to
		// know which form it is looking at.
		case "(":
			// The one thing the two forms must be told apart for: `parser.ts:1732`
			// tests exactly this character, and a sample name is not a definition.
			state.sampleName = line[at + 1] === '"';
			// `(@5, $02)` loads instrument 5's *sample* (`parser.ts:1743`); the `@`
			// is part of that command and not an instrument change, so it is taken
			// here rather than left to open one.
			if (line[at + 1] === "@") {
				return { kind: "label", end: at + 2 };
			}

			return { kind: "label", end: at + 1 };

		// `parser.ts:1585` — a second `@` is the "direct" form, which forces the
		// `$DA` that `@19`-`@29` would otherwise not emit. One token, so `gather`
		// can tell the two apart from the text alone.
		case "@":
			return { kind: "instrument", end: line[at + 1] === "@" ? at + 2 : at + 1 };

		case ")":
			return { kind: "label", end: at + 1 };

		case "<":
		case ">":
			return { kind: "octaveShift", end: at + 1 };

		case "^":
			return { kind: "tie", end: at + 1 };

		case "{":
			// `parser.ts:1071` — the brace after `#instruments` opens the block.
			// Any half-written hex run is abandoned rather than carried into it,
			// so a stray `$EF` above cannot eat the first entry's bytes.
			if (state.pendingInstruments) {
				state.pendingInstruments = false;
				state.inInstruments = true;
				state.hexLeft = 0;
				state.currentHex = 0;
				state.awaitingArpCount = false;
				state.awaitingHfdSub = false;
			}

			return { kind: "operator", end: at + 1 };

		case "}":
			// `parseInstrumentDefinitions` accepts no nesting (`Music.cpp:2570`), so
			// the first `}` closes the block.
			state.inInstruments = false;
			return { kind: "operator", end: at + 1 };

		case "?":
		case "/":
		case "&":
		case ",":
			return { kind: "operator", end: at + 1 };

		default:
			break;
	}

	// `=48` is an exact tick count attached to the note before it, and dots
	// extend a duration, so both belong to the number rather than floating free.
	if (isDigit(c) || (c === "=" && isDigit(line[at + 1]))) {
		return scanNumber(line, at);
	}

	const lower = c.toLowerCase();

	if (lower === "r") {
		return { kind: "rest", end: scanNoteBody(line, at + 1) };
	}

	if (isNoteLetter(lower)) {
		return { kind: "note", end: scanNoteBody(line, at + 1) };
	}

	const kind = LETTER_KINDS[lower] ?? LETTER_KINDS[c];
	if (kind) {
		if (HEX_ARG_LETTERS.has(lower)) {
			state.hexArgNext = true;
		}

		return { kind, end: at + 1 };
	}

	return { kind: "unknown", end: at + 1 };
}

/** A note's accidental, if it has one — `getPitch`, `parser.ts:529-535`. */
function scanNoteBody(line: string, at: number): number {
	return line[at] === "+" || line[at] === "-" ? at + 1 : at;
}

function scanNumber(line: string, at: number): StepResult {
	let end = at;
	if (line[end] === "=") {
		end++;
	}

	while (end < line.length && isDigit(line[end])) {
		end++;
	}

	// Dotted durations. `..` is legal and doubles down, so the run is greedy.
	while (end < line.length && line[end] === ".") {
		end++;
	}

	return { kind: "number", end };
}

/**
 * `#amk 4` and friends versus a `#0` channel directive — `parser.ts:707-712`.
 */
function scanHash(line: string, at: number, state: ScanState): StepResult {
	let end = at + 1;
	if (isAlpha(line[end])) {
		// Alphanumeric after the first letter, so `#am4` is one directive — as
		// `preprocess.ts:173` reads it, one word up to whitespace. The first
		// character stays alphabetic so `#0`-`#7` remain channels.
		while (end < line.length && (isAlpha(line[end]) || isDigit(line[end]))) {
			end++;
		}

		const name = line.slice(at, end).toLowerCase();
		// `parser.ts:797` matches this case-insensitively. Every other directive
		// clears the flag, so an `#instruments` with no block cannot arm the next
		// unrelated `{`.
		state.pendingInstruments = name === "#instruments";
		// See {@link ScanState.directiveWord}. The set is every directive whose
		// argument is a bare word rather than a number, a `$` value or a string.
		state.directiveWord = WORD_ARG_DIRECTIVES.has(name);

		// The target markers — preprocess.ts:340-345. `#am4`/`#amm` are
		// unguarded there, so a later one always wins, even over an earlier
		// `#amk`; `#amk`'s own guard sits where its version number is read.
		if (name === "#am4") {
			state.songTargetProgram = 1;
			state.targetAMKVersion = 0;
		} else if (name === "#amm") {
			state.songTargetProgram = 2;
			state.targetAMKVersion = 0;
		}

		// Assigned rather than or-ed, like the flags above: any other directive
		// disarms it. Note `#amk4` without a space is one (unknown) directive —
		// preprocess reads the word whole — and must not arm this.
		state.awaitingAmkVersion = name === "#amk";
		return { kind: "directive", end };
	}

	while (end < line.length && isDigit(line[end])) {
		end++;
	}

	return { kind: "channel", end };
}

/**
 * A quoted run, which is either a replacement directive or a sample name.
 *
 * `\"` escapes a quote inside the body, as `getQuotedString` allows
 * (`parser.ts:620-622`). An unterminated string stays open into the next line,
 * which is why `inString` is part of the state.
 *
 * A directive that both opens and closes here defines a replacement. "Both
 * here" is the same thing as "on one line", since one `step` call never crosses
 * a line break — which is why that restriction costs no extra state.
 */
function scanString(line: string, at: number, state: ScanState, sampleName: boolean): StepResult {
	const opened = !state.inString;
	let end = at;
	if (opened) {
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
			if (opened && !sampleName) {
				define(line.slice(at + 1, end), state);
			}

			return { kind: "string", end: end + 1 };
		}

		end++;
	}

	return { kind: "string", end: line.length };
}

/**
 * `parseReplacementDirective`, `parser.ts:640-666`.
 *
 * Split on the *first* `=`, right-trim the name, left-trim the value. A body
 * with no `=` or an empty name is an error there (AMK0021 / AMK0022) and simply
 * defines nothing here — the compiler is where diagnostics belong.
 */
function define(body: string, state: ScanState): void {
	// `getQuotedString` (`parser.ts:1297-1318`) resolves the one escape the
	// format has before the body is ever split, so `"foo=\"bar\""` defines a
	// value containing quotes rather than one containing backslashes.
	const unescaped = body.replace(/\\"/g, '"');
	const eq = unescaped.indexOf("=");
	if (eq === -1) {
		return;
	}

	const find = unescaped.slice(0, eq).replace(/\s+$/, "");
	if (find.length === 0) {
		return;
	}

	const value = unescaped.slice(eq + 1).replace(/^\s+/, "");
	state.replacements = withReplacement(state.replacements, find, value);
}

/**
 * Scans the text a replacement stands for, appending what it finds to `out`.
 *
 * The same stepper, over a string that is not in the document — which is how
 * the state effects land where they matter. `echo1` expanding to `$EF` leaves
 * `currentHex` and `hexLeft` set, so the `$2b $2d $2d` written after it in the
 * *real* source scan as that command's arguments. That is the whole point.
 */
function scanExpansion(
	text: string,
	state: ScanState,
	out: ExpandedToken[],
	active: string[],
	budget: { chars: number },
): void {
	if (active.length > MAX_EXPANSION_DEPTH) {
		return;
	}

	budget.chars -= text.length;
	if (budget.chars < 0) {
		return;
	}

	let at = 0;
	while (at < text.length) {
		const { kind, end, expansion } = stepInner(text, at, state, active, budget);
		const next = end > at ? end : at + 1;
		if (expansion) {
			// `push(...expansion)` would put the whole array on the argument stack,
			// and this runs on user-supplied text — the same care `parser.ts:693`
			// takes with `concat` over `splice`.
			for (const token of expansion) {
				out.push(token);
			}
		} else if (kind) {
			out.push({ kind, text: text.slice(at, next) });
		}

		at = next;
	}
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
	if (digits === 0) {
		return { kind: "unknown", end };
	}

	// Inside `#instruments` every `$xx` is one of an entry's five bytes, whatever
	// it happens to equal. `parseInstrumentDefinitions` reads them positionally
	// (`Music.cpp:2638-2645`) and never consults the VCMD table.
	if (state.inInstruments) {
		return { kind: "hexArg", end };
	}

	if (state.awaitingArpCount) {
		// `parser.ts:2420` — `$FB`'s length byte. A high bit means the two-byte
		// form; otherwise the count is the number of note bytes that follow.
		state.awaitingArpCount = false;
		state.hexLeft = value >= 0x80 ? 2 : value + 1;
		return { kind: "hexArg", end };
	}

	if (state.awaitingHfdSub) {
		// `parseHFDHex` (`parser.ts:3286`, Music.cpp:1466) — the byte after an
		// `#am4` `$ED` picks the form, and with it how many arguments follow.
		state.awaitingHfdSub = false;
		state.currentHexSub = value;
		if (value === 0x80) {
			state.hexLeft = 2; // DSP register and value (parser.ts:3315)
		} else if (value === 0x81) {
			state.hexLeft = 1; // semitone tune (parser.ts:3343)
		} else if (value === 0x82) {
			state.hexLeft = 4; // address and count; the data follows (parser.ts:3360)
		} else if (value === 0x83) {
			state.hexLeft = 0; // AMK0163 — nothing follows (parser.ts:3356)
		} else {
			state.hexLeft = 1; // plain ADSR, the sub being its first argument
		}

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
		if (value === 0xed && state.songTargetProgram === 1) {
			// `parser.ts:2946` — #am4 sends $ED to the HFD translator; the next
			// byte picks the form, exactly as `$FB`'s count picks its length.
			state.awaitingHfdSub = true;
			state.hexLeft = 0;
		} else if (value === 0xfb) {
			state.awaitingArpCount = true;
			state.hexLeft = 0;
		} else if (value === 0xfc && state.targetAMKVersion === 1) {
			// `parser.ts:2970-2975` — #amk 1's $FC is remote gain: two arguments.
			state.hexLeft = 2;
		} else {
			// #am4's $E5 needs no fork here — the parser's explicit 3
			// (parser.ts:2968) equals the table's; its overload is decided on the
			// first argument, below.
			state.hexLeft = HEX_LENGTHS[value - FIRST_VCMD] - 1;
		}

		return { kind: "hex", end };
	}

	state.hexLeft -= 1;
	if (state.hexLeft === 1 && state.currentHex === 0xfa) {
		state.currentHexSub = value;
	}

	// `parser.ts:2458` — `$FA $FE` takes a further byte when the high bit is set.
	if (state.hexLeft === 0 && state.currentHex === 0xfa && state.currentHexSub === 0xfe && value >= 0x80) {
		state.hexLeft++;
	}

	// `parser.ts:3014-3031` (Music.cpp:1820) — under #am4 a high bit on $E5's
	// first argument means "load sample": one fewer argument follows.
	if (state.hexLeft === 2 && state.currentHex === 0xe5 && state.songTargetProgram === 1 && value >= 0x80) {
		state.hexLeft -= 1;
	}

	// `parser.ts:3381-3396` — `$ED $82`'s third and fourth arguments are a
	// big-endian data count, and count+1 data bytes follow the four header
	// arguments (the do-while at parser.ts:3390 runs count+1 times). The sub is
	// cleared once the count is folded in, so data bytes cannot re-trigger it.
	if (state.currentHex === 0xed && state.currentHexSub === 0x82) {
		if (state.hexLeft === 1) {
			state.hfdCountHi = value;
		} else if (state.hexLeft === 0) {
			state.hexLeft = ((state.hfdCountHi << 8) | value) + 1;
			state.currentHexSub = 0;
		}
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

/**
 * One length segment of a note or rest — the initial one, then one more per
 * `^` tie. Mirrors `accumulateTiedLength` (`parser.ts:2794`), which plays
 * every segment as part of one continuous note rather than a fresh one.
 */
export interface NoteLengthSegment {
	/** Resolved ticks this segment contributes, its own dots already folded in. */
	ticks: number;
	/**
	 * Dots that lengthened this segment. Written after its digits, but counted
	 * as the parser counts them, so Addmusic 4.05's two-dot ceiling
	 * (`Music.cpp:2960`) shows here as well as in {@link ticks}.
	 */
	dots: number;
	/**
	 * No digits were written for this segment, so {@link ticks} came from
	 * whatever length was already in effect — the song's last `l`, or
	 * AddmusicK's own default before any (`parser.ts:198`).
	 */
	implicit: boolean;
	/** `true` for `=NN` — an exact tick count rather than a whole-note denominator (`parser.ts:610-621`). */
	exact: boolean;
	/**
	 * This segment was written inside a `{ }` triplet, so {@link ticks} is its
	 * written length scaled by two thirds (`parser.ts:661-667`) — the number the
	 * driver plays, not the one on the page.
	 */
	triplet: boolean;
	/** The denominator or exact count as written, digits only — `""` when {@link implicit}. */
	written: string;
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
	/**
	 * The command byte or letter alone — `$F5` out of a `$F5 $7F …` run, `@@`
	 * out of `@@19`.
	 *
	 * {@link span}`.start` already equals this one's start; the *end* is what is
	 * new, and it is what lets an editor append an argument a half-written
	 * command is missing rather than only overwrite the ones that are there.
	 */
	head: Span;
	/**
	 * The replacement the command *byte* came through, if any.
	 *
	 * Separate from {@link replacement} because the two permit different edits:
	 * `"ech=$EF"` used as `ech $80 $10 $10` sets this and leaves every argument
	 * literal, so the arguments can still be rewritten in place even though the
	 * command byte cannot.
	 */
	headReplacement?: string;
	args: {
		value: number;
		span: Span;
		/**
		 * The replacement this argument came through, if any.
		 *
		 * The interlock `@amk/tokens`'s `edits.ts` tests. Every token from one expansion
		 * is stamped with the use site's span, so two arguments out of one macro
		 * share a single span and writing over either would clobber the other —
		 * which is why provenance per part is the right primitive here rather
		 * than a span-overlap check.
		 */
		replacement?: string;
	}[];
	/** Every argument the command expects is present. */
	complete: boolean;
	/**
	 * The replacement this was written as, when any part of it came through one.
	 *
	 * A label, and the coarse half of a safety interlock: the parts that came
	 * from the macro collapse onto the use site, so {@link span} covers the name
	 * the author typed rather than the bytes. Anything that rewrites the *whole*
	 * run must refuse when this is set, or it would inline the macro and, if the
	 * expansion carried anything past the command, delete that too. Rewriting
	 * one argument asks the narrower question — see {@link headReplacement}.
	 */
	replacement?: string;
	/**
	 * The `#0`-`#7` channel this was written under, or `undefined` before any.
	 *
	 * Source order within one channel is execution order, which is what lets a
	 * reader say "this command runs after that one". Across channels it is not:
	 * the driver interleaves them by time, so nothing here should compare two
	 * commands from different channels and call one later.
	 */
	channel?: number;
	/**
	 * Written as `@@n`, the "direct" form (`parser.ts:1585`).
	 *
	 * Worth carrying because it changes what the command *means*, not just how it
	 * looks: `@19` emits nothing at all, while `@@19` emits `$DA` — and, through
	 * the unconditional remap at `parser.ts:1597`, means custom instrument 30.
	 */
	direct?: boolean;
	/**
	 * The dialect in force where this was written. Positional — the marker's
	 * line down — where the compiler applies the file's final marker throughout;
	 * the divergence is pinned in `tokentest`. The inspector dispatches on this
	 * rather than re-deriving the marker rules.
	 */
	target: CommandTarget;
	/**
	 * For a note or rest (`name` is `"note"`/`"rest"`): every length segment in
	 * source order. `undefined` for every other command.
	 *
	 * Repeated bare `r`s are not folded together the way `accumulateTiedLength`
	 * does for rests (`parser.ts:2802`) — only explicit `^` ties are, a
	 * deliberate, narrower approximation.
	 */
	noteLength?: NoteLengthSegment[];
}

/** Where a custom instrument's sample byte came from. */
export type InstrumentSample =
	/** `"kick.brr"` — an index into this song's own sample list. */
	| { form: "file"; name: string }
	/** `@n` with `n < 30`: that stock instrument's sample. `parser.ts:1147`. */
	| { form: "copy"; instrument: number; srcn: number }
	/** `nXX`: noise at that clock, flagged by the sample byte's high bit. */
	| { form: "noise"; clock: number; byte: number };

/** One entry of an `#instruments` block. */
export interface InstrumentDefinition {
	/** What `@n` addresses it as. The first entry in the file is `@30`. */
	number: number;
	/** Always one of the three forms; an entry that opens as none is not one. */
	sample: InstrumentSample;
	/**
	 * Where the sample form was written — the whole of `"kick.brr"`, `@1` or
	 * `n1F`, so an editor can swap one form for another.
	 */
	sampleSpan: Span;
	/**
	 * ADSR1, ADSR2, GAIN, tuning, subtuning. Short while half-written.
	 *
	 * Each byte carries its own span rather than the entry holding a parallel
	 * array of them: a malformed entry is recorded rather than abandoned
	 * (see below), and two arrays that may each stop early would drift the first
	 * time one of those paths was touched.
	 */
	bytes: { value: number; span: Span; replacement?: string }[];
	/** A sample form and all five bytes are present. */
	complete: boolean;
	span: Span;
}

export interface TokenIndex {
	tokens: Token[];
	commands: Command[];
	/**
	 * Every `#instruments` entry in the document, in `@30`-upward order.
	 *
	 * Here rather than in `ScanState` on purpose. Numbering runs `30 + k` across
	 * *all* the blocks in a file, so a counter carried in the scan state would
	 * encode "how many entries appear above this line" — precisely the hidden
	 * dependency on having seen the top of the file that the resumable contract
	 * forbids and that `tokentest` exists to catch. Built in a second pass over
	 * the gathered stream instead, where {@link Command} already lives.
	 *
	 * Known divergence: this pass does not evaluate `#if`, so a block inside an
	 * untaken branch is counted here where `preprocess.ts` would drop it.
	 */
	instruments: InstrumentDefinition[];
}

/**
 * What {@link gather} reads: a token stream in which an expansion has been
 * spliced in, in place of the `replacement` token that produced it.
 *
 * Kept out of {@link TokenIndex.tokens} on purpose. That list is what a
 * highlighter consumes and what {@link tokenAt} binary-searches, so it must
 * stay ordered and non-overlapping — whereas every token from one expansion
 * shares a single span by design.
 */
interface GatherToken extends Token {
	/** Literal text, for a token with no source of its own. */
	text?: string;
	/** The macro it came through. */
	replacement?: string;
}

/** A point in the document where the dialect changed. See {@link tokenize}. */
interface TargetTransition {
	at: number;
	target: CommandTarget;
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
	// Built only once a replacement actually expands, so a song without any —
	// which is most of them — pays nothing for this at all.
	let stream: GatherToken[] | null = null;
	const state = startState();

	// Where the dialect changed, recorded off the very ScanState the stepper
	// mutates — so `gather` replays the same positional model the highlighter
	// colours by, and the marker precedence rules live in one place (`scanHash`
	// and the `#amk` one-shot) rather than being re-derived here.
	const transitions: TargetTransition[] = [];
	let program = DEFAULT_TARGET.program;
	let amkVersion = DEFAULT_TARGET.amkVersion;

	let offset = 0;
	let lineNumber = 1;
	while (offset <= text.length) {
		let lineEnd = text.indexOf("\n", offset);
		if (lineEnd === -1) {
			lineEnd = text.length;
		}

		const line = text.slice(offset, lineEnd);

		let at = 0;
		while (at < line.length) {
			const { kind, end, expansion } = step(line, at, state);
			// `step` is contractually required to advance; this is the belt to that
			// brace, so a bug there cannot hang the editor.
			const next = end > at ? end : at + 1;

			if (state.songTargetProgram !== program || state.targetAMKVersion !== amkVersion) {
				program = state.songTargetProgram;
				amkVersion = state.targetAMKVersion;
				transitions.push({ at: offset + at, target: { program, amkVersion } });
			}

			if (kind) {
				const token: Token = { kind, start: offset + at, end: offset + next, line: lineNumber };
				if (expansion) {
					stream ??= tokens.slice();
					const from = line.slice(at, next);
					for (const expanded of expansion) {
						stream.push({ ...token, kind: expanded.kind, text: expanded.text, replacement: from });
					}
				} else {
					stream?.push(token);
				}

				tokens.push(token);
			}

			at = next;
		}

		if (lineEnd === text.length) {
			break;
		}

		offset = lineEnd + 1;
		lineNumber++;
	}

	const stream_ = stream ?? tokens;
	return {
		tokens,
		commands: gather(stream_, text, transitions),
		instruments: gatherInstruments(stream_, text),
	};
}

/**
 * The `#instruments` entries, read off the gathered stream.
 *
 * Mirrors `parseInstrumentDefinitions` (`parser.ts:1068`, `Music.cpp:2560`): a
 * sample in one of three forms, then exactly five `$xx` bytes, repeated until
 * the closing brace. Anything malformed is recorded as an incomplete entry
 * rather than abandoning the block, because this runs on half-typed source by
 * design — the panel has to say something useful mid-keystroke.
 */
function gatherInstruments(tokens: GatherToken[], text: string): InstrumentDefinition[] {
	const out: InstrumentDefinition[] = [];
	const textOf = (token: GatherToken): string => token.text ?? text.slice(token.start, token.end);
	let number = FIRST_CUSTOM_INSTRUMENT;

	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].kind !== "directive") {
			continue;
		}

		if (textOf(tokens[i]).toLowerCase() !== "#instruments") {
			continue;
		}

		let j = i + 1;
		while (j < tokens.length && tokens[j].kind === "comment") {
			j++;
		}

		if (j >= tokens.length || textOf(tokens[j]) !== "{") {
			i = j - 1;
			continue;
		}

		j++;

		while (j < tokens.length && textOf(tokens[j]) !== "}") {
			const start = tokens[j];
			if (start.kind === "comment") {
				j++;
				continue;
			}

			let sample: InstrumentSample;
			let last = start;
			if (start.kind === "string") {
				sample = { form: "file", name: textOf(start).replace(/^"|"$/g, "") };
				j++;
			} else if (start.kind === "instrument" && tokens[j + 1]?.kind === "number") {
				const n = numberValue(textOf(tokens[j + 1]), "number");
				// `parser.ts:1147` — a custom instrument cannot be based on another.
				sample = { form: "copy", instrument: n, srcn: INSTRUMENT_TO_SAMPLE[n] ?? -1 };
				last = tokens[j + 1];
				j += 2;
			} else if (start.kind === "noise" && tokens[j + 1]?.kind === "hexNumber") {
				const clock = numberValue(textOf(tokens[j + 1]), "hexNumber");
				// `parser.ts:1162` — the high bit is what tells the driver it is noise.
				sample = { form: "noise", clock, byte: clock | 0x80 };
				last = tokens[j + 1];
				j += 2;
			} else {
				// Not the start of an entry. Skipped so one stray character cannot
				// throw the rest of the block's numbering out.
				j++;
				continue;
			}

			// `last` is the sample form's final token until a byte moves it on, so
			// this is the whole of `"kick.brr"` / `@1` / `n1F` and nothing more.
			const sampleSpan: Span = { start: start.start, end: last.end, line: start.line };

			const bytes: InstrumentDefinition["bytes"] = [];
			while (j < tokens.length && bytes.length < 5 && tokens[j].kind === "hexArg") {
				bytes.push({
					value: parseInt(textOf(tokens[j]).slice(1), 16),
					span: { start: tokens[j].start, end: tokens[j].end, line: tokens[j].line },
					replacement: tokens[j].replacement,
				});
				last = tokens[j];
				j++;
			}

			out.push({
				number: number++,
				sample,
				sampleSpan,
				bytes,
				complete: bytes.length === 5,
				span: { start: start.start, end: last.end, line: start.line },
			});
		}

		i = j;
	}

	return out;
}

/** `scanNumber` always writes dots straight after the digits, so splitting off a trailing run always finds the right boundary. */
function splitLengthText(raw: string): { digits: string; dots: number } {
	let end = raw.length;
	while (end > 0 && raw[end - 1] === ".") {
		end--;
	}

	return { digits: raw.slice(0, end), dots: raw.length - end };
}

/** Music.cpp:2960 — Addmusic 4.05 stops adding dots after the second, so the rest are written but never heard. */
function dotsApplied(dots: number, target: CommandTarget): number {
	return target.program === 1 ? Math.min(dots, 2) : dots;
}

/**
 * The dot half of `getNoteLengthModifier` (`parser.ts:639-659`). `dots` has
 * already been through {@link dotsApplied}.
 */
function applyDots(ticks: number, dots: number): number {
	let frac = ticks;
	let total = ticks;
	for (let i = 0; i < dots; i++) {
		frac = Math.floor(frac / 2);
		total += frac;
	}

	return total;
}

/**
 * The triplet half (`parser.ts:661-667`), which runs after the dots: two thirds,
 * rounded half up. `l` never reaches it — `parseDefaultLength` is the one caller
 * that passes `allowTriplet: false` (`parser.ts:1549`).
 */
function applyTriplet(ticks: number, triplet: boolean): number {
	return triplet ? Math.floor((ticks * 2) / 3 + 0.5) : ticks;
}

/**
 * One length segment of a note or a rest — `getNoteLength`
 * (`parser.ts:607-637`). `raw` is the segment's number-token text, `""` when
 * it wrote no digits of its own; `defaultTicks` is the `l` length currently in
 * effect, `triplet` whether a `{ }` block is open, and `target` picks the same
 * forks {@link Command.target} carries everywhere else.
 */
function resolveNoteSegment(
	raw: string,
	defaultTicks: number,
	triplet: boolean,
	target: CommandTarget,
): NoteLengthSegment {
	const exact = raw.startsWith("=");
	const { digits, dots: written } = splitLengthText(exact ? raw.slice(1) : raw);
	const dots = dotsApplied(written, target);
	// `c.` writes no digits but is still dotted — `getInt` returns -1 and
	// `getNoteLengthModifier` runs on the default anyway (`parser.ts:622-637`).
	const implicit = digits.length === 0;

	if (exact && !implicit) {
		// parser.ts:610-621 — an exact tick count, skipping the /192 division.
		const ticks = Number.parseInt(digits, 10);
		if (target.amkVersion < 4) {
			// Exact counts predate the modifiers entirely: the early return is
			// ahead of both the dots and the triplet.
			return { ticks, dots: 0, implicit, exact, triplet: false, written: digits };
		}

		return { ticks: applyTriplet(applyDots(ticks, dots), triplet), dots, implicit, exact, triplet, written: digits };
	}

	const n = implicit ? -1 : Number.parseInt(digits, 10);
	const plain = n < 1 || n > TICKS_PER_WHOLE ? defaultTicks : Math.floor(TICKS_PER_WHOLE / n);
	return {
		ticks: applyTriplet(applyDots(plain, dots), triplet),
		dots,
		implicit,
		exact,
		triplet,
		written: digits,
	};
}

/**
 * `parseDefaultLength` (`parser.ts:1524-1550`), which is *not* `getNoteLength`:
 * `l=NN` and dots on `l` are both `#amk 4` and above, and every error path
 * leaves the standing length alone rather than replacing it.
 */
function resolveDefaultLength(raw: string, current: number, target: CommandTarget): number {
	const exact = raw.startsWith("=");
	const { digits, dots } = splitLengthText(exact ? raw.slice(1) : raw);

	const n = digits.length === 0 ? -1 : Number.parseInt(digits, 10);

	if (target.amkVersion < 4) {
		// AMK0070 for `l=NN`, and no dots below #amk 4 (`parser.ts:1548`).
		return exact || n < 1 || n > TICKS_PER_WHOLE ? current : Math.floor(TICKS_PER_WHOLE / n);
	}

	if (exact) {
		return applyDots(n, dotsApplied(dots, target));
	}

	// AMK0071 — an illegal denominator is an error, and the old length stands.
	if (n < 1 || n > TICKS_PER_WHOLE) {
		return current;
	}

	return applyDots(Math.floor(TICKS_PER_WHOLE / n), dotsApplied(dots, target));
}

/**
 * A note or rest's length segments, off the tokens starting at `startIndex` —
 * the one right after the note letter. Mirrors `accumulateTiedLength`
 * (`parser.ts:2794`)'s do-while: the first segment is read unconditionally,
 * then one more for every `^` that follows, each optionally digit-less.
 */
function gatherNoteLength(
	tokens: GatherToken[],
	startIndex: number,
	defaultTicks: number,
	triplet: boolean,
	target: CommandTarget,
	textOf: (token: GatherToken) => string,
	spanOf: (token: Token) => Span,
): {
	segments: NoteLengthSegment[];
	args: Command["args"];
	last: GatherToken | undefined;
	from: string | undefined;
	nextIndex: number;
} {
	const segments: NoteLengthSegment[] = [];
	const args: Command["args"] = [];
	let last: GatherToken | undefined;
	let from: string | undefined;
	let index = startIndex;

	// One segment's worth of tokens, gathered the same generous way the
	// generic letter-command loop below gathers any command's numbers — so the
	// two never disagree about where a note ends, even in the pathological
	// case a mid-digit macro splits one written number into several tokens
	// (`tokentest`'s "a macro inside a number" case). Only the run's first
	// token is read as the segment's length; AMK's own getInt would have
	// folded the rest into it, which this scanner cannot do.
	const readSegment = (): void => {
		let first: GatherToken | undefined;
		let dots = "";
		while (index < tokens.length) {
			const next = tokens[index];
			if (next.kind === "number" || next.kind === "hexNumber") {
				first ??= next;
				args.push({ value: numberValue(textOf(next), next.kind), span: spanOf(next), replacement: next.replacement });
				from ??= next.replacement;
				last = next;
				index++;
				continue;
			}

			// `l8 c.` is a dotted default-length note (`parser.ts:622-637`), but a
			// lone `.` is a length only where one has just ended, which `step` — one
			// character at a time, with no memory of the token before — cannot know.
			// So it scans as `unknown` and is claimed back here.
			if (next.kind === "unknown" && textOf(next) === ".") {
				dots += ".";
				last = next;
				index++;
				continue;
			}

			if (next.kind === "operator" && textOf(next) === "," && tokens[index + 1]?.kind === "number") {
				index++;
				continue;
			}

			break;
		}

		segments.push(resolveNoteSegment((first ? textOf(first) : "") + dots, defaultTicks, triplet, target));
	};

	readSegment();
	while (tokens[index]?.kind === "tie") {
		last = tokens[index];
		index++;
		readSegment();
	}

	return { segments, args, last, from, nextIndex: index };
}

/** Groups the flat token list into commands with their arguments. */
function gather(tokens: GatherToken[], text: string, transitions: TargetTransition[]): Command[] {
	const commands: Command[] = [];
	const spanOf = (token: Token): Span => ({ start: token.start, end: token.end, line: token.line });
	// A token from an expansion stands for text that is not in the document, so
	// its own `text` wins over the span it was stamped with.
	const textOf = (token: GatherToken): string => token.text ?? text.slice(token.start, token.end);
	let channel: number | undefined;
	let target = DEFAULT_TARGET;
	let transition = 0;
	// parser.ts:198 — what a note or rest falls back to when it carries no
	// digits of its own; `l` updates it below, positionally, the same way.
	let defaultNoteLength = TICKS_PER_WHOLE / 8;
	// parser.ts:199 — one flag for the whole song, never reset at a channel, so
	// following it here in source order is what the parser does too.
	let triplet = false;
	// A block directive's brace never reaches `parseTripletOpen` — `parseBlock`
	// eats it (`parser.ts:823-856`). It matters while the block is being typed:
	// an unclosed `#samples {` above would otherwise make every note below read
	// two thirds of its length.
	let pendingBlock = false;
	let inBlock = false;

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];

		// Transitions land on directive and number tokens, never on a token a
		// command opens with, so the `<=` tie cannot mis-attribute one.
		while (transition < transitions.length && transitions[transition].at <= token.start) {
			target = transitions[transition].target;
			transition++;
		}

		if (token.kind === "directive") {
			// Matched case-insensitively, as `matchWord` does; every other directive
			// disarms the flag, so one with no block cannot arm an unrelated `{`.
			pendingBlock = BLOCK_DIRECTIVES.has(textOf(token).toLowerCase());
		} else if (token.kind === "operator") {
			const brace = textOf(token);
			if (brace === "{") {
				if (pendingBlock) {
					pendingBlock = false;
					inBlock = true;
				} else if (!inBlock) {
					// A nested `{` is AMK0097 and leaves the block open
					// (`parser.ts:2037-2044`), so this is a set rather than a toggle.
					triplet = true;
				}
			} else if (brace === "}") {
				if (inBlock) {
					// None of the three blocks nests (`Music.cpp:2570`), so the first
					// `}` closes it.
					inBlock = false;
				} else {
					// An unopened `}` is AMK0098, and the block stays closed.
					triplet = false;
				}
			}
		}

		if (token.kind === "channel") {
			// `#0`-`#7`. A malformed one leaves the previous channel standing,
			// which is also what the parser does — it reports and carries on.
			const parsed = Number.parseInt(textOf(token).slice(1), 10);
			if (!Number.isNaN(parsed)) {
				channel = parsed;
			}

			continue;
		}

		if (token.kind === "hex") {
			const vcmd = parseInt(textOf(token).slice(1), 16);
			const args: Command["args"] = [];
			let from = token.replacement;
			let last: GatherToken = token;
			let j = i + 1;
			while (j < tokens.length && tokens[j].kind === "hexArg") {
				// Stop once the command has all its arguments, rather than taking
				// every `hexArg` in reach. `scanHex` emits that kind for any byte
				// below `$DA` even with `hexLeft` at 0 (see the comment there), so a
				// `$00` standing after a full command is one — but it is not an
				// argument: `parser.ts:2918-2943` reads such a byte as a standalone
				// literal and reports it, as AMK0151 under `#amk`. Claiming it here
				// made a one-argument command look like a two-argument one, gave the
				// inspector a row to name, and pointed `spliceArg` at a byte the
				// command does not own.
				//
				// Asked once per token because the answer changes as they arrive:
				// `$FB`'s count and `#am4 $ED`'s sub decide the length, and `null`
				// means the deciding byte is the one about to be read.
				const wanted = expectedArgs(vcmd, args, target);
				if (wanted !== null && args.length >= wanted) {
					break;
				}

				args.push({
					value: parseInt(textOf(tokens[j]).slice(1), 16),
					span: spanOf(tokens[j]),
					replacement: tokens[j].replacement,
				});
				from ??= tokens[j].replacement;
				last = tokens[j];
				j++;
			}

			const expected = expectedArgs(vcmd, args, target);
			commands.push({
				kind: "hex",
				vcmd,
				name: vcmdName(vcmd, args, target),
				span: { start: token.start, end: last.end, line: token.line },
				head: spanOf(token),
				headReplacement: token.replacement,
				args,
				complete: expected !== null && args.length >= expected,
				replacement: from,
				channel,
				target,
			});
			i = j - 1;
			continue;
		}

		if (token.kind === "note" || token.kind === "rest") {
			const { segments, args, last, from, nextIndex } = gatherNoteLength(
				tokens,
				i + 1,
				defaultNoteLength,
				triplet,
				target,
				textOf,
				spanOf,
			);
			const raw = textOf(token);
			commands.push({
				kind: raw[0],
				name: nameForNote(token.kind),
				span: { start: token.start, end: (last ?? token).end, line: token.line },
				head: spanOf(token),
				headReplacement: token.replacement,
				args,
				complete: true,
				replacement: token.replacement ?? from,
				channel,
				target,
				noteLength: segments,
			});
			i = nextIndex - 1;
			continue;
		}

		if (!LETTER_COMMAND_KINDS.has(token.kind)) {
			continue;
		}

		// `y10,1,2` and `t144` alike: consecutive numbers, optionally separated by
		// commas, belong to the command that opened them.
		const args: Command["args"] = [];
		let firstArgToken: GatherToken | undefined;
		let from = token.replacement;
		let last: GatherToken = token;
		let j = i + 1;
		while (j < tokens.length) {
			const next = tokens[j];
			if (next.kind === "number" || next.kind === "hexNumber") {
				args.push({ value: numberValue(textOf(next), next.kind), span: spanOf(next), replacement: next.replacement });
				firstArgToken ??= next;
				from ??= next.replacement;
				last = next;
				j++;
				continue;
			}

			if (next.kind === "operator" && textOf(next) === "," && tokens[j + 1]?.kind === "number") {
				j++;
				continue;
			}

			break;
		}

		const raw = textOf(token);
		const letter = raw[0];
		commands.push({
			kind: letter,
			name: LETTER_NAMES[letter.toLowerCase()] ?? nameForNote(token.kind),
			span: { start: token.start, end: last.end, line: token.line },
			head: spanOf(token),
			headReplacement: token.replacement,
			args,
			complete: true,
			replacement: from,
			channel,
			direct: raw.startsWith("@@") || undefined,
			target,
		});

		if (token.kind === "defaultLength" && firstArgToken) {
			// parser.ts:1524-1550 — updates the length later notes fall back to
			// when they carry no digits of their own.
			defaultNoteLength = resolveDefaultLength(textOf(firstArgToken), defaultNoteLength, target);
		}

		i = j - 1;
	}

	return commands;
}

function nameForNote(kind: TokenKind): string {
	if (kind === "rest") {
		return "rest";
	}

	if (kind === "tie") {
		return "tie";
	}

	return "note";
}

/** The radix comes from the kind, which keeps {@link gather} a pure function of the stream. */
function numberValue(raw: string, kind: TokenKind): number {
	if (kind === "hexNumber") {
		return raw.length === 0 ? -1 : parseInt(raw, 16);
	}

	const digits = raw.replace(/^=/, "").replace(/\.+$/, "");
	return digits.length === 0 ? -1 : parseInt(digits, 10);
}

/**
 * The command's name under the dialect it was written for.
 *
 * `VCMD_NAMES` states the AddmusicK/N-SPC reading, which is also what compiled
 * output always is; the forks here follow what the *parser* makes of the bytes
 * as written. Where a form compiles into another command, its name is that
 * command's — a `$E5` sample load really emits `$F3` (`parser.ts:3028`).
 */
export function vcmdName(vcmd: number, args: { value: number }[], target: CommandTarget): string {
	if (vcmd === 0xed && target.program === 1) {
		// `parseHFDHex` (`parser.ts:3286`) — the sub-byte picks the form.
		const sub = args[0]?.value;
		if (sub === 0x80) {
			return VCMD_NAMES[0xf6]; // what it compiles to (parser.ts:3334)
		}

		if (sub === 0x81) {
			return "tune"; // parser.ts:3343-3354
		}

		if (sub === 0x82) {
			return "ARAM upload"; // parser.ts:3360-3400
		}

		if (sub === 0x83) {
			return "unknown command"; // AMK0163 (parser.ts:3356)
		}

		return VCMD_NAMES[0xed]; // the plain form, a bare `$ED` included
	}

	if (vcmd === 0xe5 && target.program === 1 && (args[0]?.value ?? 0) >= 0x80) {
		return VCMD_NAMES[0xf3]; // sample load in disguise (parser.ts:3016-3031)
	}

	if (vcmd === 0xfc && target.amkVersion === 1) {
		return "remote gain"; // parser.ts:2970, rebuilt at parser.ts:3068-3100
	}

	return VCMD_NAMES[vcmd] ?? "unknown command";
}

/**
 * How many arguments a VCMD takes, or `null` when it cannot be known yet.
 *
 * `$FB`'s length lives in its first argument, and the dialect forks live in
 * the first argument plus {@link CommandTarget}, so both are derived rather
 * than looked up. This deliberately restates what `scanHex` expresses as
 * `hexLeft` mutations: neither side can call the other — the scanner has no
 * argument history (carrying one would break `copyState`'s O(1) contract) and
 * this is a pure function with no stream state — so, as with
 * `BANK_SLOT_COUNT`, the two statements share their citations and `tokentest`
 * pins them against each other at each fork's flip point.
 */
export function expectedArgs(vcmd: number, args: { value: number }[], target: CommandTarget): number | null {
	if (vcmd < FIRST_VCMD || vcmd > LAST_VCMD) {
		return null;
	}

	if (vcmd === 0xed && target.program === 1) {
		// `parseHFDHex` (`parser.ts:3286`) — the same forks as `awaitingHfdSub`.
		if (args.length === 0) {
			return null;
		}

		const sub = args[0].value;
		if (sub === 0x80) {
			return 3;
		}

		if (sub === 0x81) {
			return 2;
		}

		if (sub === 0x83) {
			return 1;
		}

		if (sub === 0x82) {
			if (args.length < 5) {
				return null; // the count is not written yet
			}

			// Sub + four header bytes, then count+1 data bytes (parser.ts:3390).
			return 5 + ((args[3].value << 8) | args[4].value) + 1;
		}

		return 2; // plain ADSR
	}

	if (vcmd === 0xe5 && target.program === 1 && args.length > 0 && args[0].value >= 0x80) {
		return 2; // sample load (parser.ts:3016-3031)
	}

	if (vcmd === 0xfc && target.amkVersion === 1) {
		return 2; // remote gain (parser.ts:2970)
	}

	if (vcmd === 0xfb) {
		if (args.length === 0) {
			return null;
		}

		const count = args[0].value;
		return count >= 0x80 ? 3 : count + 2;
	}

	// `parser.ts:3006-3012` — `$FA $FE`'s toggle byte takes a further byte when
	// its high bit is set, which `scanHex` forks on at `tokens.ts:1013`. This side
	// of the pair was missing it, so the two statements the doc comment above
	// claims are pinned against each other disagreed at exactly this flip point:
	// the scanner scanned three bytes and this returned two, which also made
	// `complete` true for a command still missing its last one.
	if (vcmd === 0xfa && args.length > 1 && args[0].value === 0xfe && args[1].value >= 0x80) {
		return 3;
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
 *
 * Two commands can therefore both contain one offset: adjacent ones meeting at
 * a shared boundary, and — since a replacement collapses onto its use site —
 * every command a single macro expanded to. Both are answered with the first,
 * which is what "the command it just finished" means, and which keeps the
 * result from depending on where the binary search happened to land.
 */
export function commandAt(commands: Command[], offset: number): Command | null {
	let low = 0;
	let high = commands.length - 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		const { span } = commands[mid];
		if (offset < span.start) {
			high = mid - 1;
		} else if (offset > span.end) {
			low = mid + 1;
		} else {
			let index = mid;
			while (index > 0) {
				const previous = commands[index - 1].span;
				if (offset < previous.start || offset > previous.end) {
					break;
				}

				index--;
			}

			return commands[index];
		}
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
		if (offset < token.start) {
			high = mid - 1;
		} else if (offset >= token.end) {
			low = mid + 1;
		} else {
			return token;
		}
	}

	return null;
}
