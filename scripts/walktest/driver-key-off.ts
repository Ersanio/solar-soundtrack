/** `walktest`: the driver keys a note off where the walk says it does. */

import "../localize";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSpc } from "@amk/spc/export";
import { createTickPhase, passMark, sawTick, seedTickPhase, TICK_POLL_HZ } from "@amk/spc/driver-state";
import { emptySample } from "@amk/spc/brr";
import { instantiate, SPC_SAMPLE_RATE } from "@amk/spc/wasm-host";
import { SPC_ASSETS, check, section } from "../harness";
import { build, BY_NAME, driver } from "./support";

// ---------------------------------------------------------------------------
section("the driver keys a note off where the walk says it does");
// ---------------------------------------------------------------------------
{
	// `!PlayingVoices` is set in `KeyOnVoices` and cleared in `KeyOffVoices` and
	// nowhere else (`main.asm:2537, 2578`), so each run of its voice-0 bit, counted
	// in the driver's own ticks, is how long one note sounded. The lengths straddle
	// every case `frameSoundingTicks` has: frames too short for the gate to matter,
	// short ones where `!WaitTime` wins, the 127/128 split into 96-tick pieces, and
	// 193, whose last piece is one tick with no read-ahead tick to key off on.
	const PLAYING_VOICES = 0x0382;
	const lengths = [2, 3, 4, 6, 8, 12, 24, 48, 96, 127, 128, 144, 192, 193, 200];
	const spread = lengths.map((n) => `c=${n} r8`).join(" ");
	const source =
		`#amk 4\n#0 t200 v200 @0 o4 q0F ${spread} q3F ${spread} q7F ${spread} ` +
		`$F4 $02 ${spread} $F4 $02 c8 c8 c8 c8 r8\n`;
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

	// A key-off happens inside the voice loop, after the pass's `$44` write, so it
	// belongs to the tick counted by then. A key-on is the last thing a pass does
	// (`main.asm:2532`), so one first seen by a poll that also crossed into the next
	// pass belongs to the tick before. Polled well inside a pass so a short note's
	// key-on and key-off are never seen by the same poll.
	const POLLS_PER_TICK_POLL = 8;
	const sounded: number[] = [];
	const phase = createTickPhase();
	let seeded = false;
	let ticks = 0;
	let on = false;
	let since = 0;
	let pass = 0;
	const limit = 120 * TICK_POLL_HZ * POLLS_PER_TICK_POLL;
	for (let poll = 0; poll < limit && sounded.length < timeline.notes.length; poll++) {
		emu.renderView(SPC_SAMPLE_RATE / TICK_POLL_HZ / POLLS_PER_TICK_POLL);
		const aram = emu.aram();
		if (!seeded) {
			seedTickPhase(phase, aram);
			pass = passMark(aram);
			seeded = true;
			continue;
		}

		const before = ticks;
		const crossed = passMark(aram) !== pass;
		pass = passMark(aram);
		ticks += sawTick(phase, aram);
		const now = (aram[PLAYING_VOICES] & 1) !== 0;
		if (now && !on) {
			since = crossed ? before : ticks;
		} else if (!now && on) {
			sounded.push(ticks - since);
		}

		on = now;
	}

	const walked = timeline.notes.map((note) => note.gateTicks);
	check("every note keyed on and off once", sounded.length === walked.length, `${sounded.length} of ${walked.length}`);
	const differ = walked
		.map((gate, at) => (sounded[at] === gate ? null : `#${at} ${timeline.notes[at].ticks}t: ${sounded[at]}!=${gate}`))
		.filter((line) => line !== null);
	check("each sounds as long as the walk's gateTicks", differ.length === 0, differ.slice(0, 8).join(", "));
}
