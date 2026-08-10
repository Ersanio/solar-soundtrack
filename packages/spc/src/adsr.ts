/**
 * The DSP's volume envelope: what an instrument's ADSR, GAIN and tuning bytes do.
 *
 * A port of AddmusicK's own ADSR calculator, the `<script>` at
 * `AddmusicKreadme/readme_files/hex_command_reference.html:7-95`, so the readme is
 * the citable authority for every constant here. {@link CLOCKS} is the DSP's rate
 * table, read by both the envelope rates and the noise clock — see README.md for
 * why that dual use is the only check that can catch a transposed digit in it.
 */

import { DSP_RATE } from "./fir";

/**
 * The DSP's envelope rate table, in samples per step.
 *
 * Index 0 means "never" — a release rate of 0 holds the note forever, and a
 * noise clock of 0 is silence. `hex_command_reference.html:9-13`.
 */
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
 * the DSP for every attack from 0 to 14.
 *
 * **It is wrong for attack 15, and this follows the DSP instead.** bsnes tests
 * the *rate index* — `rate = (adsr0 & 0x0F) * 2 + 1; env += rate < 31 ? 0x20 :
 * 0x400` (`AddmusicKsrc/SPC_DSP.cpp:259-260`) — so attack 15, whose rate index
 * is 31, climbs in steps of `0x400` and is done in two samples rather than 64.
 * The readme's calculator compares the attack nibble to `0x1F` instead
 * (readme:64, :88), which nothing in a 4-bit field can equal, so its own fast
 * attack is drawn and timed as though it were slow. `adsrtest` pins the
 * divergence.
 */
export function attackSeconds(attack: number): number {
	const rate = (attack & 0x0f) * 2 + 1;
	const steps = rate < 31 ? Math.ceil((ENVELOPE_MAX + 1) / 0x20) : 2;
	return (CLOCKS[rate] * steps) / DSP_RATE;
}

/**
 * Seconds for the decay phase. `getDecayTime`, readme:67-70.
 *
 * Scaled by how far the envelope has to fall, so a sustain of 7 — already full
 * level — takes no time at all.
 */
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

/**
 * The envelope as a point list, for plotting.
 *
 * Stepped the way the DSP steps it (`AddmusicKsrc/SPC_DSP.cpp:246-306`) rather
 * than drawn from the three durations, which is what gives decay and the
 * sustain fall their curve: each step subtracts one and then a further
 * `env >> 8`, so the decline is exponential rather than straight.
 *
 * Phase boundaries are the DSP's own. Attack ends when the envelope saturates
 * at `0x7FF` (:301-305); decay ends when `env >> 8` reaches the sustain level
 * (:295), which is the same test as the readme's `env >= 0x100 * (sustain + 1)`.
 *
 * A sustain rate of 0 never advances, so the curve stops at the plateau instead
 * of running to silence — the readme guards this at :91, and a port that drops
 * the guard hangs the thread rather than drawing anything. Note that this is the
 * *sustain* fall, which is what AddmusicK's readme calls release; the DSP's
 * key-off ramp is a separate fixed slope (:237-242) that no instrument byte
 * controls.
 */
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

/**
 * The same, for a voice running on GAIN instead.
 *
 * `SPC_DSP.cpp:263-291`. A direct GAIN is a level and nothing else; the four
 * ramping modes climb or fall at a rate in the byte's low five bits, and mode 7
 * changes slope once it passes `0x600`, which is the "bent" in bent increase.
 *
 * Ramps start from the level the previous note left behind, which nothing here
 * can know, so they are drawn from silence for a rise and from full for a fall —
 * the shape is the point, not the starting point.
 */
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

/**
 * Split a GAIN byte.
 *
 * `%0vvvvvvv` holds a fixed level; the four `%1` forms ramp instead, at a rate
 * in the low five bits. The stock table uses `$B8` (an exponential decrease)
 * almost everywhere, and `$7F` where it wants full volume with no envelope at
 * all.
 */
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

/**
 * The instrument's pitch multiplier, `dd.ee` as one number.
 *
 * "dd and ee together are something like dd.ee; ee is the decimal/fractional
 * portion" — `syntax_reference.html:262`. So it is an 8.8 fixed-point multiplier
 * on the sample's playback rate, and the stock instruments run from `$02.$00` to
 * `$1E.$00`.
 */
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

/**
 * The noise generator's frequency for a clock of 0-31, in Hz.
 *
 * The `n` command's argument, and the low five bits of an `#instruments` sample
 * byte with the noise flag set. Clock 0 is silence.
 *
 * Reusing {@link CLOCKS} here is not a shortcut: `32000 / CLOCKS[n]` reproduces
 * the published SNES noise ladder (16, 21, 25, 31, 42 … 16000, 32000 Hz) for all
 * 32 clocks, which is what `adsrtest` checks the table against.
 */
export function noiseHz(clock: number): number {
	const period = CLOCKS[clock & 0x1f];
	return period === 0 ? 0 : DSP_RATE / period;
}

// ===========================================================================
// Going the other way
// ===========================================================================
//
// Everything below turns a number a musician chose back into the field that
// produces it, so the envelope tuner can be driven in seconds and percent
// rather than in rate indices.
//
// Every `nearest*` is an exhaustive search over its 8, 16 or 32 candidates
// using the forward function above — never a closed-form inverse. The tables
// are tiny, so it costs nothing, and it means the inverse cannot drift from the
// decoder or have to restate the attack-15 divergence that `attackSeconds`
// documents. `adsrtest` pins the round trips.

/**
 * Nearest in *log* space, because {@link CLOCKS} is roughly geometric.
 *
 * A linear metric makes the fast end of every ladder unreachable by dragging:
 * the gap from 1 ms to 2 ms is a factor of two and, in absolute terms, smaller
 * than the rounding on a single step at the slow end.
 */
function nearestBy(count: number, target: number, seconds: (index: number) => number, from = 0): number {
	let best = from;
	let error = Infinity;
	for (let index = from; index < count; index++) {
		const candidate = seconds(index);
		if (!Number.isFinite(candidate)) {
			continue;
		}

		// Both clamped away from zero: an instant phase and a 1-sample phase are
		// the same choice as far as a control is concerned.
		const distance = Math.abs(Math.log(Math.max(candidate, 1e-6)) - Math.log(Math.max(target, 1e-6)));
		if (distance < error) {
			error = distance;
			best = index;
		}
	}

	return best;
}

/** The attack rate whose duration is closest to `seconds`. 0-15. */
export function nearestAttack(seconds: number): number {
	return nearestBy(16, seconds, attackSeconds);
}

/**
 * The decay rate closest to `seconds` at this sustain level. 0-7.
 *
 * Sustain 7 makes every decay exactly 0 s ({@link decaySeconds}'s fall table
 * ends in 0), so there is nothing to choose between and rate 0 is returned.
 */
export function nearestDecay(seconds: number, sustain: number): number {
	if (sustain >= 7) {
		return 0;
	}

	return nearestBy(8, seconds, (decay) => decaySeconds(decay, sustain));
}

/** The sustain level closest to `level`, a fraction of full. 0-7. */
export function nearestSustain(level: number): number {
	let best = 0;
	let error = Infinity;
	for (let sustain = 0; sustain < 8; sustain++) {
		const distance = Math.abs(sustainLevel(sustain) - level);
		if (distance < error) {
			error = distance;
			best = sustain;
		}
	}

	return best;
}

/**
 * The release rate closest to `seconds` at this sustain level. 0-31.
 *
 * Rate 0 is "never", so it is reachable only by asking for it: searching from 1
 * keeps a finite target from landing on the one value that means the opposite.
 */
export function nearestRelease(seconds: number, sustain: number): number {
	if (!Number.isFinite(seconds)) {
		return 0;
	}

	return nearestBy(32, seconds, (release) => releaseSeconds(release, sustain), 1);
}

/** The noise clock closest to `hz`. 0-31; 0 is silence and is never chosen. */
export function nearestNoiseClock(hz: number): number {
	if (hz <= 0) {
		return 0;
	}

	return nearestBy(32, hz, noiseHz, 1);
}

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
