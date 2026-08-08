/**
 * Constant tables lifted from AddmusicK's `Music.cpp`.
 *
 * Line references are to AddmusicK 1.0.11's `Music.cpp` so these can be
 * re-verified when the reference implementation moves.
 */

import { hex2 } from "./hex";

/** `tmpTrans[19]` — default per-instrument transposition. Music.cpp:57 */
export const DEFAULT_TRANSPOSE: readonly number[] = [0, 0, 5, 0, 0, 0, 0, 0, 0, -5, 6, 0, -5, 0, 0, 8, 0, 0, 0];

/** `instrToSample[30]` — default instrument to SRCN mapping. Music.cpp:58 */
export const INSTRUMENT_TO_SAMPLE: readonly number[] = [
	0x00, 0x01, 0x02, 0x03, 0x04, 0x07, 0x08, 0x09, 0x05, 0x0a, 0x0b, 0x01, 0x10, 0x0c, 0x0d, 0x12, 0x0c, 0x11, 0x01,
	0x00, 0x00, 0x0f, 0x06, 0x06, 0x0e, 0x0e, 0x0b, 0x0b, 0x0b, 0x0e,
];

/**
 * `hexLengths[]` — total byte length (command + arguments) of each VCMD,
 * indexed by `command - 0xDA`. Music.cpp:62
 *
 * `$FB` (arpeggio) is variable-length and handled separately by the parser.
 */
export const HEX_LENGTHS: readonly number[] = [
	2, 2, 3, 4, 4, 1, 2, 3, 2, 3, 2, 4, 2, 2, 3, 4, 2, 4, 4, 3, 2, 4, 1, 4, 4, 3, 2, 9, 3, 4, 2, 3, 3, 2, 5, 1, 1,
];

/**
 * The sample AddmusicK substitutes for slots a song never plays, so their bytes
 * do not have to be uploaded. `optimizeSampleUsage`, Music.cpp:3076.
 *
 * A zero-byte file in an AddmusicK install; hosts resolve it to a zero-length
 * sample rather than fetching anything.
 */
export const EMPTY_SAMPLE_NAME = "EMPTY.brr";

/**
 * Entries a `.bnk` bank contributes to the sample list, blanks included
 * (`addSampleBank`, globals.cpp:581).
 *
 * Deliberately stated here rather than imported from `@amk/spc/brr`, which has its
 * own `SAMPLE_BANK_SLOTS` for reading the directory: the compiler layer does not
 * depend on the SPC layer, and this is the AddmusicK-side statement of the same
 * number. `brrtest` asserts the two agree so they cannot drift apart.
 */
export const BANK_SLOT_COUNT = 0x40;

/**
 * Where AddmusicK's instrument bands begin.
 *
 * The bands are not contiguous and the boundaries are not derivable: `@0`-`@18`
 * select a driver instrument, `@19`/`@20` do nothing audible, `@21`-`@29` arm a
 * drum on the next note without emitting anything, and `@30` up are the song's
 * own `#instruments` entries (`Music.cpp:1594`, ported at `parser.ts:1622`).
 *
 * Stated here for the same reason as `BANK_SLOT_COUNT` above: `@amk/spc/instruments`
 * names the same two numbers for the driver-table side, `compiler/` does not
 * depend on the SPC layer, and `instrtest` asserts the two agree.
 */
export const FIRST_PERCUSSION_INSTRUMENT = 21;
export const FIRST_CUSTOM_INSTRUMENT = 30;

/**
 * Name for one slot of a `.bnk` sample bank.
 *
 * A bank is a single file holding up to 64 samples, but the compiler deals only
 * in names and the host resolves them to bytes — so each slot needs a name of
 * its own. AddmusicK generates these from a global counter
 * (`__SRCNBANKBRR%04X`, globals.cpp:612); deriving the name from the bank and
 * the slot instead makes it deterministic, which is what lets the two sides
 * agree without sharing any mutable state.
 *
 * The `:` cannot collide with a real filename: `validateName` in `@amk/spc/brr`
 * already refuses the characters that would matter, and a slot name is never
 * typed by hand.
 */
export function bankSlotName(bank: string, slot: number): string {
	return `${bank}:${hex2(slot)}`;
}

/**
 * `NoteDurations` — what `q`'s high nibble means. `main.asm:3477`
 *
 * The readme calls the nibble "how long of a delay there is between each note"
 * and says no more. The driver (`main.asm:2365-2379`) masks it to three bits,
 * indexes this table, and multiplies the note's own duration by the result
 * before taking the high byte — so it is a *gate time in 256ths of the note*,
 * and the "delay" is trailing silence proportional to how long the note is.
 * `aram_map.html:666` says so outright: "quantization, which is in 256ths of a
 * note". `q7` is $FF, so a note is never quite held for its full length.
 */
export const NOTE_DURATIONS: readonly number[] = [0x33, 0x66, 0x80, 0x99, 0xb3, 0xcc, 0xe6, 0xff];

/**
 * `VelocityValues` — what `q`'s low nibble means. `main.asm:3481-3483`
 *
 * Two tables of sixteen, SMW's first and N-SPC's second, indexed by the nibble
 * with `+0x10` when the driver's `!SecondVTable` is set (`main.asm:2374-2378`).
 * Which one is live is a property of the *song*, not of the byte: `#amk 2` moved
 * the default from SMW's to N-SPC's (`parser.ts:415`) and `#option smwvtable` /
 * `nspcvtable` switch it mid-file (`parser.ts:926-953`). Neither is linear, so
 * the nibble is an index and not a volume.
 */
export const VELOCITY_VALUES: readonly number[] = [
	0x08, 0x12, 0x1b, 0x24, 0x2c, 0x35, 0x3e, 0x47, 0x51, 0x5a, 0x62, 0x6b, 0x7d, 0x8f, 0xa1, 0xb3, 0x19, 0x33, 0x4c,
	0x66, 0x72, 0x7f, 0x8c, 0x99, 0xa5, 0xb2, 0xbf, 0xcc, 0xd8, 0xe5, 0xf2, 0xfc,
];

/** Where {@link VELOCITY_VALUES}' N-SPC half begins — the driver's own `or a, #$10`. */
export const NSPC_VELOCITY_OFFSET = 0x10;

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
	// AddmusicM's "Write Byte" — an address and a value, matching its
	// `HEX_LENGTHS` entry of 4. It is not an echo command; the FIR one is `$F5`.
	0xf7: "write byte",
	0xf8: "noise",
	0xf9: "data send",
	0xfa: "misc",
	0xfb: "arpeggio",
	0xfc: "remote code",
	// Both are real zero-argument commands as of AddmusicK 1.0.9, relocated from
	// vanilla's $E6 and $ED (`hex_command_reference.html`; dispatched through
	// `main.asm`'s CommandDispatchTable).
	0xfd: "tremolo off",
	0xfe: "pitch envelope off",
};
