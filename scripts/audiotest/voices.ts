/**
 * `audiotest`: reading each voice off the DSP — rendering a frame at a time produces the same bytes
 * a block does, `VxOUTX` follows the voices the song plays, and a mute reads as volume 0.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DspReg, instantiate } from "@amk/spc/wasm-host";
import { SPC_ASSETS, check, info, section } from "../harness";
import { BLOCK, compileToSpc, emu } from "./support";

const BUSY = compileToSpc(`#amk 2
$EF $FF $30 $30 $F1 $04 $50 $01
#0 t60 @0 o4 v200 [c8 e8 g8 >c8<]8
#1 @1 o3 v180 [c4 r4 g4 r4]4
#2 @4 o5 v150 [e16 g16 b16 r16]16
#3 @21 c8 @22 c8 @21 c8 @23 c8 c8 c8 c8 c8
#4 @2 o4 q7f c2 d2 e2 f2
#5 @3 o5 c1 d1
#6 @5 o3 c4 d4 e4 f4
#7 @6 o4 c8 d8 e8 f8 g8 a8 b8
`);

section("a frame at a time renders the same song");
{
	// A second instance, so both run the same image from the same start.
	const other = instantiate(new WebAssembly.Module(readFileSync(join(SPC_ASSETS, "player", "spc.wasm"))));
	emu.loadSpc(BUSY);
	other.loadSpc(BUSY);

	const outx = new Int8Array(BLOCK * 8);
	let audioAt = -1;
	let aramAt = -1;
	let blockMs = 0;
	let frameMs = 0;
	const blocks = (6 * 32000) / BLOCK;
	for (let n = 0; n < blocks && audioAt < 0 && aramAt < 0; n++) {
		let started = performance.now();
		const block = emu.renderView(BLOCK).slice();
		blockMs += performance.now() - started;
		started = performance.now();
		const frames = other.renderVoices(BLOCK, outx, 0);
		frameMs += performance.now() - started;

		if (block.some((value, at) => value !== frames[at])) {
			audioAt = n;
		}

		const a = emu.aram();
		const b = other.aram();
		if (a.some((value, at) => value !== b[at])) {
			aramAt = n;
		}
	}

	check("the audio is the same bytes", audioAt < 0, `first differs in block ${audioAt}`);
	check("and so is APU RAM", aramAt < 0, `first differs in block ${aramAt}`);
	info(`6 s of eight voices: ${blockMs.toFixed(1)} ms in blocks, ${frameMs.toFixed(1)} ms a frame at a time`);
}

section("VxOUTX follows the voices the song plays");
{
	const duet = compileToSpc("#amk 2\n#0 t60 @0 o4 v220 c1 c1\n#1 @1 o3 v200 r2 c2 c1\n");
	emu.loadSpc(duet);
	const outx = new Int8Array(BLOCK * 8);
	const moved = new Array<number>(8).fill(0);
	// Half a second: #0 is sounding, #1 is still resting.
	for (let n = 0; n < 16000 / BLOCK; n++) {
		emu.renderVoices(BLOCK, outx, 0);
		for (let frame = 1; frame < BLOCK; frame++) {
			for (let voice = 0; voice < 8; voice++) {
				if (outx[frame * 8 + voice] !== outx[(frame - 1) * 8 + voice]) {
					moved[voice]++;
				}
			}
		}
	}

	check("the voice that is keyed on moves", moved[0] > 1000, `${moved[0]} steps`);
	check("the one resting is still", moved[1] === 0, `${moved[1]} steps`);
	check(
		"the six with no music are still",
		moved.slice(2).every((count) => count === 0),
		moved.join(", "),
	);

	const regs = emu.dspRegisters();
	check("its envelope is up", regs[DspReg.Envx] > 0, `ENVX ${regs[DspReg.Envx]}`);
	check("and its sample is @0's", regs[DspReg.Srcn] === 0, `SRCN ${regs[DspReg.Srcn]}`);

	const volumes = new Int8Array(16);
	emu.voiceVolumes(volumes);
	check("it is mixed at a volume", volumes[0] !== 0 && volumes[1] !== 0, Array.from(volumes).join(","));

	emu.muteVoices(0b1);
	emu.voiceVolumes(volumes);
	check("and a mute reads as volume 0", volumes[0] === 0 && volumes[1] === 0, Array.from(volumes).join(","));
	emu.muteVoices(0);
	emu.voiceVolumes(volumes);
	check("which an unmute gives back", volumes[0] !== 0, Array.from(volumes).join(","));
}
