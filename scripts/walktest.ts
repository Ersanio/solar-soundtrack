/**
 * The song-data walker: `@amk/spc/song-walk`.
 *
 * The piano roll is drawn entirely from what this says, and a walker that
 * mis-frames one command draws a plausible-looking roll that is quietly wrong —
 * there is no visual tell. Three assertions carry the weight, and none of them
 * is obvious from the names:
 *
 * 1. **`vcmdLength` is pinned against `expectedArgs`.** `@amk/spc` may not reach
 *    `@amk/tokens`, so the two packages each state how long a VCMD is — one
 *    about emitted bytes, one about source text. That is the arrangement
 *    `BANK_SLOT_COUNT` and `MELODIC_SRCN` already live under, and it is only
 *    safe because something asserts the pair agree. This is that something.
 *    Checked at the default target alone, deliberately: the dialect forks are
 *    gone by the time bytes exist, since `parser.ts` rewrites `#am4`'s
 *    `$ED $80` to `$F6` and `#amk 1`'s `$FC` before either reaches the blob.
 *
 * 2. **`$FB`'s arguments are not walked as notes.** An arpeggio's note bytes sit
 *    in the `$80` range without being notes, so a walker that priced `$FB` at a
 *    fixed length would invent a chord out of nowhere and still produce a
 *    timeline that looks entirely reasonable. The song here writes two notes and
 *    must yield exactly two.
 *
 * 3. **The emulator is the oracle.** Tick totals agreeing with `stats` only
 *    proves the walk agrees with AddmusicK's own prediction — both could be
 *    wrong together. So the real driver is run, and at every poll the note the
 *    walk says is sounding is compared against the one the voice's track pointer
 *    is actually on. Overwhelming agreement rather than unanimity, for the
 *    reason `audiotest` gives: a pointer read from outside the emulator can be
 *    caught half-written.
 *
 * A fourth, for `AMK0502`: a loop that repeats too many times must kill no
 * *written* note. The same four notes sound in the iterations that survive, and
 * a diagnostic that underlined them would be telling an author a note is dead
 * while they can hear it playing.
 *
 *   npm run walktest
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { compiler } from "@amk/compiler";
import { type CompileResult, noteAddressAt } from "@amk/core/types";
import { FIRST_VCMD, LAST_VCMD } from "@amk/core/hardcoded-tables";
import { commandStartingAt, expectedArgs, tokenize } from "@amk/tokens";
import { commandScope, parseTimeInForce } from "@amk/tokens/commands/in-force";
import { loadDriver } from "@amk/spc/driver";
import { buildSpc } from "@amk/spc/export";
import { readDriverState } from "@amk/spc/driver-state";
import { emptySample } from "@amk/spc/brr";
import { SPC_SAMPLE_RATE, instantiate } from "@amk/spc/wasm-host";
import {
	SLOTS,
	type SongTimeline,
	type StateSlot,
	type TempoChange,
	unreachableChannels,
	vcmdLength,
	walkSong,
} from "@amk/spc/song-walk";
import { secondsAtTick, songClock } from "../web/src/app/state/song-clock";
import { measureClock, tempoShortfall } from "../web/src/app/state/measure-clock";
import { commandsInForceOf } from "../web/src/app/state/commands-in-force";
import { driverTickSeconds } from "@amk/tokens/commands/units";

import { SPC_ASSETS, check, stubFetch, summarise } from "./harness";

stubFetch();

const driver = await loadDriver();
const ARAM = driver.manifest.localPos;
const OPTIONS = {
	sampleNames: driver.samples.map((sample) => sample.sampleName),
	sampleGroups: driver.manifest.sampleGroups,
};

const BY_NAME = new Map(driver.samples.map((sample) => [sample.sampleName, sample]));

function build(source: string): { result: CompileResult; timeline: SongTimeline } {
	const result = compiler.compile({ source, aramAddress: ARAM, options: OPTIONS });
	if (!result.ok || !result.data) {
		throw new Error(result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
	}

	return { result, timeline: walkSong(result.data, ARAM) };
}

/** The default target, which is the only one emitted bytes can be in. */
const DEFAULT_TARGET = { program: 0, amkVersion: 4 } as const;

// ---------------------------------------------------------------------------
console.log("both packages agree on how long a command is");
// ---------------------------------------------------------------------------
{
	const args = (values: number[]) => values.map((value) => ({ value }));

	let mismatched = "";
	for (let vcmd = FIRST_VCMD; vcmd <= LAST_VCMD; vcmd++) {
		if (vcmd === 0xfa || vcmd === 0xfb) {
			continue; // Both are variable, and get their own checks below.
		}

		const bytes = Uint8Array.from([vcmd, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		const expected = (expectedArgs(vcmd, args([0, 0, 0, 0, 0, 0, 0, 0]), DEFAULT_TARGET) ?? -1) + 1;
		if (vcmdLength(bytes, 0) !== expected) {
			mismatched += ` $${vcmd.toString(16)}(${vcmdLength(bytes, 0)}!=${expected})`;
		}
	}

	check("every fixed-length VCMD matches expectedArgs", mismatched === "", mismatched);

	let arpeggio = "";
	for (const count of [0x00, 0x01, 0x03, 0x7f, 0x80, 0xff]) {
		const bytes = Uint8Array.from([0xfb, count, ...new Array<number>(count + 4).fill(0x80)]);
		const expected = (expectedArgs(0xfb, args([count]), DEFAULT_TARGET) ?? -1) + 1;
		if (vcmdLength(bytes, 0) !== expected) {
			arpeggio += ` $${count.toString(16)}(${vcmdLength(bytes, 0)}!=${expected})`;
		}
	}

	check("$FB matches expectedArgs at every count", arpeggio === "", arpeggio);

	// `$FA $FE`'s hot patch takes one further byte for every trailing byte whose
	// high bit is set — a flat 3 is right only for a chain of one.
	let hotPatch = "";
	for (const chain of [[0x05], [0x80, 0x05], [0x80, 0x80, 0x05], [0x80, 0x80, 0x80, 0x05]]) {
		const bytes = Uint8Array.from([0xfa, 0xfe, ...chain, 0x00, 0x00]);
		const expected = (expectedArgs(0xfa, args([0xfe, ...chain]), DEFAULT_TARGET) ?? -1) + 1;
		if (vcmdLength(bytes, 0) !== expected) {
			hotPatch += ` [${chain.length}](${vcmdLength(bytes, 0)}!=${expected})`;
		}
	}

	check("$FA $FE matches expectedArgs at every chain length", hotPatch === "", hotPatch);
	check("a plain $FA is three bytes", vcmdLength(Uint8Array.from([0xfa, 0x06, 0x01]), 0) === 3);
	check("a byte that is not a VCMD has no length", vcmdLength(Uint8Array.from([0x80]), 0) === 0);
}

// ---------------------------------------------------------------------------
console.log("\nthe walk and the compiler agree on how long the song is");
// ---------------------------------------------------------------------------

/** Each song isolates one hazard; the name is what it is there to catch. */
const CORPUS: { name: string; source: string }[] = [
	{ name: "plain melody", source: "#amk 4\n#0 o4 c8d8e8f8 g4 r4\n" },
	{ name: "normal loop", source: "#amk 4\n#0 o4 [c8d8]4 e4\n" },
	{ name: "superloop", source: "#amk 4\n#0 o4 [[c8d8]]3 e4\n" },
	// The space is required: `[[[` is AMK0120, ambiguous between the two forms.
	{ name: "superloop inside a loop", source: "#amk 4\n#0 o4 [ [[c8d8]]2 e8]3 f4\n" },
	{ name: "loop recall", source: "#amk 4\n#0 o4 [c8d8]2 e4 *3 f4\n" },
	{ name: "an intro", source: "#amk 4\n#0 o4 c4d4 / e4f4\n" },
	{ name: "ties", source: "#amk 4\n#0 o4 c1^1^1^1 d4\n" },
	{ name: "long note split", source: "#amk 4\n#0 o4 c=192 c=192 d4\n" },
	{ name: "quantization", source: "#amk 4\n#0 o4 q44 c4 q7f d4\n" },
	{ name: "rests", source: "#amk 4\n#0 o4 c4 r4 r8 r8 d4\n" },
	{ name: "percussion on #0", source: "#amk 4\n#0 @29 o2 a1 b2 c3\n" },
	{ name: "percussion on #6", source: "#amk 4\n#0 o4 c1 c2 c3\n#6 @29 o2 a1 b2 c3\n" },
	{ name: "arpeggio", source: "#amk 4\n#0 o4 $FB $03 $10 $80 $84 $87 c4 d4\n" },
	{ name: "hot patch chain", source: "#amk 4\n#0 $FA $FE $80 $80 $05 o4 c4 d4\n" },
	{ name: "remote call", source: "#amk 4\n(!1)[$E7 $30]\n#0 o4 (!1,-1) c4 d4\n" },
	// Music.cpp:385-400 — text above the first marker is written to the lowest
	// channel declared anywhere, so these head #0 and #1 respectively.
	{ name: "commands above the first channel", source: "#amk 4\n$ED $7F $E0 t54 v200\n#0 o4 c8 d8\n#1 o4 e8 f8\n" },
	{ name: "the starting channel is the lowest declared", source: "#amk 4\n$ED $7F $E0\n#1 o4 e8 f8\n" },
	// One channel in two blocks is one track: six notes on #0, six on #5.
	{ name: "a split channel", source: "#amk 4\n\n#0 v255 t54 @15\naaa\n\n#5 @17\ncccccc\n\n#0 @9\nbbb\n" },
	{ name: "eight channels", source: eightChannels() },
	{
		name: "a real song",
		source: "#amk 4\n#0 t54 v200 @0 o4 q7F [c8 d8 e8]4 g2\n#1 v180 @1 o3 q7F c1c1\n#2 @4 o5 v150 l16 [ceg>c<]8\n",
	},
];

function eightChannels(): string {
	let source = "#amk 4\n";
	for (let channel = 0; channel < 8; channel++) {
		source += `#${channel} @${channel} o${(channel % 4) + 3} l8 [cdef]4\n`;
	}

	return source;
}

for (const song of CORPUS) {
	const { result, timeline } = build(song.source);
	const stats = result.stats;
	if (!stats) {
		check(`${song.name}: compiled with stats`, false);
		continue;
	}

	// AddmusicK's own prediction (`parser.ts`'s tick accounting, which multiplies
	// a loop body's length by its count) against a walk of the bytes it emitted.
	// Two genuinely independent computations of the same number.
	const mismatch = stats.channelTicks
		.map((ticks, channel) => ({ ticks, channel }))
		.filter(({ ticks, channel }) => ticks !== timeline.channelTicks[channel])
		.map(({ ticks, channel }) => `#${channel} stats ${ticks} walk ${timeline.channelTicks[channel]}`)
		.join(", ");
	check(`${song.name}: ticks per channel agree`, mismatch === "", mismatch);

	check(
		`${song.name}: one pass is the intro plus one trip round`,
		timeline.ticks === stats.introTicks + stats.loopTicks,
		`walk ${timeline.ticks}, stats ${stats.introTicks} + ${stats.loopTicks}`,
	);
	check(
		`${song.name}: the loop comes back where the compiler says`,
		timeline.loopTick === (stats.loops ? stats.introTicks : null),
		`walk ${String(timeline.loopTick)}, stats ${stats.introTicks} loops=${String(stats.loops)}`,
	);
	check(
		`${song.name}: the walk finished`,
		!timeline.truncated && timeline.problems.length === 0,
		timeline.problems.join(" | "),
	);
}

// ---------------------------------------------------------------------------
console.log("\nthe song's tempo map");
// ---------------------------------------------------------------------------
{
	const map = (source: string) => build(source).timeline.tempoChanges;
	const shown = (changes: readonly TempoChange[]) =>
		changes.map((c) => `${c.tick}:t${c.tempo}${c.fadeTicks ? `/${c.fadeTicks}` : ""}`).join(" ");

	const plain = map("#amk 4\n#0 o4 t54 c4\n");
	check("a t at the top is one change on tick 0", shown(plain) === "0:t54", shown(plain));

	// `$E3` writes its duration first and its target second (`parser.ts:1706-1708`).
	// A map that swapped them still reads as a perfectly reasonable fade.
	const fade = map("#amk 4\n#0 o4 t20,96 c1\n");
	check(
		"a fade keeps its duration and its target apart",
		shown(fade) === "0:t96/20",
		`${shown(fade)} — tempo ${fade[0]?.tempo}, over ${fade[0]?.fadeTicks}`,
	);

	const later = map("#amk 4\n#0 o4 c1 t96 c1\n");
	check("a command runs where the channel has got to", shown(later) === "192:t96", shown(later));

	// The claim that makes the map worth having: it records *executions*, not
	// bytes. The compiler cannot say this at all — `parser.ts:1692` gives up on
	// the song's whole length for a `t` in the loop block — and a walk that
	// recorded bytes would say one change and produce a timeline that looks fine.
	const looped = map("#amk 4\n#0 o4 [t96 c1]3\n");
	check("a t inside a loop is recorded once per iteration", shown(looped) === "0:t96 192:t96 384:t96", shown(looped));

	const subloop = map("#amk 4\n#0 o4 [[t96 c1]]2\n");
	check("and once per turn of a superloop", shown(subloop) === "0:t96 192:t96", shown(subloop));

	// The driver's own order, which is what makes a table built forward from the
	// list correct. Nothing sorts it; the walk emits it that way.
	const two = map("#amk 4\n#0 o4 c1 t96 c1\n#1 o4 t60 c1 c1\n");
	check("two channels interleave by tick, unsorted", shown(two) === "0:t60 192:t96", shown(two));

	// The same cut `notes` takes, and what AMK0217 warns about.
	const past = map("#amk 4\n#0 o4 c4\n#1 o4 c4 c4 t96 c4\n");
	check("a t past the shortest channel never runs", shown(past) === "", shown(past));

	// The premise of the whole clock, in one place: if this ever stops being true
	// the app can go back to `stats.playback` and none of it is needed.
	const { result, timeline } = build("#amk 4\n#0 o4 t20,96 c1\n");
	check(
		"a fade leaves the compiler with no length, and the walk with every tick",
		result.stats?.playback === null && timeline.ticks === 192 && timeline.tempoChanges.length === 1,
		`playback ${JSON.stringify(result.stats?.playback)}, ${timeline.ticks} ticks`,
	);
	check(
		"and the note it carries reports the tempo the fade is aiming at",
		timeline.notes[0]?.state.tempo === 96,
		String(timeline.notes[0]?.state.tempo),
	);
}

// ---------------------------------------------------------------------------
console.log("\nthe clock and the compiler agree about the songs the compiler can time");
// ---------------------------------------------------------------------------
{
	// The clock is the only thing that can time a faded song, so nothing can
	// check it against the compiler there. What *can* be checked is that it
	// retimes no ordinary song relative to `stats.playback` — and where it does,
	// that the size of the difference is named rather than discovered later.
	//
	// This needs the compiler for `stats`, the walk for the ticks and the app for
	// the arithmetic that makes them comparable, which is why it is here: no
	// package can reach all three, and `charttest` has no compiler.
	for (const song of CORPUS) {
		const { result, timeline } = build(song.source);
		const played = result.stats?.playback;
		const clock = songClock(timeline);
		if (!played || !clock) {
			check(`${song.name}: has both a length and a clock`, false);
			continue;
		}

		const stated = played.introSeconds + played.mainSeconds;
		const setsTempo = timeline.tempoChanges.some((change) => change.tick === 0 && change.fadeTicks === 0);
		if (setsTempo) {
			check(
				`${song.name}: the clock reads exactly what the compiler does`,
				Math.abs(clock.seconds - stated) < 1e-9,
				`clock ${clock.seconds.toFixed(6)}, stats ${stated.toFixed(6)}`,
			);
			continue;
		}

		// A song with no `t` differs by exactly 55/54, and the ratio is the
		// assertion. `estimateSeconds` unshifts `[0, 0x36]` (`parser.ts:3477`) and
		// reads `0x36` as an MML byte, adding one to get driver 55; `main.asm:177`
		// puts `#$36` into `$51` itself, which is driver 54, and that is what
		// `DEFAULT_TEMPO` says. The clock reads ~1.85% longer and is right —
		// commit a512e25 already ruled on this. Pinning the ratio means the next
		// person to touch either side sees the divergence rather than finding a
		// retimed editor.
		check(
			`${song.name}: with no t of its own it is the driver's t53, not AddmusicK's t54`,
			Math.abs(clock.seconds / stated - 55 / 54) < 1e-9,
			`clock ${clock.seconds.toFixed(6)}, stats ${stated.toFixed(6)}`,
		);
	}
}

// ---------------------------------------------------------------------------
console.log("\na song that does not loop");
// ---------------------------------------------------------------------------
{
	const { result, timeline } = build("#amk 4\n#option noloop\n#0 o4 c4d4e4f4\n");
	check("the compiler says it does not loop", result.stats?.loops === false);
	check("and so does the walk", timeline.loopTick === null);
	check("its notes are still there", timeline.notes.length === 4, `${timeline.notes.length} notes`);
}

// ---------------------------------------------------------------------------
console.log("\nevery note the walk finds is a note the compiler mapped");
// ---------------------------------------------------------------------------
{
	let checked = 0;
	let unmapped = "";
	let wrongPitch = "";
	let wrongLength = "";

	for (const song of CORPUS) {
		const { result, timeline } = build(song.source);
		const byAddress = new Map((result.noteMap ?? []).map((entry) => [entry.address, entry]));

		for (const note of timeline.notes) {
			checked++;
			const entry = byAddress.get(note.address);
			if (!entry) {
				unmapped += ` ${song.name}#${note.channel}@0x${note.address.toString(16)}`;
				continue;
			}

			// `noteMap` records the emitting channel, which is the loop block for a
			// note inside `[ ]`; the walk records the voice that sounds it.
			if (entry.channel !== note.channel && entry.channel !== 8) {
				unmapped += ` ${song.name}#${note.channel}(mapped to ${entry.channel})`;
			}

			if (entry.note !== note.note) {
				wrongPitch += ` ${song.name} $${entry.note.toString(16)}!=$${note.note.toString(16)}`;
			}

			if (entry.ticks !== note.ticks) {
				wrongLength += ` ${song.name} ${entry.ticks}!=${note.ticks}`;
			}
		}
	}

	check("the corpus produced notes to check", checked > 100, `${checked} notes`);
	check("every walked note has a note-map entry", unmapped === "", unmapped);
	check("every walked note has the pitch the compiler emitted", wrongPitch === "", wrongPitch);
	check("every walked note has the length the compiler emitted", wrongLength === "", wrongLength);
}

// ---------------------------------------------------------------------------
console.log("\nthe note map keeps the pitch that was written");
// ---------------------------------------------------------------------------
{
	// The byte has `h` or the instrument's transposition folded in; the map
	// keeps the letter's own pitch beside it, since nothing downstream can get
	// it back — and that is the row the piano roll draws on.
	const { result, timeline } = build("#amk 4\n#0 @2 o5 g4 h7 o4 c4 h12 o0 c4 r4 o4 @21 c4\n");
	const entries = (result.noteMap ?? []).filter((entry) => entry.channel === 0);
	const at = (n: number) => entries[n];
	check("five entries, the rest among them", entries.length === 5, `${entries.length}`);
	check(
		"@2 takes five semitones off the byte and none off the written pitch",
		at(0).note === 0xb2 && at(0).written === 0xb7,
		`$${at(0).note.toString(16)} written $${at(0).written.toString(16)}`,
	);
	check(
		"h7 adds seven to the byte and none to the written pitch",
		at(1).note === 0xab && at(1).written === 0xa4,
		`$${at(1).note.toString(16)} written $${at(1).written.toString(16)}`,
	);
	check(
		"h12 o0 c is $80 on the wire and o0 c as written",
		at(2).note === 0x80 && at(2).written === 0x74,
		`$${at(2).note.toString(16)} written $${at(2).written.toString(16)}`,
	);
	check("a rest is written as it is emitted", at(3).note === 0xc7 && at(3).written === 0xc7);
	check(
		"a drum keeps the letter it was written under",
		at(4).note === 0xd0 && at(4).written === 0xa4,
		`$${at(4).note.toString(16)} written $${at(4).written.toString(16)}`,
	);
	check("and the walk still reads the bytes", timeline.notes.map((n) => n.note).join(",") === "178,171,128,208");

	// `$FA $02` is the driver's own version of `h`, added to the note number at
	// play time, so it is state a note reports rather than a change to the byte.
	const tuned = build("#amk 4\n#0 o4 c4 $FA $02 $03 c4 $FA $02 $FD c4\n").timeline;
	check(
		"$FA $02 is reported as the channel's tune",
		tuned.notes.map((n) => n.state.tune).join(",") === "0,3,-3",
		tuned.notes.map((n) => n.state.tune).join(","),
	);
	check(
		"and moves no note byte",
		tuned.notes.every((n) => n.note === 0xa4),
	);

	// A song-wide command is read by every channel's next note, not only by the
	// channel that ran it: the other channels' frozen state must be dropped too.
	const wide = build("#amk 4\n#0 o4 c4 t120 $E4 $02 c4\n#1 o4 c4 c4\n").timeline;
	const second = wide.notes.filter((n) => n.channel === 1);
	check("channel 1's first note is before the change", second[0].state.tempo === 0 && second[0].state.transpose === 0);
	check(
		"and its second note reports the tempo and transposition channel 0 set",
		second[1].state.tempo === 120 && second[1].state.transpose === 2,
		`t${second[1].state.tempo} $E4 ${second[1].state.transpose}`,
	);
}

// ---------------------------------------------------------------------------
console.log("\nthe commands that must not be walked as notes");
// ---------------------------------------------------------------------------
{
	// Assertion 2. The arpeggio's three note bytes are arguments, not notes.
	const { timeline } = build("#amk 4\n#0 o4 $FB $03 $10 $80 $84 $87 c4 d4\n");
	check("an arpeggio's note bytes are not notes", timeline.notes.length === 2, `${timeline.notes.length} notes`);

	const plain = build("#amk 4\n#0 o4 c4 d4\n").timeline;
	check(
		"and the arpeggio costs no ticks of its own",
		timeline.channelTicks[0] === plain.channelTicks[0],
		`${timeline.channelTicks[0]} against ${plain.channelTicks[0]}`,
	);

	// `$FC` points at a body in the loop block that runs off an event. Following
	// it would invent ticks; it must be skipped as a plain five-byte command.
	const remote = build("#amk 4\n(!1)[$E7 $30]\n#0 o4 (!1,-1) c4 d4\n").timeline;
	check(
		"a remote call costs no ticks and adds no notes",
		remote.channelTicks[0] === plain.channelTicks[0] && remote.notes.length === 2,
		`${remote.channelTicks[0]} ticks, ${remote.notes.length} notes`,
	);

	// A hot-patch chain is five bytes, not three. Getting it wrong desynchronises
	// everything after it, which shows up as the wrong number of notes.
	const hot = build("#amk 4\n#0 $FA $FE $80 $80 $05 o4 c4 d4\n").timeline;
	check(
		"a hot-patch chain does not desynchronise the channel",
		hot.notes.length === 2 && hot.channelTicks[0] === plain.channelTicks[0],
		`${hot.notes.length} notes, ${hot.channelTicks[0]} ticks`,
	);
}

// ---------------------------------------------------------------------------
console.log("\npercussion follows the channel it is written on");
// ---------------------------------------------------------------------------
{
	// `parser.ts:2676-2682` clears the instrument after the first remapped note,
	// except on the SFX channels. So the same three notes are one drum and two
	// pitched notes on #0, and three drums on #6 — which is the behaviour a
	// source-level pass would have to re-derive and this one gets for free.
	const melodic = build("#amk 4\n#0 @29 o2 a1 b2 c3\n").timeline;
	const drums = build("#amk 4\n#0 o4 c1 c2 c3\n#6 @29 o2 a1 b2 c3\n").timeline.notes.filter((n) => n.channel === 6);

	check(
		"on #0 a drum is followed by pitched notes",
		melodic.notes.length === 3 &&
			melodic.notes[0].percussion === 8 &&
			melodic.notes[1].percussion === null &&
			melodic.notes[2].percussion === null,
		melodic.notes.map((n) => `$${n.note.toString(16)}`).join(" "),
	);
	check(
		"and those notes keep the drum's own instrument",
		melodic.notes[1].state.instrument === 29,
		`instrument ${String(melodic.notes[1].state.instrument)}`,
	);
	check(
		"on #6 every note is the drum",
		drums.length === 3 && drums.every((n) => n.percussion === 8),
		drums.map((n) => `$${n.note.toString(16)}`).join(" "),
	);
	// Those three assertions are now the *entire* foundation the roll's lane rule
	// stands on: it places a note by the instrument in force, and this is what
	// says the instrument survives a `$D0` byte. Which of them counts as
	// percussion is a preference and lives in the app — `percussion.ts`, covered
	// by `charttest`.
	check(
		"the song says which instruments it sounds",
		melodic.usedInstruments.join(",") === "29",
		melodic.usedInstruments.join(","),
	);

	// A drum reached only through a `$D0` byte emits no `$DA` at all
	// (`parser.ts:1816-1847`), so a list built from instrument commands alone
	// would miss it entirely.
	check("including one no $DA ever named", melodic.usedInstruments.includes(29));

	// The walk must have no opinion about which of them is a drum. `@10` is one
	// the roll calls percussion by default and `@11` is not, and nothing here
	// may be able to tell them apart — the moment this list starts sorting them,
	// a view preference has moved into a package that states driver facts.
	const alike = build("#amk 4\n#0 @10 o4 c\n#1 @11 o4 c\n").timeline;
	check(
		"a drum and a melodic slot are listed alike",
		alike.usedInstruments.join(",") === "10,11",
		alike.usedInstruments.join(","),
	);

	// Ascending and distinct, because the control draws one chip per entry.
	const repeated = build("#amk 4\n#0 @5 o4 c @1 d @5 e\n#1 @1 o4 c\n").timeline;
	check(
		"each instrument is listed once, ascending",
		repeated.usedInstruments.join(",") === "1,5",
		repeated.usedInstruments.join(","),
	);
}

// ---------------------------------------------------------------------------
console.log("\nties, gates and the pitched range");
// ---------------------------------------------------------------------------
{
	const tied = build("#amk 4\n#0 o4 c1^1^1^1 d4\n").timeline;
	check("a tie chain is one note", tied.notes.length === 2, `${tied.notes.length} notes`);
	check("and it is as long as its parts", tied.notes[0].ticks === 192 * 4, `${tied.notes[0].ticks} ticks`);

	const gated = build("#amk 4\n#0 o4 q7F c4 q44 d4\n").timeline;

	// Even `q7F` does not sound for the whole slot. `NoteDurations[7]` is `$FF`
	// and `main.asm:2443` keeps only the high byte of `duration × $FF`, so the
	// longest gate there is is 255/256 of the note — 47 ticks of a 48-tick
	// quarter. A roll that drew the two as equal would be drawing the wrong
	// thing, so this pins the arithmetic rather than the intent.
	check(
		"the longest gate is 255/256 of the slot",
		gated.notes[0].gateTicks === (gated.notes[0].ticks * 0xff) >> 8,
		`${gated.notes[0].gateTicks} of ${gated.notes[0].ticks}`,
	);
	check(
		"a short gate sounds for less",
		gated.notes[1].gateTicks < gated.notes[0].gateTicks && gated.notes[1].gateTicks > 0,
		`${gated.notes[1].gateTicks} against ${gated.notes[0].gateTicks}`,
	);

	// The two ends of the keyboard, on the notes themselves rather than through
	// an aggregate: `key` is what a row is chosen by, and `$80` is o1 c.
	const range = build("#amk 4\n#0 o1 c4 o6 a4\n").timeline;
	check("the lowest key is o1 c", range.notes[0].key === 0, `${String(range.notes[0].key)}`);
	check("the highest key is o6 a", range.notes[1].key === 69, `${String(range.notes[1].key)}`);
}

// ---------------------------------------------------------------------------
console.log("\na channel longer than the song is reported, not drawn");
// ---------------------------------------------------------------------------
{
	// `#1` runs twice as long as `#0`. The driver ends a phrase the moment any
	// voice reads its `$00`, so half of `#1` is never played — silently, which
	// is what makes it worth a diagnostic rather than a shrug.
	const uneven = build("#amk 4\n#0 @0 o4 l8 [c d e f g f e d]4\n#1 @1 o3 l4 [c e g e]8\n");
	const [warning] = unreachableChannels(uneven.timeline, uneven.result.noteMap ?? []);

	check("an over-long channel is reported", warning !== undefined);
	check("it is AMK0502 and severe", warning?.code === "AMK0502" && warning?.severity === "severe", warning?.code);
	check("it names the channel that runs long", warning?.message.includes("#1") === true, warning?.message);
	check(
		"and the shortest channel it is measured against",
		warning?.message.includes("#0") === true && warning?.message.includes("768") === true,
		warning?.message,
	);
	check(
		// `#1` loses four of eight iterations of `[c e g e]`, and all four of those
		// notes still sound in the iterations that survive. Reporting them would
		// tell an author a note is dead while they can hear it playing, so a loop
		// that repeats too often must kill no written note at all.
		"losing loop iterations kills no written note",
		uneven.timeline.unreachable.length === 0,
		`${uneven.timeline.unreachable.length} reported`,
	);
	check(
		"but the channel is still reported, with a span to jump to",
		warning !== undefined && warning.span.end > warning.span.start,
		JSON.stringify(warning?.span),
	);

	// Straight-line music past the cutoff is where notes really do die.
	const tailSource = "#amk 4\n#0 @0 o4 l4 c d e f\n#1 @1 o4 l4 c d e f g a b > c\n";
	const tail = build(tailSource);
	const dead = tail.timeline.unreachable;
	const byAddress = new Map((tail.result.noteMap ?? []).map((e) => [e.address, e]));
	const text = (address: number) => {
		const span = byAddress.get(address)?.span;
		return span ? tailSource.slice(span.start, span.end) : "?";
	};

	check("notes written past the end are unreachable", dead.length === 4, `${dead.length}`);
	check(
		"every unreachable address is one the compiler mapped",
		dead.every((address) => byAddress.has(address)),
	);
	check(
		"none of them is a note that also sounds",
		dead.every((address) => !tail.timeline.notes.some((note) => note.address === address)),
	);
	check(
		"they are the four written past the cutoff",
		dead.map(text).sort().join(" ") === "a b c g",
		dead.map(text).join(" "),
	);

	// The roll must not also complain about it; it is not in `problems`, so the
	// same fact is not reported in two places with two different wordings.
	check("the walk keeps quiet about it", uneven.timeline.problems.length === 0, uneven.timeline.problems.join(" | "));

	// Channels of equal length, and a song with only one, have nothing to say.
	const even = build("#amk 4\n#0 @0 o4 l8 [c d e f g f e d]4\n#1 @1 o3 l4 [c e g e]4\n");
	check("even channels are not reported", unreachableChannels(even.timeline, even.result.noteMap ?? []).length === 0);
	check("and no note is unreachable", even.timeline.unreachable.length === 0);

	const alone = build("#amk 4\n#0 @0 o4 l8 c d e f\n");
	check(
		"a single-channel song is never over-long",
		unreachableChannels(alone.timeline, alone.result.noteMap ?? []).length === 0,
	);

	// Three long channels should read as a list rather than as three warnings.
	const many = build("#amk 4\n#0 @0 o4 l8 [c d]1\n#1 @1 o4 l8 [c d]4\n#2 @2 o4 l8 [c d]4\n#3 @3 o4 l8 [c d]4\n");
	const [multi] = unreachableChannels(many.timeline, many.result.noteMap ?? []);
	check(
		"several over-long channels are one diagnostic",
		unreachableChannels(many.timeline, many.result.noteMap ?? []).length === 1,
	);
	check(
		"listing all of them",
		["#1", "#2", "#3"].every((name) => multi?.message.includes(name)),
		multi?.message,
	);
}

// ---------------------------------------------------------------------------
console.log("\nmalformed data is contained, not thrown");
// ---------------------------------------------------------------------------
{
	// `*` before any `[ ]` emits `$E9 FF FF n` on purpose (`parser.ts:2485-2494`,
	// porting `Music.cpp:1321`), because AddmusicK builds it rather than
	// rejecting it. What it does *not* do is point outside the song: relocation
	// adds the loop-block base to `$FFFF` and keeps the low sixteen bits, so the
	// call wraps to one byte below the block and lands back inside the blob. The
	// driver follows it into whatever is there and so does the walk — the only
	// thing worth asserting is that a song built from nonsense still terminates.
	const { timeline } = build("#amk 4\n#0 o4 *2 c4 d4\n");
	check("a call to nowhere still terminates", !timeline.truncated, timeline.problems.join(" | "));

	// A blob whose phrase table points outside itself.
	const broken = walkSong(Uint8Array.from([0x00, 0x40, 0x00, 0x00]), ARAM);
	check("a phrase outside the song is reported", broken.problems.length > 0, broken.problems.join(" | "));
	check("and yields no notes", broken.notes.length === 0);

	const nothing = walkSong(new Uint8Array(0), ARAM);
	check("an empty blob is reported", nothing.problems.length > 0 && nothing.notes.length === 0);
}

// ---------------------------------------------------------------------------
console.log("\nthe driver plays what the walk says it will");
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
console.log("\nthe driver does not always run the song as fast as it is written");
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
	// figure and the AMK0503 that rides on it drift with them.
	let apart = 0;
	for (let driverTempo = 1; driverTempo <= 255; driverTempo++) {
		if (256 / (500 * driverTempo) !== driverTickSeconds(driverTempo)) {
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

// ---------------------------------------------------------------------------
console.log("\nthe command in force at a note is named exactly");
// ---------------------------------------------------------------------------
//
// The roll draws one glyph per command acting on a note, and clicking a glyph
// goes to that command in the source. Two joins carry that, and neither has any
// visual tell when it is wrong: the compiler's command map has to address the
// byte the walk reads, and the span it carries has to be the text a person
// wrote. A map off by one addresses an argument, and still draws.
{
	const source = "#amk 4\n#0 v255 (1)[ c8 d8 e8 ]2 v200 (1)5 @1 $ED $3F $4D $DF\n";
	const { result } = build(source);
	const map = result.commandMap ?? [];
	const commands = tokenize(source).commands;

	check("a song with commands has a command map", map.length > 0);

	let misaddressed = "";
	let unwritten = "";
	for (const entry of map) {
		const byte = result.data![entry.address - ARAM];
		if (source.slice(entry.span.start, entry.span.end).trim() === "") {
			unwritten += ` ${entry.address}`;
		}

		// `(1)n` and `[ ]` are the two spellings `gather` does not raise to
		// commands. Both are structure, and neither can carry a glyph.
		const command = commandStartingAt(commands, entry.span.start);
		if (command?.vcmd !== undefined && command.vcmd !== byte) {
			misaddressed += ` ${byte.toString(16)} vs ${command.vcmd.toString(16)}`;
		}
	}

	check("every hex entry addresses the byte its span was written as", misaddressed === "", misaddressed);
	check("and every entry's span is text somebody wrote", unwritten === "", unwritten);

	// A note in both maps would be a command in force on itself.
	const noteAddresses = new Set((result.noteMap ?? []).map((entry) => entry.address));
	check(
		"no note is in the command map",
		map.every((entry) => !noteAddresses.has(entry.address)),
	);

	// Nothing the roll draws is something it would then filter out.
	const undrawable = map
		.map((entry) => commandStartingAt(commands, entry.span.start))
		.filter((command) => command !== null && commandScope(command) === "position");
	check("no command that emits bytes is one the roll calls positioning", undrawable.length === 0);
}

// The case the whole design is for, and the one no reading of the text can
// reach: the command that decides it is not inside the body at all.
{
	const source = "#amk 4\n#0 v255 (1)[ c8 d8 e8 ]2 v200 (1)5\n";
	const { result, timeline } = build(source);
	const spans = new Map((result.commandMap ?? []).map((entry) => [entry.address, entry.span]));
	const volume = SLOTS.indexOf("volume");
	const textOf = (note: SongTimeline["notes"][number]) => {
		const at = note.origins[volume];
		const span = at === null ? undefined : spans.get(at);
		return span === undefined ? null : source.slice(span.start, span.end);
	};

	check("three written notes played seven times are 21 notes", timeline.notes.length === 21);
	check(
		"the first call's six sound under v255",
		timeline.notes.slice(0, 6).every((note) => textOf(note) === "v255"),
	);
	check(
		"and the second call's fifteen under v200",
		timeline.notes.slice(6).every((note) => textOf(note) === "v200"),
	);

	// One array per state change, not one per note: the roll builds a view model
	// off these, and a fresh array per note is a fresh view model per note.
	const distinct = new Set(timeline.notes.map((note) => note.origins));
	check("and share one origins array per state change", distinct.size === 2, `${distinct.size} arrays`);
}

// A command at the *end* of a body is in force for the body's own notes on the
// second pass and not the first. One at the head is in force on every pass, and
// would pass under any answer at all.
{
	const source = "#amk 4\n#0 v100 [ c8 d8 v200 ]2\n";
	const { result, timeline } = build(source);
	const spans = new Map((result.commandMap ?? []).map((entry) => [entry.address, entry.span]));
	const volume = SLOTS.indexOf("volume");
	const textOf = (note: SongTimeline["notes"][number]) => {
		const at = note.origins[volume];
		const span = at === null ? undefined : spans.get(at);
		return span === undefined ? null : source.slice(span.start, span.end);
	};

	check("a loop body's first pass is under what preceded the loop", textOf(timeline.notes[0]) === "v100");
	check("and its second under what its own last pass set", textOf(timeline.notes[2]) === "v200");
}

// A command above the first marker is on the starting channel's track — the
// lowest channel declared anywhere (Music.cpp:385-400) — and the walk sees it
// there, and nowhere else, because that is where the bytes are.
{
	const named = (source: string, slot: StateSlot) => {
		const { result, timeline } = build(source);
		const spans = new Map((result.commandMap ?? []).map((entry) => [entry.address, entry.span]));
		const at = SLOTS.indexOf(slot);
		return (channel: number) => {
			const note = timeline.notes.find((n) => n.channel === channel);
			const address = note?.origins[at] ?? null;
			const span = address === null ? undefined : spans.get(address);
			return span === undefined ? null : source.slice(span.start, span.end);
		};
	};

	const heads = named("#amk 4\n$ED $7F $E0\n#0 o4 c8 d8\n#1 o4 e8 f8\n", "envelope");
	check("an $ED above #0 is in force on #0's first note", heads(0) === "$ED $7F $E0");
	check("and not on #1's", heads(1) === null);

	const lowest = named("#amk 4\n$ED $7F $E0\n#1 o4 e8 f8\n", "envelope");
	check("with no #0 declared it is on #1's, the lowest there is", lowest(1) === "$ED $7F $E0");

	const later = named("#amk 4\n$ED $7F $E0\n#1 o4 e8 f8\n#0 o4 c8 d8\n", "envelope");
	check("and a #0 declared further down takes it back", later(0) === "$ED $7F $E0" && later(1) === null);
}

// A channel written in two blocks is one track, and the walk reads it as one:
// the second block's notes follow the first's in time and under its own `@`.
{
	const source = "#amk 4\n\n#0 v255 t54 @15\naaa\n\n#5 @17\ncccccc\n\n#0 @9\nbbb\n";
	const { result, timeline } = build(source);
	const spans = new Map((result.commandMap ?? []).map((entry) => [entry.address, entry.span]));
	const instrument = SLOTS.indexOf("instrument");
	const under = (note: SongTimeline["notes"][number]) => {
		const at = note.origins[instrument];
		const span = at === null ? undefined : spans.get(at);
		return span === undefined ? null : source.slice(span.start, span.end);
	};

	const first = timeline.notes.filter((n) => n.channel === 0);
	const fifth = timeline.notes.filter((n) => n.channel === 5);
	check("#0 written in two blocks is six notes", first.length === 6, `${first.length} notes`);
	check("as many as #5 written in one", fifth.length === 6, `${fifth.length} notes`);
	check(
		"and they follow each other in time",
		first.every((note, n) => n === 0 || note.tick > first[n - 1].tick),
	);
	check(
		"the first block's under @15 and the second's under @9",
		first.slice(0, 3).every((n) => under(n) === "@15") && first.slice(3).every((n) => under(n) === "@9"),
		first.map((n) => under(n)).join(","),
	);
	check(
		"and #5's under @17",
		fifth.every((n) => under(n) === "@17"),
	);
	check(
		"only those two channels play",
		timeline.used
			.map((u, ch) => (u ? ch : -1))
			.filter((ch) => ch >= 0)
			.join(",") === "0,5",
	);
}

// Taking a slot away, and the one thing that fills a slot with no command.
{
	const { timeline } = build("#amk 4\n#0 @1 $DE $00 $0C $08 c8 $DF d8 @21 e8\n");
	const vibrato = SLOTS.indexOf("vibrato");
	const instrument = SLOTS.indexOf("instrument");
	check("a $DE is in force on the note after it", timeline.notes[0].origins[vibrato] !== null);
	check("and $DF takes it away rather than replacing it", timeline.notes[1].origins[vibrato] === null);

	// `@21`-`@29` emit no `$DA`, so the drum a note byte loaded has no command in
	// the stream at all; keeping the last `$DA` would name one no longer in force.
	check("a drum loaded by its note byte leaves no stale instrument", timeline.notes[2].origins[instrument] === null);
}

// What names the drum instead: the note whose byte loaded it, which the walk
// carries as `drumFrom`, and the source, asked about that note, names the `@`.
// The two halves meet in `commands-in-force.ts`, and this is where the join is
// pinned end to end — the roll and the note panel read it and nothing else can
// exercise it.
{
	/** The commands acting on each note, as the roll's glyphs will show them, spelled as written. */
	const acting = (source: string) => {
		const { result, timeline } = build(source);
		const index = tokenize(source);
		const inForce = commandsInForceOf({
			index,
			text: source,
			commands: new Map((result.commandMap ?? []).map((entry) => [entry.address, entry])),
			notes: new Map((result.noteMap ?? []).map((entry) => [entry.address, entry])),
		});
		const folded = parseTimeInForce(index, source);
		const spell = (command: { span: { start: number; end: number } }) =>
			source.slice(command.span.start, command.span.end);
		return {
			timeline,
			glyphs: (n: number) => inForce(timeline.notes[n]).map(spell).join(" "),
			foldedInto: (text: string) => {
				const command = commandStartingAt(index.commands, source.indexOf(text));
				return command === null ? "?" : (folded.get(command) ?? []).map(spell).join(" ");
			},
		};
	};

	// The plain case: the compiler folds `@21` into `c` alone (`selftest` pins the
	// bytes), and `d` still plays on drum 21's sample.
	const plain = acting("#amk 4\n#0 @21 c8 d8\n");
	check("a drum note names its own @", plain.glyphs(0) === "@21", plain.glyphs(0));
	check(
		"the pitched note after it names the same @ through the note that loaded it",
		plain.glyphs(1) === "@21",
		plain.glyphs(1),
	);
	check(
		"which the source alone would not: nothing was folded into it",
		plain.foldedInto("d8") === "",
		plain.foldedInto("d8"),
	);
	check(
		"and drumFrom is that note's address",
		plain.timeline.notes[1].drumFrom === plain.timeline.notes[0].address &&
			plain.timeline.notes[0].drumFrom === plain.timeline.notes[0].address,
	);

	// Through a `]`: the `@21` inside the body is gone at the `]` for the compiler,
	// and the sample it loaded is still under `d`.
	const looped = acting("#amk 4\n#0 [ @21 c8 ]2 d8\n");
	check("a drum loaded inside a [ ] is named on the note after the ]", looped.glyphs(2) === "@21", looped.glyphs(2));

	// A `$DA` reloads, and takes the drum with it: one glyph, the walk's.
	const reloaded = acting("#amk 4\n#0 @21 c8 @0 d8\n");
	check("a $DA after the drum is the only instrument named", reloaded.glyphs(1) === "@0", reloaded.glyphs(1));
	check("and drumFrom is cleared by it", reloaded.timeline.notes[1].drumFrom === null);

	// A `*` replays the drum byte, and a note after it is on the drum again — with
	// the `$DA` between them no longer in force, so it is not named twice.
	const replayed = acting("#amk 4\n#0 [ @21 c8 ]1 @0 d8 * e8\n");
	check(
		"a * that replays a drum byte puts a later note back on the drum",
		replayed.glyphs(3) === "@21",
		replayed.glyphs(3),
	);

	// And a call from another channel: the `@21` was written on #0, the note it
	// reaches is on #1, and no reading of #1's text could find it.
	const called = acting("#amk 4\n#0 (1)[ @21 c8 ]1 d8\n#1 (1)1 e8\n");
	const e = called.timeline.notes.findIndex((note) => note.channel === 1 && note.percussion === null);
	check(
		"a drum loaded by a call from another channel is named on that channel's note",
		e >= 0 && called.glyphs(e) === "@21",
		called.glyphs(e),
	);
}

// `main.asm:2321` calls `SetInstrument` with 0 for every channel whose `$C1+x`
// is still zero, which `main.asm:2193` has just made true of all of them.
{
	const { timeline } = build("#amk 4\n#0 c8 d8\n");
	check(
		"a channel with no @ plays @0",
		timeline.notes.every((note) => note.state.instrument === 0),
	);
}

// Every slot is reachable. One that nothing can write is one the roll will
// never draw, and it would look exactly like a command with no glyph.
{
	// The remote form rather than a bare `$FC`: the compiler writes that byte's
	// address itself, so `(!1,1,24)` is the only spelling that produces a real one.
	const source =
		"#amk 4\n" +
		"(!1)[$F4 $09]\n" +
		"#0 @1 $F3 $00 $04 $ED $3F $4D v200 y10 $EE $01 $FA $02 $01 n10 p12,8 $E5 $00 $12 $08\n" +
		"$EB $00 $18 $02 $DD $00 $18 $A4 $FB $02 $06 $A4 $A7 $F4 $01 $FA $00 $00 t144 w200 $E4 $00\n" +
		"$EF $FF $28 $28 $F5 $7F $00 $00 $00 $00 $00 $00 $00 (!1,1,24) c8\n";
	const { timeline } = build(source);
	const note = timeline.notes[timeline.notes.length - 1];
	const unreached: StateSlot[] = [];
	SLOTS.forEach((slot, at) => {
		if (note.origins[at] === null) {
			unreached.push(slot);
		}
	});

	check("one song writes every slot the walk tracks", unreached.length === 0, unreached.join(", "));

	// The song-wide slots are the tail of `SLOTS`, which is what `CHANNEL_SLOTS`
	// splits on. Filing a per-channel slot in that tail would have one channel's
	// command reported by all eight, and filing a song-wide one outside it would
	// have a `t` on #0 unheard by #1.
	const songWide: StateSlot[] = ["tempo", "globalVolume", "transpose", "echo", "fir"];
	const tail = SLOTS.slice(SLOTS.length - songWide.length);
	check("and the song-wide ones are its tail", tail.join(",") === songWide.join(","), tail.join(","));
}

summarise();
