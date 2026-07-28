/**
 * The compiler-agnostic contract.
 *
 * Everything in this file is deliberately free of AddmusicK specifics. A future
 * "Addmusic 5" front-end only has to implement `MmlCompiler` and register itself;
 * no UI code changes.
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
	/** Sample filenames the song asked for, in SRCN order. */
	sampleNames: string[];
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
	diagnostics: Diagnostic[];
	/** Present even on failure where possible, so the UI can still show partials. */
	stats: CompileStats | null;
}

export interface MmlCompiler {
	/** Stable machine id, e.g. `addmusick`. Persisted in project files. */
	readonly id: string;
	/** Human label for the picker. */
	readonly name: string;
	/** Marker(s) this compiler claims, e.g. `["#amk 4"]`. Shown in the UI. */
	readonly targets: readonly string[];
	/**
	 * Cheap sniff used to auto-select a compiler for a given source. Return a
	 * confidence in [0, 1]; the registry picks the highest. Returning 0 means
	 * "definitely not mine".
	 */
	detect(source: string): number;
	compile(request: CompileRequest): CompileResult;
}

// ---------------------------------------------------------------------------
// Small helpers shared by implementations.
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
		hasIntro: false,
		loops: true,
		seconds: null,
		tags: {},
	};
}

export function failure(diagnostics: Diagnostic[], stats: CompileStats | null = null): CompileResult {
	return { ok: false, data: null, diagnostics, stats };
}
