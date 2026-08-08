/**
 * The echo FIR filter's maths.
 *
 * The anchors are the two filters in the SNES Development Manual (§7.2.2.11,
 * "Filter Setting Example 1" and "2"), which AddmusicK ships verbatim as
 * `EchoFilter0` and `EchoFilter1` at `main.asm:3507`. If the flat one is not
 * flat and the low-pass one does not roll off, everything built on top is
 * wrong, and it will be wrong as a picture rather than as an exception.
 *
 *   npm run firtest
 */

import {
	DSP_RATE,
	FIR_AUTHORITY_HZ,
	FIR_PRESETS,
	FIR_TAPS,
	clampTap,
	describeFir,
	designTone,
	echoStability,
	firCurve,
	firDcGain,
	firHeadroom,
	firMagnitude,
	firNyquistGain,
	firPeakGain,
	firRepeatCurves,
	fitToTarget,
	matchPreset,
	toHexByte,
	toSigned,
} from "@amk/spc/fir";

import { builtInTaps, echoHazards, feedbackBefore } from "@amk/tokens/echo-hazards";
import { tokenize } from "@amk/tokens";

import { check, summarise } from "./harness";

const dB = (gain: number) => 20 * Math.log10(Math.max(gain, 1e-9));

/** EchoFilter1, main.asm:3509. */
const FLAT = [0x7f, 0, 0, 0, 0, 0, 0, 0];
/** EchoFilter0, main.asm:3507 — $FF $08 $17 $24 $24 $17 $08 $FF. */
const CLASSIC = [-1, 0x08, 0x17, 0x24, 0x24, 0x17, 0x08, -1];

console.log("\nsigned bytes are read the way the DSP reads them");
{
	check("$FF is −1", toSigned(0xff) === -1);
	check("$7F is 127", toSigned(0x7f) === 127);
	check("$80 is −128", toSigned(0x80) === -128);
	check("$00 is 0", toSigned(0x00) === 0);
	check("−1 writes back as FF", toHexByte(-1) === "FF");
	check("127 writes back as 7F", toHexByte(127) === "7F");
	check("clamping holds the register range", clampTap(500) === 127 && clampTap(-500) === -128);
}

console.log("\nthe manual's flat filter is flat");
{
	// $7F is 127/128, so it is a hair under unity rather than exactly at it.
	const unity = 127 / 128;
	for (const hz of [0, 100, 1000, 4000, 8000, 16000]) {
		check(`${hz} Hz is unity`, Math.abs(firMagnitude(FLAT, hz) - unity) < 1e-9, `${firMagnitude(FLAT, hz)}`);
	}

	check("its DC gain is 127/128", Math.abs(firDcGain(FLAT) - unity) < 1e-9);
	check("it is described as flat", describeFir(FLAT).shape === "flat", describeFir(FLAT).shape);
	check("its tilt is nil", Math.abs(describeFir(FLAT).tiltDb) < 0.1);
}

console.log("\nthe manual's low-pass filter rolls off");
{
	// −1 + 8 + 23 + 36 + 36 + 23 + 8 − 1 = 132.
	check("its coefficients sum to 132", CLASSIC.reduce((a, b) => a + b, 0) === 132);
	check("so its DC gain is 132/128", Math.abs(firDcGain(CLASSIC) - 132 / 128) < 1e-9, String(firDcGain(CLASSIC)));
	check("which is about +0.27 dB", Math.abs(dB(firDcGain(CLASSIC)) - 0.267) < 0.02);

	const nyquist = firNyquistGain(CLASSIC);
	check("Nyquist is deeply attenuated", dB(nyquist) < -30, `${dB(nyquist).toFixed(1)} dB`);
	check("it is described as a low-pass", describeFir(CLASSIC).shape === "low-pass", describeFir(CLASSIC).shape);
	check("its tilt is negative", describeFir(CLASSIC).tiltDb < -10, `${describeFir(CLASSIC).tiltDb.toFixed(1)} dB`);

	const corner = describeFir(CLASSIC).cornerHz;
	check("it has a corner frequency", corner !== null);
	check(
		"which is in the audible midrange",
		corner !== null && corner > 2000 && corner < 9000,
		`${corner?.toFixed(0)} Hz`,
	);

	// The transition falls steadily; the stopband beyond it does not, and should
	// not be expected to. Eight taps leave real ripple up there — this filter
	// reaches −38 dB at 9 kHz and comes back to −31 dB at 10 kHz — so the useful
	// claim is that the transition is monotone and the stopband stays down.
	const transition = firCurve(CLASSIC, { fromHz: 2000, toHz: 8000, points: 30 });
	check(
		"the transition falls monotonically",
		transition.every((v, i) => i === 0 || v <= transition[i - 1] + 1e-9),
	);
	const stopband = firCurve(CLASSIC, { fromHz: 8000, toHz: 15500, points: 40 });
	check(
		"and the stopband stays at least 25 dB down",
		stopband.every((v) => dB(v) < -25),
		`worst ${Math.max(...stopband.map(dB)).toFixed(1)} dB`,
	);
}

console.log("\ngain readings");
{
	check("peak gain of the flat filter is unity", Math.abs(firPeakGain(FLAT) - 127 / 128) < 1e-6);
	check("peak gain of the low-pass is its DC gain", Math.abs(firPeakGain(CLASSIC) - 132 / 128) < 1e-3);
	check("an all-zero filter silences the echo", firPeakGain([0, 0, 0, 0, 0, 0, 0, 0]) === 0);
}

console.log("\nagainst bsnes's SPC_DSP.cpp, the emulator's own echo stage");
{
	// bsnes SPC_DSP.cpp:621,629 — a buffer sample is halved on the way in and the
	// product shifted down six, so a tap is worth c/128 and unity is Σc = 128.
	// A single $80 tap is therefore exactly −1, and $7F exactly 127/128.
	check("Σc = 128 is unity", Math.abs(firDcGain([0x40, 0x40, 0, 0, 0, 0, 0, 0]) - 1) < 1e-12);
	check("a lone $80 tap inverts at unity", Math.abs(firDcGain([-128, 0, 0, 0, 0, 0, 0, 0]) + 1) < 1e-12);

	// bsnes SPC_DSP.cpp:621 pairs coefficient i with history entry i+1, and :629/:635
	// make entry 8 the newest — so the impulse response runs C7…C0, the reverse
	// of register order. Magnitude is blind to that, which is the only reason
	// the plot can be drawn without settling it.
	const reversed = [...CLASSIC].reverse();
	const forward = firCurve(CLASSIC, { fromHz: 100, toHz: 16000, points: 50 });
	const backward = firCurve(reversed, { fromHz: 100, toHz: 16000, points: 50 });
	check(
		"a reversed filter has the same magnitude",
		forward.every((v, i) => Math.abs(v - backward[i]) < 1e-9),
	);

	// An asymmetric filter, so this is not passing by accident on a palindrome.
	const asymmetric = [0x50, 0x20, -0x10, 0x08, 0, 0, 0, 0];
	check(
		"and that holds for an asymmetric filter too",
		firCurve(asymmetric, { fromHz: 100, toHz: 16000, points: 50 }).every(
			(v, i) => Math.abs(v - firCurve([...asymmetric].reverse(), { fromHz: 100, toHz: 16000, points: 50 })[i]) < 1e-9,
		),
	);
	check(
		"CLASSIC is a palindrome, so register order is unobservable in it",
		CLASSIC.every((c, i) => c === CLASSIC[CLASSIC.length - 1 - i]),
	);
}

console.log("\nintermediate overflow — bsnes SPC_DSP.cpp:668-678");
{
	// Taps 0-6 are summed and truncated to int16 (which wraps), and only then
	// is tap 7 added and the total clamped. So the budget is over seven taps,
	// not eight, and it is 128.
	check("the flat filter has ample headroom", !firHeadroom(FLAT).mayWrap);
	check("its sum is 127", firHeadroom(FLAT).sum === 127);

	// The eighth tap is outside the budget, being added after the truncation.
	check("tap 7 does not count against it", firHeadroom([0, 0, 0, 0, 0, 0, 0, 127]).sum === 0);

	// AddmusicK's own EchoFilter0 exceeds the bound: 1+8+23+36+36+23+8 = 135.
	// Recorded rather than treated as a fault — it is Super Mario World's echo,
	// and it is fine on real music.
	check("SMW's own filter grazes past it", firHeadroom(CLASSIC).sum === 135, String(firHeadroom(CLASSIC).sum));
	check("and is flagged as able to wrap", firHeadroom(CLASSIC).mayWrap);

	check("a filter of all $7F is far past it", firHeadroom(new Array(8).fill(127)).fraction > 6);

	// Nothing designed here should be anywhere near the bound.
	for (const preset of FIR_PRESETS) {
		if (preset.name === "Classic") {
			continue;
		}

		check(
			`${preset.name} stays inside the DSP's arithmetic`,
			!firHeadroom(preset.taps).mayWrap,
			`sum ${firHeadroom(preset.taps).sum}`,
		);
	}
}

console.log("\nthe echo loop");
{
	// The filter is inside the feedback path, so a repeat is scaled by
	// EFB/128 × H each time round.
	const gentle = echoStability(CLASSIC, 0x40);
	check("half feedback with the stock filter is stable", !gentle.runaway);
	check("its loop gain is about 0.52", Math.abs(gentle.loopGain - 0.5156) < 0.01, String(gentle.loopGain));
	check("and it marks no runaway band", gentle.runawayBand === null);

	// $7F feedback against a filter with gain above unity compounds.
	const hot = echoStability([0x7f, 0x30, 0x20, 0, 0, 0, 0, 0], 0x7f);
	check("high feedback with a hot filter runs away", hot.runaway, String(hot.loopGain));
	check("and the offending band is reported", hot.runawayBand !== null);
	check(
		"the band lies inside the spectrum",
		hot.runawayBand !== null && hot.runawayBand.fromHz >= 0 && hot.runawayBand.toHz <= DSP_RATE / 2,
	);

	check("zero feedback is always stable", !echoStability(CLASSIC, 0x00).runaway);
	// Feedback is signed; a negative value inverts phase but has the same size.
	check("negative feedback counts by its size", echoStability(CLASSIC, 0xc0).loopGain > 0.4);
}

console.log("\nrepeat curves darken pass by pass");
{
	const options = { fromHz: 100, toHz: 16000, points: 40 };
	const repeats = firRepeatCurves(CLASSIC, 4, options);
	check("one curve per repeat", repeats.length === 4);

	// At 8 kHz the stock filter is well down, so each pass must be quieter.
	const index = 30;
	check(
		"each repeat is quieter than the last in the treble",
		repeats.every((curve, k) => k === 0 || curve[index] < repeats[k - 1][index]),
		repeats.map((c) => c[index].toFixed(3)).join(" > "),
	);
	check(
		"the first repeat is the plain response",
		repeats[0].every((v, i) => Math.abs(v - firCurve(CLASSIC, options)[i]) < 1e-12),
	);
}

console.log("\ndesigning from a tone control");
{
	const flat = designTone({ tone: 0 });
	check("tone 0 leaves the echo alone", describeFir(flat).shape === "flat", describeFir(flat).shape);

	const dark = designTone({ tone: -1 });
	check("tone −1 is a low-pass", describeFir(dark).shape === "low-pass", describeFir(dark).shape);
	check("and it is darker than warm", describeFir(dark).tiltDb < describeFir(designTone({ tone: -0.4 })).tiltDb);

	const bright = designTone({ tone: 1 });
	check("tone +1 is a high-pass", describeFir(bright).shape === "high-pass", describeFir(bright).shape);
	check("tilt runs the other way", describeFir(bright).tiltDb > 0);

	check("strength 0 is flat whatever the tone", describeFir(designTone({ tone: -1, strength: 0 })).shape === "flat");
	check(
		"tilt grows with strength",
		Math.abs(describeFir(designTone({ tone: -1, strength: 1 })).tiltDb) >
			Math.abs(describeFir(designTone({ tone: -1, strength: 0.3 })).tiltDb),
	);

	// Every design path must produce something the DSP can actually hold.
	for (const tone of [-1, -0.5, 0, 0.5, 1]) {
		const taps = designTone({ tone });
		check(
			`tone ${tone} yields eight in-range bytes`,
			taps.length === FIR_TAPS && taps.every((t) => Number.isInteger(t) && t >= -128 && t <= 127),
			taps.join(", "),
		);
	}
}

console.log("\nfitting a drawn curve");
{
	// The fit cannot be exact with eight taps, but it must follow the shape.
	const target = [
		{ hz: 100, gain: 1 },
		{ hz: 2000, gain: 1 },
		{ hz: 6000, gain: 0.2 },
		{ hz: 16000, gain: 0.05 },
	];
	const fitted = fitToTarget(target);
	check("the fit is eight in-range bytes", fitted.length === FIR_TAPS && fitted.every((t) => t >= -128 && t <= 127));
	check("and it comes out a low-pass", describeFir(fitted).shape === "low-pass", describeFir(fitted).shape);
	check("it passes the low end", Math.abs(firMagnitude(fitted, 1000)) > 0.7, String(firMagnitude(fitted, 1000)));
	check("and stops the top end", firMagnitude(fitted, 14000) < 0.35, String(firMagnitude(fitted, 14000)));

	// A flat target should come back flat.
	const flat = fitToTarget([
		{ hz: 100, gain: 1 },
		{ hz: 16000, gain: 1 },
	]);
	check("a flat target fits flat", describeFir(flat).shape === "flat", describeFir(flat).shape);
	check("with roughly unity gain", Math.abs(firDcGain(flat) - 1) < 0.15, String(firDcGain(flat)));

	check("no points at all is not a crash", fitToTarget([]).length === FIR_TAPS);
}

console.log("\nquantisation earns its keep");
{
	// The ±1 refinement pass must never make the fit worse than plain rounding.
	const target = (hz: number) => (hz < 5000 ? 1 : 0.1);
	const points = [
		{ hz: 100, gain: 1 },
		{ hz: 4999, gain: 1 },
		{ hz: 5000, gain: 0.1 },
		{ hz: 16000, gain: 0.1 },
	];
	const fitted = fitToTarget(points);
	const error = (taps: number[]) => {
		let sum = 0;
		for (let hz = 200; hz <= 16000; hz += 200) {
			sum += (firMagnitude(taps, hz) - target(hz)) ** 2;
		}

		return sum;
	};

	check("the fitted filter beats doing nothing", error(fitted) < error(FLAT), `${error(fitted)} vs ${error(FLAT)}`);
}

console.log("\npresets");
{
	check("there are presets", FIR_PRESETS.length >= 6);
	for (const preset of FIR_PRESETS) {
		check(
			`${preset.name} is eight in-range signed bytes`,
			preset.taps.length === FIR_TAPS && preset.taps.every((t) => Number.isInteger(t) && t >= -128 && t <= 127),
			preset.taps.join(", "),
		);
		check(`${preset.name} says what it does`, preset.note.length > 10);
	}

	// The two that must be exact, because they are AddmusicK's own.
	const flat = FIR_PRESETS.find((p) => p.name === "Flat");
	check("Flat is EchoFilter1 verbatim", JSON.stringify(flat?.taps) === JSON.stringify(FLAT), flat?.taps.join(", "));
	const classic = FIR_PRESETS.find((p) => p.name === "Classic");
	check(
		"Classic is EchoFilter0 verbatim",
		JSON.stringify(classic?.taps) === JSON.stringify(CLASSIC),
		classic?.taps.join(", "),
	);

	check("a preset recognises itself", matchPreset(CLASSIC)?.name === "Classic");
	check("an unrelated filter matches nothing", matchPreset([1, 2, 3, 4, 5, 6, 7, 8]) === null);

	// No preset should quietly ship an echo that blows up at ordinary feedback.
	for (const preset of FIR_PRESETS) {
		check(
			`${preset.name} is stable at $60 feedback`,
			!echoStability(preset.taps, 0x60).runaway,
			`loop gain ${echoStability(preset.taps, 0x60).loopGain.toFixed(3)}`,
		);
	}
}

console.log("\nthe authority limit is honest");
{
	// The claim the UI makes by shading below FIR_AUTHORITY_HZ is about
	// resolution, not about level: eight taps at 32 kHz cannot put a *feature*
	// down there. So ask for one and show it does not arrive. Two targets that
	// are identical except for a deep notch at 500 Hz must fit to near enough
	// the same filter — the notch is simply not expressible.
	const plain = fitToTarget([
		{ hz: 100, gain: 1 },
		{ hz: 16000, gain: 1 },
	]);
	const notched = fitToTarget([
		{ hz: 100, gain: 1 },
		{ hz: 400, gain: 1 },
		{ hz: 500, gain: 0.05 },
		{ hz: 600, gain: 1 },
		{ hz: 16000, gain: 1 },
	]);
	const notchDepth = dB(firMagnitude(notched, 500)) - dB(firMagnitude(plain, 500));
	check(
		"a notch asked for at 500 Hz barely appears",
		Math.abs(notchDepth) < 3,
		`${notchDepth.toFixed(1)} dB of a requested −26 dB`,
	);

	// The same notch high up, where the filter does have resolution, lands.
	const highNotch = fitToTarget([
		{ hz: 100, gain: 1 },
		{ hz: 7000, gain: 1 },
		{ hz: 11000, gain: 0.05 },
		{ hz: 15000, gain: 1 },
	]);
	check(
		"the same notch at 11 kHz does appear",
		dB(firMagnitude(highNotch, 11000)) - dB(firMagnitude(plain, 11000)) < -8,
		`${(dB(firMagnitude(highNotch, 11000)) - dB(firMagnitude(plain, 11000))).toFixed(1)} dB`,
	);

	check("the limit is where it is documented", FIR_AUTHORITY_HZ === 2000);
}

console.log("\ncurve sampling");
{
	const curve = firCurve(CLASSIC, { fromHz: 20, toHz: 16000, points: 100 });
	check("a curve has the points asked for", curve.length === 100);
	check(
		"every point is a finite gain",
		curve.every((v) => Number.isFinite(v) && v >= 0),
	);
	check("two points is the floor, not a crash", firCurve(CLASSIC, { fromHz: 20, toHz: 16000, points: 1 }).length === 2);
	check("a linear axis works too", firCurve(CLASSIC, { fromHz: 0, toHz: 16000, points: 10, log: false }).length === 10);
}

// ---------------------------------------------------------------------------
// The diagnostic built on all of the above.
//
// `echoStability` only ever saw the one filter under the caret. `echoHazards`
// walks the whole document, which means it has to decide which feedback each
// filter is running at and which commands are allowed to see each other — and
// those decisions, not the maths, are what can quietly regress.
// ---------------------------------------------------------------------------

/** Taps whose gain exceeds unity; the same ones the loop-gain check above uses. */
const HOT = "$F5 $7F $30 $20 $00 $00 $00 $00 $00";

function hazards(source: string) {
	return echoHazards(tokenize(source).commands);
}

console.log("\nrunaway echo diagnostics");
{
	const custom = hazards(`#amk 2\n\n#0 $F1 $08 $7F $00 ${HOT}\nc4\n`);
	check(
		"a hot $F5 under high feedback is reported",
		custom.some((d) => d.code === "AMK0500"),
	);
	check(
		"and it is severe rather than an error",
		custom.every((d) => d.severity === "severe"),
	);

	// The case the FIR designer could never have shown: no $F5 anywhere, so
	// nothing to put a caret on. Filter 0 peaks at 132/128, which $7F feedback
	// pushes past unity on its own.
	const builtIn = hazards("#amk 2\n\n#0 $F1 $08 $7F $00\nc4\n");
	check("$F1's own filter 0 at full feedback is reported", builtIn.length === 1 && builtIn[0].code === "AMK0501");
	check("filter 1 is flat and cannot run away", hazards("#amk 2\n\n#0 $F1 $08 $7F $01\nc4\n").length === 0);

	check("no feedback means no runaway", hazards(`#amk 2\n\n#0 $F1 $08 $00 $00 ${HOT}\nc4\n`).length === 0);
	check("a $F5 before any $F1 is judged at zero feedback", hazards(`#amk 2\n\n#0 ${HOT}\nc4\n`).length === 0);
	check("a stable filter says nothing", hazards("#amk 2\n\n#0 $F1 $08 $40 $00\nc4\n").length === 0);
	check("a song with no echo at all says nothing", hazards("#amk 2\n\n#0 o4 c4 d4 e4\n").length === 0);
}

console.log("\nthe diagnostic points at the command that causes it");
{
	const source = `#amk 2\n\n#0 $F1 $08 $7F $00 ${HOT}\nc4\n`;
	const fir = hazards(source).find((d) => d.code === "AMK0500");
	check(
		"the span covers the whole $F5 run",
		fir !== undefined && source.slice(fir.span.start, fir.span.end) === HOT,
		fir && JSON.stringify(source.slice(fir.span.start, fir.span.end)),
	);
	check("and carries the line it is on", fir?.span.line === 3);
	check(
		"the message names the feedback and stays dry about the consequences",
		fir?.message.includes("$7F") === true && !/ear|speaker|damage/i.test(fir.message),
		fir?.message,
	);
}

console.log("\nmultiple filters are judged one at a time");
{
	// AddmusicK emits every $F5 verbatim (`Music.cpp:63`, `:1770`), so both of
	// these run — the first under $7F feedback, the second under $20.
	const both = hazards(`#amk 2\n\n#0 $F1 $08 $7F $00 ${HOT} $F1 $08 $20 $01 ${HOT}\nc4\n`);
	check(
		"only the one whose feedback makes it diverge is reported",
		both.filter((d) => d.code === "AMK0500").length === 1,
		`${both.length} diagnostics: ${both.map((d) => d.code).join(", ")}`,
	);

	// A later $F1 reloads a built-in table and throws the coefficients away, but
	// they were live until it ran.
	const overridden = hazards(`#amk 2\n\n#0 $F1 $08 $7F $00 ${HOT} $F1 $08 $00 $01\nc4\n`);
	check(
		"a $F5 a later $F1 discards is still reported",
		overridden.some((d) => d.code === "AMK0500"),
	);

	const twice = hazards(`#amk 2\n\n#0 $F1 $08 $7F $00 ${HOT} ${HOT}\nc4\n`);
	check("two runaway filters give two diagnostics, not one", twice.filter((d) => d.code === "AMK0500").length === 2);
}

console.log("\nchannels are read separately");
{
	// Source order is execution order within a channel and nothing between them,
	// so these two must not pair up — the same rule `fir-override.ts` enforces.
	// It under-reports: the DSP has one echo unit and they really do interact.
	// Reaching across channels would be guesswork, and the FIR designer sitting
	// beside this would disagree with it.
	const split = hazards(`#amk 2\n\n#0 $F1 $08 $7F $01\nc4\n\n#1 ${HOT}\nc4\n`);
	check("a $F1 in one channel does not arm a $F5 in another", split.length === 0);

	const together = hazards(`#amk 2\n\n#0 $F1 $08 $7F $01 ${HOT}\nc4\n`);
	check("the same two in one channel do pair up", together.length === 1);
}

console.log("\nhalf-written commands are left alone");
{
	// Three bytes into typing eight, the filter is not yet what it will be — and
	// the flat table it is replacing keeps the $F1 above quiet, so a diagnostic
	// here could only have come from the half-written run.
	check("an incomplete $F5 is not judged", hazards("#amk 2\n\n#0 $F1 $08 $7F $01 $F5 $7F $30\nc4\n").length === 0);
	// One argument short of a $F1 that would be reported, which is also the case
	// that would read past the end of `args` if it were judged anyway.
	check("an incomplete $F1 is not judged", hazards(`#amk 2\n\n#0 $F1 $08 $7F\nc4\n`).length === 0);
}

console.log("\nthe pieces the inspectors share");
{
	const source = `#amk 2\n\n#0 $F1 $08 $60 $00 ${HOT}\nc4\n`;
	const commands = tokenize(source).commands;
	const fir = commands.find((c) => c.vcmd === 0xf5);
	check("feedbackBefore finds the $F1 ahead of a $F5", fir !== undefined && feedbackBefore(fir, commands) === 0x60);
	check(
		"and answers zero when there is none",
		feedbackBefore(
			tokenize(`#amk 2\n\n#0 ${HOT}\nc4\n`).commands[0],
			tokenize(`#amk 2\n\n#0 ${HOT}\nc4\n`).commands,
		) === 0,
	);

	check("builtInTaps 0 is the SMW low-pass", JSON.stringify(builtInTaps(0)) === JSON.stringify(CLASSIC));
	check("builtInTaps 1 is flat", JSON.stringify(builtInTaps(1)) === JSON.stringify(FLAT));
	// $02 and up read past the end of the table; the parser reports that as
	// AMK0158/AMK0212 and nothing here should invent an answer for it.
	check("an out-of-range table ID has no answer", builtInTaps(2) === null);
	check("nor does a runaway verdict", hazards("#amk 2\n\n#0 $F1 $08 $7F $02\nc4\n").length === 0);
}

summarise();
