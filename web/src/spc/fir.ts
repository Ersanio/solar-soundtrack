/**
 * The DSP's echo FIR filter: what eight signed bytes actually do to a sound.
 *
 * The SNES runs its echo through an 8-tap FIR whose coefficients live in DSP
 * registers `$0F, $1F, … $7F`, one filter shared by both channels. The SNES
 * Development Manual §7.2.2.11 describes each as "eight bits including a sign
 * bit"; the DSP multiplies by them and shifts down by seven, so a coefficient
 * counts as `c / 128` and `$7F` is very nearly unity.
 *
 * AddmusicK sets them with `$F5 $c0 … $c7` and validates nothing whatsoever —
 * there is no `$F5` code in `Music.cpp` at all, and its readme documents the
 * arguments as "Coefficient 1 … Coefficient 8" with no ranges and no defaults.
 * So everything here is analysis this project is adding, not a port.
 *
 * Two facts drive most of what follows:
 *
 *   - The filter sits *inside* the echo's feedback loop. Whatever comes back
 *     round has been filtered again, so repeat *k* of the echo has gain
 *     `|H|^k`. A gentle low-pass therefore darkens the tail as it decays, which
 *     is what makes it sound like a room, and a filter with gain above unity
 *     compounds instead of decaying.
 *   - Eight taps at 32 kHz span 219 µs. The filter simply has no authority over
 *     anything much below a couple of kHz, whatever the numbers say.
 *
 * Everything here has been checked against the echo stage of bsnes's DSP core
 * (`AddmusicKsrc/SPC_DSP.cpp:610-700`, from the bsnes source), which settles
 * three things the manual leaves to inference:
 *
 *   - **The scale really is 1/128.** `echo_read` stores the buffer sample
 *     halved (`s >> 1`, :629) and `CALC_FIR` shifts the product down six more
 *     (:621), so a tap contributes `sample × c / 128` and unity is `Σc = 128`.
 *     `$7F` alone is 127/128, a hair under.
 *   - **C7 multiplies the newest sample, C0 the oldest.** `CALC_FIR(i)` pairs
 *     coefficient *i* with history entry *i + 1* (:621) out of a window whose
 *     last entry is the sample just read (:629, :635). So the impulse response
 *     in time order is C7…C0, the reverse of register order. It does not matter
 *     here — reversing a response conjugates its spectrum and leaves the
 *     magnitude alone — but it is now a fact rather than an assumption, and
 *     `firtest` pins it.
 *   - **The feedback path is exactly `EFB/128 × H`.** What goes back into the
 *     buffer is the voice sends plus `(echo_in × EFB) >> 7` (:697), and
 *     `echo_in` is the FIR's output. So a repeat is scaled by `EFB/128 · H(f)`
 *     each time round, which is what {@link echoStability} tests against unity
 *     and what {@link firRepeatCurves} raises to successive powers.
 *
 * The same source shows where a filter clips, which is not where you would
 * guess — see {@link firHeadroom}.
 */

/** Coefficients per filter, and DSP registers `$0F, $1F, … $7F`. */
export const FIR_TAPS = 8;

/** The DSP's sample rate. Nyquist, and so the top of every plot, is half this. */
export const DSP_RATE = 32000;

/** What the DSP divides each coefficient by: `c / 128`. */
const TAP_UNIT = 128;

/**
 * Below this an 8-tap filter at 32 kHz can do essentially nothing.
 *
 * The eight taps span `7 / 32000` seconds, so the longest period the filter can
 * shape half a cycle of is about 437 µs — a little over 2 kHz. The UI shades
 * everything under this rather than implying control it does not have.
 */
export const FIR_AUTHORITY_HZ = 2000;

/** Eight signed bytes, C0 first. */
export type FirTaps = readonly number[];

/** Clamps to the signed byte range the DSP registers actually hold. */
export function clampTap(value: number): number {
	return Math.max(-128, Math.min(127, Math.round(value)));
}

/** Reads a coefficient as the DSP does, so `$FF` is −1 rather than 255. */
export function toSigned(byte: number): number {
	const masked = byte & 0xff;
	return masked >= 0x80 ? masked - 0x100 : masked;
}

/** Renders a coefficient the way `$F5` wants it written. */
export function toHexByte(tap: number): string {
	return (tap & 0xff).toString(16).toUpperCase().padStart(2, "0");
}

/**
 * `|H(f)|` — the gain the filter applies at one frequency.
 *
 * `H(f) = Σ (c_n / 128) · e^(−j2πfn/32000)`, the textbook DFT of the impulse
 * response, evaluated directly because eight taps is far too few for an FFT to
 * be worth the machinery.
 */
export function firMagnitude(taps: FirTaps, hz: number): number {
	const omega = (-2 * Math.PI * hz) / DSP_RATE;
	let real = 0;
	let imaginary = 0;
	for (let n = 0; n < taps.length; n++) {
		const c = taps[n] / TAP_UNIT;
		real += c * Math.cos(omega * n);
		imaginary += c * Math.sin(omega * n);
	}

	return Math.hypot(real, imaginary);
}

export interface CurveOptions {
	fromHz: number;
	toHz: number;
	points: number;
	/** Sample the axis logarithmically, which is how hearing is spaced. */
	log?: boolean;
}

/** The frequencies a curve of these options is sampled at. */
export function firCurveFrequencies(options: CurveOptions): number[] {
	const { fromHz, toHz, points, log = true } = options;
	const count = Math.max(2, points);
	const out: number[] = [];
	// A logarithmic axis cannot start at zero, so it starts at `fromHz` and the
	// caller is expected to pass something audible.
	const lowLog = Math.log(Math.max(fromHz, 1));
	const highLog = Math.log(Math.max(toHz, fromHz + 1));
	for (let i = 0; i < count; i++) {
		const t = i / (count - 1);
		out.push(log ? Math.exp(lowLog + (highLog - lowLog) * t) : fromHz + (toHz - fromHz) * t);
	}

	return out;
}

/** `|H(f)|` sampled across a range, for plotting. */
export function firCurve(taps: FirTaps, options: CurveOptions): number[] {
	return firCurveFrequencies(options).map((hz) => firMagnitude(taps, hz));
}

/**
 * Gain at DC — simply the coefficients summed.
 *
 * The manual's low-pass example sums to 132, so it lifts steady tones by a
 * couple of percent; its flat example sums to 127 and leaves them alone.
 */
export function firDcGain(taps: FirTaps): number {
	let sum = 0;
	for (const tap of taps) {
		sum += tap;
	}

	return sum / TAP_UNIT;
}

/** Gain at Nyquist, where alternate taps cancel. */
export function firNyquistGain(taps: FirTaps): number {
	return firMagnitude(taps, DSP_RATE / 2);
}

/**
 * The largest gain anywhere in the band.
 *
 * Sampled rather than solved: the true maximum of an 8-tap response needs the
 * roots of a degree-7 polynomial, and a fine sweep is both simpler and accurate
 * enough for deciding whether an echo will run away.
 */
export function firPeakGain(taps: FirTaps): number {
	let peak = 0;
	const steps = 512;
	for (let i = 0; i <= steps; i++) {
		const magnitude = firMagnitude(taps, (DSP_RATE / 2) * (i / steps));
		if (magnitude > peak) {
			peak = magnitude;
		}
	}

	return peak;
}

// ===========================================================================
// Describing a filter in words
// ===========================================================================

export type FirShape = "flat" | "low-pass" | "high-pass" | "band-pass" | "notch" | "custom";

export interface FirDescription {
	shape: FirShape;
	/** Where the response first falls 3 dB from its peak, if it does. */
	cornerHz: number | null;
	/** Treble minus bass, in dB. Negative is darker than the source. */
	tiltDb: number;
	/** Gain at DC, as a plain multiplier. */
	dcGain: number;
	peakGain: number;
}

const dB = (gain: number): number => 20 * Math.log10(Math.max(gain, 1e-6));

/**
 * Top of the band used to describe a filter, rather than Nyquist itself.
 *
 * A symmetric filter whose taps sum to zero across alternate positions has an
 * exact null at Nyquist — AddmusicK's own `EchoFilter0` is one — and measuring
 * tilt against a null reports −120 dB, which is arithmetically true and useless
 * to read. Three quarters of the way up is past everything musical and clear of
 * that artefact.
 */
const DESCRIBE_TOP_HZ = (DSP_RATE / 2) * 0.75;

/**
 * A plain-English reading of what the filter does.
 *
 * Deliberately coarse. The point is to turn eight numbers into "dark" or
 * "bright" for someone who did not come here to do signal processing, so the
 * thresholds are chosen to be legible rather than precise.
 */
export function describeFir(taps: FirTaps): FirDescription {
	const dcGain = firDcGain(taps);
	const peakGain = firPeakGain(taps);

	// Sampled where the filter actually has authority. Below that everything
	// looks flat and would drag every measurement towards "flat".
	const frequencies = firCurveFrequencies({ fromHz: FIR_AUTHORITY_HZ, toHz: DESCRIBE_TOP_HZ, points: 64 });
	const response = frequencies.map((hz) => firMagnitude(taps, hz));

	const low = dB(Math.abs(dcGain));
	const high = dB(response[response.length - 1]);
	const tiltDb = high - low;

	const peak = Math.max(...response, Math.abs(dcGain));
	const trough = Math.min(...response, Math.abs(dcGain));
	const rangeDb = dB(peak) - dB(trough);

	let shape: FirShape;
	if (rangeDb < 1.5) {
		shape = "flat";
	} else if (tiltDb < -3) {
		shape = "low-pass";
	} else if (tiltDb > 3) {
		shape = "high-pass";
	} else {
		// Neither end stands out, so the interesting part is in the middle: a
		// bump is a band-pass, a dip is a notch.
		const middle = response[Math.floor(response.length / 2)];
		const ends = Math.max(Math.abs(dcGain), response[response.length - 1]);
		shape = middle > ends ? "band-pass" : middle < ends ? "notch" : "custom";
	}

	return { shape, cornerHz: cornerOf(frequencies, response, peak), tiltDb, dcGain, peakGain };
}

/**
 * Where the response first crosses 3 dB below its peak, in either direction.
 *
 * Both directions because a high-pass has a corner too: its response starts
 * below the threshold and rises through it, and only looking for a falling
 * crossing reports "no corner" for exactly the filters someone is most likely
 * to be dialling in by ear.
 */
function cornerOf(frequencies: number[], response: number[], peak: number): number | null {
	const target = peak * Math.SQRT1_2;
	for (let i = 1; i < response.length; i++) {
		const before = response[i - 1];
		const after = response[i];
		if ((before > target && after <= target) || (before < target && after >= target)) {
			// Interpolated, so the number moves smoothly as a slider is dragged
			// rather than jumping between sample points.
			const t = (before - target) / (before - after);
			return frequencies[i - 1] + (frequencies[i] - frequencies[i - 1]) * t;
		}
	}

	return null;
}

// ===========================================================================
// The echo loop
// ===========================================================================

export interface EchoStability {
	/** `|EFB/128| × peak filter gain`. At or above 1 the echo compounds. */
	loopGain: number;
	runaway: boolean;
	/** Frequencies where the loop gain reaches unity, for marking on a plot. */
	runawayBand: { fromHz: number; toHz: number } | null;
}

/**
 * Whether this filter and this feedback make an echo that decays or one that
 * builds until it clips.
 *
 * The echo's output is fed back through the same filter, so a repeat is scaled
 * by `EFB/128 · H(f)` each time round. Below one the tail dies away; at or
 * above one it grows without limit at that frequency, which is the single most
 * common way a hand-written `$F5` ruins a song. Neither AddmusicK nor the
 * community's FIRcon warns about it.
 */
export function echoStability(taps: FirTaps, feedbackByte: number): EchoStability {
	const feedback = Math.abs(toSigned(feedbackByte)) / TAP_UNIT;
	const loopGain = feedback * firPeakGain(taps);

	let fromHz: number | null = null;
	let toHz = 0;
	const steps = 256;
	for (let i = 0; i <= steps; i++) {
		const hz = (DSP_RATE / 2) * (i / steps);
		if (feedback * firMagnitude(taps, hz) >= 1) {
			fromHz ??= hz;
			toHz = hz;
		}
	}

	return {
		loopGain,
		runaway: loopGain >= 1,
		runawayBand: fromHz === null ? null : { fromHz, toHz },
	};
}

export interface FirHeadroom {
	/** `Σ|c₀…c₆|`. At or below 128 the intermediate sum cannot overflow. */
	sum: number;
	/** How much of the safe budget is used, as a fraction. */
	fraction: number;
	/** The intermediate sum can wrap on a loud enough echo signal. */
	mayWrap: boolean;
}

/**
 * Whether the filter can overflow the DSP's own arithmetic.
 *
 * The last tap is treated differently from the rest, and the difference is
 * audible. bsnes's `SPC_DSP.cpp:668-678` sums taps 0 to 6, truncates that
 * running total to 16 bits — `l = (int16_t) l`, which *wraps* rather than
 * saturating — and only then adds tap 7 and clamps. So a filter whose first
 * seven coefficients are large enough turns a loud echo into a crackle, as the
 * sum wraps from positive to negative, rather than into the soft clipping you
 * would expect.
 *
 * A buffer sample is halved before the taps see it, so the largest magnitude
 * one tap contributes is `16384 × |c| / 64 = 256|c|`. Seven of them stay inside
 * a signed 16-bit total exactly when `Σ|c₀…c₆| ≤ 128`.
 *
 * This is a warning, not an error, and the reason is instructive: AddmusicK's
 * own `EchoFilter0` — Super Mario World's echo, straight from the SNES manual —
 * sums to 135 and so exceeds it. The bound is reached only when the echo buffer
 * is near full scale and the taps line up in phase, which for a gentle low-pass
 * on real music does not happen. It is worth surfacing for filters that go well
 * past it, and worth not shouting about for filters that only graze it.
 */
export function firHeadroom(taps: FirTaps): FirHeadroom {
	let sum = 0;
	for (let n = 0; n < Math.min(taps.length, FIR_TAPS - 1); n++) {
		sum += Math.abs(taps[n]);
	}

	return { sum, fraction: sum / TAP_UNIT, mayWrap: sum > TAP_UNIT };
}

/**
 * Gain curves for successive echo repeats — `|H|`, `|H|²`, `|H|³`, …
 *
 * Plotting these is what makes a filter legible: it shows the tail getting
 * darker pass by pass, which is the thing you can hear but cannot read off
 * eight bytes.
 */
export function firRepeatCurves(taps: FirTaps, repeats: number, options: CurveOptions): number[][] {
	const first = firCurve(taps, options);
	const out: number[][] = [];
	for (let k = 1; k <= repeats; k++) {
		out.push(first.map((magnitude) => magnitude ** k));
	}

	return out;
}

// ===========================================================================
// Designing a filter
// ===========================================================================

/**
 * Quantises a float impulse response to eight signed bytes.
 *
 * Rounding alone is close but not best: with only eight coefficients of 128
 * steps each, the rounding error is a real fraction of the answer. So rounding
 * is followed by a short coordinate descent — try each tap ±1, keep anything
 * that lowers the error — which reliably recovers a few tenths of a dB.
 */
function quantise(ideal: number[], error: (taps: number[]) => number): number[] {
	const taps = ideal.map((value) => clampTap(value * TAP_UNIT));

	// Nothing designed here should be able to wrap the DSP's own intermediate
	// sum, so the budget in {@link firHeadroom} is a hard constraint rather than
	// something to notice afterwards. Rounding routinely pushes a filter a step
	// or two past it, so trim the largest coefficient until it fits — largest
	// first because a unit off the biggest tap is the smallest relative change,
	// and one step at a time because scaling and re-rounding can land back over.
	while (firHeadroom(taps).mayWrap) {
		let widest = 0;
		for (let i = 1; i < FIR_TAPS - 1; i++) {
			if (Math.abs(taps[i]) > Math.abs(taps[widest])) {
				widest = i;
			}
		}

		if (taps[widest] === 0) {
			break;
		}

		taps[widest] -= Math.sign(taps[widest]);
	}

	let best = error(taps);

	for (let pass = 0; pass < 8; pass++) {
		let improved = false;
		for (let i = 0; i < taps.length; i++) {
			for (const delta of [-1, 1]) {
				const candidate = clampTap(taps[i] + delta);
				if (candidate === taps[i]) {
					continue;
				}

				const previous = taps[i];
				taps[i] = candidate;
				const score = firHeadroom(taps).mayWrap ? Infinity : error(taps);
				if (score < best) {
					best = score;
					improved = true;
				} else {
					taps[i] = previous;
				}
			}
		}

		if (!improved) {
			break;
		}
	}

	return taps;
}

/** Squared error against a target magnitude, weighted towards the audible. */
function magnitudeError(target: (hz: number) => number): (taps: number[]) => number {
	const frequencies = firCurveFrequencies({ fromHz: 100, toHz: DSP_RATE / 2, points: 96 });
	return (taps) => {
		let sum = 0;
		for (const hz of frequencies) {
			const difference = firMagnitude(taps, hz) - target(hz);
			sum += difference * difference;
		}

		return sum;
	};
}

/**
 * The zero-phase impulse response whose spectrum is `target`.
 *
 * An inverse DFT of a real, even spectrum, which comes out real and even, taken
 * as eight taps centred on the middle of the window. This is what "fit the
 * curve I drew" means: eight taps cannot follow an arbitrary shape, and this is
 * as close as they get.
 *
 * Deliberately *not* windowed. A window is the usual answer to the ripple that
 * truncation leaves behind, but truncating the Fourier series is already the
 * least-squares-optimal linear-phase approximation, and least squares is
 * exactly what the refinement pass below then minimises. With only eight taps
 * to spend, a window throws away more resolution than the ripple costs.
 */
function impulseFor(target: (hz: number) => number): number[] {
	const bins = 256;
	// A whole number of samples, not the midpoint of the window. Centring
	// between two taps makes the ideal response a half-sample delay, which no
	// short FIR can render — a flat target would come back as a ringing spread
	// of taps rather than the single impulse it obviously ought to be.
	const centre = FIR_TAPS / 2 - 1;
	const ideal: number[] = [];

	for (let n = 0; n < FIR_TAPS; n++) {
		const offset = n - centre;
		let sum = 0;
		for (let k = 0; k <= bins; k++) {
			const hz = (DSP_RATE / 2) * (k / bins);
			// Trapezoidal weighting: the DC and Nyquist bins are half-width.
			const weight = k === 0 || k === bins ? 0.5 : 1;
			sum += weight * target(hz) * Math.cos((2 * Math.PI * hz * offset) / DSP_RATE);
		}

		// h(τ) = (2/fs)·∫₀^(fs/2) H(f)·cos(2πfτ) df, and the sample spacing
		// (fs/2)/bins cancels the 2/fs, leaving the mean of the summed terms.
		ideal.push(sum / bins);
	}

	return rescale(ideal, target);
}

/**
 * Scales an impulse response to sit as close to the target level as it can.
 *
 * Truncation loses a little gain, and quantising to 128ths loses a little more.
 * Since scaling the taps scales the response by the same factor, the best
 * scalar has a closed form — the least-squares projection of the target onto
 * the achievable response — which is worth taking before rounding rather than
 * leaving the ±1 pass to claw it back one step at a time.
 */
function rescale(ideal: number[], target: (hz: number) => number): number[] {
	let numerator = 0;
	let denominator = 0;
	for (const hz of firCurveFrequencies({ fromHz: 100, toHz: DSP_RATE / 2, points: 96 })) {
		const achieved = firMagnitude(
			ideal.map((v) => v * TAP_UNIT),
			hz,
		);
		numerator += achieved * target(hz);
		denominator += achieved * achieved;
	}

	if (denominator === 0) {
		return ideal;
	}

	return ideal.map((v) => v * (numerator / denominator));
}

/**
 * Fits eight taps to a drawn magnitude curve.
 *
 * `points` are the handles the user dragged, as gain multipliers against
 * frequency. Between them the target is interpolated linearly in frequency and
 * beyond them it is held flat, which is exactly how the plot strokes it — the
 * straight segments the user sees are the segments that get fitted.
 *
 * That correspondence is the whole reason this is linear rather than log. The
 * two must agree, and the plot's axis is linear because an 8-tap response is a
 * degree-7 polynomial in `cos(ω)` — its features are evenly spaced in
 * frequency, not in octaves.
 */
export function fitToTarget(points: { hz: number; gain: number }[]): number[] {
	if (points.length === 0) {
		return [...FLAT_TAPS];
	}

	const sorted = [...points].sort((a, b) => a.hz - b.hz);

	const target = (hz: number): number => {
		if (hz <= sorted[0].hz) {
			return sorted[0].gain;
		}

		const last = sorted[sorted.length - 1];
		if (hz >= last.hz) {
			return last.gain;
		}

		for (let i = 1; i < sorted.length; i++) {
			if (hz <= sorted[i].hz) {
				const a = sorted[i - 1];
				const b = sorted[i];
				const t = (hz - a.hz) / (b.hz - a.hz);
				return a.gain + (b.gain - a.gain) * t;
			}
		}

		return last.gain;
	};

	return quantise(impulseFor(target), magnitudeError(target));
}

export interface ToneOptions {
	/**
	 * −1 is as dark as eight taps manage, 0 leaves the echo alone, +1 is as
	 * bright. The one control most people actually want.
	 */
	tone: number;
	/** How far the tone setting is taken, 0 to 1. */
	strength?: number;
}

/**
 * Designs a filter from a tone control rather than from coefficients.
 *
 * A gentle tilt across the band, expressed as a target curve and then fitted.
 * Gentle rather than sharp because eight taps cannot do sharp, and pretending
 * otherwise buys ripple that sounds worse than the smooth version.
 *
 * The tilt only ever *cuts*. Boosting one end would be the more obvious way to
 * write this, but the filter sits inside the echo's feedback loop, where any
 * gain above unity compounds every pass until it clips. Attenuating the end you
 * do not want keeps the peak at unity and the echo well-behaved at any feedback
 * the driver can be given.
 */
export function designTone({ tone, strength = 1 }: ToneOptions): number[] {
	const amount = Math.max(-1, Math.min(1, tone)) * Math.max(0, Math.min(1, strength));
	if (amount === 0) {
		return [...FLAT_TAPS];
	}

	// 18 dB across the band at full deflection: unmistakable, and still within
	// what eight taps can render smoothly.
	const depthDb = 18 * Math.abs(amount);
	const nyquist = DSP_RATE / 2;
	// The tilt spans only the range the filter can actually shape. Starting it
	// lower looks reasonable on a log axis — 100 Hz to 2 kHz is more than half
	// the visual width — but it asks for detail below {@link FIR_AUTHORITY_HZ}
	// that eight taps cannot render, and what comes back is a smeared version
	// of the request rather than the request.
	const lowLog = Math.log(FIR_AUTHORITY_HZ);
	const spanLog = Math.log(nyquist) - lowLog;

	const target = (hz: number): number => {
		// Linear in log-frequency, which is how a tilt reads by ear. Unlike
		// {@link fitToTarget} this one is not tracing a line the user drew, so it
		// is free to follow hearing rather than the plot's linear axis — it comes
		// out as a curve there, which is correct and not worth straightening.
		const t = Math.min(1, Math.max(0, (Math.log(Math.max(hz, FIR_AUTHORITY_HZ)) - lowLog) / spanLog));
		// Dark cuts the top, bright cuts the bottom; either way the peak is 1.
		const cut = amount < 0 ? t : 1 - t;
		return 10 ** ((-depthDb * cut) / 20);
	};

	return quantise(impulseFor(target), magnitudeError(target));
}

// ===========================================================================
// Presets
// ===========================================================================

/** `EchoFilter1`, main.asm:3509 — unity on the first tap and nothing else. */
const FLAT_TAPS: readonly number[] = [0x7f, 0, 0, 0, 0, 0, 0, 0];

export interface FirPreset {
	name: string;
	/** What it does, in the terms a music porter would use. */
	note: string;
	taps: number[];
}

/**
 * Filters worth starting from.
 *
 * The first two are AddmusicK's own, copied byte for byte from `main.asm:3507`
 * — they are what `$F1`'s third argument selects between, and both come from
 * the SNES Development Manual's worked examples (§7.2.2.11, "Filter Setting
 * Example 1" and "2"). The rest are designed here, and are named for what they
 * sound like rather than for what they are.
 */
export const FIR_PRESETS: readonly FirPreset[] = [
	{
		name: "Flat",
		note: "Echo comes back unchanged. AddmusicK's filter 1.",
		taps: [...FLAT_TAPS],
	},
	{
		name: "Classic",
		note: "Super Mario World's echo. AddmusicK's filter 0.",
		// EchoFilter0, main.asm:3507 — $FF and $08 read as −1 and 8.
		taps: [-1, 0x08, 0x17, 0x24, 0x24, 0x17, 0x08, -1],
	},
	{
		name: "Warm",
		note: "Takes the edge off without muffling anything.",
		taps: designTone({ tone: -0.45 }),
	},
	{
		name: "Dark",
		note: "Echo sits well behind the music. Good for big spaces.",
		taps: designTone({ tone: -1 }),
	},
	{
		name: "Bright",
		note: "Echo keeps its top end and stays present.",
		taps: designTone({ tone: 0.6 }),
	},
	{
		name: "Telephone",
		note: "Midrange only — thin and distant.",
		taps: fitToTarget([
			{ hz: 100, gain: 0.15 },
			{ hz: 900, gain: 0.95 },
			{ hz: 3000, gain: 1 },
			{ hz: 6000, gain: 0.3 },
			{ hz: 16000, gain: 0.1 },
		]),
	},
	{
		name: "Boomy",
		note: "Keeps the low end, drops everything above it.",
		taps: fitToTarget([
			{ hz: 100, gain: 1 },
			{ hz: 1500, gain: 0.9 },
			{ hz: 5000, gain: 0.25 },
			{ hz: 16000, gain: 0.05 },
		]),
	},
];

/** The preset these taps match exactly, if any. */
export function matchPreset(taps: FirTaps): FirPreset | null {
	return FIR_PRESETS.find((preset) => preset.taps.every((tap, i) => tap === taps[i])) ?? null;
}
