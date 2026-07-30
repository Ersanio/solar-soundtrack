/**
 * What goes into the compiler and what comes out of it.
 *
 * The UI reads these types too — diagnostics, stats and the sample list are all
 * rendered — so they live here rather than inside `compilers/addmusick/`.
 */

export type Severity = "error" | "warning" | "info";

/** A half-open byte range `[start, end)` into the *source text*. */
export interface Span {
	start: number;
	end: number;
	/** 1-based, for display. */
	line: number;
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
	/** Estimated seconds, or `null` when the compiler could not guess. */
	seconds: number | null;
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
	 * SPC. In AddmusicK this is `programPos + main.bin.length - 4`.
	 */
	aramAddress: number;
	/** Compiler-specific knobs. Unknown keys must be ignored, not rejected. */
	options?: Readonly<Record<string, unknown>>;
}

export interface CompileResult {
	ok: boolean;
	/** Relocated song data, ready to paste at `aramAddress`. Null if `!ok`. */
	data: Uint8Array | null;
	/**
	 * The sample set this song needs, by filename, in SRCN order — index 0 is
	 * directory entry 0. `null` means the compiler has no opinion and the host
	 * should use whatever default its driver ships; `[]` means the song genuinely
	 * asks for no samples at all, which is why the two cannot be conflated.
	 *
	 * This is a correctness-critical output, not a statistic. Building an SPC
	 * against a different set than the compiler resolved produces a file that
	 * looks valid and plays the wrong sounds, so hosts must feed this to the SPC
	 * writer rather than assuming.
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
		echoBufferSize: 0,
		sampleNames: [],
		usedSampleNames: [],
		hasIntro: false,
		loops: true,
		seconds: null,
		tags: {},
	};
}

export function failure(
	diagnostics: Diagnostic[],
	stats: CompileStats | null = null,
	sampleList: readonly string[] | null = null,
): CompileResult {
	return { ok: false, data: null, sampleList, diagnostics, stats };
}
