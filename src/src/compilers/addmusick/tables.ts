/**
 * Constant tables lifted from AddmusicK's `Music.cpp`.
 *
 * Line references are to AddmusicK 1.0.11's `Music.cpp` so these can be
 * re-verified when the reference implementation moves.
 */

/** `tmpTrans[19]` — default per-instrument transposition. Music.cpp:57 */
export const DEFAULT_TRANSPOSE: readonly number[] = [
	0, 0, 5, 0, 0, 0, 0, 0, 0, -5, 6, 0, -5, 0, 0, 8, 0, 0, 0,
];

/** `instrToSample[30]` — default instrument to SRCN mapping. Music.cpp:58 */
export const INSTRUMENT_TO_SAMPLE: readonly number[] = [
	0x00, 0x01, 0x02, 0x03, 0x04, 0x07, 0x08, 0x09, 0x05, 0x0a,
	0x0b, 0x01, 0x10, 0x0c, 0x0d, 0x12, 0x0c, 0x11, 0x01,
	0x00, 0x00,
	0x0f, 0x06, 0x06, 0x0e, 0x0e, 0x0b, 0x0b, 0x0b, 0x0e,
];

/**
 * `hexLengths[]` — total byte length (command + arguments) of each VCMD,
 * indexed by `command - 0xDA`. Music.cpp:62
 *
 * `$FB` (arpeggio) is variable-length and handled separately by the parser.
 */
export const HEX_LENGTHS: readonly number[] = [
	2, 2, 3, 4, 4, 1,
	2, 3, 2, 3, 2, 4, 2, 2, 3, 4, 2, 4, 4, 3, 2, 4,
	1, 4, 4, 3, 2, 9, 3, 4, 2, 3, 3, 2, 5, 1, 1,
];

export const FIRST_VCMD = 0xda;
export const LAST_VCMD = 0xfe;

/** Semitone offsets for `a b c d e f g`, indexed by `charCode - 0x61`. Music.cpp:getPitch */
export const PITCH_TABLE: readonly number[] = [9, 11, 0, 2, 4, 5, 7];

/** Note byte for a tie (`^`). */
export const NOTE_TIE = 0xc6;
/** Note byte for a rest (`r`). */
export const NOTE_REST = 0xc7;
/** Notes must satisfy `0x80 <= n < 0xC6`. */
export const NOTE_MIN = 0x80;
export const NOTE_MAX = 0xc6;

/** Ticks in a whole note. */
export const TICKS_PER_WHOLE = 192;

/** The parser version this implementation targets. */
export const PARSER_VERSION = 4;

/** Human-readable names for the VCMDs, used in hover text and hex dumps. */
export const VCMD_NAMES: Readonly<Record<number, string>> = {
	0xda: "set instrument",
	0xdb: "pan",
	0xdc: "pan fade",
	0xdd: "pitch bend",
	0xde: "vibrato",
	0xdf: "vibrato off",
	0xe0: "global volume",
	0xe1: "global volume fade",
	0xe2: "tempo",
	0xe3: "tempo fade",
	0xe4: "global transpose",
	0xe5: "tremolo",
	0xe6: "subloop",
	0xe7: "volume",
	0xe8: "volume fade",
	0xe9: "call loop",
	0xea: "vibrato fade",
	0xeb: "pitch envelope (release)",
	0xec: "pitch envelope (attack)",
	0xed: "ADSR / GAIN",
	0xee: "fine tune",
	0xef: "echo parameters",
	0xf0: "echo off",
	0xf1: "echo parameters",
	0xf2: "echo fade",
	0xf3: "sample load",
	0xf4: "misc",
	0xf5: "FIR filter",
	0xf6: "DSP write",
	0xf7: "echo FIR",
	0xf8: "noise",
	0xf9: "data send",
	0xfa: "misc",
	0xfb: "arpeggio",
	0xfc: "remote code",
	0xfd: "(reserved)",
	0xfe: "(reserved)",
};
