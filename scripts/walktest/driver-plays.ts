/** `walktest`: the driver plays what the walk says it will. */

import "../localize";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { noteAddressAt } from "@amk/core/types";
import { buildSpc } from "@amk/spc/export";
import { readDriverState } from "@amk/spc/driver-state";
import { emptySample } from "@amk/spc/brr";
import { walkSong } from "@amk/spc/song-walk";
import { instantiate, SPC_SAMPLE_RATE } from "@amk/spc/wasm-host";
import { SPC_ASSETS, check, section } from "../harness";
import { ARAM, build, BY_NAME, driver } from "./support";

// ---------------------------------------------------------------------------
section("the driver plays what the walk says it will");
// ---------------------------------------------------------------------------
{
	const source = "#amk 4\n#0 t54 v200 @0 o4 q7F [c8 d8 e8]4 g2\n#1 v180 @1 o3 q7F c1c1\n";
	const { result, timeline } = build(source);

	const emu = instantiate(new WebAssembly.Module(readFileSync(join(SPC_ASSETS, "player", "spc.wasm"))));
	const samples = (result.sampleList ?? []).map((name) => BY_NAME.get(name) ?? emptySample(name));
	emu.loadSpc(
		buildSpc({
			songData: result.data ?? new Uint8Array(0),
			driver,
			samples,
			echoBufferSize: result.stats?.echoBufferSize,
			date: new Date(2026, 6, 28),
		}).spc,
	);

	const noteMap = result.noteMap ?? [];
	// The walk's own answer to "which note is voice v sounding at tick t",
	// resolved the same way the roll will resolve it.
	const byVoice = [0, 1].map((voice) => timeline.notes.filter((note) => note.channel === voice));

	emu.renderView(SPC_SAMPLE_RATE / 20);

	let looked = 0;
	let agreed = 0;
	let tick = 0;
	let previousDuration = 0;

	for (let poll = 0; poll < 3000; poll++) {
		emu.renderView(SPC_SAMPLE_RATE / 1000);
		const aram = emu.aram();
		const state = readDriverState(aram);

		// Count ticks off voice 0's duration counter, as the worklet does.
		const duration = aram[0x70];
		if (duration < previousDuration || (duration > previousDuration && previousDuration !== 0)) {
			tick++;
		}

		previousDuration = duration;
		if (tick === 0 || tick >= timeline.ticks) {
			continue;
		}

		for (let voice = 0; voice < 2; voice++) {
			const pointer = state.trackPointers[voice];
			if (pointer === 0) {
				continue;
			}

			const driverEntry = noteAddressAt(noteMap, pointer);
			// The last note this voice started at or before `tick` — the walk's own
			// answer to what is sounding, resolved the way the roll will resolve it.
			const sounding = byVoice[voice];
			let walkNote = null;
			for (let n = sounding.length - 1; n >= 0; n--) {
				if (sounding[n].tick < tick) {
					walkNote = sounding[n];
					break;
				}
			}

			if (!driverEntry || !walkNote) {
				continue;
			}

			looked++;
			if (driverEntry.note === walkNote.note) {
				agreed++;
			}
		}
	}

	check("the driver was polled while notes played", looked > 500, `${looked} lookups`);
	check(
		"the note the walk predicts is the note the driver is on",
		looked > 0 && agreed / looked > 0.95,
		`${agreed}/${looked} agreed`,
	);
}

// ---------------------------------------------------------------------------
section("a call of count zero plays its body once and ends the phrase");
// ---------------------------------------------------------------------------
{
	// `]0` is AMK0116, so a compiled `]2` has its count byte patched to zero. `cmdE9` stores the
	// count untested (`Commands.asm:400-417`) and the body's `$00` then finds `$C0+x` at zero and
	// ends the phrase (`main.asm:2345-2346`), so the `d8 e8` after the call never play.
	const { result } = build("#amk 4\n#0 @0 o4 [c8]2 d8 e8\n");
	const data = result.data ?? new Uint8Array(0);
	const headerSize = result.stats?.headerSize ?? 0;
	const calls = [...data.keys()].filter((i) => i >= headerSize && data[i] === 0xe9 && data[i + 3] === 2);
	check("the song has one $E9 of count 2 to patch", calls.length === 1, `${calls.length} found`);
	const call = calls[0] ?? 0;
	const zero = data.slice();
	zero[call + 3] = 0;

	// Whether voice 0's track pointer ever stands on the bytes after the call.
	const reachesPastCall = (song: Uint8Array): boolean => {
		const emu = instantiate(new WebAssembly.Module(readFileSync(join(SPC_ASSETS, "player", "spc.wasm"))));
		const samples = (result.sampleList ?? []).map((name) => BY_NAME.get(name) ?? emptySample(name));
		emu.loadSpc(buildSpc({ songData: song, driver, samples, date: new Date(2026, 6, 28) }).spc);
		const after = ARAM + call + 4;
		for (let poll = 0; poll < 2000; poll++) {
			emu.renderView(SPC_SAMPLE_RATE / 1000);
			const pointer = readDriverState(emu.aram()).trackPointers[0];
			if (pointer > after && pointer <= after + 4) {
				return true;
			}
		}

		return false;
	};

	check("with its count, the driver plays on past the call", reachesPastCall(data));
	check("with a count of zero, the driver never does", !reachesPastCall(zero));

	const walked = walkSong(zero, ARAM);
	const twice = walkSong(data, ARAM);
	check(
		"and the walk plays the body once and stops there",
		walked.loops.length === 0 &&
			walked.notes.length === 1 &&
			walked.notes[0]?.note === twice.notes[0]?.note &&
			walked.ticks === 24 &&
			twice.notes.length === 4,
		`${walked.notes.length} notes over ${walked.ticks} ticks, ${walked.loops.length} runs`,
	);
}
