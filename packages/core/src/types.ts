/**
 * What goes into the compiler and what comes out of it.
 * Both the UI and compiler read these types.
 */

/** Diagnostics severities */
export type Severity = "error" | "severe" | "warning" | "info";

/** Represents a portion of the txt source */
export interface Span {
	start: number;
	end: number;
	line: number;
}

/** A song split into the part played once and the part played round and round. */
export interface SongLength {
	introSeconds: number;
	mainSeconds: number;
}

/** Errors, warnings and other notices */
export interface Diagnostic {
	severity: Severity;
	code: string;
	message: string;
	span: Span;
}

/** Per-channel accounting, surfaced in the UI and used for the ARAM budget. */
export interface CompileStats {
	/** Byte size of each of the 8 music channels. */
	channelSizes: number[];
	/** Byte size of the loop/subroutine block (AMK's "channel 8"). */
	loopDataSize: number;
	/** Byte size of the pointer table + custom instrument block. */
	headerSize: number;
	/** Total size of the emitted blob. Equals `data.length`. */
	totalSize: number;
	/** Tick count per channel. */
	channelTicks: number[];
	/** Taken from the shortest channel, so `introTicks + loopTicks` is one pass. */
	introTicks: number;
	loopTicks: number;
	/** Echo buffer size in 2 KiB units; bytes = `echoBufferSize << 11`. */
	echoBufferSize: number;
	/**
	 * Sample filenames the song asked for, in SRCN order, before any optimisation
	 * pass replaced the unplayed ones. `[]` when the compiler had no opinion.
	 */
	sampleNames: string[];
	/**
	 * The subset of {@link sampleNames} the song actually plays — through an
	 * instrument, a `$F3` load, or a custom instrument's own sample.
	 */
	usedSampleNames: string[];
	hasIntro: boolean;
	loops: boolean;
	/** Length written to the ID666 tag: Intro, 2x loop, fadeout. Used in the SPC downloader. */
	tagSeconds: number | null;
	/** Estimated intro seconds, one pass. `null` when the compiler could not guess. */
	introSeconds: number | null;
	/** Estimated main-loop seconds, one pass. `null` when the compiler could not guess. */
	mainSeconds: number | null;
	/**
	 * Songlength synced against the driver's real tick rate rather than AddmusicK's
	 * rounded one, and the transport's **fallback**. See README.md.
	 *
	 * It is still an estimate over the tempo the song asked for, so it is wrong by
	 * whatever the driver drops, and `null` for a song AddmusicK will not time at
	 * all. Anything following the audio goes through the editor's own clock first
	 * — see `EditorStore.clock` — and reaches this only when there is no walk of
	 * the compiled bytes to read.
	 */
	playback: SongLength | null;
	/** ID666 tags parsed out of `#spc { }`. */
	tags: SongTags;
	/**
	 * The `#amk` version in force, 0 under `#am4`/`#amm`, and the target program
	 * in the parser's own vocabulary: 0 AddmusicK, 1 Addmusic 4.05, 2 AddmusicM.
	 *
	 * Here because anything that writes MML back has to know what the target can
	 * spell — dots and `=N` on an `l` need `#amk 4` (`mml-text.ts:spellLength`).
	 * The scan can answer this positionally; the compiler answers it finally.
	 */
	targetAMKVersion: number;
	songTargetProgram: number;
	/**
	 * `#halvetempo` and `#option dividetempo`'s divisor, 1 without either.
	 *
	 * Load-bearing for writing text, not a statistic: every note's {@link
	 * NoteAddress.ticks} and every walked tick is already **divided** by it
	 * (`parser.ts:divideByTempoRatio`), so a length spelled from a tick count has
	 * to be multiplied back up first or the song is silently halved. Only
	 * {@link ParseTrace} carried it before, and a trace costs an event per
	 * dispatch where this costs nothing.
	 */
	tempoRatio: number;
}

export interface SongTags {
	title?: string;
	game?: string;
	author?: string;
	comment?: string;
	length?: string;
}

export interface CompileRequest {
	source: string;
	/** ARAM address the emitted song binary will be loaded at. */
	aramAddress: number;
	/** Compiler-specific knobs. Unknown keys must be ignored, not rejected. */
	options?: Readonly<Record<string, unknown>>;
}

/** Note, rest or tie and its txt source equivalent */
export interface NoteAddress {
	/** Absolute ARAM address of the first byte the note's emission wrote. */
	address: number;
	/** 0-7 for the music channels; 8 for the loop/subroutine block. */
	channel: number;
	/**
	 * The note byte as emitted: `$80`-`$C5` pitched, `$C6` a tie, `$C7` a rest,
	 * `$D0`-`$D8` a drum. Post-transpose and post-percussion-remap, so it is what
	 * the driver will read rather than what the letter said.
	 *
	 * Here so that `walktest` can check `@amk/spc`'s walk of the emitted bytes
	 * against what the compiler thought it was emitting — two independent
	 * derivations of the same note. Nothing in the app reads it: the roll draws
	 * from the walk, which also knows the tick each note falls on and the state
	 * it sounds under, and this map does not.
	 */
	note: number;
	/**
	 * The byte the letter and octave alone name, before `h`, the instrument's
	 * transposition and the percussion remap — `o4 c` is `$A4` whatever it plays
	 * as. Equal to {@link note} for a rest or a tie. Only the source knows this,
	 * which is why the walk cannot supply it: the piano roll draws a pitched note
	 * on this row and reports `note - written` as the transposition.
	 */
	written: number;
	/** Ticks the note occupies, source-level `^` ties already folded in. Same use as {@link note}. */
	ticks: number;
	span: Span;
}

/**
 * A command that emitted bytes, and the source text it was written as.
 *
 * The sibling of {@link NoteAddress}, and not something AddmusicK records
 * either. It exists because the driver decides which command is in force at run
 * time: a `[ ]` body, a `[[ ]]` subloop and a `(1)n` call all replay one run of
 * bytes under whatever state reached them, so only a walk of the emitted stream
 * can say which command a note sounds under — and a walk can name a command by
 * nothing but its address. This turns that address back into text.
 *
 * Commands the compiler resolves at parse time are deliberately absent, since
 * they emit nothing to address: `q` folds into each note's duration byte, `h`
 * and `@21`-`@29` into the note byte itself, and `o`/`l` into neither. Source
 * order answers those exactly, because that is the order the compiler read them
 * in.
 */
export interface CommandAddress {
	/** Absolute ARAM address of the first byte the command emitted. */
	address: number;
	/** 0-7 for the music channels; 8 for the loop/subroutine block. */
	channel: number;
	span: Span;
}

/**
 * The parser's note state, as it stands between two dispatches.
 *
 * Everything the parser resolves at parse time and folds into the bytes it
 * emits — so everything a text that re-spells a command has to put back. The
 * nine-slot arrays are per channel with slot 8 for the loop block, exactly as
 * the parser keeps them.
 */
export interface ParseState {
	channel: number;
	prevChannel: number;
	/** -1 to 7 as the parser holds it; `<` under `o0` and `>` over `o6` reach the ends. */
	octave: number;
	/** The `l` in force, in ticks. */
	defaultNoteLength: number;
	/** The last duration byte written, or -1 after anything that forces the next note to carry one. */
	prevNoteLength: number;
	triplet: boolean;
	hTranspose: number;
	usingHTranspose: boolean;
	/** Per slot. 21-29 is a drum remap waiting for a note; 0xff is one that note consumed. */
	instrument: readonly number[];
	q: readonly number[];
	/** Per slot; only Addmusic 4.05 ever sets one. */
	ignoreTuning: readonly boolean[];
	inRemoteDefinition: boolean;
	inE6Loop: boolean;
	/** The loop block offset the last `[` opened at, which is the id a `*` or `(n)m` calls. */
	prevLoop: number;
	loopLabel: number;
	channelDefined: boolean;
	inPitchSlide: boolean;
	nextNoteIsForDD: boolean;
}

/** What a dispatch did to the loop structure, read off the bytes it wrote. */
export type LoopEvent =
	/** `[`, `(n)[` or `(!n)[`. `at` is the loop block offset the body starts at — its id. */
	| { kind: "open"; at: number; label: number; remote: boolean }
	/** `]n`. `count` is what the `$E9` carries; 1 for a remote body, which emits none. */
	| { kind: "close"; at: number; count: number; remote: boolean }
	/** `[[`. */
	| { kind: "subOpen" }
	/** `]]n`. `count` is n, the number of times the body plays. */
	| { kind: "subClose"; count: number }
	/** `*n` or `(n)m`. `at` is the id of the body called; 0xffff for a `*` with no loop before it. */
	| { kind: "call"; at: number; count: number; label: number | null };

/** One dispatch of the parser's scan loop. */
export interface ParseEvent {
	/** The command's source text, trailing whitespace trimmed. */
	span: Span;
	/** The lower-cased character the scan dispatched on. */
	char: string;
	/** The channel the dispatch started on; 8 inside a loop body. */
	channel: number;
	/** The parser's state once the dispatch returned. */
	state: ParseState;
	loop?: LoopEvent;
}

/**
 * The parse as a sequence of states, for rewriting the source.
 *
 * A `[ ]` body is compiled once, under the state standing at its `[`, and
 * replayed from bytes; text that unrolls it has to re-create that state around
 * each copy, and only the parser can say what it was. Recorded by bracketing the
 * scan's one dispatch loop, as the command map is, so no handler knows it exists.
 */
export interface ParseTrace {
	events: readonly ParseEvent[];
	/** The parser's buffer once the scan is done: preprocessed, every replacement expanded. */
	buffer: string;
	/** One source offset per character of {@link buffer}, before the BOM adjustment spans carry. */
	origins: readonly number[];
	/** The source span of every `"find=value"` match the parser expanded, in parse order. */
	expansions: readonly Span[];
	/** The channel text above the first `#N` is written to. */
	startingChannel: number;
	targetAMKVersion: number;
	songTargetProgram: number;
	tempoRatio: number;
	/** The instrument transposition table as the scan left it. */
	transposeMap: readonly number[];
}

export interface CompileResult {
	ok: boolean;
	/** Relocated song data, ready to paste at `aramAddress`. Null if `!ok`. */
	data: Uint8Array | null;
	/**
	 * Every note, rest and tie by the ARAM address of its first byte, sorted by
	 * address. Used by the live playback to link editor txt source highlighting.
	 * Null if `!ok`.
	 */
	noteMap: readonly NoteAddress[] | null;
	/**
	 * Every command that emitted bytes, by the ARAM address of its first byte,
	 * sorted by address. The piano roll names the commands a note sounds under
	 * with it. Null if `!ok`.
	 */
	commandMap: readonly CommandAddress[] | null;
	/** The sample set this song needs, by filename, ordered by sample index. */
	sampleList: readonly string[] | null;
	diagnostics: Diagnostic[];
	/** Present even on failure where possible, so the UI can still show partials. */
	stats: CompileStats | null;
	/** The parse trace, only when the request's options asked for one (`trace: true`) and the song compiled. */
	trace?: ParseTrace;
}

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

/** The entry a voice is sounding while its track pointer sits at `pointer`. */
export function noteAddressAt(map: readonly NoteAddress[], pointer: number): NoteAddress | null {
	let low = 0;
	let high = map.length - 1;
	let found = -1;

	while (low <= high) {
		const mid = (low + high) >> 1;
		if (map[mid].address < pointer) {
			found = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	return found >= 0 ? map[found] : null;
}
