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
import { expectedArgs } from "@amk/tokens";
import { loadDriver } from "@amk/spc/driver";
import { buildSpc } from "@amk/spc/export";
import { readDriverState } from "@amk/spc/driver-state";
import { emptySample } from "@amk/spc/brr";
import { SPC_SAMPLE_RATE, instantiate } from "@amk/spc/wasm-host";
import { type SongTimeline, type TempoChange, unreachableChannels, vcmdLength, walkSong } from "@amk/spc/song-walk";
import { secondsAtTick, songClock } from "../web/src/app/state/song-clock";
import { measureClock, tempoShortfall } from "../web/src/app/state/measure-clock";
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

summarise();
