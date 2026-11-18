/** `walktest`: the vibrato a note sounds under, how long it moves before the key-off, and the note inspector's reading of it. */

import "../localize";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSpc } from "@amk/spc/export";
import { TICK_POLL_HZ } from "@amk/spc/driver-state";
import { emptySample } from "@amk/spc/brr";
import type { Vibrato } from "@amk/spc/song-walk";
import { instantiate, SPC_SAMPLE_RATE } from "@amk/spc/wasm-host";
import { vibratoLine } from "../../web/src/app/output/command-inspector/note-command/vibrato-swing";
import { SPC_ASSETS, check, section } from "../harness";
import { build, BY_NAME, driver } from "./support";

const spell = (vibrato: Vibrato | null): string =>
	vibrato === null ? "none" : `${vibrato.delay},${vibrato.rate},${vibrato.depth}`;

// ---------------------------------------------------------------------------
section("a note carries the $DE in force");
// ---------------------------------------------------------------------------
{
	const { timeline } = build("#amk 4\n#0 o4 c4 $DE $18 $0C $F2 c4 p6,12,34 c4 p12,34 c4 $DF c4 $DE $10 $10 $00 c4\n");
	const held = timeline.notes.map((note) => spell(note.state.vibrato));
	check("none before the first $DE", held[0] === "none", held[0]);
	check("$DE's delay, rate and depth", held[1] === "24,12,242", held[1]);
	check("p with three arguments is the same $DE", held[2] === "6,12,34", held[2]);
	check("p with two has no delay", held[3] === "0,12,34", held[3]);
	check("$DF leaves none", held[4] === "none", held[4]);
	check("and so does a $DE of depth 0, which the driver skips", held[5] === "none", held[5]);
}

// ---------------------------------------------------------------------------
section("the driver steps a vibrato as often as the walk says");
// ---------------------------------------------------------------------------
{
	// At a rate of 1 the phase, `$0330+x`, counts the vibrato's steps, and a key-on is the only
	// thing that zeroes it (`main.asm:453-457`). The step is skipped once `!PlayingVoices` is clear
	// (`main.asm:3298-3300`), so the phase read in the rest after a note is that note's count. The
	// lengths straddle a frame too short to reach the delay, the read-ahead keying off at the gate
	// and at `!WaitTime`, and the `$60`-tick pieces, whose first ticks fetch and so step nothing.
	const PLAYING_VOICES = 0x0382;
	const PHASE = 0x0330;
	const lengths = [2, 3, 4, 6, 8, 12, 24, 48, 96, 127, 128, 144, 192, 193, 200];
	const spread = lengths.map((n) => `c=${n} r8`).join(" ");
	const runs = [
		["$00", "q7F"],
		["$01", "q7F"],
		["$05", "q7F"],
		["$1E", "q7F"],
		["$01", "q3F"],
	];
	const body = runs.map(([delay, q]) => `$DE ${delay} $01 $40 ${q} ${spread}`).join(" ");
	const { result, timeline } = build(`#amk 4\n#0 t200 v200 @0 o4 ${body} r8\n`);

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

	// Polled well inside a tick, as `driver-key-off.ts` is, so a one-tick note's key-on and key-off
	// are never seen by the same poll.
	const POLLS_PER_TICK_POLL = 8;
	const stepped: number[] = [];
	let on = false;
	const limit = 120 * TICK_POLL_HZ * POLLS_PER_TICK_POLL;
	for (let poll = 0; poll < limit && stepped.length < timeline.notes.length; poll++) {
		emu.renderView(SPC_SAMPLE_RATE / TICK_POLL_HZ / POLLS_PER_TICK_POLL);
		const aram = emu.aram();
		const now = (aram[PLAYING_VOICES] & 1) !== 0;
		if (!now && on) {
			stepped.push(aram[PHASE]);
		}

		on = now;
	}

	const walked = timeline.notes.map((note) => note.vibratoTicks);
	check("every note keyed on and off once", stepped.length === walked.length, `${stepped.length} of ${walked.length}`);
	check("the walk has the vibrato moving on most of them", walked.filter((n) => n > 0).length > walked.length / 2);
	const differ = walked
		.map((steps, at) => {
			const note = timeline.notes[at];
			return stepped[at] === steps
				? null
				: `#${at} ${note.ticks}t gate ${note.gateTicks} delay ${note.state.vibrato?.delay}: ${stepped[at]}!=${steps}`;
		})
		.filter((line) => line !== null);
	check("each steps as often as the walk's vibratoTicks", differ.length === 0, differ.slice(0, 8).join(", "));
}

// ---------------------------------------------------------------------------
section("the note inspector names the notes a vibrato swings between");
// ---------------------------------------------------------------------------
{
	const said = (body: string, expected: string | null): [boolean, string] => {
		const { result, timeline } = build(`#amk 4\n#0 ${body}\n`);
		const note = timeline.notes[0];
		const got = vibratoLine(note, result.noteMap?.find((entry) => entry.address === note.address)?.written);
		return [got === expected, `${got}`];
	};

	// `$F2` is 510 256ths either way, two semitones less two: a hair flat of the note at the top and
	// sharp of it at the bottom.
	check(
		"$F2 is two semitones, each end a cent short",
		...said("$DE $00 $10 $F2 o4 c4", "Vibrato peaks at o4 d −1¢ and dips to o3 a+ +1¢"),
	);
	check(
		"$40 is a quarter of one, which names the note itself",
		...said("$DE $00 $10 $40 o4 c4", "Vibrato peaks at o4 c +25¢ and dips to o4 c −25¢"),
	);
	check(
		"$FF is fifteen, six cents short",
		...said("$DE $00 $10 $FF o4 c4", "Vibrato peaks at o5 d+ −6¢ and dips to o2 a +6¢"),
	);
	check(
		"half a semitone reads the same either way",
		...said("$DE $00 $10 $81 o4 c4", "Vibrato peaks at o4 c +50¢ and dips to o4 c −50¢"),
	);
	check(
		"from the pitch written, not the byte @2 made of it",
		...said("@2 $DE $00 $10 $F2 o5 g4", "Vibrato peaks at o5 a −1¢ and dips to o5 f +1¢"),
	);
	check(
		"a note that keys off inside the delay plays steady",
		...said("$DE $30 $10 $F2 o4 c8", "Keys off before the vibrato's 48-tick delay runs out, so it plays steady"),
	);
	check(
		"and one that keys off before a delay of 0 is up",
		...said("$DE $00 $10 $F2 o4 c=2", "Keys off before the vibrato starts, so it plays steady"),
	);
	check(
		"a rate of 0 never moves",
		...said("$DE $00 $00 $F2 o4 c4", "The vibrato's rate of 0 never moves it, so this note plays steady"),
	);
	check("nothing without a vibrato", ...said("o4 c4", null));
	check("nor for a drum, which sounds at its percussion entry's pitch", ...said("$DE $00 $10 $F2 @21 o4 c4", null));
	check("nor under noise, which no pitch reaches", ...said("$DE $00 $10 $F2 $F8 $10 o4 c4", null));
}
