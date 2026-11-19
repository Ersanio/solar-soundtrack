/**
 * `charttest`: the Song Inspector's arithmetic — the fixed frequency axis and the band levels read
 * off it, BS.1770 loudness at the DSP's rate, the scope's trigger and gain, and the timeline's
 * columns, which keep a column's loudest bucket.
 */

import "../localize";
import { PowerSpectrum } from "../../web/src/app/state/analysis/fft";
import { LoudnessMeter } from "../../web/src/app/state/analysis/loudness";
import {
	CORRELATION_HOLD,
	CORRELATION_SMOOTHING,
	correlation,
	heardGain,
	stepCorrelation,
	triggerFrame,
} from "../../web/src/app/state/analysis/scope";
import {
	BLACKMAN,
	FLOOR_DB,
	HANN,
	HIGH_HZ,
	LOW_HZ,
	THIRD_OCTAVES,
	bandLevels,
	logRows,
} from "../../web/src/app/state/analysis/spectrum-bands";
import {
	TIMELINE_WIDTH,
	areaPath,
	columnMax,
	spectrogramColumns,
} from "../../web/src/app/editor/views/song-inspector/timeline-paths";
import { spectrumBars } from "../../web/src/app/editor/spectrum/spectrum-bars";
import { check, section } from "../harness";

const RATE = 32000;

const sine = (hz: number, amplitude: number, frames: number, rate = RATE) =>
	Float32Array.from({ length: frames }, (_, n) => amplitude * Math.sin((2 * Math.PI * hz * n) / rate));

section("one frequency axis for every song, 31.5 Hz to the DSP's 16 kHz");
{
	check("28 third-octave bands", THIRD_OCTAVES.length === 28, `${THIRD_OCTAVES.length}`);
	check("from 31.5 Hz to 16 kHz", THIRD_OCTAVES[0].centre === 31.5 && THIRD_OCTAVES.at(-1)!.centre === 16000);
	check(
		"each band ends where the next begins",
		THIRD_OCTAVES.every((band, n) => n === 0 || Math.abs(band.low - THIRD_OCTAVES[n - 1].high) < 1e-9),
	);
	check(
		"the axis's edges are the outer bands' edges",
		Math.abs(THIRD_OCTAVES[0].low - LOW_HZ) < 1e-9 && Math.abs(THIRD_OCTAVES.at(-1)!.high - HIGH_HZ) < 1e-9,
	);
	check("no band reaches past what a 32 kHz DSP makes", THIRD_OCTAVES.at(-1)!.high < 18000);
	const rows = logRows(12);
	check(
		"the spectrogram's rows cover the same range, twelve to the octave",
		Math.abs(rows[0].low - LOW_HZ) < 1e-9 &&
			Math.abs(rows.at(-1)!.high / HIGH_HZ - 1) < 0.01 &&
			rows.every((row) => Math.abs(row.high / row.low - 2 ** (1 / 12)) < 1e-9),
		`${rows.length} rows`,
	);
}

section("a full-scale sine reads 0 dB in its own band");
{
	const size = 2048;
	const fft = new PowerSpectrum(size);
	const power = new Float32Array(fft.bins);
	const binHz = RATE / size;

	for (const hz of [125, 1000, 4000]) {
		fft.power(sine(hz, 1, size), 0, power);
		const levels = bandLevels(power, binHz, THIRD_OCTAVES, HANN, (size / 2) ** 2);
		const own = THIRD_OCTAVES.findIndex((band) => band.low <= hz && hz < band.high);
		const loudest = levels.indexOf(Math.max(...levels));
		check(`${hz} Hz is loudest in its band`, loudest === own, `band ${loudest}, expected ${own}`);
		check(`at 0 dB`, Math.abs(levels[own]) < 0.5, `${levels[own].toFixed(2)} dB`);
		check(
			"and far down two octaves away",
			levels[Math.min(27, own + 6)] < -40,
			`${levels[Math.min(27, own + 6)].toFixed(1)} dB`,
		);
	}

	fft.power(sine(1000, 0.1, size), 0, power);
	const quieter = bandLevels(power, binHz, THIRD_OCTAVES, HANN, (size / 2) ** 2)[15];
	check("a tenth of full scale reads -20 dB", Math.abs(quieter + 20) < 0.5, `${quieter.toFixed(2)} dB`);

	const silent = bandLevels(new Float32Array(fft.bins), binHz, THIRD_OCTAVES, HANN, 1);
	check(
		"silence sits on the floor",
		silent.every((level) => level === FLOOR_DB),
	);

	// The analyser's own calibration: |X| / N under a Blackman window, so a unit sine peaks at 0.21.
	const analyser = new Float32Array(4096);
	analyser[Math.round(1000 / (48000 / 8192))] = (BLACKMAN.coherent / 2) ** 2;
	const read = bandLevels(analyser, 48000 / 8192, THIRD_OCTAVES, BLACKMAN, 1 / 4)[15];
	check("an analyser's peak bin at a unit sine reads 0 dB", Math.abs(read) < 0.01, `${read.toFixed(2)} dB`);

	check(
		"the top bar's meter keeps the louder of each pair",
		spectrumBars(Float32Array.from([-10, -3, -50, -60]), true).join() === "-3,-50",
	);
}

section("loudness as BS.1770 measures it, at the DSP's rate");
{
	const tone = sine(1000, 1, RATE * 3);
	const left = new LoudnessMeter(RATE);
	for (const value of tone) {
		left.push(value, 0);
	}

	check(
		"a full-scale 1 kHz sine on one side is -3.01 LUFS",
		Math.abs(left.integrated() + 3.01) < 0.1,
		`${left.integrated().toFixed(3)}`,
	);
	check("and so is its momentary loudness", Math.abs(left.momentary() + 3.01) < 0.1, `${left.momentary().toFixed(3)}`);

	const both = new LoudnessMeter(RATE);
	for (const value of tone) {
		both.push(value, value);
	}

	check("on both sides it is 3 dB louder", Math.abs(both.integrated() - 0) < 0.1, `${both.integrated().toFixed(3)}`);

	const quiet = new LoudnessMeter(RATE);
	for (let n = 0; n < RATE * 2; n++) {
		quiet.push(0, 0);
	}

	check("silence is gated out of the integration", quiet.integrated() === -Infinity);

	// A loud half and a silent half: the gate keeps the silence from halving the figure.
	const half = new LoudnessMeter(RATE);
	tone.forEach((value, n) => half.push(n < tone.length / 2 ? value : 0, 0));
	check(
		"a pause is gated out rather than halving it, as the ungated -6 dB would",
		half.integrated() > -3.6 && half.integrated() < -3.01,
		`${half.integrated().toFixed(3)}`,
	);
}

section("the scope holds a waveform still and draws it as heard");
{
	// Two cycles of a 100-frame period, voice 2 of 8 interleaved.
	const frames = 400;
	const samples = new Int8Array(frames * 8);
	for (let frame = 0; frame < frames; frame++) {
		samples[frame * 8 + 2] = Math.round(100 * Math.sin((2 * Math.PI * (frame + 30)) / 100));
	}

	const start = triggerFrame(samples, frames, 200, 8, 2);
	check(
		"it starts on a rising zero crossing",
		samples[(start - 1) * 8 + 2] < 0 && samples[start * 8 + 2] >= 0,
		`frame ${start}`,
	);
	check("and leaves a whole span after it", start <= frames - 200, `frame ${start}`);
	check("silence starts at the newest span", triggerFrame(new Int8Array(800), 100, 40) === 60);

	const volumes = new Int8Array(18);
	volumes[4] = 64;
	volumes[5] = -64;
	volumes[16] = 127;
	volumes[17] = 127;
	check(
		"a surround voice is heard at its volume's magnitude",
		Math.abs(heardGain(volumes, 2) - (64 * 127) / 128 ** 3) < 1e-12,
	);
	check("a muted voice not at all", heardGain(volumes, 0) === 0);

	const mono = Int16Array.from({ length: 200 }, (_, n) => Math.round(1000 * Math.sin(n / 3)));
	const surround = Int16Array.from({ length: 200 }, (_, n) => (n % 2 ? -mono[n - 1] : mono[n]));
	check(
		"mono correlates at +1",
		Math.abs(
			correlation(
				mono.map((_, n) => mono[n - (n % 2)]),
				0,
				100,
			)! - 1,
		) < 1e-9,
	);
	check("one side negated at -1", Math.abs(correlation(surround, 0, 100)! + 1) < 1e-9);
	check("silence has none", correlation(new Int16Array(200), 0, 100) === null);

	const first = stepCorrelation(null, 0.8, 0)!;
	check("silence leaves the meter where it stands", stepCorrelation(first, null, 1) === first);
	check("the meter starts on its first reading", first.value === 0.8 && first.low === 0.8);
	const eased = stepCorrelation(first, -1, CORRELATION_SMOOTHING)!;
	check(
		"and eases toward the next, about two-thirds of the way in one time constant",
		Math.abs(eased.value - (0.8 - 1.8 * (1 - Math.exp(-1)))) < 1e-9,
		`${eased.value}`,
	);
	check("a dip takes the low mark with it", eased.low === eased.value);
	let held = eased;
	for (let n = 0; n < 10; n++) {
		held = stepCorrelation(held, 1, 0.1)!;
	}

	check(
		"the low mark holds while the bar climbs back",
		held.low === eased.low && held.value > 0.5,
		`${held.low} / ${held.value}`,
	);
	for (let n = 0; n < CORRELATION_HOLD / 0.1 + 1; n++) {
		held = stepCorrelation(held, 1, 0.1)!;
	}

	check("and lets go once it has held its time", held.low > 0.9, `${held.low}`);
}

section("the timeline keeps each column's loudest moment");
{
	// 3000 buckets of one tick into 1000 columns: a one-bucket peak must survive the squeeze.
	const levels = new Float32Array(3000).fill(-60);
	levels[1500] = -3;
	const columns = columnMax(levels, levels.length, 1, 3000);
	check("one column per unit of the viewBox", columns.length === TIMELINE_WIDTH);
	check("a one-bucket peak survives", columns[500] === -3, `${columns[500]}`);
	check("its neighbours keep their own level", columns[499] === -60 && columns[501] === -60);

	const sparse = columnMax(Float32Array.from([-10, -20]), 2, 50, 100);
	check(
		"a bucket wider than a column fills every column it covers",
		sparse[0] === -10 && sparse[499] === -10 && sparse[500] === -20,
	);
	check("a pass of nothing reaches no column", columnMax(new Float32Array(1), 1, 1, 0).every(Number.isNaN));

	const unreached = columnMax(Float32Array.from([-10]), 1, 10, 100);
	check("past what the analysis reached, nothing", Number.isNaN(unreached[999]) && unreached[0] === -10);
	check("and an area there drops to the floor", areaPath(unreached, -60, 0, 20).endsWith("H1000V20Z"));

	// Columns a steady 10 ticks apart, then 30 once the tempo halves.
	const ticks = Float32Array.from([0, 10, 20, 30, 60, 90]);
	const lookup = spectrogramColumns(ticks, 100, 10);
	check("a spectrogram is looked up by tick, not stretched", lookup.join() === "0,1,2,3,3,3,4,4,4,5", lookup.join());
}
