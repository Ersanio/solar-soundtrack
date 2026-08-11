/** The DSP's volume envelope: what an instrument's ADSR, GAIN and tuning bytes do. */

import { DSP_RATE } from "./fir";

/** The DSP's envelope rate table, in samples per step. 0 means "never" */
export const CLOCKS: readonly number[] = [
	0, 2048, 1536, 1280, 1024, 768, 640, 512, 384, 320, 256, 192, 160, 128, 96, 80, 64, 48, 40, 32, 24, 20, 16, 12, 10, 8,
	6, 5, 4, 3, 2, 1,
];

/** Peak envelope level. The DSP's envelope is 11 bits. */
export const ENVELOPE_MAX = 0x7ff;

export interface Envelope {
	/** ADSR1's top bit: false means the GAIN byte is in charge. */
	adsrEnabled: boolean;
	/** 0-15. */
	attack: number;
	/** 0-7. */
	decay: number;
	/** 0-7; the level decay falls to. */
	sustain: number;
	/** 0-31; 0 means the note never releases. */
	release: number;
}

/** Split ADSR1/ADSR2 into their fields. */
export function decodeAdsr(adsr1: number, adsr2: number): Envelope {
	return {
		adsrEnabled: (adsr1 & 0x80) !== 0,
		attack: adsr1 & 0x0f,
		decay: (adsr1 >> 4) & 0x07,
		sustain: (adsr2 >> 5) & 0x07,
		release: adsr2 & 0x1f,
	};
}

/**
 * Seconds for the attack phase.
 *
 * `getAttackTime` (readme:62-65) is `CLOCKS[a * 2 + 1] * 64 / 32000`, which is
 * the 64 steps of `0x20` it takes to climb an 11-bit envelope. That agrees with
 * the DSP for every attack from 0 to 14. Attack 15 is an exception and climbs
 * in steps of 0x400 instead; `adsrtest` pins the divergence.
 */
export function attackSeconds(attack: number): number {
	const rate = (attack & 0x0f) * 2 + 1;
	const steps = rate < 31 ? Math.ceil((ENVELOPE_MAX + 1) / 0x20) : 2;
	return (CLOCKS[rate] * steps) / DSP_RATE;
}

/** Seconds for the decay phase. `getDecayTime`, readme:67-70. */
export function decaySeconds(decay: number, sustain: number): number {
	const fall = [440, 312, 227, 163, 112, 69, 32, 0][sustain];
	return (CLOCKS[decay * 2 + 0x10] * fall) / DSP_RATE;
}

/** The level decay settles at, as a fraction of peak. `getSustainLevel`, readme:72. */
export function sustainLevel(sustain: number): number {
	return (sustain + 1) / 8;
}

/** Seconds to fall silent after key-off. `getReleaseTime`, readme:77-80. */
export function releaseSeconds(release: number, sustain: number): number {
	if (release === 0) {
		return Infinity;
	}

	const fall = [255, 383, 469, 533, 584, 626, 663, 695][sustain];
	return (CLOCKS[release] * fall) / DSP_RATE;
}

/** A point on the drawn envelope: seconds against 0-1 of full level. */
export interface EnvelopePoint {
	t: number;
	level: number;
}

/** The envelope as a point list, for plotting, based on BSNES' source */
export function envelopeAdsr(envelope: Envelope): EnvelopePoint[] {
	const { attack, decay, sustain, release } = envelope;
	const points: EnvelopePoint[] = [];
	let t = 0;
	let env = 0;

	const push = () => points.push({ t: t / DSP_RATE, level: env / ENVELOPE_MAX });
	push();

	// SPC_DSP.cpp:259-260 — the step is the rate index's, not the nibble's.
	const attackRate = (attack & 0x0f) * 2 + 1;
	const attackStep = attackRate < 31 ? 0x20 : 0x400;
	while (env < ENVELOPE_MAX) {
		t += CLOCKS[attackRate];
		env = Math.min(env + attackStep, ENVELOPE_MAX);
		push();
	}

	while (env >> 8 > sustain) {
		t += CLOCKS[decay * 2 + 0x10];
		env--;
		env -= env >> 8;
		push();
	}

	if (release !== 0) {
		while (env > 0) {
			t += CLOCKS[release];
			env--;
			env -= env >> 8;
			push();
		}
	}

	return points;
}

/** The same, for a voice running on GAIN instead. */
export function envelopeGain(gain: number): EnvelopePoint[] {
	const decoded = decodeGain(gain);
	if (decoded.mode === "direct") {
		const level = decoded.level ?? 0;
		return [
			{ t: 0, level },
			{ t: 1, level },
		];
	}

	const rate = decoded.rate ?? 0;
	const points: EnvelopePoint[] = [];
	let t = 0;
	let env = decoded.mode === "linearDecrease" || decoded.mode === "expDecrease" ? ENVELOPE_MAX : 0;

	const push = () => points.push({ t: t / DSP_RATE, level: env / ENVELOPE_MAX });
	push();

	// Rate 0 never advances the counter, so the level simply stands.
	if (rate === 0) {
		points.push({ t: 1, level: env / ENVELOPE_MAX });
		return points;
	}

	const done = () => env <= 0 || env >= ENVELOPE_MAX;
	// Bounded independently of the rules above, so a mode that cannot converge
	// still returns a curve rather than spinning.
	for (let i = 0; i < 0x1000 && !(i > 0 && done()); i++) {
		t += CLOCKS[rate];
		switch (decoded.mode) {
			case "linearDecrease":
				env -= 0x20;
				break;
			case "expDecrease":
				env--;
				env -= env >> 8;
				break;
			case "linearIncrease":
				env += 0x20;
				break;
			case "bentIncrease":
				env += env < 0x600 ? 0x20 : 0x8;
				break;
		}

		env = Math.min(Math.max(env, 0), ENVELOPE_MAX);
		push();
	}

	return points;
}

/** How a GAIN byte behaves when ADSR is switched off. */
export type GainMode = "direct" | "linearDecrease" | "expDecrease" | "linearIncrease" | "bentIncrease";

export interface Gain {
	mode: GainMode;
	/** Fixed level, 0-1. Only for `"direct"`. */
	level: number | null;
	/** Rate index into {@link CLOCKS}. `null` for `"direct"`. */
	rate: number | null;
}

/** Split a GAIN byte. */
export function decodeGain(gain: number): Gain {
	if ((gain & 0x80) === 0) {
		return { mode: "direct", level: (gain & 0x7f) / 0x7f, rate: null };
	}

	const rate = gain & 0x1f;
	const mode = (["linearDecrease", "expDecrease", "linearIncrease", "bentIncrease"] as const)[(gain >> 5) & 0x03];
	return { mode, level: null, rate };
}

/** A GAIN mode said in words. Shared so the two views cannot word it differently. */
export function gainModeName(mode: GainMode): string {
	switch (mode) {
		case "direct":
			return "fixed level";
		case "linearDecrease":
			return "linear decrease";
		case "expDecrease":
			return "exponential decrease";
		case "linearIncrease":
			return "linear increase";
		case "bentIncrease":
			return "bent increase";
	}
}

/** The instrument's pitch multiplier; Tuning and subtuning as one number. */
export function tuningMultiplier(tuning: number, subTuning: number): number {
	return tuning + subTuning / 256;
}

/** The same multiplier said in semitones, which is how a musician hears it. */
export function tuningSemitones(multiplier: number): number {
	if (multiplier <= 0) {
		return -Infinity;
	}

	return 12 * Math.log2(multiplier);
}

/** The noise generator's frequency for a clock of 0-31, in Hz. */
export function noiseHz(clock: number): number {
	const period = CLOCKS[clock & 0x1f];
	return period === 0 ? 0 : DSP_RATE / period;
}

// ===========================================================================
// Going the other way
// ===========================================================================
//
// The two envelope editors read a byte, show it as fields, and have to write
// the byte back. Everything below is the inverse of a decoder above, and the
// trip byte -> fields -> byte is exact for every byte each one accepts, which
// `adsrtest` asserts exhaustively. Only the other direction rounds: a level or
// a multiplier a musician chose need not be a whole 1/127 or 1/256.

/** ADSR1 and ADSR2 from the four fields. The inverse of {@link decodeAdsr}. */
export function encodeAdsr(envelope: Envelope): { adsr1: number; adsr2: number } {
	const adsr1 = (envelope.adsrEnabled ? 0x80 : 0) | ((envelope.decay & 0x07) << 4) | (envelope.attack & 0x0f);
	const adsr2 = ((envelope.sustain & 0x07) << 5) | (envelope.release & 0x1f);
	return { adsr1, adsr2 };
}

/** A GAIN byte from a decoded one. The inverse of {@link decodeGain}. */
export function encodeGain(gain: Gain): number {
	if (gain.mode === "direct") {
		return Math.round((gain.level ?? 0) * 0x7f) & 0x7f;
	}

	const mode = (["linearDecrease", "expDecrease", "linearIncrease", "bentIncrease"] as const).indexOf(gain.mode);
	return 0x80 | (mode << 5) | ((gain.rate ?? 0) & 0x1f);
}

/**
 * The two tuning bytes closest to a multiplier. The inverse of
 * {@link tuningMultiplier}, and exact for anything the pair can express.
 */
export function encodeTuning(multiplier: number): { tuning: number; subTuning: number } {
	const clamped = Math.min(255 + 255 / 256, Math.max(0, multiplier));
	const whole = Math.floor(clamped);
	const fraction = Math.round((clamped - whole) * 256);
	// A fraction that rounds up to a whole 256 carries, exactly as 0.999 → 1.0
	// would in decimal; without this, `$01.$100` is not a byte pair.
	return fraction === 256
		? { tuning: (whole + 1) & 0xff, subTuning: 0 }
		: { tuning: whole & 0xff, subTuning: fraction };
}
