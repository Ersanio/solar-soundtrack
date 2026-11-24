/**
 * `audiotest`: the `.wav` export — the song as it plays up to the end of its second loop, counted
 * in driver ticks, then a ten-second fade to silence; a song that does not loop rings out after
 * its one pass; and the RIFF header a player reads.
 */

import { compiler } from "@amk/compiler";
import { createTickPhase, sawTick, seedTickPhase, tickVoice } from "@amk/spc/driver-state";
import {
	RENDER_FADE_SECONDS,
	RENDER_LOOP_COUNT,
	RENDER_TAIL_MAX_SECONDS,
	encodeWav,
	renderSong,
} from "@amk/spc/render";
import { SPC_CHANNELS, SPC_SAMPLE_RATE } from "@amk/spc/wasm-host";
import { check, section } from "../harness";
import { BLOCK, OPTIONS, compileToSpc, driver, emu, firstDifference, peak } from "./support";

function lengthOf(source: string) {
	const result = compiler.compile({ source, aramAddress: driver.manifest.localPos, options: OPTIONS });
	const stats = result.stats!;
	return { loops: stats.loops, introTicks: stats.introTicks, loopTicks: stats.loopTicks, stats };
}

/** Frames until `target` ticks have passed, counted block by block apart from `renderSong`. */
function framesToTick(spc: Uint8Array, target: number): number {
	emu.loadSpc(spc);
	const tick = createTickPhase();
	let ticks = 0;
	let frames = 0;
	let latched = false;
	while (ticks < target) {
		emu.renderView(BLOCK);
		frames += BLOCK;
		const aram = emu.aram();
		if (!latched) {
			tickVoice(aram);
			seedTickPhase(tick, aram);
			latched = true;
		} else {
			ticks += sawTick(tick, aram);
		}
	}

	return frames;
}

const LOOPING = "#amk 2\n#0 t50 @0 o4 v220 l8 c d e f / [g e c e]2\n#1 @1 o3 v200 l4 c / [c g]2\n";
const ONCE = "#amk 2\n? #0 t60 @0 o4 v220 l8 c d e f g a b > c\n";

section("a looping song plays to the end of its second loop, then fades to nothing");
{
	const length = lengthOf(LOOPING);
	const spc = compileToSpc(LOOPING);
	const pcm = renderSong(emu, spc, length);
	const frames = pcm.length / SPC_CHANNELS;
	const target = length.introTicks + RENDER_LOOP_COUNT * length.loopTicks;
	const fadeFrom = framesToTick(spc, target);

	check("the song loops and has an intro", length.loops && length.introTicks > 0 && length.loopTicks > 0);
	check(
		"its length is the tick count to the end of loop two, plus the fade",
		frames === fadeFrom + RENDER_FADE_SECONDS * SPC_SAMPLE_RATE,
		`${frames} frames, ${fadeFrom} to the fade`,
	);

	const seconds = length.stats.introSeconds! + RENDER_LOOP_COUNT * length.stats.mainSeconds!;
	check(
		"which is about what the compiler estimates for intro and two loops",
		Math.abs(fadeFrom / SPC_SAMPLE_RATE - seconds) < 0.1,
		`${(fadeFrom / SPC_SAMPLE_RATE).toFixed(3)} s against ${seconds.toFixed(3)} s`,
	);

	emu.loadSpc(spc);
	const plain = emu.render(fadeFrom);
	check(
		"up to the fade it is the song as the emulator plays it",
		firstDifference(plain, pcm.subarray(0, fadeFrom * SPC_CHANNELS)) === -1,
	);

	const before = peak(pcm.subarray((fadeFrom - SPC_SAMPLE_RATE) * SPC_CHANNELS, fadeFrom * SPC_CHANNELS));
	const last = pcm.subarray((frames - SPC_SAMPLE_RATE / 2) * SPC_CHANNELS);
	check("it is sounding as the fade begins", before > 0.05, `${before.toFixed(3)}`);
	check("the fade's last half second is under a tenth of that", peak(last) < before / 10, `${peak(last).toFixed(4)}`);
	check("and its last frame is silent", pcm[pcm.length - 1] === 0 && pcm[pcm.length - 2] === 0);
}

section("a song that does not loop plays once and rings out");
{
	const length = lengthOf(ONCE);
	const spc = compileToSpc(ONCE);
	const pcm = renderSong(emu, spc, length);
	const frames = pcm.length / SPC_CHANNELS;
	const pass = framesToTick(spc, length.introTicks + length.loopTicks);

	check("the song does not loop", !length.loops);
	check(
		"it runs past its pass, but no more than the tail allows",
		frames > pass && frames <= pass + RENDER_TAIL_MAX_SECONDS * SPC_SAMPLE_RATE,
		`${frames} frames, the pass ends at ${pass}`,
	);
	check("it ends in silence", peak(pcm.subarray(pcm.length - 0.25 * SPC_SAMPLE_RATE * SPC_CHANNELS)) < 0.001);
}

section("the .wav is 16-bit stereo PCM at 32 kHz");
{
	const pcm = new Int16Array([1, -1, 32767, -32768]);
	const wav = encodeWav(pcm);
	const view = new DataView(wav.buffer);
	const text = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));

	check("RIFF / WAVE / fmt / data", text(0) + text(8) + text(12) + text(36) === "RIFFWAVEfmt data");
	check("the RIFF size counts all but its first eight bytes", view.getUint32(4, true) === wav.length - 8);
	check(
		"PCM, two channels, 32000 Hz, 16 bits",
		view.getUint16(20, true) === 1 &&
			view.getUint16(22, true) === 2 &&
			view.getUint32(24, true) === 32000 &&
			view.getUint32(28, true) === 128000 &&
			view.getUint16(32, true) === 4 &&
			view.getUint16(34, true) === 16,
	);
	check("the data is the samples, little-endian", view.getUint32(40, true) === 8 && view.getInt16(48, true) === 32767);
}
