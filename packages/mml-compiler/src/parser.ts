/**
 * AddmusicK MML parser.
 *
 * A port of the single-pass scanner in AddmusicK's `Music.cpp`, covering every
 * target it accepts:
 *
 *   `#amk 1`, `#amk 2`, `#amk 4`  — AddmusicK's own parser versions
 *   `#am4`                        — Addmusic 4.05
 *   `#amm`                        — AddmusicM
 *
 * (`#amk 3`, Codec's beta, is unimplemented in AddmusicK itself and rejected in
 * the preprocessor.)
 *
 * Two variables drive every legacy behaviour, matching the original:
 *   `targetAMKVersion`  — 0 for am4/amm, otherwise the `#amk` number
 *   `songTargetProgram` — 0 = AddmusicK, 1 = Addmusic 4.05, 2 = AddmusicM
 *
 * Where behaviour looks strange it is almost certainly strange in the original
 * too; comments cite the reference line numbers so the two can be diffed.
 */

import { hex2 } from "@amk/core/hex";
import type {
	Diagnostic,
	LoopEvent,
	ParseEvent,
	ParseState,
	ParseTrace,
	SongLength,
	Span,
	SongTags,
} from "@amk/core/types";
import { TARGET_AM4, TARGET_AMM, TARGET_NONE, preprocess } from "./preprocess";
import {
	DEFAULT_TRANSPOSE,
	EMPTY_SAMPLE_NAME,
	BANK_SLOT_COUNT,
	bankSlotName,
	FIRST_CUSTOM_INSTRUMENT,
	FIRST_PERCUSSION_INSTRUMENT,
	FIRST_VCMD,
	HEX_LENGTHS,
	INSTRUMENT_TO_SAMPLE,
	NOTE_MAX,
	NOTE_MIN,
	NOTE_REST,
	NOTE_TIE,
	PARSER_VERSION,
	PITCH_TABLE,
	TICKS_PER_WHOLE,
} from "@amk/core/hardcoded-tables";

export interface AddmusicKOptions {
	sampleNames: readonly string[];
	sampleGroups: Readonly<Record<string, readonly string[]>>;
	importantSamples?: readonly string[];
	optimizeSampleUsage?: boolean;
}

/** What `scan` dispatches to `parseNote`; {@link NoteEvent} already holds them. */
const NOTE_LETTERS = new Set(["c", "d", "e", "f", "g", "a", "b", "r", "^"]);

export interface NoteEvent {
	channel: number;
	offset: number;
	/** The emitted note byte, after transposition and the percussion remap. */
	note: number;
	/**
	 * The byte the letter and octave alone name — `getPitch` — before `h`, the
	 * instrument's transposition and the percussion remap. Equal to `note` for a
	 * rest or a tie. Not something AddmusicK records; the piano roll draws on it.
	 */
	written: number;
	/** Ticks the note occupies, `^` ties folded in and the tempo ratio applied. */
	ticks: number;
	span: Span;
}

/**
 * A command that emitted bytes, for the command map. See `CommandAddress`.
 *
 * Only commands that emit are here, because only those have an address for the
 * walk to name them by. `q`, `h` and `@21`-`@29` write nothing of their own —
 * they fold into the notes that follow — and `o` and `l` write nothing at all.
 */
export interface CommandEvent {
	channel: number;
	offset: number;
	span: Span;
}

/** Raw output of the scan, before pointers are resolved. See `link.ts`. */
export interface ParseOutput {
	data: number[][];
	loopLocations: number[][];
	phrasePointers: number[][];
	noteEvents: NoteEvent[];
	commandEvents: CommandEvent[];
	instrumentData: number[];
	hasIntro: boolean;
	doesntLoop: boolean;
	resizedChannel: number;
	echoBufferSize: number;
	hasEchoBufferCommand: boolean;
	echoBufferAllocVCMDIsSet: boolean;
	echoBufferAllocVCMDLoc: number;
	echoBufferAllocVCMDChannel: number;
	channelLengths: number[];
	/** AddmusicK's `introLength`: the last `/` parsed. Kept for parity only. */
	introLength: number;
	/** Where the intro actually ends, in ticks: the first `/` in the file. */
	introTicks: number;
	sampleList: readonly string[] | null;
	requestedSamples: readonly string[] | null;
	usedSamples: boolean[];
	minSize: number;
	tags: SongTags;
	tagSeconds: number | null;
	introSeconds: number | null;
	mainSeconds: number | null;
	playback: SongLength | null;
	hasYoshiDrums: boolean;
	targetAMKVersion: number;
	songTargetProgram: number;
	/** `#halvetempo` and `#option dividetempo`'s divisor, 1 without either. */
	tempoRatio: number;
	diagnostics: Diagnostic[];
	errorCount: number;
	/** Only when the parser was asked to trace. See `ParseTrace`. */
	trace: ParseTrace | null;
}

/**
 * Preprocessor directives that reach the parser, and what AddmusicK says about
 * them (Music.cpp:2432-2456, via `parseDefine` and friends at Music.cpp:3348+).
 *
 * They only get here when the spelling did not match `preprocess`'s
 * case-sensitive comparison but does match this stage's case-insensitive one
 */
const LEFTOVER_PREPROCESSOR: readonly (readonly [word: string, article: string, code: string])[] = [
	["define", "A", "AMK0046"],
	["undef", "An", "AMK0047"],
	["ifdef", "An", "AMK0048"],
	["ifndef", "An", "AMK0049"],
	["endif", "An", "AMK0054"],
];

/**
 * How long one tick lasts, in seconds, at a given tempo.
 *
 * AddmusicK's `1 / (2 * tempo)` is a rounding, and says so — Music.cpp:3255 asks
 * "Just 2? Not 2.012584 or something?". Timer 0 runs at SPC-700's 8000hz/16 = 500 Hz
 * (main.asm:176, commented "2 ms") and the ticker adds the tempo to `$49` once
 * per pass of the main loop, ticking on carry — one tick per 256 units, so the
 * divisor is 500/256 = 1.953125.
 *
 * An estimate, and used only for labels. Anything that must stay in step
 * with the audio counts the driver's own ticks; see `@amk/spc/driver-state`.
 */
const TIMER_HZ = 500;
const TEMPO_UNIT = 256;
const TEMPO_TICK_SECONDS = (tempo: number): number => TEMPO_UNIT / (TIMER_HZ * (tempo + 1));

const isSpace = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\v" || c === "\f";
const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isAlpha = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
const isNoteLetter = (c: string): boolean => "abcdefgABCDEFG".includes(c);

export class AddmusicKParser {
	private text: string;
	private pos = 0;
	private line = 1;

	// --- target -------------------------------------------------------------
	private targetAMKVersion = PARSER_VERSION;
	private songTargetProgram = 0;

	// --- channel state -------------------------------------------------------
	private channel = 0;
	private prevChannel = 0;
	private channelDefined = false;
	private readonly data: number[][] = Array.from({ length: 9 }, () => []);
	private readonly loopLocations: number[][] = Array.from({ length: 9 }, () => []);
	private readonly phrasePointers: number[][] = Array.from({ length: 8 }, () => [0, 0]);
	private readonly noteEvents: NoteEvent[] = [];
	private readonly commandEvents: CommandEvent[] = [];
	/** The hex run being gathered, since `$ED $3F $4D` is three dispatches. */
	private hexRun: { start: number; offset: number } | null = null;
	private readonly passedNote = new Array<boolean>(8).fill(false);
	private readonly passedIntro = new Array<boolean>(8).fill(false);

	// --- note state ----------------------------------------------------------
	private octave = 4;
	private prevNoteLength = -1;
	private defaultNoteLength = TICKS_PER_WHOLE / 8;
	private triplet = false;
	private inPitchSlide = false;
	private nextNoteIsForDD = false;
	private readonly instrument = new Array<number>(9).fill(0);
	private readonly q = new Array<number>(9).fill(0x7f);
	private readonly updateQ = new Array<boolean>(9).fill(true);
	private readonly transposeMap = new Array<number>(256).fill(0);
	/** Addmusic 4.05 ignores instrument tuning until one is declared. */
	private readonly ignoreTuning = new Array<boolean>(9).fill(false);
	private hTranspose = 0;
	private usingHTranspose = false;

	// --- hex state machine ---------------------------------------------------
	private hexLeft = 0;
	private currentHex = 0;
	private currentHexSub = 0;
	private nextHexIsArpeggioNoteLength = false;
	private readonly usingFC = new Array<boolean>(9).fill(false);
	private readonly lastFCDelayValue = new Array<number>(9).fill(0);
	private readonly lastFCGainValue = new Array<number>(9).fill(0);

	// --- loop state ----------------------------------------------------------
	private prevLoop = -1;
	private loopLabel = 0;
	private readonly loopPointers = new Map<number, number>();
	private inE6Loop = false;
	private normalLoopLength = 0;
	private superLoopLength = 0;
	private readonly loopLengths = new Map<number, number>();
	private baseLoopIsNormal = false;
	private baseLoopIsSuper = false;
	private extraLoopIsNormal = false;
	private extraLoopIsSuper = false;

	// --- song state ----------------------------------------------------------
	private hasIntro = false;
	private doesntLoop = false;
	private hasYoshiDrums = false;
	private tempo = 0x36;
	private tempoRatio = 1;
	private usingSMWVTable = false;
	private resizedChannel = -1;
	private echoBufferSize = 0;
	private hasEchoBufferCommand = false;
	private echoBufferAllocVCMDIsSet = false;
	private echoBufferAllocVCMDLoc = 0;
	private echoBufferAllocVCMDChannel = 0;
	private readonly channelLengths = new Array<number>(8).fill(0);
	private introLength = 0;
	private introTicks = 0;
	private guessLength = true;
	private declaredSeconds: number | null = null;
	private readonly tempoChanges: [number, number][] = [];
	private readonly sampleList: string[] = [];
	private readonly sampleImportant: boolean[] = [];
	private readonly usedSamples = new Array<boolean>(256).fill(false);
	private basepath = "";
	private inRemoteDefinition = false;
	private minSize = 0;
	private readonly tags: SongTags = {};
	private readonly instrumentData: number[] = [];

	// --- replacements --------------------------------------------------------
	private readonly replacements = new Map<string, string>();
	private sortedReplacements: [string, string][] = [];
	private replacementsDirty = false;

	// --- diagnostics ---------------------------------------------------------
	private readonly diagnostics: Diagnostic[] = [];
	private errorCount = 0;
	private readonly warnedOnce = new Set<string>();

	/** Where each character of `this.text` came from in the source. */
	private origins: number[] = [];
	/** The source as the preprocessor saw it: BOM stripped, nothing else. */
	private scanned = "";
	/** 1 when a BOM was removed, since that shifts every offset after it. */
	private bomOffset = 0;
	/** Offsets in {@link scanned} at which each line after the first begins; built on first use. */
	private lineStarts: number[] | null = null;

	// --- trace ---------------------------------------------------------------
	/** One event per dispatch, or null when no trace was asked for. See `ParseTrace`. */
	private readonly traceEvents: ParseEvent[] | null;
	/** The source span of every replacement match, kept beside the events. */
	private readonly expansions: Span[] | null;

	constructor(
		private readonly source: string,
		private readonly options?: AddmusicKOptions,
		trace = false,
	) {
		this.text = "";
		this.traceEvents = trace ? [] : null;
		this.expansions = trace ? [] : null;
	}

	// =========================================================================
	// Entry point
	// =========================================================================

	parse(): ParseOutput {
		let text = this.stripBOM();

		// Music.cpp:297-306 - substring search of the raw* source, before preprocessing
		const titleAt = text.indexOf(";title=");
		if (titleAt !== -1) {
			const from = titleAt + ";title=".length;
			const end = text.slice(from).search(/[\r\n]/);
			this.tags.title = end === -1 ? text.slice(from) : text.slice(from, from + end);
		}

		// Music.cpp:286 - Add some spaces to the end before preprocessing
		const pre = preprocess(`${text}                `);
		this.diagnostics.push(...pre.diagnostics);
		this.errorCount += pre.diagnostics.filter((d) => d.severity === "error").length;

		// More of the same, so the parser's own lookahead never runs off the end.
		this.text = `${pre.text}                       `;

		this.origins = pre.origins
			.map((origin) => Math.min(origin, text.length))
			.concat(new Array<number>(this.text.length - pre.text.length).fill(text.length));

		if (this.errorCount === 0 && this.applyTarget(pre.version)) {
			this.detectStartingChannel();
			for (let z = 0; z < 19; z++) {
				this.transposeMap[z] = DEFAULT_TRANSPOSE[z];
			}

			// Music.cpp:410 - Addmusic 4.05 suppresses tuning until an instrument
			// is explicitly declared on a channel.
			this.ignoreTuning.fill(this.songTargetProgram === 1);
			this.scan();
		}

		this.terminateChannels();
		return this.output();
	}

	private stripBOM() {
		let text = this.source;
		if (text.charCodeAt(0) === 0xfeff) {
			text = text.slice(1);
		}

		// A stripped BOM shifts everything after it, so spans are mapped back
		// through the text the preprocessor actually saw and the byte is added
		// again at the end.
		this.bomOffset = this.source.length - text.length;
		this.scanned = text;
		return text;
	}

	/** Music.cpp:337-380. Returns false when the song cannot be compiled. */
	private applyTarget(version: number): boolean {
		if (version === TARGET_AM4) {
			this.songTargetProgram = 1;
			this.targetAMKVersion = 0;
		} else if (version === TARGET_AMM) {
			this.songTargetProgram = 2;
			this.targetAMKVersion = 0;
		} else if (version === TARGET_NONE) {
			this.errorAt(0, 0, "AMK0002", 'Song did not specify a target program with "#amk", "#am4" or "#amm".');
			return false;
		} else {
			this.targetAMKVersion = version;
			if (version > PARSER_VERSION) {
				this.errorAt(
					0,
					0,
					"AMK0003",
					`This song was made for a newer version of AddmusicK (#amk ${version}); only up to ${PARSER_VERSION} is supported.`,
				);
				return false;
			}
		}

		// Music.cpp:377 - #amk 2 and beyond use N-SPC velocity tables, not SMW's
		this.usingSMWVTable = this.targetAMKVersion < 2;
		return true;
	}

	/** Music.cpp:383-406. */
	private detectStartingChannel(): void {
		for (let ch = 0; ch <= 7; ch++) {
			if (this.text.includes(`#${ch}`)) {
				this.channel = ch;
				this.prevChannel = ch;
				break;
			}
		}

		this.resizedChannel = this.channel;
	}

	/** The dispatch loop. Music.cpp:419-492. */
	private scan(): void {
		while (this.pos < this.text.length - 23) {
			this.doReplacement();
			const c = this.text[this.pos];
			const lower = c.toLowerCase();

			// Music.cpp:431 — anything that is not whitespace or another `$` while
			// a hex command is still expecting arguments is an error. Addmusic 4.05
			// gets one exception: an unterminated $E6 becomes $FD.
			if (this.hexLeft !== 0 && !isSpace(c) && lower !== "$" && c !== "\n") {
				if (this.currentHex === 0xe6 && this.songTargetProgram === 1) {
					this.data[this.channel][this.data[this.channel].length - 1] = 0xfd;
					this.hexLeft = 0;
				} else {
					this.error("AMK0155", "Unknown hex command.");
				}
			}

			const commandAt = this.pos;
			const commandChannel = this.channel;
			const commandOffset = this.data[this.channel].length;
			const midRun = this.hexLeft !== 0;
			// The trace's view of the same moment. `lengthsBefore` is what lets a
			// loop event be read off the bytes a handler wrote, and is only taken
			// when a trace was asked for.
			const lengthsBefore = this.traceEvents === null ? null : this.data.map((channel) => channel.length);
			const wasRemote = this.inRemoteDefinition;
			const wasE6 = this.inE6Loop;

			// prettier-ignore
			switch (lower) {
				case "?": this.parseQMark(); break;
				case "#": this.parseHash(); break;
				case "l": this.parseDefaultLength(); break;
				case "w": this.parseGlobalVolume(); break;
				case "v": this.parseVolume(); break;
				case "q": this.parseQuantization(); break;
				case "y": this.parsePan(); break;
				case "/": this.parseIntro(); break;
				case "t": this.parseT(); break;
				case "o": this.parseOctave(); break;
				case "@": this.parseInstrument(); break;
				case "(": this.parseOpenParen(); break;
				case "[": this.parseLoopStart(); break;
				case "]": this.parseLoopEnd(); break;
				case "*": this.parseStarLoop(); break;
				case "p": this.parseVibrato(); break;
				case "{": this.parseTripletOpen(); break;
				case "}": this.parseTripletClose(); break;
				case ">": this.parseRaiseOctave(); break;
				case "<": this.parseLowerOctave(); break;
				case "&": this.parsePitchSlide(); break;
				case "$": this.parseHexCommand(); break;
				case "h": this.parseTranspose(); break;
				case "n": this.parseNoise(); break;
				case '"': this.parseReplacementDirective(); break;
				case "\n": this.pos++; this.line++; break;
				case "|": this.pos++; this.hexLeft = 0; break;
				case ";": this.parseComment(); break;
				case "c": case "d": case "e": case "f":
				case "g": case "a": case "b": case "r": case "^":
					this.parseNote();
					break;
				default:
					if (isSpace(c)) {
						this.pos++;
					} else {
						this.warn(this.pos, this.pos + 1, "AMK0100", `Unexpected character "${c}".`);
						this.pos++;
					}
			}

			this.recordCommand(lower, commandAt, commandChannel, commandOffset, midRun);
			if (lengthsBefore !== null && !isSpace(c)) {
				this.recordTrace(lower, commandAt, commandChannel, lengthsBefore, wasRemote, wasE6);
			}
		}
	}

	/**
	 * The parse trace: the state each dispatch left behind, and what it did to
	 * the loop structure. Nothing AddmusicK records — see `ParseTrace`.
	 *
	 * Here beside {@link recordCommand} for the same reason it is: the dispatch
	 * is the one place every command passes through. What a bracket did is read
	 * off the bytes rather than asked of the handler — `[` moves the channel to
	 * 8, `]` moves it back and leaves `$E9 lo hi n` on the caller, `*` and `(n)m`
	 * leave the same four bytes, `[[` and `]]n` toggle `inE6Loop` and `]]n`
	 * leaves `$E6 n-1` — and every handler writes only on its success path, so
	 * a dispatch that errored records no loop event.
	 */
	private recordTrace(
		lower: string,
		start: number,
		channel: number,
		lengthsBefore: number[],
		wasRemote: boolean,
		wasE6: boolean,
	): void {
		if (this.traceEvents === null) {
			return;
		}

		let end = this.pos;
		while (end > start && isSpace(this.text[end - 1])) {
			end--;
		}

		const event: ParseEvent = { span: this.spanAt(start, end), char: lower, channel, state: this.snapshotState() };
		const loop = this.loopEventOf(lower, start, channel, lengthsBefore, wasRemote, wasE6);
		if (loop) {
			event.loop = loop;
		}

		this.traceEvents.push(event);
	}

	private snapshotState(): ParseState {
		return {
			channel: this.channel,
			prevChannel: this.prevChannel,
			octave: this.octave,
			defaultNoteLength: this.defaultNoteLength,
			prevNoteLength: this.prevNoteLength,
			triplet: this.triplet,
			hTranspose: this.hTranspose,
			usingHTranspose: this.usingHTranspose,
			instrument: [...this.instrument],
			q: [...this.q],
			ignoreTuning: [...this.ignoreTuning],
			inRemoteDefinition: this.inRemoteDefinition,
			inE6Loop: this.inE6Loop,
			prevLoop: this.prevLoop,
			loopLabel: this.loopLabel,
			channelDefined: this.channelDefined,
			inPitchSlide: this.inPitchSlide,
			nextNoteIsForDD: this.nextNoteIsForDD,
		};
	}

	private loopEventOf(
		lower: string,
		start: number,
		channel: number,
		lengthsBefore: number[],
		wasRemote: boolean,
		wasE6: boolean,
	): LoopEvent | undefined {
		const grew = (slot: number): number => this.data[slot].length - lengthsBefore[slot];
		const tail = (slot: number, back: number): number => this.data[slot][this.data[slot].length - back];

		switch (lower) {
			case "[":
				if (channel < 8 && this.channel === 8) {
					return { kind: "open", at: this.prevLoop, label: this.loopLabel, remote: this.inRemoteDefinition };
				}

				if (!wasE6 && this.inE6Loop) {
					return { kind: "subOpen" };
				}

				return undefined;

			case "]":
				if (channel === 8 && this.channel < 8) {
					const called = grew(this.channel) === 4 && tail(this.channel, 4) === 0xe9;
					return { kind: "close", at: this.prevLoop, count: called ? tail(this.channel, 1) : 1, remote: wasRemote };
				}

				if (wasE6 && !this.inE6Loop && grew(channel) === 2 && tail(channel, 2) === 0xe6) {
					return { kind: "subClose", count: tail(channel, 1) + 1 };
				}

				return undefined;

			case "*":
			case "(":
				if (channel < 8 && grew(channel) === 4 && tail(channel, 4) === 0xe9) {
					// `(n)m` reads its label as `parseLabelLoop` does, one higher than
					// written, so it matches the `open` event's label.
					const written = lower === "(" ? /^\((\d+)\)/.exec(this.text.slice(start, start + 8)) : null;
					return {
						kind: "call",
						at: tail(channel, 3) | (tail(channel, 2) << 8),
						count: tail(channel, 1),
						label: written ? Number.parseInt(written[1], 10) + 1 : null,
					};
				}

				return undefined;

			default:
				return undefined;
		}
	}

	/**
	 * The command map: what the dispatch above just wrote, and where it was
	 * written. Nothing AddmusicK records — see `CommandAddress`.
	 *
	 * Here rather than in each handler because there are fifty of them and one
	 * that forgot would leave a note sounding under a command nothing could
	 * name. The dispatch is the one place every command passes through, so the
	 * question "did that write bytes to this channel" is asked once.
	 *
	 * Three things it has to know that the byte count alone does not say:
	 *
	 *   - A hex run is many dispatches. `$ED $3F $4D` reaches `case "$"` three
	 *     times, one byte each, so the run opens on the byte that found
	 *     `hexLeft` at zero and is recorded when it returns there — under the
	 *     first byte's offset, which is the address the driver reads it at.
	 *   - Notes are already in {@link NoteEvent}, and a note in both maps would
	 *     be a command in force on itself.
	 *   - `#N`, `[` and `]` move {@link channel} out from under the offset that
	 *     was taken before them, which is what the comparison catches. Their own
	 *     bytes are structure rather than state, so losing them costs nothing.
	 */
	private recordCommand(lower: string, start: number, channel: number, offset: number, midRun: boolean): void {
		if (this.hexLeft !== 0) {
			// Still gathering. The first byte of the run is the one to remember;
			// whitespace between arguments must not disturb it.
			if (lower === "$" && !midRun && this.data[channel].length > offset) {
				this.hexRun = { start, offset };
			}

			return;
		}

		const run = this.hexRun;
		this.hexRun = null;

		if (this.channel !== channel || this.data[channel].length === offset || NOTE_LETTERS.has(lower)) {
			return;
		}

		// A single-byte command like `$F0` never opened a run, so it is its own.
		const from = lower === "$" && run !== null ? run : { start, offset };

		// The trailing whitespace the handler's own `skipSpaces` walked past is
		// not part of the command, as `parseNote` trims it for the same reason.
		let end = this.pos;
		while (end > from.start && isSpace(this.text[end - 1])) {
			end--;
		}

		this.commandEvents.push({ channel, offset: from.offset, span: this.spanAt(from.start, end) });
	}

	private terminateChannels(): void {
		const saved = this.channel;
		for (let z = 0; z < 8; z++) {
			if (this.data[z].length !== 0) {
				this.channel = z;
				this.append(0);
			}
		}

		this.channel = saved;
	}

	// =========================================================================
	// Lexing primitives
	// =========================================================================

	private append(value: number): void {
		this.data[this.channel].push(value & 0xff);
	}

	private skipSpaces(): void {
		while (this.pos < this.text.length && isSpace(this.text[this.pos])) {
			if (this.text[this.pos] === "\n") {
				this.line++;
			}

			this.pos++;
		}
	}

	private getInt(): number {
		this.doReplacement();
		let value = 0;
		let digits = 0;
		while (this.pos < this.text.length && isDigit(this.text[this.pos])) {
			value = value * 10 + (this.text.charCodeAt(this.pos) - 0x30);
			this.pos++;
			digits++;
		}

		return digits === 0 ? -1 : value;
	}

	private getIntWithNegative(): number {
		this.doReplacement();
		let negative = false;
		if (this.text[this.pos] === "-") {
			negative = true;
			this.pos++;
		}

		let value = 0;
		let digits = 0;
		while (this.pos < this.text.length && isDigit(this.text[this.pos])) {
			value = value * 10 + (this.text.charCodeAt(this.pos) - 0x30);
			this.pos++;
			digits++;
		}

		if (digits === 0) {
			throw new Error("Invalid number");
		}

		return negative ? -value : value;
	}

	private getHex(anyLength = false): number {
		this.doReplacement();
		let value = 0;
		let digits = 0;
		while (this.pos < this.text.length) {
			if (digits >= 2 && !anyLength) {
				break;
			}

			const c = this.text[this.pos];
			let nibble: number;
			if (c >= "0" && c <= "9") {
				nibble = c.charCodeAt(0) - 0x30;
			} else if (c >= "A" && c <= "F") {
				nibble = c.charCodeAt(0) - 0x37;
			} else if (c >= "a" && c <= "f") {
				nibble = c.charCodeAt(0) - 0x57;
			} else {
				break;
			}

			this.pos++;
			digits++;
			value = value * 16 + nibble;
		}

		return digits === 0 ? -1 : value;
	}

	private getPitch(letter: string): number {
		let value = PITCH_TABLE[letter.charCodeAt(0) - 0x61] + (this.octave - 1) * 12 + 0x80;
		if (this.text[this.pos] === "+") {
			value++;
			this.pos++;
		} else if (this.text[this.pos] === "-") {
			value--;
			this.pos++;
		}

		return value;
	}

	/** Music.cpp:getNoteLength. */
	private getNoteLength(n: number): number {
		let ticks: number;
		if (n === -1 && this.text[this.pos] === "=") {
			this.pos++;
			ticks = this.getInt();
			if (ticks === -1) {
				this.error("AMK0010", "Error parsing note length.");
				ticks = this.defaultNoteLength;
			}

			// Exact tick counts only gained dot/triplet modifiers in #amk 4.
			if (this.targetAMKVersion < 4) {
				return ticks;
			}
		} else if (n < 1 || n > TICKS_PER_WHOLE) {
			ticks = this.defaultNoteLength;
		} else {
			if (TICKS_PER_WHOLE % n !== 0) {
				this.warnOnce(
					"fraction",
					"AMK0200",
					"A note length was used that is not divisible by 192 ticks, so it produces a fractional tick value.",
				);
			}

			ticks = Math.floor(TICKS_PER_WHOLE / n);
		}

		return this.getNoteLengthModifier(ticks, true);
	}

	private getNoteLengthModifier(ticks: number, allowTriplet: boolean): number {
		let frac = ticks;
		let dots = 0;
		while (this.pos < this.text.length && this.text[this.pos] === ".") {
			if (frac % 2 !== 0) {
				this.warnOnce(
					"fraction",
					"AMK0200",
					`Adding ${dots + 1 === 1 ? "a dot" : `${dots + 1} dots`} to this note produces a fractional tick value.`,
				);
			}

			frac = Math.floor(frac / 2);
			ticks += frac;
			this.pos++;
			dots++;
			// Music.cpp:2960 — Addmusic 4.05 stops after two dots.
			if (dots === 2 && this.songTargetProgram === 1) {
				break;
			}
		}

		if (this.triplet && allowTriplet) {
			if (ticks % 3 !== 0) {
				this.warnOnce("fraction", "AMK0200", "Putting this note in a triplet produces a fractional tick value.");
			}

			ticks = Math.floor((ticks * 2.0) / 3.0 + 0.5);
		}

		return ticks;
	}

	/** Music.cpp:3662 — the tempo ratio only applies from #amk 4. */
	private divideByTempoRatio(value: number, fractionIsError: boolean): number {
		if (this.targetAMKVersion < 4 || this.tempoRatio === 1) {
			return value;
		}

		const result = Math.floor(value / this.tempoRatio);
		if (value % this.tempoRatio !== 0) {
			if (fractionIsError) {
				this.error("AMK0011", "Using the tempo ratio on this value would produce a fractional value.");
			} else {
				this.warnOnce("ratio", "AMK0201", "The tempo ratio produced a fractional value.");
			}
		}

		return result;
	}

	private multiplyByTempoRatio(value: number): number {
		const result = value * this.tempoRatio;
		if (result >= 256) {
			this.error("AMK0012", "Using the tempo ratio on this value would overflow.");
		}

		return result;
	}

	// =========================================================================
	// Replacements
	// =========================================================================

	private parseReplacementDirective(): void {
		const start = this.pos;
		this.pos++;
		// Music.cpp:2518 reads this with `getQuotedString`, so `\"` is legal here
		// too — `"foo=\"bar\""` defines a replacement whose value contains quotes.
		const body = this.getQuotedString();
		if (body === null) {
			this.pos = this.text.length;
			return;
		}

		const eq = body.indexOf("=");
		if (eq === -1) {
			this.errorAt(start, this.pos, "AMK0021", "Error parsing replacement directive; could not find '='.");
			return;
		}

		const find = body.slice(0, eq).replace(/\s+$/, "");
		const replacement = body.slice(eq + 1).replace(/^\s+/, "");
		if (find.length === 0) {
			this.errorAt(start, this.pos, "AMK0022", "Error parsing replacement directive; string to find was empty.");
			return;
		}

		this.replacements.set(find, replacement);
		this.replacementsDirty = true;
	}

	/**
	 * Greedy, longest-match-first, applied repeatedly so replacements can be
	 * transitive. Like the original this rewrites the buffer in place.
	 */
	private doReplacement(): void {
		if (this.replacements.size === 0) {
			return;
		}

		if (this.replacementsDirty) {
			this.sortedReplacements = [...this.replacements.entries()].sort((a, b) => b[0].length - a[0].length);
			this.replacementsDirty = false;
		}

		// Music.cpp:137 caps this at 500. Anything lower rejects chains the
		// reference compiles.
		for (let guard = 0; guard < 500; guard++) {
			let matched = false;
			for (const [find, replacement] of this.sortedReplacements) {
				if (this.text.startsWith(find, this.pos)) {
					const useSite = this.originAt(this.pos);
					// The only place the match's extent is known; the trace needs it to
					// find the use site in the source.
					if (this.expansions !== null) {
						this.expansions.push(this.spanAt(this.pos, this.pos + find.length));
					}

					this.text = this.text.slice(0, this.pos) + replacement + this.text.slice(this.pos + find.length);
					// `concat` rather than `splice(...)` with a spread: a long
					// replacement would push its whole length onto the argument
					// stack, and this runs on user-supplied text.
					this.origins = this.origins
						.slice(0, this.pos)
						.concat(new Array<number>(replacement.length).fill(useSite), this.origins.slice(this.pos + find.length));
					matched = true;
					break;
				}
			}

			if (!matched) {
				return;
			}
		}

		this.error("AMK0023", "Replacement expansion did not terminate (recursive definition?).");
	}

	// =========================================================================
	// Directives
	// =========================================================================

	/**
	 * Music.cpp:494 — the preprocessor strips `;` comments for every target
	 * except AddmusicM, so anything reaching here is either an AMM comment or a
	 * stray semicolon.
	 */
	private parseComment(): void {
		if (this.songTargetProgram === 2) {
			this.pos++;
			while (this.pos < this.text.length && this.text[this.pos] !== "\n") {
				this.pos++;
			}

			this.line++;
			return;
		}

		this.pos++;
		this.error("AMK0101", "Illegal use of comments. Sorry about that.");
	}

	/**
	 * Music.cpp:535 — `?` on its own, or `?0`, stops the song looping.
	 *
	 * `?1` and `?2` set AMK's `noMusic[channel][]`, which is written at
	 * Music.cpp:543-544 and read nowhere in the reference, so they are consumed
	 * and discarded. Consuming the digit matters either way: without it `?1`
	 * both stops the song looping and leaves the `1` reported as a stray
	 * character.
	 */
	private parseQMark(): void {
		this.pos++;
		const which = this.getInt();
		if (which === -1 || which === 0) {
			this.doesntLoop = true;
		}
	}

	private parseHash(): void {
		this.pos++;
		if (isAlpha(this.text[this.pos])) {
			this.parseSpecialDirective();
			return;
		}

		const n = this.getInt();
		if (n === -1) {
			return this.error("AMK0030", "Error parsing channel directive.");
		}

		if (n < 0 || n > 7) {
			return this.error("AMK0031", "Illegal value for channel directive; must be #0 to #7.");
		}

		this.channel = n;
		this.q[8] = this.q[n];
		this.updateQ[8] = this.updateQ[n];
		this.prevNoteLength = -1;
		this.hTranspose = 0;
		this.usingHTranspose = false;
		this.channelDefined = true;
	}

	/**
	 * `strnicmp(text + pos, word, n) == 0 && isspace(text[pos + n])`, which is the
	 * shape of every branch in `parseSpecialDirective` (Music.cpp:2415-2506) bar
	 * two — see {@link matchPrefix} for those. Case-insensitive.
	 */
	private matchWord(word: string): boolean {
		const slice = this.text.slice(this.pos, this.pos + word.length);
		if (slice.toLowerCase() !== word) {
			return false;
		}

		const after = this.text[this.pos + word.length];
		return after === undefined || isSpace(after);
	}

	/** The two directives AddmusicK matches on prefix alone: `amk=` and `halvetempo`. */
	private matchPrefix(word: string): boolean {
		return this.text.slice(this.pos, this.pos + word.length).toLowerCase() === word;
	}

	private parseSpecialDirective(): void {
		const start = this.pos - 1;

		if (this.matchWord("spc")) {
			this.pos += 3;
			this.parseBlock(() => this.parseSpcInfo());
		} else if (this.matchPrefix("amk=")) {
			// Music.cpp:2488 — read and thrown away.
			this.pos += 4;
			this.getInt();
		} else if (this.matchPrefix("halvetempo")) {
			// Music.cpp:2493 — the one directive with no terminator test, so `#halvetempo#0` is legal.
			this.pos += 10;
			if (this.channelDefined) {
				return this.error("AMK0040", "#halvetempo must be used before any and all channels.");
			}

			this.tempoRatio *= 2;
			if (!this.checkTempoRatio(start)) {
				return;
			}
		} else if (this.matchWord("option")) {
			this.pos += 6;
			this.parseOptionDirective();
		} else if (this.matchWord("louder")) {
			this.pos += 6;
			if (this.targetAMKVersion > 1) {
				this.warn(start, this.pos, "AMK0204", "#louder is redundant in #amk 2 and above.");
			}

			this.append(0xf4);
			this.append(0x08);
		} else if (this.matchWord("tempoimmunity")) {
			this.pos += 13;
			this.append(0xf4);
			this.append(0x07);
		} else if (this.matchWord("samples")) {
			this.pos += 7;
			this.parseBlock(() => this.parseSampleDefinitions(start));
		} else if (this.matchWord("instruments")) {
			this.pos += 11;
			this.parseBlock(() => this.parseInstrumentDefinitions(start));
		} else if (this.matchWord("path")) {
			this.pos += 4;
			this.parsePath();
		} else if (this.matchWord("pad")) {
			this.pos += 3;
			this.parsePadDefinition();
		} else if (this.matchWord("am4") || this.matchWord("amm")) {
			this.pos += 3;
		} else {
			// Music.cpp:2432-2456 — `preprocess` is case-sensitive and this is not,
			// so a capitalised `#DEFINE` survives preprocessing and lands here.
			for (const [word, article, code] of LEFTOVER_PREPROCESSOR) {
				if (this.matchWord(word)) {
					this.pos += word.length;
					return this.errorAt(start, this.pos, code, `${article} #${word} was found after the preprocessing stage.`);
				}
			}

			// And nothing else. Music.cpp:2413-2506 has no final else, so `pos` is
			// left sitting on the first letter and `scan` dispatches it as music:
			// `#c4` is the note `c4`, and `#foo` is the note `f` followed by an `o`
			// octave directive with no number.
			//
			// Reporting an unknown directive here instead would have been the more
			// helpful thing to do, and it is not what the reference does — a song
			// that leans on this, deliberately or not, has to compile the same way
			// in both.
		}
	}

	/** Music.cpp:parseOptionDirective. */
	private parseOptionDirective(): void {
		const start = this.pos;
		if (this.targetAMKVersion === 1) {
			return this.error("AMK0045", "#option is not available in #amk 1.");
		}

		if (this.channelDefined) {
			return this.error("AMK0041", "#option directives must be used before any and all channels.");
		}

		this.skipSpaces();

		if (this.matchWord("smwvtable")) {
			this.pos += 9;
			if (!this.usingSMWVTable) {
				this.append(0xfa);
				this.append(0x06);
				this.append(0x00);
				this.usingSMWVTable = true;
			} else {
				// Music.cpp:2354
				this.warn(
					start,
					this.pos,
					"AMK0203",
					"This song already uses the SMW velocity table; this command wastes three bytes.",
				);
			}
		} else if (this.matchWord("nspcvtable")) {
			this.pos += 10;
			this.append(0xfa);
			this.append(0x06);
			this.append(0x01);
			this.usingSMWVTable = false;
			this.warn(
				start,
				this.pos,
				"AMK0202",
				"Songs use the N-SPC velocity table by default; this command wastes three bytes.",
			);
		} else if (this.matchWord("tempoimmunity")) {
			this.pos += 13;
			this.append(0xf4);
			this.append(0x07);
		} else if (this.matchWord("noloop")) {
			this.pos += 6;
			this.doesntLoop = true;
		} else if (this.matchWord("dividetempo")) {
			this.pos += 11;
			this.skipSpaces();
			const n = this.getInt();
			if (n === -1) {
				return this.error("AMK0042", "Missing integer argument for #option dividetempo.");
			}

			if (n === 0) {
				return this.error("AMK0043", "Argument for #option dividetempo cannot be 0.");
			}

			// Music.cpp:2388
			if (n === 1) {
				this.warn(start, this.pos, "AMK0214", "#option dividetempo 1 has no effect.");
			}

			this.tempoRatio = n;
			if (!this.checkTempoRatio(start)) {
				return;
			}
		} else if (this.targetAMKVersion >= 4 && this.matchWord("amk109hotpatch")) {
			this.pos += 14;
			this.append(0xfa);
			this.append(0x7f);
			this.append(0x01);
			this.markEchoBufferAllocVCMD();
			this.echoBufferAllocVCMDLoc--;
		} else {
			this.error("AMK0044", "#option directive missing or unrecognised first argument.");
		}
	}

	/**
	 * `#path "dir"` — Music.cpp:2776.
	 *
	 * A replacement, not a stack: a second `#path` discards the first. It applies
	 * to quoted names in `#samples` and `#instruments` and to `(...)` sample
	 * loads, but never to `#group` members, which AMK resolves unprefixed.
	 */
	private parsePath(): void {
		this.skipSpaces();
		if (this.text[this.pos] !== '"') {
			return this.error("AMK0052", "Unexpected symbol in #path; expected a quoted string.");
		}

		this.pos++;
		const dir = this.getQuotedString();
		if (dir === null) {
			return;
		}

		const trimmed = dir
			.replace(/^[.\\/]+/, "")
			.replace(/[\\/]+$/, "")
			.replace(/\\/g, "/");
		this.basepath = trimmed.length === 0 ? "" : `${trimmed}/`;
	}

	/**
	 * Consumes the remainder of a `{ … }` directive block after a failure.
	 *
	 * Every error path inside a block parser returns immediately, which leaves the
	 * closing brace behind. The MML scanner then reads the block's contents as
	 * notes and its brace as a triplet-close, and the real diagnostic disappears
	 * under a cascade of nonsense.
	 */
	private skipPastBlockEnd(): void {
		while (this.pos < this.text.length && this.text[this.pos] !== "}") {
			this.pos++;
		}

		if (this.pos < this.text.length) {
			this.pos++;
		}
	}

	/** Runs a block parser and cleans up after it if it bailed. */
	private parseBlock(body: () => void): void {
		const before = this.errorCount;
		body();
		if (this.errorCount > before) {
			this.skipPastBlockEnd();
		}
	}

	/**
	 * Rejects a tempo divisor that has run away (Music.cpp:2394, :2501).
	 *
	 * AMK detects this by signed overflow — `tempoRatio` is an `int`, and enough
	 * `#halvetempo`s push it negative. JavaScript numbers never wrap, so the
	 * condition has to be stated directly instead. A divisor past 0x8000 already
	 * makes every tempo round to zero, so the exact threshold is immaterial.
	 */
	private checkTempoRatio(start: number): boolean {
		if (this.tempoRatio > 0 && this.tempoRatio <= 0x8000) {
			return true;
		}

		this.errorAt(
			start,
			this.pos,
			"AMK0215",
			"The tempo divisor has grown too large — #halvetempo was used too many times.",
		);
		return false;
	}

	/**
	 * `#pad $NNNN` — Music.cpp:2756.
	 *
	 * Declares a minimum size for the song, so that inserting it into a ROM
	 * reserves that much ARAM even while the song is still short. It does *not*
	 * pad the emitted data here: AMK only zero-fills for global songs
	 * (`AddmusicK.cpp:1266`, gated on `i <= highestGlobalSong`), and a song
	 * compiled by this app is always the local one. So the value is recorded,
	 * reported, and warned about when the song outgrows it.
	 */
	private parsePadDefinition(): void {
		this.skipSpaces();
		if (this.text[this.pos] !== "$") {
			return this.error("AMK0053", "Error parsing #pad; the size must be a $ hex value.");
		}

		this.pos++;
		const size = this.getHex(true);
		if (size === -1) {
			return this.error("AMK0053", "Error parsing #pad; the size must be a $ hex value.");
		}

		this.minSize = size;
	}

	/**
	 * `#samples { … }` — Music.cpp:2697.
	 *
	 * Entries are quoted filenames or `#groupName`, and their order *is* the SRCN
	 * assignment. Repeats are kept rather than collapsed: AMK's `addSample`
	 * pushes an entry onto `mySamples` for every occurrence and only avoids
	 * storing the *bytes* twice, so `{ #default #default }` really does produce
	 * forty directory entries over twenty blobs. `buildSpc` reproduces that by
	 * deduplicating on sample identity.
	 */
	private parseSampleDefinitions(start: number): void {
		this.skipSpaces();
		if (this.text[this.pos] !== "{") {
			return this.error("AMK0050", 'Unexpected character in #samples; expected "{".');
		}

		this.pos++;

		for (;;) {
			this.skipSpaces();
			if (this.pos >= this.text.length) {
				return this.errorAt(start, this.pos, "AMK0108", "Unexpected end of file while parsing #samples.");
			}

			const character = this.text[this.pos];
			if (character === "}") {
				this.pos++;
				return;
			}

			if (character === '"') {
				this.pos++;
				const quoted = this.getQuotedString();
				if (quoted === null) {
					return;
				}

				if (!this.addSampleByName(this.basepath + quoted)) {
					return;
				}

				continue;
			}

			if (character === "#") {
				this.pos++;
				let group = "";
				// AMK reads to the next whitespace (Music.cpp:2736), which would
				// swallow a closing brace in `{ #default}`. Stopping at `}` too
				// costs nothing and accepts a form nobody expects to be illegal.
				while (this.pos < this.text.length && !isSpace(this.text[this.pos]) && this.text[this.pos] !== "}") {
					group += this.text[this.pos];
					this.pos++;
				}

				if (!this.addSampleGroup(group)) {
					return;
				}

				continue;
			}

			return this.error("AMK0057", `Unexpected character "${character}" in #samples.`);
		}
	}

	/** Appends one sample by filename. Returns false if it reported an error. */
	private addSampleByName(name: string): boolean {
		const dot = name.lastIndexOf(".");
		if (dot === -1) {
			this.error("AMK0107", `The sample "${name}" is missing its extension; is it a .brr or a .bnk?`);
			return false;
		}

		// Music.cpp:2723-2728 compares with `==`, so the extension is case-
		// sensitive and `"kick.BRR"` is not a sample AddmusicK will take.
		const extension = name.slice(dot);
		if (extension !== ".brr" && extension !== ".bnk") {
			this.error("AMK0056", `"${name}" is not a valid sample; only ".brr" and ".bnk" are allowed.`);
			return false;
		}

		// With no library to check against — a bare `compile()` with no options —
		// take the name on trust rather than rejecting every song.
		if (this.options && !this.options.sampleNames.includes(name)) {
			this.error("AMK0058", `Could not find the sample "${name}".`);
			return false;
		}

		if (extension === ".bnk") {
			// A bank contributes all 64 slots, empty ones included
			// (`addSampleBank`, globals.cpp:581-615). Keeping the blanks is the
			// point: a song ported from another game addresses its samples by
			// SRCN, so skipping empty slots would renumber every one after them.
			for (let slot = 0; slot < BANK_SLOT_COUNT; slot++) {
				this.pushSample(bankSlotName(name, slot));
			}

			return true;
		}

		this.pushSample(name);
		return true;
	}

	/**
	 * Appends one name to the sample list, recording whether it is important.
	 *
	 * Importance comes from the host and nowhere else. AMK infers it from where a
	 * name came from — `true` for anything written out in `#samples`
	 * (`Music.cpp:2726`), the group's own flag for a `#group` member, `true` for
	 * every bank slot (`globals.cpp:614`) — because a filename was the only signal
	 * of intent it had. Here the user marks samples directly, and an inference
	 * would silently override that.
	 */
	private pushSample(name: string): void {
		this.sampleList.push(name);
		this.sampleImportant.push(this.isImportantName(name));
	}

	/**
	 * `#instruments { … }` — Music.cpp:2551.
	 *
	 * Each entry is six bytes: a sample, then exactly five `$xx` values. They
	 * append to the same `instrumentData` block the HFD `$ED $6136` hack fills
	 * (`parseHFDInstrumentHack`), and the first entry becomes `@30`. Note the two
	 * paths reach six bytes differently — HFD supplies five and gets a zero
	 * appended, whereas here the sample byte is the first of the six.
	 *
	 * `link.ts` needs no changes for any of this: `buildHeader` already sizes the
	 * header off `instrumentData.length` and `relocate` already steps over it.
	 */
	private parseInstrumentDefinitions(start: number): void {
		this.skipSpaces();
		if (this.text[this.pos] !== "{") {
			return this.error("AMK0051", 'Could not find the opening brace in #instruments; expected "{".');
		}

		this.pos++;

		for (;;) {
			this.skipSpaces();
			if (this.pos >= this.text.length) {
				return this.errorAt(start, this.pos, "AMK0069", "Unexpected end of file while parsing #instruments.");
			}

			if (this.text[this.pos] === "}") {
				this.pos++;
				return;
			}

			const sample = this.readInstrumentSample();
			if (sample === null) {
				return;
			}

			this.instrumentData.push(sample);
			this.noteSampleUse(sample);

			for (let byte = 0; byte < 5; byte++) {
				this.skipSpaces();
				if (this.text[this.pos] !== "$") {
					return this.errorAt(
						start,
						this.pos,
						"AMK0087",
						"Error parsing #instruments; every instrument needs exactly six bytes — a sample followed by five $xx values.",
					);
				}

				this.pos++;
				const value = this.getHex();
				if (value === -1 || value > 0xff) {
					return this.error("AMK0088", "Error parsing #instruments; expected a one-byte hex value.");
				}

				this.instrumentData.push(value);
			}
		}
	}

	/**
	 * The sample byte of an `#instruments` entry.
	 *
	 * Three forms (Music.cpp:2572-2630): a quoted filename, `@n` copying a stock
	 * instrument's sample, or `nXX` for noise. Returns `null` after reporting.
	 */
	private readInstrumentSample(): number | null {
		const character = this.text[this.pos];

		if (character === '"') {
			this.pos++;
			const quoted = this.getQuotedString();
			if (quoted === null) {
				return null;
			}

			const name = this.basepath + quoted;
			// Resolved against *this song's* list, not the whole library, because
			// the byte stored is an SRCN. That lookup is also what makes
			// `#instruments` before `#samples` fail on its own, with no ordering
			// rule to enforce — which is how AMK does it (Music.cpp:2596-2607).
			const srcn = this.sampleList.indexOf(name);
			if (srcn === -1) {
				this.error("AMK0089", `The sample "${name}" was not included in this song; add it to #samples first.`);
				return null;
			}

			return srcn;
		}

		if (character === "@") {
			this.pos++;
			const n = this.getInt();
			if (n === -1) {
				this.error("AMK0102", "Error parsing the instrument-copy portion of #instruments.");
				return null;
			}

			if (n >= FIRST_CUSTOM_INSTRUMENT) {
				this.error("AMK0103", "Cannot use a custom instrument's sample as a base for another custom instrument.");
				return null;
			}

			return INSTRUMENT_TO_SAMPLE[n];
		}

		if (character === "n") {
			this.pos++;
			const pitch = this.getHex();
			if (pitch === -1 || pitch > 0xff) {
				this.error("AMK0104", "Error parsing the noise portion of #instruments.");
				return null;
			}

			if (pitch >= 0x20) {
				this.error("AMK0105", "Invalid noise pitch; it must be a hex value from $00 to $1F.");
				return null;
			}

			// The high bit is what tells the driver this is noise, not a sample.
			return pitch | 0x80;
		}

		this.error(
			"AMK0106",
			`Unexpected character "${character}" in #instruments; expected a quoted sample name, @n, or nXX.`,
		);
		return null;
	}

	/** Appends a named group's members, in order. globals.cpp:527. */
	private addSampleGroup(group: string): boolean {
		const members = this.options?.sampleGroups[group];
		if (!members) {
			const known = Object.keys(this.options?.sampleGroups ?? {});
			this.error(
				"AMK0059",
				`The sample group "#${group}" could not be found.` +
					(known.length > 0 ? ` Available groups: ${known.map((name) => `#${name}`).join(", ")}.` : ""),
			);
			return false;
		}

		// Group members are resolved unprefixed; `#path` does not apply to them.
		for (const member of members) {
			this.pushSample(member);
		}

		return true;
	}

	/** ID666 gives each text field 32 bytes (Music.cpp:3528-3547). */
	private static readonly TAG_LIMIT = 32;

	/** Music.cpp:3452 */
	private parseSpcInfo(): void {
		const start = this.pos;
		this.skipSpaces();
		if (this.text[this.pos] !== "{") {
			return this.error("AMK0060", 'Error parsing #spc; expected "{".');
		}

		this.pos++;

		for (;;) {
			this.skipSpaces();
			if (this.pos >= this.text.length) {
				return this.error("AMK0061", "Unterminated #spc block.");
			}

			if (this.text[this.pos] === "}") {
				this.pos++;
				break;
			}

			if (this.text[this.pos] !== "#") {
				return this.error("AMK0062", 'Error parsing #spc; expected a field name or "}".');
			}

			this.pos++;

			// Music.cpp:3468 reads to the next whitespace, so `#titlex` is reported
			// as the unknown field `titlex` rather than as `title` with a stray `x`.
			// Music.cpp:3471 then compares with `!=`, so the name is case-sensitive
			// and `#Title` is an unknown field, not a title.
			let field = "";
			while (this.pos < this.text.length && !isSpace(this.text[this.pos])) {
				field += this.text[this.pos];
				this.pos++;
			}

			this.skipSpaces();
			if (this.text[this.pos] !== '"') {
				return this.error("AMK0063", `Error parsing #spc; field "${field}" is missing its quoted value.`);
			}

			this.pos++;
			const value = this.getQuotedString();
			if (value === null) {
				return;
			}

			switch (field) {
				case "title":
					this.tags.title = value;
					break;
				case "game":
					this.tags.game = value;
					break;
				case "author":
					this.tags.author = value;
					break;
				case "comment":
					this.tags.comment = value;
					break;
				case "length":
					this.tags.length = value;
					if (!this.parseLengthField(value, start)) {
						return;
					}

					break;
				default:
					this.error("AMK0065", `Unknown #spc field "#${field}".`);
					return;
			}
		}

		this.truncateTag("title", start);
		this.truncateTag("game", start);
		this.truncateTag("author", start);
		this.truncateTag("comment", start);
	}

	/**
	 * `#length "m:ss"` or `#length "auto"` (Music.cpp:3493-3521).
	 *
	 * A declared length also switches length *guessing* off, which is the whole
	 * point of the field: without that the estimate would win and the declared
	 * value would be recorded in the tag but never used.
	 */
	private parseLengthField(value: string, start: number): boolean {
		if (value === "auto") {
			this.guessLength = true;
			this.declaredSeconds = null;
			return true;
		}

		const match = /^(\d+):(\d+)$/.exec(value);
		if (!match) {
			this.errorAt(start, this.pos, "AMK0066", 'Error parsing #spc #length; format must be "m:ss" or "auto".');
			return false;
		}

		const seconds = Number(match[1]) * 60 + Number(match[2]);
		if (seconds > 999) {
			this.errorAt(start, this.pos, "AMK0067", "Songs longer than 16:39 are not allowed by the SPC format.");
			return false;
		}

		this.guessLength = false;
		this.declaredSeconds = seconds;
		return true;
	}

	private truncateTag(field: "title" | "game" | "author" | "comment", start: number): void {
		const value = this.tags[field];
		if (value === undefined || value.length <= AddmusicKParser.TAG_LIMIT) {
			return;
		}

		this.tags[field] = value.slice(0, AddmusicKParser.TAG_LIMIT);
		this.warn(
			start,
			this.pos,
			"AMK0205",
			`The "${field}" field is ${value.length} characters; ID666 allows 32, so it was truncated to "${this.tags[field]}".`,
		);
	}

	/**
	 * globals.cpp:658 — a quoted string body, honouring the single escape the
	 * format allows.
	 *
	 * `pos` must sit just past the opening quote; on success it ends just past
	 * the closing one. Returns `null` after reporting, so callers can bail.
	 */
	private getQuotedString(): string | null {
		let out = "";
		while (this.pos < this.text.length && this.text[this.pos] !== '"') {
			if (this.text[this.pos] === "\\") {
				if (this.text[this.pos + 1] !== '"') {
					this.error("AMK0068", 'The only escape sequence allowed inside a string is \\".');
					return null;
				}

				out += '"';
				this.pos += 2;
				continue;
			}

			out += this.text[this.pos];
			this.pos++;
		}

		if (this.pos >= this.text.length) {
			this.error("AMK0064", "Unterminated string.");
			return null;
		}

		this.pos++;
		return out;
	}

	private parseDefaultLength(): void {
		this.pos++;
		let n = this.getInt();
		if (n === -1 && this.text[this.pos] === "=" && this.targetAMKVersion >= 4) {
			this.pos++;
			n = this.getInt();
			if (n === -1) {
				return this.error("AMK0070", 'Error parsing "l" directive.');
			}

			this.defaultNoteLength = n;
		} else if (n === -1) {
			return this.error("AMK0070", 'Error parsing "l" directive.');
		} else if (n < 1 || n > TICKS_PER_WHOLE) {
			return this.error("AMK0071", 'Illegal value for "l" directive.');
		} else {
			if (TICKS_PER_WHOLE % n !== 0) {
				this.warnOnce("fraction", "AMK0200", "A default note length was used that is not divisible by 192 ticks.");
			}

			this.defaultNoteLength = Math.floor(TICKS_PER_WHOLE / n);
		}

		if (this.targetAMKVersion >= 4) {
			this.defaultNoteLength = this.getNoteLengthModifier(this.defaultNoteLength, false);
		}
	}

	private parseGlobalVolume(): void {
		this.pos++;
		const [duration, volume, ok] = this.parseFadeableValue("global volume", "w", "AMK0072");
		if (!ok) {
			return;
		}

		if (duration === -1) {
			this.append(0xe0);
			this.append(volume);
		} else {
			this.append(0xe1);
			this.append(this.divideByTempoRatio(duration, false));
			this.append(volume);
		}
	}

	private parseVolume(): void {
		this.pos++;
		const [duration, volume, ok] = this.parseFadeableValue("volume", "v", "AMK0073");
		if (!ok) {
			return;
		}

		if (duration === -1) {
			this.append(0xe7);
			this.append(volume);
		} else {
			this.append(0xe8);
			this.append(this.divideByTempoRatio(duration, false));
			this.append(volume);
		}
	}

	/** `X value`, or `X duration,value` — the comma form arrived in #amk 3. */
	private parseFadeableValue(label: string, letter: string, code: string): [number, number, boolean] {
		let duration = -1;
		let value = this.getInt();
		if (value === -1) {
			this.error(code, `Error parsing ${label} ("${letter}") command.`);
			return [-1, -1, false];
		}

		if (this.targetAMKVersion >= 3) {
			this.skipSpaces();
			if (this.text[this.pos] === ",") {
				this.pos++;
				this.skipSpaces();
				duration = value;
				value = this.getInt();
				if (value === -1) {
					this.error(code, `Error parsing ${label} ("${letter}") command.`);
					return [-1, -1, false];
				}
			}
		}

		if (value < 0 || value > 255) {
			this.error(code, `Illegal value for ${label} ("${letter}") command.`);
			return [-1, -1, false];
		}

		if (duration !== -1 && (duration < 0 || duration > 255)) {
			this.error(code, `Illegal duration for ${label} ("${letter}") command.`);
			return [-1, -1, false];
		}

		return [duration, value, true];
	}

	private parseQuantization(): void {
		this.pos++;
		const n = this.getHex();
		if (n === -1 || n < 1 || n > 0x7f) {
			return this.error("AMK0074", 'Error parsing quantization ("q") command; expected a hex value from 01 to 7F.');
		}

		if (this.channel === 8) {
			this.q[this.prevChannel] = n;
			this.updateQ[this.prevChannel] = true;
		} else {
			this.q[this.channel] = n;
			this.updateQ[this.channel] = true;
		}

		this.q[8] = n;
		this.updateQ[8] = true;
	}

	private parsePan(): void {
		this.pos++;
		let n = this.getInt();
		if (n === -1) {
			return this.error("AMK0075", 'Error parsing pan ("y") command.');
		}

		if (n < 0 || n > 20) {
			return this.error("AMK0076", 'Illegal value for pan ("y") command; must be 0 to 20.');
		}

		let pan = n;

		this.skipSpaces();
		if (this.text[this.pos] === ",") {
			this.pos++;
			n = this.getInt();
			if (n === -1) {
				return this.error("AMK0075", 'Error parsing pan ("y") command.');
			}

			if (n > 2) {
				return this.error("AMK0076", 'Illegal value for pan ("y") command.');
			}

			pan |= n << 7;
			this.skipSpaces();
			if (this.text[this.pos] !== ",") {
				return this.error("AMK0075", 'Error parsing pan ("y") command.');
			}

			this.pos++;
			n = this.getInt();
			if (n === -1) {
				return this.error("AMK0075", 'Error parsing pan ("y") command.');
			}

			if (n > 2) {
				return this.error("AMK0076", 'Illegal value for pan ("y") command.');
			}

			pan |= n << 6;
		}

		this.append(0xdb);
		this.append(pan);
	}

	private parseIntro(): void {
		if (this.channel === 8) {
			return this.error("AMK0080", "Intro directive found within a loop.");
		}

		if (!this.hasIntro) {
			this.tempoChanges.push([this.channelLengths[this.channel], -this.tempo]);
			// Where the intro ends, for anything that needs it as a tick count.
			//
			// Deliberately the *first* `/` in the file, matching the marker pushed
			// beside it: the length estimate splits intro from loop at that tick, so
			// taking the boundary from anywhere else contradicts the seconds it
			// reports. AddmusicK's own `introLength` is assigned on every `/`
			// (Music.cpp:751) and so ends up holding whichever channel happened to be
			// parsed last, which on a song whose channels carry their `/` at
			// different points is simply a different place in the song. It gets away
			// with it because the only thing it feeds is a dead statement.
			this.introTicks = this.channelLengths[this.channel];
		} else {
			for (const change of this.tempoChanges) {
				if (change[1] < 0) {
					change[1] = -this.tempo;
				}
			}
		}

		this.hasIntro = true;
		this.pos++;
		this.phrasePointers[this.channel][1] = this.data[this.channel].length;
		this.prevNoteLength = -1;
		this.passedIntro[this.channel] = true;
		this.introLength = this.channelLengths[this.channel];
	}

	private parseT(): void {
		this.pos++;
		if (this.text.startsWith("uning[", this.pos)) {
			this.parseTuningDirective();
		} else {
			this.parseTempo();
		}
	}

	private parseTempo(): void {
		let duration = -1;
		let value = this.getInt();
		if (value === -1) {
			return this.error("AMK0077", 'Error parsing tempo ("t") command.');
		}

		if (this.targetAMKVersion >= 3) {
			this.skipSpaces();
			if (this.text[this.pos] === ",") {
				this.pos++;
				this.skipSpaces();
				duration = value;
				value = this.getInt();
				if (value === -1) {
					return this.error("AMK0077", 'Error parsing tempo ("t") command.');
				}
			}
		}

		if (value < 0 || value > 255) {
			return this.error("AMK0078", 'Illegal value for tempo ("t") command.');
		}

		this.tempo = this.divideByTempoRatio(value, false);
		if (this.tempo === 0) {
			this.error("AMK0079", "Tempo has been zeroed out by #halvetempo / #option dividetempo.");
			this.tempo = value;
		}

		if (duration === -1) {
			if (this.channel === 8 || this.inE6Loop) {
				this.guessLength = false;
			} else {
				this.tempoChanges.push([this.channelLengths[this.channel], this.tempo]);
			}

			this.append(0xe2);
			this.append(this.tempo);
		} else {
			if (duration < 0 || duration > 255) {
				return this.error("AMK0078", 'Illegal duration for tempo ("t") command.');
			}

			this.guessLength = false;
			this.append(0xe3);
			this.append(this.divideByTempoRatio(duration, false));
			this.append(this.tempo);
		}
	}

	private parseTuningDirective(): void {
		this.pos += 6;
		let index = this.getInt();
		if (index === -1) {
			return this.error("AMK0081", "Error parsing tuning directive.");
		}

		if (index < 0 || index > 255) {
			return this.error("AMK0082", "Illegal instrument value for tuning directive.");
		}

		if (this.text[this.pos] !== "]") {
			return this.error("AMK0081", "Error parsing tuning directive.");
		}

		this.pos++;
		this.skipSpaces();
		if (this.text[this.pos] !== "=") {
			return this.error("AMK0081", "Error parsing tuning directive.");
		}

		this.pos++;

		for (;;) {
			this.skipSpaces();
			let plus = true;
			if (this.text[this.pos] === "+") {
				this.pos++;
			} else if (this.text[this.pos] === "-") {
				this.pos++;
				plus = false;
			}

			const value = this.getInt();
			if (value === -1) {
				return this.error("AMK0081", "Error parsing tuning directive.");
			}

			this.transposeMap[index] = plus ? value : -value;

			this.skipSpaces();
			if (this.text[this.pos] !== ",") {
				break;
			}

			this.pos++;
			index++;
			if (index >= 256) {
				return this.error("AMK0082", "Illegal value for tuning directive.");
			}
		}
	}

	private parseOctave(): void {
		this.pos++;
		const n = this.getInt();
		if (n === -1) {
			return this.error("AMK0083", 'Error parsing octave ("o") directive.');
		}

		if (n < 0 || n > 6) {
			return this.error("AMK0084", 'Illegal value for octave ("o") directive; must be 0 to 6.');
		}

		this.octave = n;
	}

	private parseRaiseOctave(): void {
		this.pos++;
		this.octave++;
		if (this.octave > 7) {
			this.octave = 7;
			this.error("AMK0085", "The octave has been raised too high.");
		}
	}

	private parseLowerOctave(): void {
		this.pos++;
		this.octave--;
		if (this.octave < -1) {
			this.octave = 0;
			this.error("AMK0086", "The octave has been dropped too low.");
		}
	}

	/** Music.cpp:parseInstrumentCommand. */
	private parseInstrument(): void {
		const start = this.pos;
		this.pos++;
		let direct = false;
		if (this.text[this.pos] === "@") {
			this.pos++;
			direct = true;
		}

		let n = this.getInt();
		if (n === -1) {
			return this.error("AMK0090", 'Error parsing instrument ("@") command.');
		}

		if (n < 0 || n > 255) {
			return this.error("AMK0091", 'Illegal value for instrument ("@") command.');
		}

		if (n <= 18 || direct || n >= FIRST_CUSTOM_INSTRUMENT) {
			// Music.cpp:880 — Addmusic 4.05/M numbered custom instruments from $13;
			// AddmusicK starts them at 30.
			if (n >= 0x13 && n < FIRST_CUSTOM_INSTRUMENT) {
				n = n - 0x13 + FIRST_CUSTOM_INSTRUMENT;
			}

			if (n >= FIRST_CUSTOM_INSTRUMENT) {
				// Music.cpp:889. AMK only performs this check when
				// `optimizeSampleUsage` is on; here it is unconditional, because
				// `$DA n` past the end of the table makes the driver read six bytes
				// of whatever follows it as an instrument.
				const entry = (n - 30) * 6;
				if (entry >= this.instrumentData.length) {
					return this.errorAt(
						start,
						this.pos,
						"AMK0092",
						`Custom instrument @${n} has not been defined yet. Define it in an #instruments block; ` +
							`the first entry there is @30.`,
					);
				}

				this.noteSampleUse(this.instrumentData[entry]);
			}

			if (this.songTargetProgram === 1) {
				this.ignoreTuning[this.channel] = false;
			}

			this.append(0xda);
			this.append(n);
		}

		if (n < FIRST_CUSTOM_INSTRUMENT) {
			const srcn = INSTRUMENT_TO_SAMPLE[n];
			// A song that replaced the sample list with a shorter one has left the
			// stock instruments pointing past the end of the directory, which the
			// DSP would read as a garbage BRR address. AMK only survives this by
			// accident — its `usedSamples` is a bool[256] that absorbs the write.
			if (this.sampleList.length > 0 && srcn >= this.sampleList.length) {
				this.errorAt(
					start,
					this.pos,
					"AMK0109",
					`@${n} plays sample ${srcn}, but this song's #samples list only defines ` +
						`${this.sampleList.length}. Include a group that covers the stock instruments, such as #default.`,
				);
			}

			this.noteSampleUse(srcn);
		}

		this.instrument[this.channel] = n;

		// Music.cpp:910 — AddmusicM resets tuning when a stock instrument is set.
		if (this.songTargetProgram === 2 && n < 19) {
			this.hTranspose = 0;
			this.usingHTranspose = false;
			this.transposeMap[n] = DEFAULT_TRANSPOSE[n];
		}
	}

	private parseTranspose(): void {
		this.pos++;
		if (this.songTargetProgram === 1) {
			this.warnOnce("nonNativeCmd", "AMK0205", 'The "h" command is not native to Addmusic 4.05. Did you mean #amm?');
		}

		try {
			this.hTranspose = this.getIntWithNegative();
			this.usingHTranspose = true;
		} catch {
			this.error("AMK0093", 'Error parsing transpose ("h") directive.');
		}
	}

	private parseNoise(): void {
		this.pos++;
		const n = this.getHex();
		if (n < 0 || n > 0x1f) {
			return this.error("AMK0094", 'Invalid value for the "n" command; must be a hex value from 0 to 1F.');
		}

		this.append(0xf8);
		this.append(n);
	}

	private parseVibrato(): void {
		this.pos++;
		const t1 = this.getInt();
		if (t1 === -1) {
			return this.error("AMK0095", "Error parsing vibrato command.");
		}

		this.skipSpaces();
		if (this.text[this.pos] !== ",") {
			return this.error("AMK0095", "Error parsing vibrato command.");
		}

		this.pos++;
		this.skipSpaces();
		const t2 = this.getInt();
		if (t2 === -1) {
			return this.error("AMK0095", "Error parsing vibrato command.");
		}

		this.skipSpaces();

		if (this.text[this.pos] === ",") {
			this.pos++;
			this.skipSpaces();
			const t3 = this.getInt();
			if (t3 === -1) {
				return this.error("AMK0095", "Error parsing vibrato command.");
			}

			if (t1 < 0 || t1 > 255) {
				return this.error("AMK0096", "Illegal value for vibrato delay.");
			}

			if (t2 < 0 || t2 > 255) {
				return this.error("AMK0096", "Illegal value for vibrato rate.");
			}

			if (t3 < 0 || t3 > 255) {
				return this.error("AMK0096", "Illegal value for vibrato extent.");
			}

			this.append(0xde);
			this.append(this.divideByTempoRatio(t1, false));
			this.append(this.multiplyByTempoRatio(t2));
			this.append(t3);
		} else {
			if (t1 < 0 || t1 > 255) {
				return this.error("AMK0096", "Illegal value for vibrato rate.");
			}

			if (t2 < 0 || t2 > 255) {
				return this.error("AMK0096", "Illegal value for vibrato extent.");
			}

			this.append(0xde);
			this.append(0x00);
			this.append(this.multiplyByTempoRatio(t1));
			this.append(t2);
		}
	}

	private parseTripletOpen(): void {
		this.pos++;
		if (this.triplet) {
			return this.error("AMK0097", "Triplet-open directive found within a triplet block.");
		}

		this.triplet = true;
	}

	private parseTripletClose(): void {
		this.pos++;
		if (!this.triplet) {
			return this.error("AMK0098", "Triplet-close directive found outside a triplet block.");
		}

		this.triplet = false;
	}

	private parsePitchSlide(): void {
		this.pos++;
		if (this.inPitchSlide) {
			return this.error("AMK0099", "Pitch slide directive specified multiple times in a row.");
		}

		this.inPitchSlide = true;
	}

	// =========================================================================
	// Loops
	// =========================================================================

	/** Music.cpp:917 — a `(` is either a sample load or a label loop. */
	private parseOpenParen(): void {
		const next = this.text[this.pos + 1];
		if (next === '"' || next === "@") {
			this.parseSampleLoad();
		} else {
			this.parseLabelLoop();
		}
	}

	/**
	 * `("kick.brr", $02)` or `(@1, $02)` — Music.cpp:925.
	 *
	 * The comma is mandatory and the tuning multiplier sits *inside* the
	 * parentheses; both forms compile to `$F3 <srcn> <tuning>`, the sample-load
	 * VCMD that the `#amk 1` and Addmusic 4.05 paths already emit.
	 */
	private parseSampleLoad(): void {
		const start = this.pos;
		this.pos++;

		let srcn: number;
		if (this.text[this.pos] === "@") {
			this.pos++;
			const n = this.getInt();
			// AMK reads `instrToSample[i]` with no check at all (Music.cpp:932),
			// so a missing or out-of-range number indexes past a 30-entry array.
			if (n === -1 || n >= FIRST_CUSTOM_INSTRUMENT) {
				return this.errorAt(
					start,
					this.pos,
					"AMK0110",
					"A sample load must name a stock instrument between @0 and @29, as in (@1, $02).",
				);
			}

			srcn = INSTRUMENT_TO_SAMPLE[n];
		} else {
			this.pos++;
			// AMK scans raw to the closing quote here rather than going through
			// `getQuotedString`, so it has no escape handling. Using the shared
			// reader is harmless: a name containing a quote could never resolve.
			const quoted = this.getQuotedString();
			if (quoted === null) {
				return;
			}

			const name = this.basepath + quoted;
			const found = this.sampleList.indexOf(name);
			if (found === -1) {
				return this.errorAt(
					start,
					this.pos,
					"AMK0132",
					`The sample "${name}" was not included in this song; add it to #samples first.`,
				);
			}

			srcn = found;
		}

		if (this.text[this.pos] !== ",") {
			return this.errorAt(
				start,
				this.pos,
				"AMK0133",
				'Error parsing the sample load command; expected a comma, as in ("kick.brr", $02).',
			);
		}

		this.pos++;
		this.skipSpaces();

		if (this.text[this.pos] !== "$") {
			return this.errorAt(
				start,
				this.pos,
				"AMK0134",
				"Error parsing the sample load command; the tuning multiplier must be a $xx value.",
			);
		}

		this.pos++;
		const tuning = this.getHex();
		if (tuning === -1 || tuning > 0xff) {
			return this.errorAt(start, this.pos, "AMK0135", "Error parsing the sample load command's tuning value.");
		}

		if (this.text[this.pos] !== ")") {
			return this.errorAt(start, this.pos, "AMK0136", 'Error parsing the sample load command; expected ")".');
		}

		this.pos++;

		this.noteSampleUse(srcn);
		this.append(0xf3);
		this.append(srcn);
		this.append(tuning);
	}

	private parseLabelLoop(): void {
		const start = this.pos;
		this.pos++;

		if (this.text[this.pos] === "!") {
			if (this.targetAMKVersion < 2) {
				return this.errorAt(start, this.pos + 1, "AMK0117", "Unrecognized character '!'.");
			}

			this.pos++;
			this.skipSpaces();

			// Music.cpp:1015 — definitions and calls are told apart by *where they
			// are*, not by syntax. `channelDefined` latches on the first `#N` and
			// never clears, so every definition has to precede every channel.
			if (this.channelDefined) {
				this.parseRemoteCall(start);
			} else {
				this.parseRemoteDefinition(start);
			}

			return;
		}

		if (this.channel === 8) {
			return this.error("AMK0112", "Nested loops are not allowed.");
		}

		let label = this.getInt();
		if (label === -1) {
			return this.error("AMK0113", "Error parsing label loop.");
		}

		label++; // Music.cpp offsets by one so that label 0 is usable.
		if (label <= 0 || label >= 0x10000) {
			return this.error("AMK0114", "Illegal value for loop label.");
		}

		if (this.text[this.pos] !== ")") {
			return this.error("AMK0113", "Error parsing label loop.");
		}

		this.pos++;

		this.updateQ[this.channel] = true;
		this.updateQ[8] = true;
		this.prevNoteLength = -1;

		if (this.text[this.pos] === "[") {
			this.loopLabel = label;
			return;
		}

		this.loopLabel = label;
		const target = this.loopPointers.get(label);
		if (target === undefined) {
			this.loopLabel = 0;
			return this.errorAt(start, this.pos, "AMK0115", "Label not yet defined.");
		}

		let count = this.getInt();
		if (count === -1) {
			count = 1;
		}

		if (count < 1 || count > 255) {
			// Music.cpp:1181 — `error()` expands to `{ printError(…); return; }`,
			// so the `j = 1` written after it is unreachable and no `$E9` is
			// emitted at all. Carrying on with a count of 1 would put a loop call
			// in the song that AddmusicK does not.
			return this.error("AMK0116", "Invalid loop count.");
		}

		this.handleNormalLoopRemoteCall(count);
		this.append(0xe9);
		this.loopLocations[this.channel].push(this.data[this.channel].length);
		this.append(target & 0xff);
		this.append(target >> 8);
		this.append(count);
		this.loopLabel = 0;
	}

	/**
	 * `(!n)[ … ]` outside any channel — Music.cpp:1125.
	 *
	 * Only records the intent. The `[` is deliberately left for `parseLoopStart`,
	 * which does all the channel-8 bookkeeping and writes `loopPointers[n]`; the
	 * difference from an ordinary label loop is entirely in what `parseLoopEnd`
	 * does at the other end, which is what `inRemoteDefinition` selects.
	 *
	 * Note the label is *not* offset by one, where `(n)` label loops are
	 * (Music.cpp:1156). So `(!1)` and `(0)` share a slot. Reproduced as-is.
	 */
	private parseRemoteDefinition(start: number): void {
		const label = this.getInt();
		if (label === -1) {
			return this.errorAt(start, this.pos, "AMK0111", "Error parsing remote code definition.");
		}

		this.skipSpaces();
		if (this.text[this.pos] !== ")") {
			return this.errorAt(start, this.pos, "AMK0111", 'Error parsing remote code definition; expected ")".');
		}

		this.pos++;

		if (this.text[this.pos] !== "[") {
			return this.errorAt(
				start,
				this.pos,
				"AMK0137",
				"Error parsing remote code definition; the definition body was missing.",
			);
		}

		this.loopLabel = label;
		this.inRemoteDefinition = true;
		// AMK also sets `remoteDefinitionType` here, from a stale member variable
		// (Music.cpp:1141). It is written there and at init and read nowhere, so
		// there is nothing to model.
	}

	/**
	 * `(!n, type[, arg])` or `(!!n)` inside a channel — Music.cpp:1015-1123.
	 *
	 * Both emit the five-byte `$FC` remote-code VCMD. A call points at a
	 * previously defined body; `(!!n)` points at nothing and instead selects a
	 * disable variant by its argument.
	 */
	private parseRemoteCall(start: number): void {
		if (this.targetAMKVersion >= 3 && this.text[this.pos] === "!") {
			this.pos++;
			const which = this.tryGetIntWithNegative();
			if (which === null) {
				return this.errorAt(start, this.pos, "AMK0138", "Error parsing remote code reset; expected a number.");
			}

			this.skipSpaces();
			if (this.text[this.pos] !== ")") {
				return this.errorAt(start, this.pos, "AMK0139", 'Error parsing remote code reset; expected ")".');
			}

			this.pos++;

			// Music.cpp:1037. 0 disables both kinds, -1 the key-on kind, anything
			// else the non-key-on kind.
			this.append(0xfc);
			this.append(0x00);
			this.append(0x00);
			this.append(which === 0 ? 0x00 : which === -1 ? 0x08 : 0x07);
			this.append(0x00);
			return;
		}

		const label = this.getInt();
		if (label === -1) {
			return this.errorAt(start, this.pos, "AMK0143", "Error parsing remote code setup.");
		}

		this.skipSpaces();
		if (this.text[this.pos] !== ",") {
			return this.errorAt(start, this.pos, "AMK0144", "Error parsing remote code setup; expected a comma.");
		}

		this.pos++;
		this.skipSpaces();

		const type = this.tryGetIntWithNegative();
		if (type === null) {
			return this.errorAt(
				start,
				this.pos,
				"AMK0145",
				"Error parsing remote code setup; the event type was missing. Remote code cannot be defined inside a channel.",
			);
		}

		this.skipSpaces();

		// Event types 1 and 2 fire relative to a note, so they carry a duration.
		let argument = 0;
		if (type === 1 || type === 2) {
			if (this.text[this.pos] !== ",") {
				return this.errorAt(
					start,
					this.pos,
					"AMK0146",
					"Error parsing remote code setup; the third argument is missing.",
				);
			}

			this.pos++;
			this.skipSpaces();

			if (this.text[this.pos] === "$") {
				this.pos++;
				argument = this.getHex();
				if (argument === -1) {
					return this.errorAt(
						start,
						this.pos,
						"AMK0147",
						"Error parsing remote code setup; could not read the third argument as a hex value.",
					);
				}
			} else {
				argument = this.getNoteLength(this.getInt());
				if (argument > 0x100) {
					return this.errorAt(start, this.pos, "AMK0148", "The note length specified was too large.");
				}

				// A full 256 ticks wraps to zero in one byte (Music.cpp:1101).
				if (argument === 0x100) {
					argument = 0;
				}
			}

			this.skipSpaces();
		}

		if (this.text[this.pos] !== ")") {
			return this.errorAt(start, this.pos, "AMK0149", 'Error parsing remote code setup; expected ")".');
		}

		this.pos++;

		if (this.text[this.pos] === "[") {
			return this.errorAt(start, this.pos, "AMK0153", "Remote code cannot be defined within a channel.");
		}

		const target = this.loopPointers.get(label);
		if (target === undefined) {
			// AMK appends `loopPointers[i]` unchecked here, which for an undefined
			// label is its -1 initialiser — two 0xFF bytes that relocation then
			// turns into a pointer to nowhere.
			return this.errorAt(start, this.pos, "AMK0115", `Remote code (!${label}) has not been defined yet.`);
		}

		this.append(0xfc);
		this.loopLocations[this.channel].push(this.data[this.channel].length);
		this.append(target & 0xff);
		this.append(target >> 8);
		this.append(type & 0xff);
		this.append(argument & 0xff);
	}

	/** `getIntWithNegative`, but reporting absence instead of throwing. */
	private tryGetIntWithNegative(): number | null {
		try {
			return this.getIntWithNegative();
		} catch {
			return null;
		}
	}

	private parseLoopStart(): void {
		this.pos++;
		if (this.channel < 8) {
			this.updateQ[this.channel] = true;
		}

		this.updateQ[8] = true;
		this.prevNoteLength = -1;

		if (this.text[this.pos] === "[") {
			this.pos++;
			if (this.text[this.pos] === "[") {
				return this.error("AMK0120", 'Ambiguous use of "[[[" — separate the "[[" and "[" to clarify your intent.');
			}

			if (this.inE6Loop) {
				return this.error("AMK0121", "You cannot nest a subloop within another subloop.");
			}

			// Music.cpp:1217 guards this with `text[pos - 2] == ')'` as well, and
			// that lookbehind is all but unreachable: both brackets have been
			// consumed by now, so `pos - 2` is the first '[', never the ')' of a
			// label. Reproduced rather than simplified away, because `loopLabel`
			// survives from `(n)[` until the matching `]`, so testing it alone
			// rejects `(5)[ c [[d]]4 ]` — which the reference compiles.
			if (this.loopLabel > 0 && this.text[this.pos - 2] === ")") {
				return this.error("AMK0122", "A label loop cannot define a subloop. Use a standard or remote loop instead.");
			}

			this.handleSuperLoopEnter();
			this.append(0xe6);
			this.append(0x00);
			return;
		}

		if (this.channel === 8) {
			return this.error("AMK0123", "You cannot nest standard [ ] loops.");
		}

		this.prevLoop = this.data[8].length;
		this.prevChannel = this.channel;
		this.channel = 8;
		this.prevNoteLength = -1;
		this.instrument[8] = this.instrument[this.prevChannel];
		// Music.cpp:1240 — the loop block inherits the channel's tuning state.
		if (this.songTargetProgram === 1) {
			this.ignoreTuning[8] = this.ignoreTuning[this.prevChannel];
		}

		if (this.loopLabel > 0) {
			if (this.loopPointers.has(this.loopLabel)) {
				return this.error("AMK0124", "Label redefinition.");
			}

			this.loopPointers.set(this.loopLabel, this.prevLoop);
		}

		this.handleNormalLoopEnter();
	}

	private parseLoopEnd(): void {
		this.pos++;
		if (this.channel < 8) {
			this.updateQ[this.channel] = true;
		}

		this.updateQ[8] = true;
		this.prevNoteLength = -1;

		if (this.text[this.pos] === "]") {
			this.pos++;
			if (this.text[this.pos] === "]") {
				return this.error("AMK0125", 'Ambiguous use of "]]]" — separate the "]]" and "]" to clarify your intent.');
			}

			const count = this.getInt();
			if (count === 1) {
				return this.error("AMK0126", "A subloop cannot repeat only once.");
			}

			if (!this.inE6Loop) {
				return this.error("AMK0127", "A subloop end was found outside of a subloop.");
			}

			if (count === -1) {
				return this.error("AMK0128", "Error parsing subloop command; the loop count was missing.");
			}

			this.inE6Loop = false;
			this.handleSuperLoopExit(count);
			this.append(0xe6);
			this.append(count - 1);
			return;
		}

		if (this.channel !== 8) {
			return this.error("AMK0129", "Loop end found outside of a loop.");
		}

		let count = this.getInt();
		// Music.cpp:1293 — a remote body is jumped into by the driver, not looped
		// over by the channel, so a repeat count on it means nothing.
		if (count !== -1 && this.inRemoteDefinition) {
			return this.error("AMK0164", "Remote code definitions cannot repeat.");
		}

		if (count === -1) {
			count = 1;
		}

		if (count < 1 || count > 255) {
			return this.error("AMK0116", "Invalid loop count.");
		}

		this.append(0);
		this.channel = this.prevChannel;
		this.handleNormalLoopExit(count);

		// The one structural difference between a label loop and a remote
		// definition: an ordinary loop emits the `$E9` call that runs it here and
		// now, whereas a remote body is only stored, to be triggered later by a
		// `$FC` event (Music.cpp:1305).
		if (!this.inRemoteDefinition) {
			this.append(0xe9);
			this.loopLocations[this.channel].push(this.data[this.channel].length);
			this.append(this.prevLoop & 0xff);
			this.append(this.prevLoop >> 8);
			this.append(count);
		}

		this.inRemoteDefinition = false;
		this.loopLabel = 0;
	}

	private parseStarLoop(): void {
		this.pos++;
		if (this.channel === 8) {
			return this.error("AMK0112", "Nested loops are not allowed.");
		}

		// No check that there *is* a previous loop, because Music.cpp:1321 has
		// none. `prevLoop` is an `unsigned int` initialised to -1 (Music.cpp:240),
		// so `*` before any `[ ]` emits `$E9 FF FF <count>` and relocation turns
		// those two bytes into a pointer to nowhere. Rejecting it would be the
		// kinder thing to do and would reject a song AddmusicK builds.
		this.updateQ[this.channel] = true;
		this.updateQ[8] = true;
		this.prevNoteLength = -1;

		let count = this.getInt();
		if (count === -1) {
			count = 1;
		}

		if (count < 1 || count > 255) {
			// Music.cpp:1332, and the same dead assignment as the label-loop call
			// above: nothing is emitted.
			return this.error("AMK0116", "Invalid loop count.");
		}

		this.handleNormalLoopRemoteCall(count);
		this.append(0xe9);
		this.loopLocations[this.channel].push(this.data[this.channel].length);
		this.append(this.prevLoop & 0xff);
		this.append(this.prevLoop >> 8);
		this.append(count);
	}

	// --- tick accounting (Music.cpp:3552-3660) --------------------------------

	private handleNormalLoopEnter(): void {
		this.normalLoopLength = 0;
		if (this.inE6Loop) {
			this.baseLoopIsNormal = false;
			this.baseLoopIsSuper = true;
			this.extraLoopIsNormal = true;
			this.extraLoopIsSuper = false;
		} else {
			this.baseLoopIsNormal = true;
			this.baseLoopIsSuper = false;
			this.extraLoopIsNormal = false;
			this.extraLoopIsSuper = false;
		}
	}

	private handleSuperLoopEnter(): void {
		this.superLoopLength = 0;
		this.inE6Loop = true;
		if (this.channel === 8) {
			this.baseLoopIsNormal = true;
			this.baseLoopIsSuper = false;
			this.extraLoopIsNormal = false;
			this.extraLoopIsSuper = true;
		} else {
			this.baseLoopIsNormal = false;
			this.baseLoopIsSuper = true;
			this.extraLoopIsNormal = false;
			this.extraLoopIsSuper = false;
		}
	}

	private handleNormalLoopExit(count: number): void {
		if (this.extraLoopIsNormal) {
			this.extraLoopIsNormal = false;
			this.extraLoopIsSuper = false;
			this.superLoopLength += this.normalLoopLength * count;
		} else if (this.baseLoopIsNormal) {
			this.baseLoopIsNormal = false;
			this.baseLoopIsSuper = false;
			this.channelLengths[this.channel] += this.normalLoopLength * count;
		}

		if (this.loopLabel > 0) {
			this.loopLengths.set(this.loopLabel, this.normalLoopLength);
		}
	}

	private handleSuperLoopExit(count: number): void {
		this.inE6Loop = false;
		if (this.extraLoopIsSuper) {
			this.extraLoopIsNormal = false;
			this.extraLoopIsSuper = false;
			this.normalLoopLength += this.superLoopLength * count;
		} else if (this.baseLoopIsSuper) {
			this.baseLoopIsNormal = false;
			this.baseLoopIsSuper = false;
			this.channelLengths[this.channel] += this.superLoopLength * count;
		}
	}

	private handleNormalLoopRemoteCall(count: number): void {
		if (this.loopLabel === 0) {
			this.addNoteLength(this.normalLoopLength * count);
		} else {
			this.addNoteLength((this.loopLengths.get(this.loopLabel) ?? 0) * count);
		}
	}

	private addNoteLength(ticks: number): void {
		if (this.extraLoopIsNormal) {
			this.normalLoopLength += ticks;
		} else if (this.extraLoopIsSuper) {
			this.superLoopLength += ticks;
		} else if (this.baseLoopIsNormal) {
			this.normalLoopLength += ticks;
		} else if (this.baseLoopIsSuper) {
			this.superLoopLength += ticks;
		} else {
			this.channelLengths[this.channel] += ticks;
		}
	}

	// =========================================================================
	// Notes
	// =========================================================================

	private parseNote(): void {
		const start = this.pos;
		if (this.channel !== 8) {
			this.passedNote[this.channel] = true;
		} else {
			this.passedNote[this.prevChannel] = true;
		}

		const raw = this.text[this.pos];
		const letter = raw.toLowerCase();
		this.pos++;

		// Music.cpp:2125 — older AddmusicK builds did not fold case here, so an
		// upper-case note that works now will not work there.
		if (raw !== letter && this.targetAMKVersion < 4) {
			this.warnOnce(
				"caseNote",
				"AMK0216",
				"Upper-case note letters will not translate correctly on AddmusicK 1.0.8 or lower.",
			);
		}

		// Music.cpp:2138 — a remote body runs as a hex-command sequence off an
		// event trigger; it has no note pointer of its own to advance.
		if (this.inRemoteDefinition) {
			return this.error("AMK0165", "Remote code definitions cannot contain note data.");
		}

		// Music.cpp:2141 — only AddmusicK insists notes live inside a channel;
		// the legacy formats allow them before any channel directive. A remote
		// definition sits outside every channel, which is why AMK exempts it —
		// though the check above has already rejected notes there anyway.
		if (this.songTargetProgram === 0 && !this.channelDefined && !this.inRemoteDefinition) {
			return this.error("AMK0140", "Note data must be inside a channel.");
		}

		let note: number;
		let written: number;
		if (letter === "r") {
			note = written = NOTE_REST;
		} else if (letter === "^") {
			note = written = NOTE_TIE;
		} else {
			note = written = this.getPitch(letter);

			if (this.usingHTranspose) {
				note += this.hTranspose;
			} else if (!this.ignoreTuning[this.channel]) {
				note -= this.transposeMap[this.instrument[this.channel]];
			}

			if (note < NOTE_MIN) {
				// Older songs shipped with out-of-range notes and still "worked".
				if (this.songTargetProgram === 0 && this.targetAMKVersion < 4) {
					this.warnOnce(
						"lowNote",
						"AMK0206",
						"This older AddmusicK song outputs an invalid note byte (its pitch is too low); it may be inaudible.",
					);
				} else {
					this.errorAt(start, this.pos, "AMK0141", "Note's pitch was too low.");
					note = NOTE_REST;
				}
			} else if (note >= NOTE_MAX) {
				this.errorAt(start, this.pos, "AMK0142", "Note's pitch was too high.");
			} else if (
				this.instrument[this.channel] >= FIRST_PERCUSSION_INSTRUMENT &&
				this.instrument[this.channel] < FIRST_CUSTOM_INSTRUMENT
			) {
				note = 0xd0 + (this.instrument[this.channel] - 21);
				const isSfxChannel =
					this.channel === 6 ||
					this.channel === 7 ||
					(this.channel === 8 && (this.prevChannel === 6 || this.prevChannel === 7));
				if (this.songTargetProgram !== 0 || !isSfxChannel) {
					this.instrument[this.channel] = 0xff;
				}
			}
		}

		if (this.inPitchSlide) {
			this.inPitchSlide = false;
			this.append(0xdd);
			this.append(0x00);
			this.append(this.prevNoteLength);
			this.append(note);
		}

		if (this.nextNoteIsForDD) {
			this.append(note);
			this.nextNoteIsForDD = false;
			return;
		}

		let ticks = this.accumulateTiedLength(note);
		ticks = this.divideByTempoRatio(ticks, true);
		this.addNoteLength(ticks);

		// The note map: `emitNote` writes this note's first byte next, so the
		// current end of the channel vector is that byte's offset. The ties
		// `accumulateTiedLength` consumed belong to the note; the trailing
		// whitespace its `skipSpaces` walked past does not, so the span is
		// trimmed back to the text.
		let end = this.pos;
		while (end > start && isSpace(this.text[end - 1])) {
			end--;
		}

		this.noteEvents.push({
			channel: this.channel,
			offset: this.data[this.channel].length,
			note,
			written,
			ticks,
			span: this.spanAt(start, end),
		});

		this.emitNote(note, ticks);
	}

	private accumulateTiedLength(note: number): number {
		let ticks = 0;
		let okayToRewind = false;

		do {
			const savedTicks = ticks;
			const savedPos = this.pos;

			if (ticks !== 0 && (this.text[this.pos] === "^" || (note === NOTE_REST && this.text[this.pos] === "r"))) {
				this.pos++;
			}

			ticks += this.getNoteLength(this.getInt());
			this.skipSpaces();

			// A pitch bend ahead forces the tie to be emitted separately. Legacy
			// songs use `&` where AddmusicK uses `$DD`.
			//
			// Music.cpp:2224 strncmps against exactly "$DD" and "$dd", so a
			// mixed-case `$Dd` matches neither and the tie folds into the note
			// instead — even though getHex (Music.cpp:2876) reads that spelling as
			// a perfectly good command byte. Matching case-insensitively here
			// would be the more sensible rule and would emit different music.
			const ahead = this.text.slice(this.pos, this.pos + 3);
			const aheadIsDD = ahead === "$DD" || ahead === "$dd" || (this.songTargetProgram !== 0 && ahead[0] === "&");
			if (aheadIsDD && okayToRewind) {
				ticks = savedTicks;
				this.pos = savedPos;
				break;
			}

			okayToRewind = true;

			if (this.pos >= this.text.length) {
				break;
			}
		} while (this.text[this.pos] === "^" || (note === NOTE_REST && this.text[this.pos] === "r"));

		return ticks;
	}

	private emitNote(note: number, ticks: number): void {
		const limit = this.divideByTempoRatio(0x80, true);

		if (ticks >= limit) {
			// Music.cpp:2254 — inside the branch, not above it. `divideByTempoRatio`
			// errors on a fractional result, and a ratio that divides 0x80 exactly
			// but not 0x60 (64, or 128) would otherwise fail every short note in a
			// song AddmusicK compiles without complaint.
			const chunk = this.divideByTempoRatio(0x60, true);
			this.append(chunk);
			this.emitPendingQuantization();
			this.append(note);
			ticks -= chunk;

			while (ticks > chunk) {
				this.append(NOTE_TIE);
				ticks -= chunk;
			}

			if (ticks > 0) {
				if (ticks !== chunk) {
					this.append(ticks);
				}

				this.append(NOTE_TIE);
			}

			this.prevNoteLength = ticks;
			return;
		}

		if (ticks > 0) {
			if (ticks !== this.prevNoteLength || this.updateQ[this.channel]) {
				this.append(ticks);
			}

			this.prevNoteLength = ticks;
			this.emitPendingQuantization();
			this.append(note);
		}
	}

	private emitPendingQuantization(): void {
		if (!this.updateQ[this.channel]) {
			return;
		}

		this.append(this.q[this.channel]);
		this.updateQ[this.channel] = false;
		this.updateQ[8] = false;
	}

	// =========================================================================
	// Hex commands
	// =========================================================================

	/**
	 * One `$XX` at a time, exactly as `Music::parseHexCommand` does.
	 *
	 * The byte-at-a-time shape is load-bearing for the legacy targets: `$E5`
	 * only decides between tremolo and a sample load once its second byte is in,
	 * `$FC` accumulates a delay and a gain across two bytes before emitting
	 * anything, and `$ED` dispatches into the HFD translator. A parser that
	 * consumed whole commands greedily could not express any of that.
	 */
	private parseHexCommand(): void {
		const start = this.pos;
		this.pos++;
		let i = this.getHex();
		if (i === -1 || i > 0xff) {
			return this.errorAt(start, this.pos, "AMK0150", "Error parsing hex command.");
		}

		if (this.hexLeft === 0) {
			this.currentHex = i;

			if (i > 0xf2 && this.songTargetProgram === 1) {
				this.warnOnce(
					"nonNativeHex",
					"AMK0207",
					"A hex command was used that is not native to Addmusic 4.05. Did you mean #amm?",
				);
			}

			if (i > 0xfa && this.songTargetProgram === 2) {
				this.warnOnce(
					"nonNativeHex",
					"AMK0207",
					"A hex command was used that is not native to AddmusicM. Did you mean #amk 1?",
				);
			}

			if (i < FIRST_VCMD) {
				// Legacy songs wrote raw bytes here on purpose; AddmusicK only
				// warns for them, and errors for its own targets.
				if (this.targetAMKVersion === 0) {
					// Music.cpp:1699-1713 folds each "already said this" flag into the
					// *condition* rather than guarding the warning inside the branch,
					// so a second byte >= $80 finds the note warning spent and falls
					// through to the duration one — and says both things about a song
					// that only ever did the first. Reproduced, oddity and all,
					// because it is what a porter comparing output will see.
					if (!this.warnedOnce.has("manualNote") && i >= 0x80) {
						this.warnOnce(
							"manualNote",
							"AMK0208",
							"A hex command was found that will act as a note rather than an effect.",
						);
					} else if (!this.warnedOnce.has("manualDur") && i > 0x00) {
						this.warnOnce(
							"manualDur",
							"AMK0209",
							"A hex command was found that will act as a duration or quantization byte.",
						);
					} else if (!this.warnedOnce.has("manualEnd") && i === 0x00) {
						this.warnOnce(
							"manualEnd",
							"AMK0210",
							"A hex command was found that will act as a phrase end marker; the song may terminate early.",
						);
					}
				} else {
					return this.errorAt(start, this.pos, "AMK0151", `$${hex2(i)} is not a command byte (commands are $DA-$FE).`);
				}
			} else if (i > 0xfe) {
				return this.errorAt(start, this.pos, "AMK0152", `$${hex2(i)} is not a valid command.`);
			} else if (i === 0xed && this.songTargetProgram === 1) {
				return this.parseHFDHex();
			} else if (i === 0xfb) {
				// Arpeggio: the following byte is a count that sets the length.
				this.skipSpaces();
				if (this.text[this.pos] !== "$") {
					return this.error("AMK0154", "$FB is missing its length argument.");
				}

				this.pos++;
				const count = this.getHex();
				if (count === -1) {
					return this.error("AMK0154", "$FB is missing its length argument.");
				}

				this.hexLeft = count >= 0x80 ? 2 : count + 1;
				this.nextHexIsArpeggioNoteLength = true;
				this.append(i);
				this.append(count);
				return;
			} else if (i === 0xe5 && this.songTargetProgram === 1) {
				// Decided on the next byte: tremolo, or a sample load in disguise.
				this.hexLeft = 3;
				return;
			} else if (i === 0xfc && this.targetAMKVersion === 1) {
				const target = this.channel === 8 ? this.prevChannel : this.channel;
				this.usingFC[target] = true;
				this.currentHex = 0xfc;
				this.hexLeft = 2;
				return;
			} else {
				this.hexLeft = HEX_LENGTHS[this.currentHex - FIRST_VCMD] - 1;
				if (this.currentHex === 0xe3) {
					this.guessLength = false;
				}
			}

			if (this.targetAMKVersion > 1 && this.targetAMKVersion < 4 && this.currentHex === 0xfc) {
				this.warnOnce(
					"remoteGain",
					"AMK0211",
					"$FC errors on AddmusicK 1.0.8 and lower, which replaced it with remote code in #amk 2. For remote gain use $FC $xx $01 $yy $zz.",
				);
			}
		} else {
			this.hexLeft -= 1;

			if (this.hexLeft === 1 && this.currentHex === 0xfa && this.songTargetProgram === 2) {
				this.hexLeft = 0;
				return this.error("AMK0156", "This historical AddmusicM hex command is not implemented in AddmusicK.");
			}

			if (this.hexLeft === 1 && this.currentHex === 0xfa) {
				this.currentHexSub = i;
			}

			if (this.hexLeft === 0 && this.currentHex === 0xfa && this.currentHexSub === 0x7f) {
				this.markEchoBufferAllocVCMD();
			}

			if (this.hexLeft === 0 && this.currentHex === 0xfa && this.currentHexSub === 0xfe) {
				if (i >= 0x80) {
					this.hexLeft++;
				} else {
					this.markEchoBufferAllocVCMD();
				}
			}

			// Music.cpp:1820 — Addmusic 4.05 overloaded $E5: a high bit on the
			// second byte means "load sample", otherwise it is tremolo.
			if (this.hexLeft === 2 && this.currentHex === 0xe5 && this.songTargetProgram === 1) {
				if (i >= 0x80) {
					this.hexLeft--;
					// Music.cpp:1826 — anything past the stock group needs #samples
					// to have supplied it.
					if (this.sampleList.length === 0 && (i & 0x7f) > 0x13) {
						return this.error(
							"AMK0131",
							"This song uses custom samples, but has not yet defined its samples with the #samples command.",
						);
					}

					this.append(0xf3);
					this.append(i - 0x80);
					this.noteSampleUse(i - 0x80);
					return;
				}

				this.append(0xe5);
			}

			// Music.cpp:1784 — the third `nonNativeHexWarning` trigger. Shares the
			// warn-once key with the other two, as AMK shares the flag.
			if (this.hexLeft === 0 && this.currentHex === 0xf4 && i >= 0x07 && this.songTargetProgram === 2) {
				this.warnOnce(
					"nonNativeHex",
					"AMK0207",
					"A hex command was used that is not native to AddmusicM. Did you mean #amk 1?",
				);
			}

			if (this.hexLeft === 1 && this.targetAMKVersion > 1 && this.currentHex === 0xfa && i === 0x05) {
				return this.error("AMK0157", "$FA $05 was replaced with remote code in #amk 2 and above.");
			}

			// Music.cpp:1925-1962 — #amk 1's remote gain. The `$FA $05` pair is
			// popped back off and rewritten as a remote code event: type 6, which
			// rides along with type 5 and restores the instrument, or type 8, which
			// cancels it. Emitting the literal bytes instead would upload a command
			// the driver no longer has.
			if (
				this.hexLeft === 0 &&
				this.currentHex === 0xfa &&
				this.currentHexSub === 0x05 &&
				this.targetAMKVersion === 1
			) {
				// Music.cpp:1928-1929 — the `$FA $05` already appended comes back off.
				this.data[this.channel].pop();
				this.data[this.channel].pop();

				if (i !== 0) {
					// Type 6: a type-3-like event that runs alongside type 5 and
					// restores the instrument itself (Music.cpp:1941-1946).
					this.append(0xfc);
					this.append(i);
					this.append(0x01);
					this.append(0x06);
					this.append(0x00);
				} else {
					// Type 8 cancels type 6 and key-on events (Music.cpp:1952-1957).
					this.append(0xfc);
					this.append(0x00);
					this.append(0x00);
					this.append(0x08);
					this.append(0x00);
				}

				// AddmusicK also sets `usingFA[channel]` here. It is written in both
				// branches and read nowhere in the whole of Music.cpp, so there is
				// no state to carry.
				return;
			}

			if (this.hexLeft === 0 && this.currentHex === 0xf1 && i > 1) {
				if (this.songTargetProgram === 1) {
					return this.error("AMK0158", `$${hex2(i)} is not a valid FIR filter for $F1. Must be $00 or $01.`);
				}

				this.warnOnce(
					"firTable",
					"AMK0212",
					`$${hex2(i)} is a non-standard FIR table ID and reads out of bounds. Only $00 and $01 are consistent; use $F5 for custom coefficients.`,
				);
			}

			// Music.cpp:1863 — Addmusic 4.05 offsets $E4 by one.
			if (this.hexLeft === 0 && this.currentHex === 0xe4 && this.songTargetProgram === 1) {
				i = (i + 1) & 0xff;
			}

			// --- #amk 1 remote gain, rebuilt as a type 5 remote code event ---
			if (this.hexLeft === 1 && this.currentHex === 0xfc && this.targetAMKVersion === 1) {
				const target = this.channel === 8 ? this.prevChannel : this.channel;
				if (i === 0) {
					this.usingFC[target] = false;
					this.lastFCDelayValue[target] = i;
				} else {
					this.lastFCDelayValue[target] = this.divideByTempoRatio(i, false);
				}

				return;
			}

			if (this.hexLeft === 0 && this.currentHex === 0xfc && this.targetAMKVersion === 1) {
				const target = this.channel === 8 ? this.prevChannel : this.channel;
				this.lastFCGainValue[target] = i;
				if (i !== 0 && this.lastFCDelayValue[target] !== 0) {
					this.append(0xfc);
					this.append(i);
					this.append(0x01);
					this.append(0x05);
					this.append(this.lastFCDelayValue[target]);
				} else {
					// A zero timer or gain means it can never fire; cancel instead.
					this.append(0xfc);
					this.append(0x00);
					this.append(0x00);
					this.append(0x07);
					this.append(0x00);
				}

				return;
			}

			// Music.cpp:1964 — `hexLeft == 1` is the sample number. `hexLeft == 0`
			// is the pitch multiplier that follows it, so recording usage there
			// would mark the wrong sample.
			if (this.hexLeft === 1 && this.currentHex === 0xf3) {
				this.noteSampleUse(i);
			}

			if (this.hexLeft === 2 && this.currentHex === 0xf1) {
				this.echoBufferSize = Math.max(this.echoBufferSize, i);
				this.hasEchoBufferCommand = true;
			}

			// Beyond the reference, and deliberately. AMK tracks `$DA` sample usage
			// only on the am4 path (Music.cpp:1976), so a plain AddmusicK song
			// written with raw `$DA $05` instead of `@5` has that sample judged
			// unused and replaced with `EMPTY.brr` — it goes silent. Tracking every
			// target keeps a sample AMK would discard, which is the safe direction
			// to differ in, and it is what makes the optimisation trustworthy.
			if (this.hexLeft === 0 && this.currentHex === 0xda) {
				if (i < FIRST_CUSTOM_INSTRUMENT) {
					this.noteSampleUse(INSTRUMENT_TO_SAMPLE[i]);
				} else {
					const custom = (i - 30) * 6;
					if (custom < this.instrumentData.length) {
						this.noteSampleUse(this.instrumentData[custom]);
					}
				}
			}

			// Music.cpp:1976 — Addmusic 4.05 numbered custom instruments from $13.
			if (this.currentHex === 0xda && this.songTargetProgram === 1) {
				if (i >= 0x13) {
					i = i - 0x13 + FIRST_CUSTOM_INSTRUMENT;
				}

				// Two deliberate deviations from Music.cpp:1981. AMK indexes
				// `instrumentData[(i - 30) * 5]` unconditionally, so a `$DA` below
				// $13 reaches it with a negative subscript; and the stride is 5
				// where entries are 6 bytes, so it reads the wrong instrument's
				// sample. Both are guarded here rather than reproduced.
				const entry = (i - 30) * 6;
				if (i >= FIRST_CUSTOM_INSTRUMENT && entry < this.instrumentData.length) {
					this.noteSampleUse(this.instrumentData[entry]);
				}
			}

			if (this.hexLeft === 0 && this.currentHex === 0xe6) {
				if (i === 0) {
					if (this.inE6Loop) {
						return this.error("AMK0159", "Cannot nest $E6 loops within other $E6 loops.");
					}

					this.inE6Loop = true;
					this.handleSuperLoopEnter();
				} else {
					if (!this.inE6Loop) {
						return this.error("AMK0160", "An $E6 loop starting point has not yet been declared.");
					}

					this.inE6Loop = false;
					this.handleSuperLoopExit(i + 1);
				}
			}

			if (this.hexLeft === 0 && this.currentHex === 0xf4 && (i === 0x00 || i === 0x06)) {
				this.hasYoshiDrums = true;
			}

			// $DD may take a note as its last parameter.
			if (this.hexLeft === 1 && this.currentHex === 0xdd) {
				const backup = this.pos;
				for (;;) {
					this.skipSpaces();
					if (this.text[this.pos] === "o") {
						// Music.cpp:2020 — 1.0.8 and earlier freeze on hex validation
						// here, so a song targeting one of them is worth warning about.
						if (this.targetAMKVersion < 4) {
							this.warnOnce(
								"octaveForDD",
								"AMK0218",
								"Using o after $DD freezes hex validation in AddmusicK 1.0.8 and lower.",
							);
						}

						this.pos++;
						this.getInt();
					} else if (isNoteLetter(this.text[this.pos])) {
						if (this.updateQ[this.channel]) {
							this.error(
								"AMK0161",
								"You cannot use a note as the last parameter of $DD if qXX was used just before it.",
							);
						}

						this.hexLeft = 0;
						this.nextNoteIsForDD = true;
						break;
					} else if (this.text[this.pos] === "<" || this.text[this.pos] === ">") {
						this.pos++;
					} else {
						break;
					}
				}

				this.pos = backup;
			}

			i = this.applyTempoRatioToHexArgument(i);
		}

		if (i < 0 || i > 255) {
			return this.error("AMK0162", "Illegal value for hex command.");
		}

		this.append(i);
	}

	/** Music.cpp:2046-2087 — duration arguments scale with the tempo ratio. */
	private applyTempoRatioToHexArgument(i: number): number {
		const divide = (): number => this.divideByTempoRatio(i, false);
		const multiply = (): number => this.multiplyByTempoRatio(i);

		if (this.currentHex === 0xdc && this.hexLeft === 1) {
			return divide();
		}

		if (this.currentHex === 0xdd && (this.hexLeft === 2 || this.hexLeft === 1)) {
			return divide();
		}

		if (this.currentHex === 0xde && this.hexLeft === 2) {
			return divide();
		}

		if (this.currentHex === 0xde && this.hexLeft === 1) {
			return multiply();
		}

		if (this.currentHex === 0xe1 && this.hexLeft === 1) {
			return divide();
		}

		if (this.currentHex === 0xe2 && this.hexLeft === 0) {
			return divide();
		}

		if (this.currentHex === 0xe3 && this.hexLeft === 1) {
			return divide();
		}

		if (this.currentHex === 0xe5 && this.hexLeft === 2) {
			return divide();
		}

		if (this.currentHex === 0xe5 && this.hexLeft === 1) {
			return multiply();
		}

		if (this.currentHex === 0xe8 && this.hexLeft === 1) {
			return divide();
		}

		if (this.currentHex === 0xea && this.hexLeft === 0) {
			return divide();
		}

		if (this.currentHex === 0xeb && (this.hexLeft === 2 || this.hexLeft === 1)) {
			return divide();
		}

		if (this.currentHex === 0xec && (this.hexLeft === 2 || this.hexLeft === 1)) {
			return divide();
		}

		if (this.currentHex === 0xf2 && this.hexLeft === 2) {
			return divide();
		}

		if (this.nextHexIsArpeggioNoteLength) {
			this.nextHexIsArpeggioNoteLength = false;
			return divide();
		}

		return i;
	}

	/**
	 * Addmusic 4.05's `$ED` escape (Music.cpp:1466).
	 *
	 * HFD packed arbitrary SPC operations behind `$ED`: `$80` writes a DSP
	 * register, `$81` sets a semitone tune, `$82` copies a block into ARAM (and
	 * one specific address is really an instrument table), anything else is a
	 * plain `$ED` ADSR command.
	 */
	private parseHFDHex(): void {
		this.skipSpaces();
		if (this.text[this.pos] !== "$") {
			return this.error("AMK0163", "Unknown HFD hex command.");
		}

		this.pos++;
		const kind = this.getHex();
		if (kind === -1) {
			return this.error("AMK0150", "Error parsing hex command.");
		}

		const nextByte = (): number | null => {
			this.skipSpaces();
			if (this.text[this.pos] !== "$") {
				this.error("AMK0163", "Unknown HFD hex command.");
				return null;
			}

			this.pos++;
			const value = this.getHex();
			if (value === -1) {
				this.error("AMK0163", "Unknown HFD hex command.");
				return null;
			}

			return value;
		};

		if (kind === 0x80) {
			const reg = nextByte();
			if (reg === null) {
				return;
			}

			const val = nextByte();
			if (val === null) {
				return;
			}

			if (reg === 0x6d || reg === 0x7d) {
				// The HFD header bytes; their presence is what marks the song as
				// Addmusic 4.05 in the first place, so do not emit them.
				this.songTargetProgram = 1;
			} else if (reg === 0x6c) {
				this.append(0xf8); // noise clock gets a real command
				this.append(val);
			} else {
				this.append(0xf6); // generic DSP write
				this.append(reg);
				this.append(val);
			}

			this.hexLeft = 0;
			return;
		}

		if (kind === 0x81) {
			const value = nextByte();
			if (value === null) {
				return;
			}

			this.append(0xfa);
			this.append(0x02);
			this.append(value);
			this.hexLeft = 0;
			return;
		}

		if (kind === 0x83) {
			return this.error("AMK0163", "Unknown HFD hex command.");
		}

		if (kind === 0x82) {
			const addrHi = nextByte();
			if (addrHi === null) {
				return;
			}

			const addrLo = nextByte();
			if (addrLo === null) {
				return;
			}

			const bytesHi = nextByte();
			if (bytesHi === null) {
				return;
			}

			const bytesLo = nextByte();
			if (bytesLo === null) {
				return;
			}

			const address = (addrHi << 8) | addrLo;
			let remaining = (bytesHi << 8) | bytesLo;

			if (address === 0x6136) {
				return this.parseHFDInstrumentHack(remaining);
			}

			// Any other block write is discarded: we cannot know what it would
			// clobber, and AddmusicK drops it too.
			do {
				if (nextByte() === null) {
					return;
				}

				remaining--;
			} while (remaining >= 0);

			this.hexLeft = 0;
			return;
		}

		// Anything else is a plain ADSR command with one argument already read.
		this.currentHex = 0xed;
		this.hexLeft = HEX_LENGTHS[0xed - FIRST_VCMD] - 2;
		this.append(0xed);
		this.append(kind);
	}

	/** Music.cpp:1430 — a block write to $6136 is really a custom instrument table. */
	private parseHFDInstrumentHack(bytes: number): void {
		let byteNum = 0;
		let remaining = bytes;
		do {
			this.skipSpaces();
			if (this.text[this.pos] !== "$") {
				return this.error("AMK0163", "Unknown HFD hex command.");
			}

			this.pos++;
			const value = this.getHex();
			if (value === -1 || value > 0xff) {
				return this.error("AMK0163", "Unknown HFD hex command.");
			}

			this.instrumentData.push(value);
			remaining--;
			byteNum++;
			if (byteNum === 1) {
				this.noteSampleUse(value);
			}

			if (byteNum === 5) {
				this.instrumentData.push(0); // AddmusicK's extra sub-multiplier byte
				byteNum = 0;
			}
		} while (remaining >= 0);
	}

	// =========================================================================

	private markEchoBufferAllocVCMD(): void {
		if (
			!this.echoBufferAllocVCMDIsSet &&
			this.resizedChannel !== -1 &&
			this.channel !== 8 &&
			this.channel === this.resizedChannel &&
			!this.passedNote[this.channel] &&
			!this.hasEchoBufferCommand &&
			!this.passedIntro[this.channel]
		) {
			this.echoBufferAllocVCMDIsSet = true;
			this.echoBufferAllocVCMDLoc = this.data[this.channel].length + 1;
			this.echoBufferAllocVCMDChannel = this.channel;
		}
	}

	/**
	 * Splits the song into an intro and a main loop, in seconds (Music.cpp:3221).
	 *
	 * Kept as the pair rather than one number because AddmusicK reports two
	 * different lengths from it: `introSeconds + mainSeconds` is how long the song
	 * is, and is what it prints (Music.cpp:525, :3320), while the ID666 tag gets
	 * `introSeconds + mainSeconds * 2` — the loop played twice, then faded.
	 */
	private estimateSeconds(): { estimated: SongLength; played: SongLength } | null {
		if (!this.guessLength) {
			return null;
		}

		let totalLength = Infinity;
		for (const length of this.channelLengths) {
			if (length !== 0) {
				totalLength = Math.min(totalLength, Math.floor(length));
			}
		}

		if (!Number.isFinite(totalLength)) {
			return null;
		}

		const changes = [...this.tempoChanges].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
		if (changes.length === 0 || changes[0][0] !== 0) {
			changes.unshift([0, 0x36]);
		}

		changes.push([totalLength, 0]);

		let beforeLoop = 0;
		let afterLoop = 0;
		let playedBeforeLoop = 0;
		let playedAfterLoop = 0;
		let onIntro = true;

		for (let z = 0; z < changes.length - 1; z++) {
			if (changes[z][0] > totalLength) {
				// Music.cpp:3236 — a `t` past the shortest channel's end never runs,
				// which usually means a channel is shorter than intended.
				this.warnOnce("tempoPastEnd", "AMK0217", "A tempo change was found beyond the end of the song.");
				break;
			}

			if (changes[z][1] < 0) {
				onIntro = false;
			}

			const tempo = Math.abs(changes[z][1]);
			const span = changes[z + 1][0] - changes[z][0];
			// The two rates have to be summed side by side rather than scaled at the
			// end: each segment carries its own tempo, and they do not agree by a
			// constant factor.
			const seconds = span / (2 * tempo);
			const played = span * TEMPO_TICK_SECONDS(tempo);
			if (onIntro) {
				beforeLoop += seconds;
				playedBeforeLoop += played;
			} else {
				afterLoop += seconds;
				playedAfterLoop += played;
			}
		}

		// Music.cpp:3253-3262 — without an intro the whole song *is* the loop, so
		// what was accumulated before the (absent) `/` is the main section.
		const split = (before: number, after: number): SongLength =>
			this.hasIntro ? { introSeconds: before, mainSeconds: after } : { introSeconds: 0, mainSeconds: before };

		return {
			estimated: split(beforeLoop, afterLoop),
			played: split(playedBeforeLoop, playedAfterLoop),
		};
	}

	/**
	 * Records that the song plays a given sample directory slot.
	 *
	 * The set of slots and the ordered list of names are two different things,
	 * so they are two fields: `stats.sampleNames` is filenames in SRCN order and
	 * nothing else.
	 */
	private noteSampleUse(srcn: number): void {
		if (srcn >= 0 && srcn < this.usedSamples.length) {
			this.usedSamples[srcn] = true;
		}
	}

	/**
	 * The song's sample set, in SRCN order.
	 *
	 * A song with no `#samples` gets the `#default` group, which is what
	 * Music.cpp:3064 does by re-entering the parser on a synthetic
	 * `"{#default }"` at the very end of compilation. Doing it here rather than
	 * eagerly is what lets an explicit `#samples` anywhere in the file suppress
	 * it, and it also means the list survives an early parse failure.
	 *
	 * `null` rather than `[]` when there is nothing to resolve: an empty list is
	 * a real answer meaning "no samples", and the host must be able to tell it
	 * apart from "this compiler was given no library to look names up in".
	 */
	private requestedSampleList(): readonly string[] | null {
		if (this.sampleList.length > 0) {
			return [...this.sampleList];
		}

		const fallback = this.options?.sampleGroups["default"];
		return fallback && fallback.length > 0 ? [...fallback] : null;
	}

	private resolveSampleList(): readonly string[] | null {
		const names = this.requestedSampleList();
		if (!names) {
			return null;
		}

		// The implicit `#default` fallback never went through `pushSample`, so it
		// has no recorded importance — it has to be looked up the same way, or
		// every important sample in a song that omits `#samples` (which is most
		// songs) is quietly reclaimed.
		const important =
			this.sampleList.length > 0 ? this.sampleImportant : names.map((name) => this.isImportantName(name));

		if (this.options?.optimizeSampleUsage === false) {
			return names;
		}

		return this.optimizeSamples([...names], important);
	}

	private isImportantName(name: string): boolean {
		return this.options?.importantSamples?.includes(name) ?? false;
	}

	/**
	 * Replaces samples the song never plays with `EMPTY.brr` — AMK's
	 * `optimizeSampleUsage` (Music.cpp:3074).
	 *
	 * The directory keeps its length and every SRCN keeps its meaning; only the
	 * bytes behind the unplayed slots go away. Because every replaced slot names
	 * the same zero-length sample, `buildSpc` writes it once and points the rest
	 * at that one entry.
	 *
	 * This is only safe if usage tracking is complete, since a sample wrongly
	 * judged unused becomes silence. See the `$DA` note in `parseHexCommand` for
	 * the one hole in the reference's tracking that is deliberately plugged here.
	 */
	private optimizeSamples(names: string[], important: readonly boolean[]): readonly string[] {
		return names.map((name, srcn) => (this.usedSamples[srcn] || important[srcn] ? name : EMPTY_SAMPLE_NAME));
	}

	// =========================================================================
	// Diagnostics
	// =========================================================================

	/**
	 * Turns a position in the parser's buffer into one in the original source.
	 *
	 * The buffer is not the text the author wrote: preprocessing removed the
	 * `#amk` marker, every `#define`/`#if` line, the untaken side of a false
	 * branch and all comments, and replacement expansion has rewritten parts of
	 * what is left. A raw buffer offset is wrong by however much was removed —
	 * six characters in a song beginning `#amk 4`; {@link origins} is what makes
	 * a diagnostic land.
	 *
	 * The line is counted in the source too, so it agrees with the offset rather
	 * than with the buffer.
	 */
	private spanAt(start: number, end: number): Span {
		const from = this.originAt(start);
		// The end maps from the last character *inside* the range, so a span
		// that ends where a comment was stripped does not swallow the comment.
		let to = end > start ? this.originAt(end - 1) + 1 : from;
		// Text that came from a replacement collapses to a single point, which
		// would select nothing; give it one character so it can still be seen.
		if (to <= from && end > start) {
			to = Math.min(from + 1, this.scanned.length);
		}

		return { start: from + this.bomOffset, end: Math.max(to, from) + this.bomOffset, line: this.lineOf(from) };
	}

	/**
	 * The 1-based line a {@link scanned} offset falls on: one more than the
	 * number of line starts at or before it. The table is built on the first
	 * call; `scanned` never changes after `stripBOM`.
	 */
	private lineOf(offset: number): number {
		if (this.lineStarts === null) {
			const starts: number[] = [];
			for (let n = 0; n < this.scanned.length; n++) {
				if (this.scanned[n] === "\n") {
					starts.push(n + 1);
				}
			}

			this.lineStarts = starts;
		}

		let low = 0;
		let high = this.lineStarts.length;
		while (low < high) {
			const mid = (low + high) >> 1;
			if (this.lineStarts[mid] <= offset) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}

		return low + 1;
	}

	/** {@link origins} with the ends clamped, for positions past the buffer. */
	private originAt(index: number): number {
		if (index <= 0) {
			return 0;
		}

		if (index >= this.origins.length) {
			return this.scanned.length;
		}

		return this.origins[index];
	}

	private error(code: string, message: string): void {
		this.errorAt(this.pos, this.pos + 1, code, message);
	}

	private errorAt(start: number, end: number, code: string, message: string): void {
		this.diagnostics.push({ severity: "error", code, message, span: this.spanAt(start, end) });
		this.errorCount++;
	}

	private warn(start: number, end: number, code: string, message: string): void {
		this.diagnostics.push({ severity: "warning", code, message, span: this.spanAt(start, end) });
	}

	private warnOnce(key: string, code: string, message: string): void {
		if (this.warnedOnce.has(key)) {
			return;
		}

		this.warnedOnce.add(key);
		this.warn(this.pos, this.pos + 1, code, message);
	}

	/**
	 * The three length figures, from either the estimate or a declared `#length`.
	 *
	 * A declared `#length` wins — turning off `guessLength` is the whole point of
	 * it — and gives only the tag value, since the author stated a play length and
	 * not a structure. AddmusicK leaves `introSeconds`/`mainSeconds` at zero there,
	 * so its own readout prints `0:00` for such a song; reporting the declared
	 * length instead is a deliberate divergence, and it changes nothing in the tag.
	 */
	private lengths(): Pick<ParseOutput, "tagSeconds" | "introSeconds" | "mainSeconds" | "playback"> {
		const unknown = { tagSeconds: null, introSeconds: null, mainSeconds: null, playback: null };
		if (this.errorCount > 0) {
			return unknown;
		}

		if (this.declaredSeconds !== null) {
			// Nothing to time against: the declared value is all there is, so it
			// stands in for the played length too.
			const declared = { introSeconds: this.declaredSeconds, mainSeconds: 0 };
			return { tagSeconds: this.declaredSeconds, ...declared, playback: declared };
		}

		const split = this.estimateSeconds();
		if (!split) {
			return unknown;
		}

		return {
			...split.estimated,
			playback: split.played,
			tagSeconds: Math.floor(split.estimated.introSeconds + split.estimated.mainSeconds * 2 + 0.5),
		};
	}

	// =========================================================================

	private output(): ParseOutput {
		return {
			data: this.data,
			loopLocations: this.loopLocations,
			phrasePointers: this.phrasePointers,
			noteEvents: this.noteEvents,
			commandEvents: this.commandEvents,
			instrumentData: this.instrumentData,
			hasIntro: this.hasIntro,
			doesntLoop: this.doesntLoop,
			resizedChannel: this.resizedChannel,
			echoBufferSize: this.echoBufferSize,
			hasEchoBufferCommand: this.hasEchoBufferCommand,
			echoBufferAllocVCMDIsSet: this.echoBufferAllocVCMDIsSet,
			echoBufferAllocVCMDLoc: this.echoBufferAllocVCMDLoc,
			echoBufferAllocVCMDChannel: this.echoBufferAllocVCMDChannel,
			channelLengths: this.channelLengths,
			introLength: this.introLength,
			introTicks: this.introTicks,
			sampleList: this.resolveSampleList(),
			requestedSamples: this.requestedSampleList(),
			usedSamples: this.usedSamples,
			minSize: this.minSize,
			tags: this.tags,
			...this.lengths(),
			hasYoshiDrums: this.hasYoshiDrums,
			targetAMKVersion: this.targetAMKVersion,
			songTargetProgram: this.songTargetProgram,
			tempoRatio: this.tempoRatio,
			diagnostics: this.diagnostics,
			errorCount: this.errorCount,
			trace:
				this.traceEvents === null
					? null
					: {
							events: this.traceEvents,
							buffer: this.text,
							origins: this.origins,
							expansions: this.expansions ?? [],
							startingChannel: this.resizedChannel,
							targetAMKVersion: this.targetAMKVersion,
							songTargetProgram: this.songTargetProgram,
							tempoRatio: this.tempoRatio,
							transposeMap: [...this.transposeMap],
						},
		};
	}
}
