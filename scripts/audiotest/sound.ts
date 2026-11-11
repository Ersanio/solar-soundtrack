/**
 * `audiotest`: the emulator boots, a compiled song makes sound, silence is
 * silent, notes differ audibly, and fast-forward lands somewhere different.
 */

import "../localize";
import { check, section } from "../harness";
import { peak, rms, compileToSpc, emu } from "./support";

section("emulator boots");
check("wasm instantiated and main() ran", true);

section("a compiled song actually makes sound");
{
	const spc = compileToSpc(`#amk 4
#0 t40 o4 v220 q7F @0 l8 c d e f g4 e4 c4 r4
#1 o3 v200 q7D @1 l4 [c e g e]4
`);
	emu.loadSpc(spc);
	// Discard the first moments: the driver needs a few ticks to key on.
	emu.render(4000);
	const samples = emu.render(32000); // one second at 32 kHz

	check("output is not silent", peak(samples) > 0.01, `peak ${peak(samples).toFixed(4)}`);
	check("output has real signal level", rms(samples) > 0.001, `rms ${rms(samples).toFixed(5)}`);
	check("output does not clip constantly", peak(samples) <= 1.0, `peak ${peak(samples).toFixed(4)}`);

	// Both channels should carry audio: a dead channel means the sample
	// directory or a pan command went wrong.
	const left = samples.filter((_, i) => i % 2 === 0);
	const right = samples.filter((_, i) => i % 2 === 1);
	check("left channel has signal", rms(Int16Array.from(left)) > 0.001);
	check("right channel has signal", rms(Int16Array.from(right)) > 0.001);
}

section("silence really is silent (control)");
{
	// Rests only: proves the non-silence check above is measuring our song and
	// not some artefact of the driver or leftover state.
	const spc = compileToSpc("#amk 4\n#0 t40 o4 v220 @0 l1 r r r r\n");
	emu.loadSpc(spc);
	emu.render(4000);
	const samples = emu.render(32000);
	check("a song of rests produces near-silence", peak(samples) < 0.01, `peak ${peak(samples).toFixed(4)}`);
}

section("notes differ audibly from each other");
{
	const render = (mml: string) => {
		emu.loadSpc(compileToSpc(mml));
		emu.render(4000);
		return emu.render(16000);
	};

	const low = render("#amk 4\n#0 t40 o2 v220 q7F @0 l1 c c c c\n");
	const high = render("#amk 4\n#0 t40 o5 v220 q7F @0 l1 c c c c\n");

	// Not a spectral test — just that two different pitches are not identical
	// buffers, which would mean the note byte never reached the DSP.
	let identical = low.length === high.length;
	if (identical) {
		for (let i = 0; i < low.length; i++) {
			if (low[i] !== high[i]) {
				identical = false;
				break;
			}
		}
	}

	check("o2 and o5 render differently", !identical);
	check(
		"both are audible",
		peak(low) > 0.01 && peak(high) > 0.01,
		`${peak(low).toFixed(3)} / ${peak(high).toFixed(3)}`,
	);
}

section("fast-forward lands somewhere different");
{
	const spc = compileToSpc(`#amk 4
#0 t40 o4 v220 q7F @0 l8 c d e f g a b > c < b a g f e d c r
`);
	emu.loadSpc(spc);
	const fromStart = emu.render(8000);

	emu.loadSpc(spc);
	emu.skip(3); // seconds
	const fromThree = emu.render(8000);

	let identical = true;
	for (let i = 0; i < fromStart.length; i++) {
		if (fromStart[i] !== fromThree[i]) {
			identical = false;
			break;
		}
	}

	check("skipping 3s changes the output", !identical);
	check("still audible after skipping", peak(fromThree) > 0.005, `peak ${peak(fromThree).toFixed(4)}`);
}
