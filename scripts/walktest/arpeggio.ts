/** `walktest`: the steps an `$FB` plays a note at, the driver taking them on the ticks the walk says, and a note it never keys on (`SST0516`). */

import "../localize";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSpc } from "@amk/spc/export";
import { createTickPhase, sawTick, seedTickPhase, TICK_POLL_HZ } from "@amk/spc/driver-state";
import { emptySample } from "@amk/spc/brr";
import { instantiate, SPC_SAMPLE_RATE } from "@amk/spc/wasm-host";
import { silentArpeggioNotes } from "../../web/src/app/state/silent-arpeggio";
import { SPC_ASSETS, check, section } from "../harness";
import { build, BY_NAME, driver } from "./support";

const spell = (steps: readonly number[] | null): string => (steps === null ? "null" : steps.join(","));

/** Each note's steps on `#0`, and whether the walk says an arpeggio plays it. */
const walked = (body: string): { steps: string[]; on: string } => {
	const notes = build(`#amk 4\n#0 @0 o4 ${body}\n`).timeline.notes;
	return {
		steps: notes.map((note) => spell(note.arpeggioSteps)),
		on: notes.map((note) => (note.state.arpeggio ? 1 : 0)).join(""),
	};
};

// ---------------------------------------------------------------------------
section("a note carries the steps of the $FB in force");
// ---------------------------------------------------------------------------
{
	// A quarter is 48 ticks, so a step every 6 is 8 steps; the last two ticks, where the timer is
	// held for the key-off, take none.
	const sequence = walked("$FB $03 $06 $00 $04 $07 c4 c8").steps;
	check("a sequence plays its offsets in turn", sequence[0] === "0,4,7,0,4,7,0,4", sequence[0]);
	check("and starts over on every note", sequence[1] === "0,4,7,0", sequence[1]);
	check(
		"a $80 marks where it loops back to",
		walked("$FB $04 $06 $00 $80 $04 $07 c4").steps[0] === "0,4,7,4,7,4,7,4",
		walked("$FB $04 $06 $00 $80 $04 $07 c4").steps[0],
	);
	check(
		"a negative offset is a signed byte",
		walked("$FB $02 $06 $00 $F4 c8").steps[0] === "0,-12,0,-12",
		walked("$FB $02 $06 $00 $F4 c8").steps[0],
	);
	check(
		"a trill starts on the other note",
		walked("$FB $80 $06 $0C c8").steps[0] === "12,0,12,0",
		walked("$FB $80 $06 $0C c8").steps[0],
	);

	const glissando = walked("$FB $81 $06 $01 c8 c8");
	check(
		"a glissando climbs from its first step, and ends itself on the next note",
		glissando.steps.join(" ") === "1,2,3,4 null" && glissando.on === "10",
		`${glissando.steps.join(" ")} ${glissando.on}`,
	);
	const oneNote = walked("$FA $7F $01 $FB $81 $06 $01 c8 c8");
	check(
		"under the 1.0.9 hot patch it ends on the first",
		oneNote.steps.join(" ") === "null null" && oneNote.on === "00",
		`${oneNote.steps.join(" ")} ${oneNote.on}`,
	);
	const unknown = walked("$FA $7F $08 $FB $81 $06 $01 c8 c8");
	check(
		"and under a preset past the table nothing is known",
		unknown.steps.join(" ") === "null null" && unknown.on === "11",
		`${unknown.steps.join(" ")} ${unknown.on}`,
	);
	check(
		"a glissando past its count of $81 never ends",
		walked("$FB $82 $06 $01 c8 c8").steps.join(" ") === "1,2,3,4 5,6,7,8",
		walked("$FB $82 $06 $01 c8 c8").steps.join(" "),
	);

	// The step on the first tick of `c=2` is held for the key-off, and so is the second.
	check("a note too short for a step is never keyed on", walked("$FB $02 $06 $00 $0C c=2").steps[0] === "");
	const trailing = walked("$FB $02 $06 $00 $80 c=6 c8 $FB $01 $06 $00 c8");
	check(
		"a trailing $80 reads past the list, and nothing is known until the next $FB",
		trailing.steps.join(" ") === "0 null 0,0,0,0",
		trailing.steps.join(" "),
	);
	const drum = walked("$FB $02 $06 $00 $0C @21 c4 @0 c8 $FB $00 $00 c8");
	check(
		"a drum under one is not followed, and $FB $00 $00 ends it",
		drum.steps.join(" ") === "null 0,12,0,12 null" && drum.on === "110",
		`${drum.steps.join(" ")} ${drum.on}`,
	);
}

/**
 * Every voice's read-ahead rewrites the one opcode that holds the timer, so another channel decides
 * whether a short note steps: `#1`'s `c=10` runs into a tie as `#0`'s `c=1` comes up, and its rest
 * ends as `#0`'s `c=2` does.
 */
const SHORT = "#0 t200 v200 @0 o4 q7F $FB $82 $03 $01 c=24 r=7 c=10 c=1 c=24 r=7 c=10 c=2 c=24";
const TIED = "#1 v200 @0 o3 q7F c=24 r=7 c=10 v180 ^=10 c=24 r=8 c=26";

/**
 * Runs a song on the driver and holds the walk's steps for every note to the ones it takes there.
 *
 * `$FB $82` is a glissando that never ends itself (`main.asm:2425-2427` ends type 2 alone), so with a
 * step of 1 each channel's `!ArpCurrentDelta` (`$0270+x`) counts every step it takes, rests included,
 * and each step's value says which it was. A step is taken in the voice loop, after the pass's `$44`
 * write, so it belongs to the tick counted by the poll that sees it. A note with no step is held to
 * `!PlayingVoices` (`$0382`) too, which no poll over its ticks may see set for its voice.
 */
const heldToDriver = (source: string): { compared: number; silent: number; differ: string[] } => {
	const DELTA = 0x0270;
	const PLAYING_VOICES = 0x0382;
	const POLLS_PER_TICK_POLL = 8;
	const { result, timeline } = build(source);
	const emu = instantiate(new WebAssembly.Module(readFileSync(join(SPC_ASSETS, "player", "spc.wasm"))));
	const samples = (result.sampleList ?? []).map((sample) => BY_NAME.get(sample) ?? emptySample(sample));
	emu.loadSpc(
		buildSpc({
			songData: result.data ?? new Uint8Array(0),
			driver,
			samples,
			echoBufferSize: result.stats?.echoBufferSize,
			date: new Date(2026, 6, 28),
		}).spc,
	);

	const voices = [0, 1, 2, 3, 4, 5, 6, 7];
	const stepped = voices.map(() => [] as { tick: number; offset: number }[]);
	const sounding = voices.map(() => new Set<number>());
	const last = voices.map(() => 0);
	const phase = createTickPhase();
	let seeded = false;
	let ticks = 0;
	const limit = 60 * TICK_POLL_HZ * POLLS_PER_TICK_POLL;
	for (let poll = 0; poll < limit; poll++) {
		emu.renderView(SPC_SAMPLE_RATE / TICK_POLL_HZ / POLLS_PER_TICK_POLL);
		const aram = emu.aram();
		if (!seeded) {
			seedTickPhase(phase, aram);
			voices.forEach((voice) => (last[voice] = aram[DELTA + voice * 2]));
			seeded = true;
			continue;
		}

		ticks += sawTick(phase, aram);
		for (const voice of voices) {
			const delta = aram[DELTA + voice * 2];
			if (delta !== last[voice]) {
				last[voice] = delta;
				stepped[voice].push({ tick: ticks, offset: (delta << 24) >> 24 });
			}

			if (aram[PLAYING_VOICES] & (1 << voice)) {
				sounding[voice].add(ticks);
			}
		}

		if (stepped[0].length > 0 && ticks - stepped[0][0].tick > timeline.ticks) {
			break;
		}
	}

	// The first note on `#0` steps on its own first tick, which anchors the two clocks.
	const anchor = (stepped[0][0]?.tick ?? 0) - (timeline.notes.find((note) => note.channel === 0)?.tick ?? 0);
	const differ: string[] = [];
	let compared = 0;
	let silent = 0;
	timeline.notes.forEach((note, at) => {
		if (note.arpeggioSteps === null) {
			return;
		}

		compared++;
		const from = note.tick + anchor;
		const to = from + note.ticks;
		const heard = stepped[note.channel]
			.filter((step) => step.tick >= from && step.tick < to)
			.map((step) => step.offset);
		const steps = spell(note.arpeggioSteps);
		if (heard.join(",") !== steps) {
			differ.push(`#${note.channel} note ${at}, ${note.ticks}t: ${heard.join(",")}!=${steps}`);
		}

		if (note.arpeggioSteps.length === 0) {
			silent++;
			for (let tick = from; tick < to; tick++) {
				if (sounding[note.channel].has(tick)) {
					differ.push(`#${note.channel} note ${at} keyed on at ${tick - anchor}`);
					break;
				}
			}
		}
	});

	return { compared, silent, differ };
};

// ---------------------------------------------------------------------------
section("the driver steps an arpeggio on the ticks the walk says");
// ---------------------------------------------------------------------------
{
	// The lengths straddle a frame too short to step on, the timer held on a frame's last ticks, a
	// tie carrying it on, and a last piece of one tick; the step lengths straddle `!WaitTime`, under
	// which nothing is held.
	const lengths = [1, 2, 3, 4, 6, 8, 24, 96, 97, 144, 193];
	const spread = `c=24 r=7 ${lengths.map((n) => `c=${n} r=7`).join(" ")}`;
	for (const [name, command] of [
		["every tick", "$FB $82 $01 $01"],
		["every 2 ticks, which is !WaitTime", "$FB $82 $02 $01"],
		["every 3 ticks", "$FB $82 $03 $01"],
		["every 13 ticks", "$FB $82 $0D $01"],
		["every 2 ticks under $F4 $02", "$F4 $02 $FB $82 $02 $01"],
		["a trill every 3 ticks", "$FB $80 $03 $01"],
	] as const) {
		const { compared, silent, differ } = heldToDriver(`#amk 4\n#0 t200 v200 @0 o4 q7F ${command} ${spread}\n`);
		check(
			`${name}: each note's steps are the ones the driver takes over it`,
			compared === lengths.length + 1 && differ.length === 0,
			`${compared} notes, ${silent} silent; ${differ.slice(0, 6).join(", ")}`,
		);
	}

	// On `#0` alone, the `c=1` after `c=10` is held on its one tick and never keyed on; beside
	// `#1`, whose `c=10` runs into a tie, `#1`'s read-ahead is the last to answer, and it says the
	// voice stays on. `#1`'s rest before the `c=2` answers the other way.
	const alone = build(`#amk 4\n${SHORT}\n`).timeline.notes.map((note) => spell(note.arpeggioSteps));
	const beside = build(`#amk 4\n${SHORT}\n${TIED}\n`)
		.timeline.notes.filter((note) => note.channel === 0)
		.map((note) => spell(note.arpeggioSteps));
	check(
		"another channel's read-ahead decides whether a short note steps",
		alone[2] === "" && /^-?\d+$/.test(beside[2] ?? "") && alone[5] === "" && beside[5] === "",
		`${alone.join(" ")} | ${beside.join(" ")}`,
	);

	// Legato answers for its channel that the voice stays on, and remote code that runs at the key-off
	// answers by the tick and the byte ahead (`main.asm:3126-3161`), each rewriting the opcode the
	// other channels read too.
	const voices = (head: string) =>
		[
			`#0 t200 ${head}v200 @0 o4 q7F $FB $82 $03 $01 c=24 r=7 c=1 c=2 c=3 c=5 r=3 c=1 c=40 c=2 c=144 r=2 c=1 c=24`,
			"#1 v200 @0 o3 q7F $FB $82 $05 $01 c=13 c=1 r=4 c=189 r=11 c=2 c=9 c=30",
			"#2 v200 @0 o5 q7F $F4 $01 $FB $82 $04 $01 c=7 c=9 r=5 c=13 c=3 c=1 c=30 r=2 c=2 c=60 c=1 c=126",
			"#3 v200 @0 o4 q7F (!1, 3) $FB $82 $04 $01 c=6 c=4 r=2 c=10 c=1 c=2 r=9 c=33 c=1 c=50 c=141",
		].join("\n");
	for (const [name, source] of [
		["four channels, with legato and remote code", `#amk 4\n(!1)[$E7 $FF]\n${voices("")}\n`],
		["and under $F4 $02", `#amk 4\n(!1)[$E7 $FF]\n${voices("$F4 $02 ")}\n`],
		["two channels, one running into a tie", `#amk 4\n${SHORT}\n${TIED}\n`],
	] as const) {
		const { compared, silent, differ } = heldToDriver(source);
		check(
			`${name}: each note's steps are the ones the driver takes over it, and a note with none is never keyed on`,
			compared > 5 && silent > 0 && differ.length === 0,
			`${compared} notes, ${silent} silent; ${differ.slice(0, 6).join(", ")}`,
		);
	}
}

// ---------------------------------------------------------------------------
section("a note an arpeggio never keys on is SST0516");
// ---------------------------------------------------------------------------
{
	const findings = (body: string) => {
		const source = `#amk 2\n${body}\n`;
		const { result, timeline } = build(source);
		return silentArpeggioNotes(timeline, result.noteMap ?? []).map((d) => ({
			code: d.code,
			text: source.slice(d.span.start, d.span.end),
			message: d.message,
		}));
	};

	const silent = findings("#0 @0 $FB $02 $06 $00 $0C o4 c8 c=2 c8");
	check(
		"on the note, and named by !WaitTime",
		silent.map((f) => `${f.code}@${f.text}`).join(" ") === "SST0516@c=2" &&
			silent[0]?.message ===
				"This note is too short for the arpeggio on it to take a step: the driver holds an arpeggio whose steps are longer than 2 ticks for the last 2 ticks before a key-off, so the note is never keyed on and plays nothing. Make it longer than 2 ticks, or the arpeggio's steps 2 ticks or shorter.",
		silent[0]?.message,
	);
	check(
		"which $F4 $02 makes 1",
		findings("#0 @0 $F4 $02 $FB $02 $06 $00 $0C o4 c8 c=1 c8")[0]?.message.includes(
			"longer than 1 ticks for the last 1",
		) === true,
	);
	check("a note one tick longer steps", findings("#0 @0 $FB $02 $06 $00 $0C o4 c8 c=3 c8").length === 0);
	check("and so does one under steps of !WaitTime", findings("#0 @0 $FB $02 $02 $00 $0C o4 c8 c=2 c8").length === 0);
	check("a note played three times is one finding", findings("#0 @0 $FB $02 $06 $00 $0C o4 [c8 c=2]3 c8").length === 1);
	const beside = findings(`${SHORT}\n${TIED}`)
		.map((f) => f.text)
		.join(" ");
	check("one another channel's read-ahead keeps on is not one", beside === "c=2", beside);
	check(
		"nor one under legato, whose read-ahead keeps the voice on",
		findings("#0 @0 $F4 $01 $FB $02 $06 $00 $0C o4 c8 c=2 c8").length === 0,
	);
}
