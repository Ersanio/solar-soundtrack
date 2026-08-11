/**
 * Constant tables lifted from AddmusicK's `Music.cpp` and `main.asm`.
 *
 * Line references are to AddmusicK 1.0.11's `Music.cpp` and `main.asm` so these can be
 * re-verified.
 */

import { hex2 } from "./hex";

/** Default per-instrument transposition. Music.cpp:57 - `tmpTrans[19]` */
export const DEFAULT_TRANSPOSE: readonly number[] = [0, 0, 5, 0, 0, 0, 0, 0, 0, -5, 6, 0, -5, 0, 0, 8, 0, 0, 0];

/** Default instrument to SRCN (Source Number) mapping. Music.cpp:58 - `instrToSample[30]` */
// prettier-ignore
export const INSTRUMENT_TO_SAMPLE: readonly number[] = [
	0x00, 0x01, 0x02, 0x03, 0x04, 0x07, 0x08, 0x09, 0x05, 0x0a, 0x0b, 0x01, 0x10, 0x0c, 0x0d, 0x12, 0x0c, 0x11, 0x01, // Instruments
	0x00, 0x00, //Nothing
	0x0f, 0x06, 0x06, 0x0e, 0x0e, 0x0b, 0x0b, 0x0b, 0x0e, // Percussion
];

/**
 * Total byte length (command + arguments) of each VCMD,
 * starting from command $DA - Music.cpp:63 - `hexLengths[]`
 *
 * `$FB` (arpeggio) is variable-length and handled separately by the parser.
 */
export const HEX_LENGTHS: readonly number[] = [
	2, 2, 3, 4, 4, 1, 2, 3, 2, 3, 2, 4, 2, 2, 3, 4, 2, 4, 4, 3, 2, 4, 1, 4, 4, 3, 2, 9, 3, 4, 2, 3, 3, 2, 5, 1, 1,
];

/**
 * AddmusicK's instrument types, separated by instrument number.
 * These are hardcoded in AddmuiscK's engine.
 * Relevant for parseInstrument - `Music.cpp:878`
 */
export const FIRST_PERCUSSION_INSTRUMENT = 21;
export const FIRST_CUSTOM_INSTRUMENT = 30;

/**
 * The 0-byte sample AddmusicK substitutes for slots a song never plays.
 * Relevant for `optimizeSampleUsage`, Music.cpp:3076.
 */
export const EMPTY_SAMPLE_NAME = "EMPTY.brr";

/** Number of slots a `.bnk` bank contributes to the sample list, including unused slots - globals.cpp:581 - `addSampleBank` */
export const BANK_SLOT_COUNT = 0x40;

/**
 * Name for one slot inside of a `.bnk` sample bank.
 *
 * A bank is a single file holding up to 64 samples, but the compiler deals only
 * in names. AddmusicK generates these from a global counter
 * (`__SRCNBANKBRR%04X`, globals.cpp:612); deriving the name from the bank and
 * the slot number.
 */
export function bankSlotName(bank: string, slot: number): string {
	return `${bank}:${hex2(slot)}`;
}

/**
 * `NoteDurations` — what `q`'s high nibble means. `main.asm:3477`.
 * Controls the length of the trailing silence proportional to note length.
 */
export const NOTE_DURATIONS: readonly number[] = [0x33, 0x66, 0x80, 0x99, 0xb3, 0xcc, 0xe6, 0xff];

/**
 * `VelocityValues` — what `q`'s low nibble means. `main.asm:3481-3483`.
 * Controls the volume of the note. The first half is SMW's velocities, the second half N-SPC's.
 * N-SPC by default from #amk 2 on, the choice is made by "#louder" ($F4 $08),
 * "#option smwvtable" ($FA $06 $00) and "#option nspcvtable" ($FA $06 $01)
 */
// prettier-ignore
export const VELOCITY_VALUES: readonly number[] = [
	0x08, 0x12, 0x1b, 0x24, 0x2c, 0x35, 0x3e, 0x47, 0x51, 0x5a, 0x62, 0x6b, 0x7d, 0x8f, 0xa1, 0xb3, // Normal, SMW velocities
	0x19, 0x33, 0x4c, 0x66, 0x72, 0x7f, 0x8c, 0x99, 0xa5, 0xb2, 0xbf, 0xcc, 0xd8, 0xe5, 0xf2, 0xfc, // Standard N-SPC velocities
];

/** Where {@link VELOCITY_VALUES}' N-SPC half begins. */
export const NSPC_VELOCITY_OFFSET = 0x10;

/** First and last hex commands */
export const FIRST_VCMD = 0xda;
export const LAST_VCMD = 0xfe;

/** Semitone offsets for `a b c d e f g`. Music.cpp:getPitch */
export const PITCH_TABLE: readonly number[] = [9, 11, 0, 2, 4, 5, 7];

/** Note byte for a tie (`^`). */
export const NOTE_TIE = 0xc6;
/** Note byte for a rest (`r`). */
export const NOTE_REST = 0xc7;
/** Notes abcdefg must be $0x80 <= $nn < $C6. */
export const NOTE_MIN = 0x80;
export const NOTE_MAX = 0xc6; // exclusive, as $C6 is a tie

/** Ticks in a whole note. */
export const TICKS_PER_WHOLE = 192;

/** The default parser version - #amk 4. */
export const PARSER_VERSION = 4;
