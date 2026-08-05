/**
 * The envelope maths behind the instrument and `$ED` views.
 *
 * The anchor that matters most is {@link CLOCKS}. Every other function here is
 * defined *in terms of* that table, so nothing else could catch a transposed
 * digit in it — but the DSP uses the same table for the noise generator, and the
 * SNES noise frequencies are published. Reproducing that ladder from the table
 * an envelope reads is therefore a genuinely independent check, and it is the
 * first thing below.
 *
 * The second anchor is that two sources reconcile. AddmusicK's readme ships a
 * closed-form ADSR calculator (`hex_command_reference.html:7-95`) with two magic
 * tables in it; bsnes steps the envelope one sample at a time
 * (`AddmusicKsrc/SPC_DSP.cpp:246-306`). The magic tables turn out to be exactly
 * the step counts of the stepping, which is asserted here rather than assumed.
 *
 *   npm run adsrtest
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
	CLOCKS,
	ENVELOPE_MAX,
	attackSeconds,
	decaySeconds,
	decodeAdsr,
	decodeGain,
	encodeAdsr,
	encodeGain,
	encodeTuning,
	envelopeAdsr,
	envelopeGain,
	nearestAttack,
	nearestDecay,
	nearestNoiseClock,
	nearestRelease,
	nearestSustain,
	noiseHz,
	releaseSeconds,
	sustainLevel,
	tuningMultiplier,
	tuningSemitones,
} from "../src/spc/adsr";
import { type DriverManifest, analyzeDriver } from "../src/spc/driver";
import { readInstrumentTables } from "../src/spc/instruments";

import { check, summarise } from "./harness";

console.log("\nCLOCKS, checked against the published noise ladder");
{
	// The SNES noise frequencies for NCK $00-$1F, as documented for the DSP's FLG
	// register. Independent of everything else here.
	const LADDER = [
		0, 16, 21, 25, 31, 42, 50, 63, 83, 100, 125, 167, 200, 250, 333, 400, 500, 667, 800, 1000, 1333, 1600, 2000, 2667,
		3200, 4000, 5333, 6400, 8000, 10667, 16000, 32000,
	];

	check("the table has 32 entries", CLOCKS.length === 32);
	let ladder = true;
	for (let n = 0; n < 32; n++) {
		if (Math.round(noiseHz(n)) !== LADDER[n]) {
			ladder = false;
			check(`clock ${n}`, false, `${Math.round(noiseHz(n))} Hz, expected ${LADDER[n]}`);
		}
	}

	check("every clock reproduces its published frequency", ladder);
	check("clock 0 is silence, not a division by zero", noiseHz(0) === 0);
	check("the fastest clock is the sample rate", noiseHz(0x1f) === 32000);
}

console.log("\nthe readme's magic tables are bsnes's step counts");
{
	// readme:68 and :78. These are the numbers the closed forms scale by, and
	// they are asserted here to be the number of DSP steps the fall really takes.
	const DECAY_STEPS = [440, 312, 227, 163, 112, 69, 32, 0];
	const RELEASE_STEPS = [255, 383, 469, 533, 584, 626, 663, 695];

	let decay = true;
	let release = true;
	for (let sustain = 0; sustain < 8; sustain++) {
		// SPC_DSP.cpp:251-252 — decay runs until `env >> 8` reaches the sustain level.
		let env = ENVELOPE_MAX;
		let steps = 0;
		while (env >> 8 > sustain) {
			env--;
			env -= env >> 8;
			steps++;
		}

		if (steps !== DECAY_STEPS[sustain]) {
			decay = false;
			check(`decay to sustain ${sustain}`, false, `${steps} steps, readme says ${DECAY_STEPS[sustain]}`);
		}

		// And on from the sustain level to silence, at the sustain rate.
		env = (sustain + 1) * 0x100 - 1;
		steps = 0;
		while (env > 0) {
			env--;
			env -= env >> 8;
			steps++;
		}

		if (steps !== RELEASE_STEPS[sustain]) {
			release = false;
			check(`release from sustain ${sustain}`, false, `${steps}, readme says ${RELEASE_STEPS[sustain]}`);
		}
	}

	check("every decay step count matches", decay);
	check("every release step count matches", release);
}

console.log("\nphase durations");
{
	// The readme's own closed form, which agrees with the DSP for attack 0-14.
	const readmeAttack = (a: number) => (CLOCKS[a * 2 + 1] * 64) / 32000;
	let slow = true;
	for (let a = 0; a <= 14; a++) {
		if (Math.abs(attackSeconds(a) - readmeAttack(a)) > 1e-12) {
			slow = false;
		}
	}

	check("attack 0-14 matches the readme exactly", slow);

	// The divergence, pinned. The readme compares the attack *nibble* to 0x1F
	// (readme:64), which a 4-bit field cannot equal, so its own fast attack is
	// timed as though it were slow. bsnes tests the rate index instead
	// (SPC_DSP.cpp:259-260), and rate 31 climbs in steps of 0x400.
	check(
		"attack 15 follows the DSP, not the readme",
		attackSeconds(15) < readmeAttack(15),
		`${attackSeconds(15)} vs the readme's ${readmeAttack(15)}`,
	);
	check("attack 15 is two samples", Math.abs(attackSeconds(15) - 2 / 32000) < 1e-12);

	check("a sustain of 7 needs no decay at all", decaySeconds(0, 7) === 0);
	check("a release rate of 0 never ends", releaseSeconds(0, 3) === Infinity);
	let levels = true;
	for (let s = 0; s < 8; s++) {
		if (sustainLevel(s) !== (s + 1) / 8) {
			levels = false;
		}
	}

	check("sustain level is (s+1)/8", levels);
}

console.log("\nthe stepped envelope");
{
	const envelope = decodeAdsr(0xfe, 0x6a);
	check("$FE $6A decodes to attack 14, decay 7", envelope.attack === 14 && envelope.decay === 7);
	check("and sustain 3, release 10", envelope.sustain === 3 && envelope.release === 10);
	check("its top bit means ADSR is on", envelope.adsrEnabled);
	check("a byte below $80 means GAIN instead", !decodeAdsr(0x0e, 0x6a).adsrEnabled);

	const points = envelopeAdsr(envelope);
	check("the curve starts at silence", points[0].level === 0);
	check(
		"it reaches full level",
		points.some((p) => p.level >= 1),
	);
	check("it ends at silence", points[points.length - 1].level === 0);
	check(
		"time never goes backwards",
		points.every((p, i) => i === 0 || p.t >= points[i - 1].t),
	);
	check(
		"the attack ends where attackSeconds says",
		Math.abs((points.find((p) => p.level >= 1)?.t ?? -1) - attackSeconds(envelope.attack)) < 1e-12,
	);

	// The guard that matters: a rate of 0 holds forever, and a port that steps
	// anyway never returns.
	const held = envelopeAdsr(decodeAdsr(0xfe, 0x60));
	check("a release rate of 0 stops at the plateau", held[held.length - 1].level > 0);
	check("and terminates", held.length > 1 && held.length < 10000);
}

console.log("\nGAIN");
{
	check("a byte under $80 is a fixed level", decodeGain(0x7f).mode === "direct");
	check("$7F is full volume", decodeGain(0x7f).level === 1);
	check("$B8 is a mode, not a level", decodeGain(0xb8).mode !== "direct");
	check("%101 is exponential decrease", decodeGain(0xb8).mode === "expDecrease");
	check("%100 is linear decrease", decodeGain(0x80).mode === "linearDecrease");
	check("%110 is linear increase", decodeGain(0xc0).mode === "linearIncrease");
	check("%111 is bent increase", decodeGain(0xe0).mode === "bentIncrease");
	check("the rate is the low five bits", decodeGain(0xb8).rate === 0x18);

	const flat = envelopeGain(0x7f);
	check(
		"a direct GAIN draws a level",
		flat.every((p) => p.level === 1),
	);
	const rise = envelopeGain(0xc4);
	check("a rising ramp starts at silence", rise[0].level === 0);
	check("and gets somewhere", rise[rise.length - 1].level > rise[0].level);
	const fall = envelopeGain(0x84);
	check("a falling ramp starts at full", fall[0].level === 1);
	check("and reaches silence", fall[fall.length - 1].level === 0);
	check("a rate of 0 still returns a curve", envelopeGain(0x80).length >= 2);
}

console.log("\ntuning");
{
	check("$03.$00 is a plain multiplier", tuningMultiplier(3, 0) === 3);
	check("the sub-byte is /256", tuningMultiplier(1, 0x80) === 1.5);
	check("doubling the rate is twelve semitones", Math.abs(tuningSemitones(2) - 12) < 1e-9);
	check("unity is no shift", tuningSemitones(1) === 0);
}

console.log("\nthe stock table decodes");
{
	const here = dirname(fileURLToPath(import.meta.url));
	const driverDir = join(here, "..", "public", "driver");
	const manifest = JSON.parse(readFileSync(join(driverDir, "manifest.json"), "utf8")) as DriverManifest;
	// Header-stripped, as `DriverStore` passes it — see the note in instrtest.
	const analysis = analyzeDriver(new Uint8Array(readFileSync(join(driverDir, "main.bin"))), manifest, false);
	const tables = readInstrumentTables(analysis.programData, analysis.programPos);

	// Which stock entries run on GAIN rather than ADSR, enumerated. A slip in the
	// ADSR1 column shows up here and nowhere else.
	const gainDriven = tables.melodic
		.map((entry, n) => ({ n, gain: (entry.adsr1 & 0x80) === 0 }))
		.filter((e) => e.gain)
		.map((e) => e.n);
	check("only @12 and @19 are GAIN-driven", gainDriven.join() === "12,19", gainDriven.join());

	const percGain = tables.percussion
		.map((entry, k) => ({ k, gain: (entry.adsr1 & 0x80) === 0 }))
		.filter((e) => e.gain)
		.map((e) => e.k);
	// Drums 6 and 7 belong here because their ADSR1 is $7E — two short of the $80
	// that would switch ADSR on. Easy to read as "ADSR" at a glance, which is
	// exactly why this is enumerated rather than eyeballed.
	check("as are drums 0, 1, 6, 7 and 8", percGain.join() === "0,1,6,7,8", percGain.join());

	check(
		"every stock entry produces a finite envelope",
		[...tables.melodic, ...tables.percussion].every((entry) => {
			const envelope = decodeAdsr(entry.adsr1, entry.adsr2);
			const points = envelope.adsrEnabled ? envelopeAdsr(envelope) : envelopeGain(entry.gain);
			return points.length > 1 && points.every((p) => Number.isFinite(p.t));
		}),
	);
	check(
		"and a sane tuning",
		[...tables.melodic, ...tables.percussion].every((entry) => tuningMultiplier(entry.tuning, entry.subTuning) > 0),
	);
}

console.log("\nthe inverses round-trip");
{
	// The envelope tuner is driven in seconds and percent, so every control has
	// to turn a number back into the field that produces it. A round trip is a
	// real assertion rather than a tautology — it catches a transposed nibble
	// shift, a swapped field and a tie broken the wrong way — and it introduces
	// no new magic numbers, which is the property this whole harness is built on.
	check(
		"every attack rate is the nearest to its own duration",
		Array.from({ length: 16 }, (_, a) => a).every((a) => nearestAttack(attackSeconds(a)) === a),
	);

	// Sustain 7 makes every decay exactly 0 s, so there is nothing to choose
	// between; that degenerate case is asserted rather than skipped silently.
	check(
		"every decay rate is the nearest to its own duration",
		Array.from({ length: 7 }, (_, s) => s).every((s) =>
			Array.from({ length: 8 }, (_, d) => d).every((d) => nearestDecay(decaySeconds(d, s), s) === d),
		),
	);
	check(
		"at sustain 7 every decay is instant, and 0 is returned",
		Array.from({ length: 8 }, (_, d) => decaySeconds(d, 7)).every((t) => t === 0) && nearestDecay(0, 7) === 0,
	);

	check(
		"every sustain level is the nearest to its own fraction",
		Array.from({ length: 8 }, (_, s) => s).every((s) => nearestSustain(sustainLevel(s)) === s),
	);

	check(
		"every release rate is the nearest to its own duration",
		Array.from({ length: 8 }, (_, s) => s).every((s) =>
			Array.from({ length: 31 }, (_, i) => i + 1).every((r) => nearestRelease(releaseSeconds(r, s), s) === r),
		),
	);
	// Rate 0 means "never", which is the opposite of "very slow" — a finite
	// target must never land on it, and an infinite one must always.
	check(
		"a held-forever release is the only way to reach rate 0",
		Array.from({ length: 8 }, (_, s) => s).every((s) => nearestRelease(Infinity, s) === 0) &&
			Array.from({ length: 8 }, (_, s) => s).every((s) => nearestRelease(1e6, s) !== 0),
	);

	check(
		"every noise clock is the nearest to its own frequency",
		Array.from({ length: 31 }, (_, i) => i + 1).every((n) => nearestNoiseClock(noiseHz(n)) === n),
	);
	check("silence is the only way to reach clock 0", nearestNoiseClock(0) === 0 && nearestNoiseClock(1) !== 0);

	// All 65 536 pairs, because a swapped field is invisible on any one of them.
	// Every bit of both bytes belongs to a field — attack 0-3, decay 4-6, enable
	// 7; release 0-4, sustain 5-7 — so the trip is exact, with nothing masked.
	let adsrOk = true;
	for (let adsr1 = 0; adsr1 < 256 && adsrOk; adsr1++) {
		for (let adsr2 = 0; adsr2 < 256; adsr2++) {
			const encoded = encodeAdsr(decodeAdsr(adsr1, adsr2));
			if (encoded.adsr1 !== adsr1 || encoded.adsr2 !== adsr2) {
				adsrOk = false;
				break;
			}
		}
	}

	check("decodeAdsr and encodeAdsr round-trip over every byte pair", adsrOk);

	check(
		"decodeGain and encodeGain round-trip over every byte",
		Array.from({ length: 256 }, (_, g) => g).every((g) => encodeGain(decodeGain(g)) === g),
	);

	let tuningOk = true;
	for (let tuning = 0; tuning < 256 && tuningOk; tuning++) {
		for (let sub = 0; sub < 256; sub++) {
			const encoded = encodeTuning(tuningMultiplier(tuning, sub));
			if (encoded.tuning !== tuning || encoded.subTuning !== sub) {
				tuningOk = false;
				break;
			}
		}
	}

	check("tuningMultiplier and encodeTuning round-trip over every byte pair", tuningOk);

	// The one non-round-trip fact worth pinning: a target between two rungs picks
	// the nearer in *log* space. CLOCKS is geometric, so a linear metric would
	// make the fast end of every ladder unreachable by dragging a control.
	const fast = attackSeconds(15);
	const slower = attackSeconds(14);
	check(
		"a target between two attack rungs picks the nearer in log space",
		nearestAttack(Math.sqrt(fast * slower) * 1.01) === 14 && nearestAttack(Math.sqrt(fast * slower) * 0.99) === 15,
		`${fast} .. ${slower}`,
	);
}

summarise();
