/**
 * `audiotest`: the loop lasts as long as the compiler says, the driver's ticks
 * are counted exactly, and the voice the count is latched on is one the driver
 * plays.
 */

import "../localize";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compiler } from "@amk/compiler";
import { SPC_SAMPLE_RATE, instantiate } from "@amk/spc/wasm-host";
import {
	TICK_POLL_HZ,
	createTickPhase,
	readDriverState,
	sawTick,
	seedTickPhase,
	tickVoice,
} from "@amk/spc/driver-state";
import { SPC_ASSETS, check, section } from "../harness";
import { driver, OPTIONS, compileToSpc, BLOCK, emu } from "./support";

section("the loop really lasts as long as the compiler says");
{
	/**
	 * Times a song's loop against the emulator.
	 *
	 * Each loop opens with one short note and is silent after it, so the gap
	 * between onsets is the period to the sample. First onset to last, so the
	 * threshold-crossing jitter is divided across every loop rather than counted
	 * once per measurement.
	 */
	function measureLoop(source: string, seconds: number): number {
		const loopEmu = instantiate(new WebAssembly.Module(readFileSync(join(SPC_ASSETS, "player", "spc.wasm"))));
		loopEmu.loadSpc(compileToSpc(source));

		const total = SPC_SAMPLE_RATE * seconds;
		const mono = new Float64Array(total);
		for (let at = 0; at < total; at += 32000) {
			const out = loopEmu.render(Math.min(32000, total - at));
			for (let i = 0; i < out.length / 2; i++) {
				mono[at + i] = (out[i * 2] + out[i * 2 + 1]) / 2;
			}
		}

		let loudest = 0;
		for (const value of mono) {
			loudest = Math.max(loudest, Math.abs(value));
		}

		const threshold = loudest * 0.15;
		const quiet = Math.round(0.2 * SPC_SAMPLE_RATE);
		const onsets: number[] = [];
		let silent = quiet;
		for (let i = 0; i < total; i++) {
			if (Math.abs(mono[i]) > threshold) {
				if (silent >= quiet) {
					onsets.push(i);
				}

				silent = 0;
			} else {
				silent++;
			}
		}

		const spans = onsets.length - 1;
		return spans > 1 ? (onsets[spans] - onsets[0]) / spans / SPC_SAMPLE_RATE : NaN;
	}

	// 408 ticks a loop: a 12-tick note and then quiet. Two tempos an octave
	// apart, because AddmusicK's rounding is wrong by a different amount at each
	// and a single reading could be matched by the wrong rate.
	for (const [tempo, seconds] of [
		[54, 60],
		[192, 30],
	] as const) {
		const source = `#amk 4\n#0 t${tempo} v255 @0 o4 q7F c16 r16 r1 r1\n`;
		const stats = compiler.compile({ source, aramAddress: driver.manifest.localPos, options: OPTIONS }).stats!;

		const measured = measureLoop(source, seconds);
		const claimed = stats.playback!.mainSeconds;
		const estimate = stats.mainSeconds!;

		check(
			`t${tempo}: the compiler's playback length matches the emulator`,
			Math.abs(measured / claimed - 1) < 0.005,
			`measured ${measured.toFixed(5)}s, claimed ${claimed.toFixed(5)}s (${((measured / claimed - 1) * 100).toFixed(3)}%)`,
		);
		// AddmusicK's rounding happens to land close at some tempos, so the claim
		// worth pinning is the relative one: whatever the tempo, the driver's rate
		// is far nearer the truth than the estimate is.
		const claimedError = Math.abs(measured / claimed - 1);
		const estimateError = Math.abs(measured / estimate - 1);
		check(
			`t${tempo}: and it beats AddmusicK's estimate by a wide margin`,
			claimedError * 5 < estimateError,
			`${(claimedError * 100).toFixed(4)}% vs ${(estimateError * 100).toFixed(4)}%`,
		);
	}
}

section("the driver's own ticks are counted exactly");
{
	// This is what the playhead runs on, so it has to be exact rather than close:
	// an error of one tick a pass is a progress bar that walks away from the music.
	/**
	 * Counts ticks over `seconds`, noting the count at each pass of the song.
	 *
	 * Voice 0 carries no subloops in any of these songs, so its music pointer
	 * jumping backwards is the song coming round. That is not a general way to
	 * find the loop — a subloop moves the same pointer — but it is exact here,
	 * and it is the tick count being tested, not the detector.
	 */
	// Reuses the emulator the rest of the file uses: each instance carries a
	// 16 MiB heap, and standing up a dozen of them wedges the process.
	const core = emu;

	function count(spc: Uint8Array, seconds: number) {
		core.loadSpc(spc);
		const block = SPC_SAMPLE_RATE / TICK_POLL_HZ;

		// Let the song key on, so the count runs at the song's own tempo.
		core.renderView(SPC_SAMPLE_RATE / 20);
		const tick = createTickPhase();
		seedTickPhase(tick, core.aram());
		let pointer = readDriverState(core.aram()).trackPointers[0];
		let ticks = 0;
		const passes: number[] = [];
		let pending = -1;
		let before = 0;

		for (let frame = 0; frame < SPC_SAMPLE_RATE * seconds; frame += block) {
			core.renderView(block);
			const aram = core.aram();

			ticks += sawTick(tick, aram);

			// A 16-bit pointer read from outside the emulator can be caught
			// half-written, which looks like a jump backwards and is not one. A real
			// jump is still there on the next look.
			const next = readDriverState(aram).trackPointers[0];
			if (pending >= 0) {
				if (next < before) {
					passes.push(pending);
				}

				pending = -1;
			} else if (next < pointer) {
				pending = ticks;
				before = pointer;
			}

			pointer = next;
		}

		return { ticks, passes };
	}

	const median = (values: number[]): number => [...values].sort((a, b) => a - b)[values.length >> 1];

	for (const [label, source, seconds] of [
		["one channel", "#amk 4\n#0 t192 v200 @0 o4 q7F a1g1e1e1\n", 24],
		["at the default tempo", "#amk 4\n#0 t54 v200 @0 o4 q7F a1g1e1e1\n", 40],
		[
			"eight channels, where a formula loses ticks",
			"#amk 4\n#0 t192 v200 @0 o4 q7F a1g1e1e1\n#1 v180 @1 o3 q7F c1c1c1c1\n#2 v160 @2 o4 q7F e1e1e1e1\n" +
				"#3 v160 @3 o3 q7F g1g1g1g1\n#4 v140 @0 o5 q7F a1a1a1a1\n#5 v140 @1 o2 q7F c1c1c1c1\n" +
				"#6 v120 @2 o4 q7F d1d1d1d1\n#7 v120 @3 o3 q7F f1f1f1f1\n",
			24,
		],
	] as const) {
		const stats = compiler.compile({ source, aramAddress: driver.manifest.localPos, options: OPTIONS }).stats!;
		const expected = stats.introTicks + stats.loopTicks;
		const { passes } = count(compileToSpc(source), seconds);
		const gaps = passes.slice(1).map((v, i) => v - passes[i]);

		// One tick of slack for where the poll lands relative to the jump itself;
		// the count between two passes is what has to come out right.
		check(
			`${label}: a pass is ${expected} ticks`,
			gaps.length >= 2 && Math.abs(median(gaps) - expected) <= 1,
			`${gaps.length} passes, median ${gaps.length ? median(gaps) : "-"}: ${[...new Set(gaps)].join(", ")}`,
		);
	}

	// A sparse song leaves the driver time to keep up, so the tick rate should
	// land on what the hardware documents: `$51` added to `$49` once per pass of
	// a 500 Hz main loop, a tick every 256 units. `$51` holds the `t` value plus
	// one, which is why the register is read rather than the tempo assumed.
	for (const tempo of [16, 54, 192]) {
		const source = `#amk 4\n#0 t${tempo} v200 @0 o4 q7F a1g1e1e1\n`;
		core.loadSpc(compileToSpc(source));
		// The register holds the boot default until the song's own `t` runs.
		core.renderView(SPC_SAMPLE_RATE / 4);
		const stored = core.aram()[0x51];
		check(`t${tempo}: the driver stores the tempo plus one`, stored === tempo + 1, `$51 reads ${stored}`);

		const seconds = 20;
		const { ticks } = count(compileToSpc(source), seconds);
		const rate = ticks / seconds;
		const documented = (stored * 500) / 256;

		check(
			`t${tempo}: counted ${rate.toFixed(2)} ticks/s against the driver's ${documented.toFixed(2)}`,
			Math.abs(rate / documented - 1) < 0.005,
			`off by ${((rate / documented - 1) * 100).toFixed(3)}%`,
		);
	}

	// A formula cannot do this: the driver drops ticks when the song keeps it
	// busy, so eight channels run measurably slower than the same song on one.
	const oneChannel = "#amk 4\n#0 t192 v200 @0 o4 q7F a1g1e1e1\n";
	const solo = count(compileToSpc(oneChannel), 24).ticks;
	const full = count(
		compileToSpc(
			"#amk 4\n#0 t192 v200 @0 o4 q7F a1g1e1e1\n#1 v180 @1 o3 q7F c1c1c1c1\n#2 v160 @2 o4 q7F e1e1e1e1\n" +
				"#3 v160 @3 o3 q7F g1g1g1g1\n#4 v140 @0 o5 q7F a1a1a1a1\n#5 v140 @1 o2 q7F c1c1c1c1\n" +
				"#6 v120 @2 o4 q7F d1d1d1d1\n#7 v120 @3 o3 q7F f1f1f1f1\n",
		),
		24,
	).ticks;
	check(
		"a busy song really does tick more slowly",
		full < solo,
		`${full} ticks against ${solo} over the same 24s (${(((full - solo) / solo) * 100).toFixed(2)}%)`,
	);
}

section("the music tick is the driver's own accumulator overflow");
{
	// `main.asm:220-238`. A pass of the main loop multiplies the tempo by timer
	// 0's count, adds it to `$49`, and plays a tick if that carried *or* if the
	// product had a high byte at all. Fed a synthetic page here, because the two
	// branches cannot be told apart by watching a real song: the second only
	// fires once the driver has fallen a whole accumulator period behind.
	const gate = (tempo: number, counts: readonly number[]): number => {
		const aram = new Uint8Array(0x100);
		aram[0x51] = tempo;
		const tick = createTickPhase();
		seedTickPhase(tick, aram);

		let ticks = 0;
		for (const count of counts) {
			aram[0x44] = (aram[0x44] + count * 0x38) & 0xff;
			ticks += sawTick(tick, aram);
		}

		return ticks;
	};

	const keepingUp = Array.from({ length: 500 }, () => 1);
	check(
		"a driver keeping up ticks once per accumulator period",
		gate(54, keepingUp) === Math.floor((54 * 500) / 256),
		`${gate(54, keepingUp)} of ${Math.floor((54 * 500) / 256)}`,
	);
	check(
		"and the phase is carried, so no period is lost to rounding",
		gate(
			1,
			Array.from({ length: 256 }, () => 1),
		) === 1,
	);

	// 52 x 5 is 260: the low byte adds 4 and never carries, and the tick is the
	// one `cmp y, #$00` runs. Watching `$49` alone would count nothing here.
	check("a pass that fell behind ticks on the product's high byte", gate(52, [5]) === 1);
	check("a pass that did not happen is not a tick", gate(54, [0, 0, 0]) === 0);
	// `t255` wraps `$FF` to 0 in the driver's carry-set `adc`, and a tempo of 0
	// stops the accumulator dead rather than running the song at its fastest.
	check("a stopped song never ticks", gate(0, keepingUp) === 0);
}

section("the voice the count is latched on is one the driver plays");
{
	// The playhead starts counting on the first poll that finds a voice — from
	// the moment the SPC loads, as `worklet.ts` and `measure-clock.ts` do it. At
	// song start the driver holds `$30` pointing into the zero page for its
	// hot-patch reset (`main.asm:2104-2105`), a word with a low byte and no high
	// byte, and it stays that way for some milliseconds. A latch reading the whole
	// word takes voice 0 there, and so starts the count several ticks before the
	// song it is meant to be following. The driver's own test is the high byte
	// alone (`main.asm:2315`), and so is `tickVoice`'s.
	const zeroPage = new Uint8Array(0x100);
	zeroPage[0x30] = 0x32;
	check("a pointer into the zero page is not a playing voice", tickVoice(zeroPage) === -1);
	zeroPage[0x32] = 0xac;
	zeroPage[0x33] = 0x29;
	check("and voice 1 is found behind it", tickVoice(zeroPage) === 1);

	function latched(source: string, seconds: number): { voice: number; ticks: number } {
		emu.loadSpc(compileToSpc(source));
		let voice = -1;
		const tick = createTickPhase();
		let ticks = 0;
		for (let done = 0; done < SPC_SAMPLE_RATE * seconds; done += BLOCK) {
			emu.renderView(BLOCK);
			const aram = emu.aram();
			if (voice < 0) {
				voice = tickVoice(aram);
				seedTickPhase(tick, aram);
				continue;
			}

			ticks += sawTick(tick, aram);
		}

		return { voice, ticks };
	}

	const zero = latched("#amk 4\n#0 t54 v200 @0 o4 q7F c8d8e8f8\n", 2);
	const one = latched("#amk 4\n#1 t54 v200 @0 o4 q7F c8d8e8f8\n", 2);
	check("a song whose lowest channel is #1 is latched on voice 1", one.voice === 1, `voice ${one.voice}`);
	check("and its ticks advance", one.ticks > 100, `${one.ticks} ticks`);
	check("to the same count as the same music on #0", one.ticks === zero.ticks, `${one.ticks} against ${zero.ticks}`);
}
