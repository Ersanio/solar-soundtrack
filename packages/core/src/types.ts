/**
 * What goes into the compiler and what comes out of it.
 *
 * The UI reads these types too — diagnostics, stats and the sample list are all
 * rendered — so they live here rather than inside `compiler/`.
 */

/**
 * How badly a diagnostic wants attention, worst first — the order the UI sorts by.
 *
 * `"severe"` sits below `"error"` because the song still compiles and still exports; it is for what
 * goes wrong when the song *plays*, which reading the bytes would never reveal. `"info"` is declared
 * and never produced.
 */
export type Severity = "error" | "severe" | "warning" | "info";

/** A half-open byte range `[start, end)` into the *source text*. */
export interface Span {
	start: number;
	end: number;
	/** 1-based, for display. */
	line: number;
}

/** A song split into the part played once and the part played round and round. */
export interface SongLength {
	introSeconds: number;
	mainSeconds: number;
}

export interface Diagnostic {
	severity: Severity;
	/** Stable identifier, e.g. `AMK0007`. Lets the UI link to docs later. */
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
	/**
	 * The song's shape in music ticks — the intro, played once, and the loop that
	 * follows it. Taken from the shortest channel, so `introTicks + loopTicks` is
	 * one pass. Exact, where every field in seconds below is not.
	 */
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
	 *
	 * Distinct from being *asked for*: a song can include a whole sample group and
	 * touch three of it. Deduplicated by name, so a sample listed at two SRCNs
	 * appears once if either is played.
	 */
	usedSampleNames: string[];
	hasIntro: boolean;
	loops: boolean;
	/**
	 * The length written to the ID666 tag: the intro plus *two* passes of the main
	 * loop, the SPC convention of looping once before the fade. A header field,
	 * not a song length — feed it to the SPC writer and nothing else. `null` when
	 * the compiler could not guess.
	 */
	tagSeconds: number | null;
	/** Estimated intro seconds, one pass. `null` when the compiler could not guess. */
	introSeconds: number | null;
	/** Estimated main-loop seconds, one pass. `null` when the compiler could not guess. */
	mainSeconds: number | null;
	/**
	 * The same split against the driver's real tick rate rather than AddmusicK's
	 * rounded one — what anything following the audio must use. See README.md.
	 */
	playback: SongLength | null;
	/** ID666 tags parsed out of `#spc { }`. */
	tags: SongTags;
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
	/**
	 * ARAM address the emitted blob will be loaded at. All internal pointers are
	 * relocated against this, so it must match where you paste the blob into the
	 * SPC. It comes from the driver's own song pointer table — the slot the local
	 * song occupies — which is what `planAram` reads out of `main.bin`.
	 */
	aramAddress: number;
	/** Compiler-specific knobs. Unknown keys must be ignored, not rejected. */
	options?: Readonly<Record<string, unknown>>;
}

/** One emitted note, rest or tie: where its first byte landed in ARAM, and the source that wrote it. */
export interface NoteAddress {
	/** Absolute ARAM address of the first byte the note's emission wrote. */
	address: number;
	/** 0-7 for the music channels; 8 for the loop/subroutine block. */
	channel: number;
	span: Span;
}

export interface CompileResult {
	ok: boolean;
	/** Relocated song data, ready to paste at `aramAddress`. Null if `!ok`. */
	data: Uint8Array | null;
	/**
	 * Every note, rest and tie by the ARAM address of its first byte, sorted by
	 * address — what a playhead joins against the driver's per-voice track
	 * pointers. Loop bodies live in the loop block (channel 8), so a pointer
	 * inside a loop call still resolves to the body's source span, on every
	 * pass. Null if `!ok`.
	 */
	noteMap: readonly NoteAddress[] | null;
	/**
	 * The sample set this song needs, by filename, in SRCN order — index 0 is
	 * directory entry 0. `null` means the compiler had no opinion and the driver's
	 * default stands; `[]` means the song genuinely asks for none.
	 *
	 * Correctness-critical, not a statistic: building an SPC against a different
	 * set produces a file that looks valid and plays the wrong sounds.
	 */
	sampleList: readonly string[] | null;
	diagnostics: Diagnostic[];
	/** Present even on failure where possible, so the UI can still show partials. */
	stats: CompileStats | null;
}

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

export function emptyStats(): CompileStats {
	return {
		channelSizes: [0, 0, 0, 0, 0, 0, 0, 0],
		loopDataSize: 0,
		headerSize: 0,
		totalSize: 0,
		channelTicks: [0, 0, 0, 0, 0, 0, 0, 0],
		introTicks: 0,
		loopTicks: 0,
		echoBufferSize: 0,
		sampleNames: [],
		usedSampleNames: [],
		hasIntro: false,
		loops: true,
		tagSeconds: null,
		introSeconds: null,
		mainSeconds: null,
		playback: null,
		tags: {},
	};
}

export function failure(
	diagnostics: Diagnostic[],
	stats: CompileStats | null = null,
	sampleList: readonly string[] | null = null,
): CompileResult {
	return { ok: false, data: null, noteMap: null, sampleList, diagnostics, stats };
}

/**
 * The entry a voice is sounding while its track pointer sits at `pointer`.
 *
 * The N-SPC driver reads ahead: while a note rings, the pointer is parked just
 * past the bytes it consumed, so every address in `[entry.address, pointer)`
 * belongs to that entry — the last one *strictly below* the pointer. Binary
 * search; `map` must be sorted by address, which {@link CompileResult.noteMap}
 * is.
 */
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
