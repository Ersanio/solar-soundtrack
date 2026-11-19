/**
 * `audiotest`: the Song Inspector's analysis on real songs — a lane per voice the song plays and
 * none for the rest, a mute that empties its lane and quietens the mix, samples on their SRCN, the
 * echo heard only where the song turns it on, and clipping counted where the DSP clamps.
 */

import { NOISE_SAMPLE, SOUNDING_DB, analyseSong } from "../../web/src/app/state/analysis/song-analysis";
import { check, info, section } from "../harness";
import { compileToSpc, emu } from "./support";
import { compiler } from "@amk/compiler";
import { driver, OPTIONS } from "./support";

function passOf(source: string): number {
	const result = compiler.compile({ source, aramAddress: driver.manifest.localPos, options: OPTIONS });
	return (result.stats?.introTicks ?? 0) + (result.stats?.loopTicks ?? 0);
}

const lane = (analysis: ReturnType<typeof analyseSong>, voice: number) =>
	analysis.voiceLevel.subarray(voice * analysis.buckets, (voice + 1) * analysis.buckets);
const sounds = (levels: Float32Array) => levels.some((level) => level > SOUNDING_DB);

const DUET = "#amk 2\n#0 t60 @0 o4 v220 l8 [c e g e]4\n#2 @1 o3 v200 l4 [c g]4\n";

section("a lane for each voice the song plays, and none for the rest");
{
	const started = performance.now();
	const full = analyseSong(emu, compileToSpc(DUET), passOf(DUET), 0);
	info(`analysed ${full.seconds.toFixed(2)} s of song in ${(performance.now() - started).toFixed(0)} ms`);

	check(
		"it reaches the end of the pass",
		!full.truncated && full.ticks >= full.passTicks,
		`${full.ticks} of ${full.passTicks}`,
	);
	check("#0 sounds", sounds(lane(full, 0)));
	check("#2 sounds", sounds(lane(full, 2)));
	check(
		"the six it does not use stay silent",
		[1, 3, 4, 5, 6, 7].every((voice) => !sounds(lane(full, voice))),
	);
	check("two voices at most at once", full.maxPolyphony === 2, `${full.maxPolyphony}`);
	check(
		"the two samples are @0's and @1's",
		full.samples.map((sample) => sample.id).join(",") === "0,1",
		full.samples.map((sample) => sample.id).join(","),
	);
	check(
		"it has a loudness",
		full.integratedLufs > -40 && full.integratedLufs < 0,
		`${full.integratedLufs.toFixed(2)} LUFS`,
	);
	check("and a spectrogram", full.spectrogram.columns > 10 && full.spectrogram.levels.some((level) => level > 0));
	check("nothing clips", full.clipCount === 0, `${full.clipCount}`);
	check("there is no echo", full.echoShare === 0, `${full.echoShare}`);

	const muted = analyseSong(emu, compileToSpc(DUET), passOf(DUET), 0b100);
	check("muting #2 empties its lane", !sounds(lane(muted, 2)));
	check(
		"and leaves #0's as it was",
		lane(muted, 0).every((level, n) => level === lane(full, 0)[n]),
	);
	check(
		"the mix is quieter for it",
		muted.integratedLufs < full.integratedLufs,
		`${muted.integratedLufs.toFixed(2)} vs ${full.integratedLufs.toFixed(2)} LUFS`,
	);
	check(
		"and @1 is no longer heard",
		muted.samples.every((sample) => sample.id !== 1),
		muted.samples.map((sample) => sample.id).join(","),
	);
	check("the timing is untouched", muted.ticks === full.ticks && muted.seconds === full.seconds);
}

section("the echo is heard where the song turns it on");
{
	const song = "#amk 2\n$EF $01 $40 $40 $F1 $03 $60 $01\n#0 t60 @0 o4 v220 l8 [c e g e]4\n";
	const echoed = analyseSong(emu, compileToSpc(song), passOf(song), 0);
	check("the echo is heard most of the song", echoed.echoShare > 0.5, `${echoed.echoShare.toFixed(2)}`);
	check(
		"#0 sends to it",
		echoed.echoSends.some((bits) => bits & 1),
	);
	check(
		"and the buffer fills",
		echoed.echoEnergy.some((level) => level > -50),
		`${Math.max(...echoed.echoEnergy).toFixed(1)} dBFS`,
	);
}

section("noise, and a mix driven into the rails");
{
	const noisy = "#amk 2\n#0 t60 n1F @0 o4 v255 $F8 $01 c2 c2\n";
	const noise = analyseSong(emu, compileToSpc(noisy), passOf(noisy), 0);
	check(
		"a voice playing noise is on the noise lane",
		noise.samples.some((sample) => sample.id === NOISE_SAMPLE),
		noise.samples.map((sample) => sample.id).join(","),
	);

	const loud =
		"#amk 2\nw255\n" +
		[0, 1, 2, 3, 4, 5, 6, 7]
			.map((channel) => `#${channel} ${channel === 0 ? "t60 " : ""}@1 o3 v255 y10 c1 c1`)
			.join("\n") +
		"\n";
	const hot = analyseSong(emu, compileToSpc(loud), passOf(loud), 0);
	check("eight voices at full volume clip", hot.clipCount > 0, `${hot.clipCount} samples`);
	check("and peak at full scale", hot.peakDb > -0.01, `${hot.peakDb.toFixed(2)} dBFS`);
}
