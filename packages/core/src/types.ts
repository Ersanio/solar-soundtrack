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
	 * rounded one; what anything following the audio must use. See README.md.
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
	 */
	note: number;
	/** Ticks the note occupies, source-level `^` ties already folded in. */
	ticks: number;
	span: Span;
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
	/** The sample set this song needs, by filename, ordered by sample index. */
	sampleList: readonly string[] | null;
	diagnostics: Diagnostic[];
	/** Present even on failure where possible, so the UI can still show partials. */
	stats: CompileStats | null;
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
