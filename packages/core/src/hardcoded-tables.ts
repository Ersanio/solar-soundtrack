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
 * A multiplier, in 256ths, on a note's last frame; {@link frameSoundingTicks} is what it comes to.
 */
export const NOTE_DURATIONS: readonly number[] = [0x33, 0x66, 0x80, 0x99, 0xb3, 0xcc, 0xe6, 0xff];

/**
 * `!WaitTime` (`main.asm:121`): how many ticks before a frame ends the read-ahead keys the voice off
 * at the latest. `PlaySong` sets it to 2 (`main.asm:2108`); `$F4 $02` flips it between 2 and 1 for
 * every channel at once (`Commands.asm:595-597`).
 */
export const WAIT_TIME = 2;

/**
 * The frames `emitNote` writes a note of `ticks` as (`parser.ts:2921`, Music.cpp:2254): one below
 * `$80`, otherwise `$60`-tick pieces joined by ties with the remainder last — both bounds divided by
 * the tempo ratio, and `ticks` already the emitted count.
 */
export function noteFrames(ticks: number, tempoRatio = 1): number[] {
	if (ticks < Math.floor(0x80 / tempoRatio)) {
		return ticks > 0 ? [ticks] : [];
	}

	const chunk = Math.floor(0x60 / tempoRatio);
	const frames = [chunk];
	let left = ticks - chunk;
	while (left > chunk) {
		frames.push(chunk);
		left -= chunk;
	}

	if (left > 0) {
		frames.push(left);
	}

	return frames;
}

/**
 * Ticks a frame sounds before the driver keys the voice off.
 *
 * `L_0CB3` loads `$0100+x` with the high byte of `frame × gate`, floored at 1 (`main.asm:2439-2449`).
 * The read-ahead decrements it on every tick that does not fetch, and keys off when it reaches zero
 * or when the duration counter reaches `!WaitTime`, whichever comes first (`main.asm:3212-3243`). So
 * `q7x` never sounds whole, and a one-tick frame, which has no such tick, sounds through.
 */
export function frameSoundingTicks(frame: number, gate: number, waitTime = WAIT_TIME): number {
	return Math.min(Math.max(1, (frame * gate) >> 8), Math.max(1, frame - waitTime));
}

/**
 * Ticks a whole note sounds. Every frame but the last runs into a tie, which the read-ahead never
 * keys off in front of (`main.asm:2983-2984`), so only the last one is cut short.
 */
export function noteSoundingTicks(ticks: number, gate: number, waitTime = WAIT_TIME, tempoRatio = 1): number {
	const frames = noteFrames(ticks, tempoRatio);
	const last = frames[frames.length - 1];
	return last === undefined ? 0 : ticks - last + frameSoundingTicks(last, gate, waitTime);
}

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
