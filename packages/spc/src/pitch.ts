/** The driver's pitch arithmetic: how a note number becomes the DSP's pitch register, and where that stops being the note. */

import type { Vibrato } from "./song-walk-types";

/** `PitchTable` (`main.asm:3514-3527`): one octave and the note above it, which `SetPitch` interpolates between. */
const PITCH_TABLE: readonly number[] = [
	0x085f, 0x08de, 0x0965, 0x09f4, 0x0a8c, 0x0b2c, 0x0bd6, 0x0c8b, 0x0d4a, 0x0e14, 0x0eea, 0x0fcd, 0x10be,
];

/** A semitone in the 256ths `$10/$11` hold a pitch in. */
export const SEMITONE = 0x100;

/** The DSP reads fourteen bits of `VxPITCH` (`SPC_DSP.cpp:436`), so a value from here up wraps round. */
export const DSP_PITCH_LIMIT = 0x4000;

/** o8 c, the first note number `SetPitch` cannot place: its octave counter starts past 6. */
export const SILENT_FROM = 84;

/**
 * `SetPitch` (`main.asm:484-554`) on the 16-bit `$10/$11` word, before its product is cut to 16 bits.
 *
 * It doubles the note number in eight bits, divides by 24 for the octave, interpolates the table on
 * the low bytes alone, doubles, and shifts right until the octave counter reaches 6 — which from 7
 * goes round through 255 and shifts everything out. Then it multiplies by the instrument's
 * multiplier and sub-multiplier, `$0210+x` and `$02F0+x` (`Commands.asm:211-216`), a byte at a time.
 * The DSP gets this value's low fourteen bits.
 */
export function setPitchWide(word: number, multiplier: number, sub: number): number {
	const note = (word >> 8) & 0xff;
	const fraction = word & 0xff;
	const twice = (note << 1) & 0xff;
	const octave = Math.floor(twice / 24);
	const at = (twice % 24) / 2;
	const low = PITCH_TABLE[at];
	const step = ((PITCH_TABLE[at + 1] & 0xff) - (low & 0xff)) & 0xff;
	const doubled = ((low + ((step * fraction) >> 8)) << 1) & 0xffff;
	const base = octave <= 6 ? doubled >> (6 - octave) : 0;
	const high = base >> 8;
	const lowByte = base & 0xff;
	return sub * high + multiplier * lowByte + ((multiplier * high) << 8) + ((sub * lowByte) >> 8);
}

/**
 * What the DSP makes of a pitch: `true`, `wraps` past {@link DSP_PITCH_LIMIT}, `silent` where
 * `SetPitch` gives it nothing, or `misplaced` where a note outside o1 c–o7 b still sounds somewhere.
 */
export type PitchFate = "true" | "wraps" | "silent" | "misplaced";

/** The fate of `pitch`, in 256ths of a semitone from o1 c and signed, and the register value the DSP gets. */
export function pitchFate(pitch: number, multiplier: number, sub: number): { fate: PitchFate; register: number } {
	const wide = setPitchWide(pitch & 0xffff, multiplier, sub);
	const register = wide & (DSP_PITCH_LIMIT - 1);
	if (pitch >= 0 && pitch < SILENT_FROM * SEMITONE) {
		return { fate: wide < DSP_PITCH_LIMIT ? "true" : "wraps", register };
	}

	return { fate: register === 0 ? "silent" : "misplaced", register };
}

/** o5 a, in range at every multiplier a note can play true under. */
const REFERENCE = 57 * SEMITONE;

/** The pitch, in 256ths from o1 c, that a register value sounds at under this tuning. */
export function heardPitch(register: number, multiplier: number, sub: number): number {
	return REFERENCE + 12 * SEMITONE * Math.log2(register / setPitchWide(REFERENCE, multiplier, sub));
}

/** The highest whole note, as a key from o1 c, that plays true under this tuning and fine tune; -1 when none does. */
export function highestTrue(multiplier: number, sub: number, fineTune: number): number {
	for (let key = SILENT_FROM - 1; key >= 0; key--) {
		if (setPitchWide(key * SEMITONE + fineTune, multiplier, sub) < DSP_PITCH_LIMIT) {
			return key;
		}
	}

	return -1;
}

/** The vibrato's offset, in 256ths of a semitone, at a folded phase of 0-255 (`main.asm:3333-3343`). */
function offsetAt(folded: number, depth: number): number {
	return depth < 0xf1 ? (folded * depth) >> 8 : folded * (depth & 0x0f);
}

/**
 * How far a vibrato's crest moves the pitch either way, in 256ths of a semitone.
 *
 * The folded phase peaks at `$FF`. Below `$F1` the depth multiplies it and the high byte is kept;
 * from `$F1` the low nybble multiplies it whole, so `$F2` is two semitones less 1/128 of one
 * (`main.asm:3327-3343`). The negative half subtracts the same (`main.asm:3345-3348`).
 */
export function vibratoSwing(depth: number): number {
	return offsetAt(0xff, depth);
}

/**
 * The furthest a vibrato moves the pitch up and down over its first `steps` steps, in 256ths of a
 * semitone.
 *
 * Each step adds the rate to the phase, and the phase is folded into a triangle whose top bit is
 * the sign (`main.asm:3321-3348`), so a short note or a slow rate may never reach the crest. Only
 * the phases a step lands on are counted: the driver also eases between them, and the pitch goes on
 * moving after the key-off, so this can fall short of what is heard and never exceeds it.
 */
export function vibratoReach(vibrato: Vibrato, steps: number): { up: number; down: number } {
	let up = 0;
	let down = 0;
	for (let step = 1; step <= Math.min(steps, 256); step++) {
		const phase = (step * vibrato.rate) & 0xff;
		const folded = phase & 0x40 ? ((phase << 2) & 0xff) ^ 0xff : (phase << 2) & 0xff;
		const offset = offsetAt(folded, vibrato.depth);
		if (phase & 0x80) {
			down = Math.max(down, offset);
		} else {
			up = Math.max(up, offset);
		}
	}

	return { up, down };
}
