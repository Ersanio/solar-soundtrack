/** `audiotest`: the note map lands on what the driver is playing. */

import "../localize";
import { compiler } from "@amk/compiler";
import { noteAddressAt } from "@amk/core/types";
import { SPC_SAMPLE_RATE } from "@amk/spc/wasm-host";
import { readDriverState } from "@amk/spc/driver-state";
import { check, section } from "../harness";
import { driver, OPTIONS, compileToSpc, emu } from "./support";

section("the note map lands on what the driver is playing");
{
	// A loop, so the loop block is exercised: while a voice is inside `[ ]` its
	// track pointer walks channel 8's bytes, and the map must resolve them.
	const source = "#amk 4\n#0 t54 v200 @0 o4 q7F [c8 d8 e8]4 g2\n#1 v180 @1 o3 q7F c1c1\n";
	const result = compiler.compile({ source, aramAddress: driver.manifest.localPos, options: OPTIONS });
	const noteMap = result.noteMap ?? [];
	check("a successful compile carries a note map", result.ok && noteMap.length > 0, `${noteMap.length} entries`);
	check(
		"the map is sorted by address",
		noteMap.every((entry, n) => n === 0 || entry.address >= noteMap[n - 1].address),
	);
	check(
		"the loop body is mapped in the loop block",
		noteMap.some((entry) => entry.channel === 8),
	);
	check(
		"every span starts on a note, rest or tie",
		noteMap.every((entry) => /^[a-gr^]/i.test(source.slice(entry.span.start, entry.span.end))),
		noteMap.map((entry) => JSON.stringify(source.slice(entry.span.start, entry.span.end))).join(" "),
	);

	// Drive the real driver and, at every poll, resolve each voice's pointer
	// through the map — the exact lookup the playhead performs. A pointer must
	// resolve to that voice's own channel or the loop block; landing in another
	// voice's notes would mean the address arithmetic (header size, channel
	// layout, prefix shifts, loop-block base) drew a boundary in the wrong
	// place. A pointer read from outside the emulator can be caught
	// half-written — the same torn read `count()` above defends against — so
	// overwhelming agreement is asserted rather than unanimity.
	const firstMapped = new Map<number, number>();
	for (const entry of noteMap) {
		firstMapped.set(entry.channel, Math.min(firstMapped.get(entry.channel) ?? 0xffff, entry.address));
	}

	emu.loadSpc(compileToSpc(source));
	emu.renderView(SPC_SAMPLE_RATE / 20);

	let looked = 0;
	let agreed = 0;
	let inLoopBlock = 0;
	for (let poll = 0; poll < 800; poll++) {
		emu.renderView(SPC_SAMPLE_RATE / 100);
		const state = readDriverState(emu.aram());
		for (let voice = 0; voice < 2; voice++) {
			const pointer = state.trackPointers[voice];
			if (pointer === 0 || pointer <= (firstMapped.get(voice) ?? 0xffff)) {
				continue;
			}

			const entry = noteAddressAt(noteMap, pointer);
			looked++;
			if (entry && (entry.channel === voice || entry.channel === 8)) {
				agreed++;
				if (entry.channel === 8) {
					inLoopBlock++;
				}
			}
		}
	}

	check("the driver was polled while notes played", looked > 200, `${looked} lookups`);
	check(
		"each voice's pointer resolves to its own notes",
		looked > 0 && agreed / looked > 0.99,
		`${agreed}/${looked} agreed`,
	);
	check("the loop body was seen playing from the loop block", inLoopBlock > 0, `${inLoopBlock} polls`);
}
