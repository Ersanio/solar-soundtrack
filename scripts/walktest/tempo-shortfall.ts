/** `walktest`: the driver does not always run the song as fast as it is written. */

import "../localize";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CompileResult } from "@amk/core/types";
import { buildSpc } from "@amk/spc/export";
import { emptySample } from "@amk/spc/brr";
import { instantiate } from "@amk/spc/wasm-host";
import { secondsAtTick, songClock } from "../../web/src/app/state/song-clock";
import { measureClock, tempoShortfall } from "../../web/src/app/state/measure-clock";
import { driverTickSeconds } from "@amk/tokens/commands/units";
import { SPC_ASSETS, check, section } from "../harness";
import { build, BY_NAME, driver } from "./support";

// ---------------------------------------------------------------------------
section("the driver does not always run the song as fast as it is written");
// ---------------------------------------------------------------------------
{
	// The one thing in the app that cannot be computed: the driver's main loop
	// handles at most one music tick per pass (`main.asm`, `MainLoop`), so a song
	// asking for more ticks a second than it can manage gets fewer, and every
	// seconds figure built on the tempo it *asked* for is wrong by the shortfall.
	// `measure-clock.ts` plays the song to find out; this is what says it works.
	const emu = instantiate(new WebAssembly.Module(readFileSync(join(SPC_ASSETS, "player", "spc.wasm"))));

	const spcOf = (result: CompileResult) =>
		buildSpc({
			songData: result.data ?? new Uint8Array(0),
			driver,
			samples: (result.sampleList ?? []).map((name) => BY_NAME.get(name) ?? emptySample(name)),
			echoBufferSize: result.stats?.echoBufferSize,
			date: new Date(2026, 6, 28),
		}).spc;

	const run = (source: string) => {
		const { result, timeline } = build(source);
		const stats = result.stats;
		const passTicks = (stats?.introTicks ?? 0) + (stats?.loopTicks ?? 0);
		const measured = measureClock(emu, spcOf(result), passTicks);
		return { measured, passTicks, timeline, predicted: songClock(timeline) };
	};

	// One channel at t54 is nothing like the driver's ceiling, so the measurement
	// must land on the prediction. Without this the whole mechanism could be
	// reporting garbage and only the pathological songs would show it.
	const easy = run("#amk 4\n#0 t54 @0 o4 [c8d8e8f8]8\n");
	check("an easy song reaches the tick count it was written for", !easy.measured.truncated);
	check(
		"and measures within a percent of the prediction",
		Math.abs((tempoShortfall(easy.measured) ?? 0) - 1) < 0.01,
		`${(tempoShortfall(easy.measured) ?? 0).toFixed(4)}x`,
	);

	// Eight channels at t254 ask for 498 ticks a second and get about half.
	const hard = run(
		"#amk 4\n" +
			[0, 1, 2, 3, 4, 5, 6, 7].map((ch) => `#${ch} ${ch === 0 ? "t254 " : ""}@6 o4 [c16d16e16f16]16\n`).join(""),
	);
	const shortfall = tempoShortfall(hard.measured) ?? 0;
	check("eight channels at t254 fall well short of the rate they ask for", shortfall > 1.5, `${shortfall.toFixed(3)}x`);
	check(
		"so the predicted clock is the one that is wrong, not the measurement",
		hard.predicted !== null && hard.measured.seconds > hard.predicted.seconds * 1.5,
		`measured ${hard.measured.seconds.toFixed(2)} s vs predicted ${hard.predicted?.seconds.toFixed(2)} s`,
	);

	// A one-off cost at the top of the song is not a rate. `$FA $04` zeroes the
	// whole echo buffer in the song's first tick (`main.asm`, `ModifyEchoDelay`),
	// some 26 ms a delay unit, and a short song read that as the driver falling
	// behind — 48 ticks under `$F1 $06` came out "30% slower". The pass is
	// longer by the clear, since that is heard; the rate is not.
	const plain = run("#amk 4\n#0 t53 @10 o4 f+16f+16f+16f+16\n");
	const echoed = run("#amk 4\n#0 t53 $F1 $0F $50 $00 @10 o4 f+16f+16f+16f+16\n");
	check(
		"a short song that opens by clearing a 30 KB echo buffer measures at tempo",
		Math.abs((tempoShortfall(echoed.measured) ?? 0) - 1) < 0.02,
		`${(tempoShortfall(echoed.measured) ?? 0).toFixed(4)}x`,
	);
	check(
		"and its pass is longer by the clear, which is what is heard",
		echoed.measured.seconds - plain.measured.seconds > 0.3,
		`${echoed.measured.seconds.toFixed(3)} s vs ${plain.measured.seconds.toFixed(3)} s`,
	);
	check(
		"the whole of which sits before the first tick",
		echoed.measured.leadSeconds - plain.measured.leadSeconds > 0.3,
		`lead ${echoed.measured.leadSeconds.toFixed(3)} s vs ${plain.measured.leadSeconds.toFixed(3)} s`,
	);

	// A note one tick long moves the driver's duration counter by nothing at all:
	// `$70+2n` is decremented to zero and reloaded from the duration byte in the
	// same pass (`main.asm:2337, 2440-2441`), so a 1 arrives where a 1 already
	// was. The count comes off the tempo accumulator instead, which is the
	// driver's own gate and knows nothing about note lengths. `h0` between the
	// note and the `^` is what keeps the tie from folding in (`parser.ts`,
	// `accumulateTiedLength`), and a run of equal one-tick notes drops the
	// duration byte altogether, so `$0200+2n` stops moving too.
	const tied = run("#amk 4\n#0 t23 q7F @10 o4 f+=11 h0 ^=1 f+=11 h0 ^=1 f+=11 h0 ^=1 f+=11 h0 ^=1\n");
	check(
		"a song of one-tick ties measures at tempo",
		Math.abs((tempoShortfall(tied.measured) ?? 0) - 1) < 0.02,
		`${(tempoShortfall(tied.measured) ?? 0).toFixed(4)}x`,
	);

	const drummed = run(`#amk 4\n#0 t23 q7F @10 o4 ${"c=1".repeat(48)}\n`);
	check(
		"and so does one of nothing but one-tick notes",
		Math.abs((tempoShortfall(drummed.measured) ?? 0) - 1) < 0.02,
		`${(tempoShortfall(drummed.measured) ?? 0).toFixed(4)}x`,
	);
	check(
		"both reaching the tick count the compiler wrote them for",
		!tied.measured.truncated && !drummed.measured.truncated && tied.passTicks === 48 && drummed.passTicks === 48,
		`${tied.passTicks} and ${drummed.passTicks} ticks`,
	);

	// The measured clock has to be usable through the same two functions the
	// predicted one is, or the transport cannot read one for the other.
	const clock = hard.measured.clock;
	check("a measurement yields a clock", clock !== null && clock.segments.length > 0);
	if (clock) {
		check(
			"whose ends are the pass it measured",
			secondsAtTick(clock, 0) === 0 && Math.abs(secondsAtTick(clock, clock.ticks) - clock.seconds) < 1e-9,
		);
		check(
			"which never runs backwards",
			Array.from({ length: 64 }, (_, n) => secondsAtTick(clock, (n * clock.ticks) / 63)).every(
				(seconds, n, all) => n === 0 || seconds >= all[n - 1],
			),
		);
		check(
			"and joins up at every segment boundary",
			clock.segments.every((s, n) => {
				const next = clock.segments[n + 1];
				return (
					next === undefined || Math.abs(s.seconds + (next.tick - s.tick) * s.secondsPerTick - next.seconds) < 1e-9
				);
			}),
		);
	}

	// The restatement guard, as `vcmdLength` has: `measure-clock.ts` prices a
	// tick at the driver tempo itself rather than importing `@amk/tokens`, whose
	// `driverTickSeconds` says the same thing. If these drift, every shortfall
	// figure and the SST0503 that rides on it drift with them.
	let apart = 0;
	for (let register = 1; register <= 255; register++) {
		if (256 / (500 * register) !== driverTickSeconds(register)) {
			apart++;
		}
	}

	check("both packages price a driver tick the same way", apart === 0, `${apart} disagreements`);

	// A song with no ticks to reach has nothing to measure, and must say so
	// rather than return a clock of length zero that would read as a real answer.
	check(
		"nothing to measure yields no clock",
		measureClock(emu, spcOf(build("#amk 4\n#0 c4\n").result), 0).clock === null,
	);
}
