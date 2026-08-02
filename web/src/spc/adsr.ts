/**
 * The DSP's volume envelope: what an instrument's ADSR, GAIN and tuning bytes do.
 *
 * Three of the six bytes in an instrument entry describe an envelope, and the
 * language gives you no help with any of them — `$FE $6A $B8` is the most common
 * setting in the stock table and says nothing at all out loud.
 *
 * ```
 *   ADSR1  %eddd aaaa   e: use ADSR at all; ddd: decay rate; aaaa: attack rate
 *   ADSR2  %sss rrrrr   sss: sustain level; rrrrr: sustain/release rate
 *   GAIN                used when ADSR1's top bit is clear
 * ```
 *
 * The bit layout is AddmusicK's own
 * (`AddmusicKreadme/readme_files/hex_command_reference.html:446-456`, and the
 * `#instruments` byte list at `syntax_reference.html:258-263`: "to use ADSR,
 * make sure that it is >= $80. Otherwise GAIN is used"). Note that the GAIN byte
 * is always *written* when an instrument is initialised — the `$FA $FE` hot-patch
 * bit only reorders the ADSR and GAIN writes (`hex_command_reference.html:344`) —
 * so it is inert while ADSR1's top bit is set, not absent.
 *
 * ## Where the numbers come from
 *
 * The timings are a port of AddmusicK's own ADSR calculator, the `<script>` at
 * `hex_command_reference.html:7-95`, rather than analysis this project invented.
 * That makes the readme the citable authority for every constant here, which is
 * the same footing `fir.ts` stands on with bsnes.
 *
 * {@link CLOCKS} is the DSP's rate table, and it earns its keep twice: the
 * envelope rates index it, and so does the noise clock — `n$1F` is
 * `32000 / CLOCKS[0x1F]` = 32 kHz, `n$01` is 15.6 Hz. Reproducing the published
 * SNES noise ladder from the same table an envelope reads is the one check that
 * can catch a transposed digit in it, since every other function here is defined
 * *in terms of* the table. `adsrtest` does exactly that.
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
 * (readme:64, :89), which nothing in a 4-bit field can equal, so its own fast
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
 * of running to silence — the readme guards this at :92, and a port that drops
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
 * in the low five bits. The stock table uses `$B8` (a fixed level) almost
 * everywhere, and `$7F` where it wants full volume with no envelope at all.
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
