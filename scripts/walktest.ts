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
 * A fourth, for `SST0502`: a loop that repeats too many times must kill no
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
import { commandsInForceOf, definedAt, noteHeardOn, notePreceding } from "../web/src/app/state/commands-in-force";
import { commandTimeline } from "../web/src/app/state/command-timeline";
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
console.log("\nthe loops the walk plays through");
// ---------------------------------------------------------------------------
//
// `SongTimeline.loops` is the roll's only ground truth for loop structure:
// which voice replays which body, how many times, entering at which tick.
// Nothing else can say it — a `(1)n` call may be another channel's text, and a
// body's `noteMap` entries are the loop block's — and a run that mis-prices one
// pass draws a group where nothing repeats, with no visual tell. The spelling
// here also pins the declaration/recall distinction on the one fact that
// carries it: a `]n`'s `$E9` is dropped from the command map (`parser.ts:649`)
// where a `(n)m`, `*n` or `$E6` is not.
{
	const shown = (source: string) => {
		const { result, timeline } = build(source);
		const mapped = new Set((result.commandMap ?? []).map((entry) => entry.address));
		return timeline.loops
			.map((run) => {
				const label = run.kind === "call" ? (mapped.has(run.from) ? "recall" : "decl") : "sub";
				return `${label}#${run.channel}x${run.count}@` + run.passes.map((p) => `${p.tick}+${p.ticks}`).join(",");
			})
			.join(" ");
	};

	const declared = shown("#amk 4\n#0 o4 [c8d8]4 e4\n");
	check("a [ ]n is one run of n passes", declared === "decl#0x4@0+48,48+48,96+48,144+48", declared);

	const sub = shown("#amk 4\n#0 o4 [[c8d8]]2 e4\n");
	check("a ]]n plays n times", sub === "sub#0x2@0+48,48+48", sub);

	// The hex spelling goes through `cmdE6`'s own arithmetic: the byte is one
	// less than the times the body plays.
	const hex = shown("#amk 4\n#0 o4 $E6 $00 c8d8 $E6 $02 e4\n");
	check("a hex $E6 $02 plays three times", hex === "sub#0x3@0+48,48+48,96+48", hex);

	const recalled = shown("#amk 4\n#0 o4 (1)[c8]2 d4 (1)3\n");
	check(
		"a label recall is its own run, told from the declaration by the command map",
		recalled === "decl#0x2@0+24,24+24 recall#0x3@96+24,120+24,144+24",
		recalled,
	);

	const star = shown("#amk 4\n#0 o4 [c8]2 d4 *3\n");
	check("a * is a recall too", star === "decl#0x2@0+24,24+24 recall#0x3@96+24,120+24,144+24", star);

	// Each outer pass opens and closes the subloop afresh, so nesting is already
	// enumerated: readers multiply nothing.
	const nested = shown("#amk 4\n#0 o4 [ [[c8]]2 d8]3 f4\n");
	check(
		"a subloop inside a loop is one run per outer pass",
		nested === "decl#0x3@0+72,72+72,144+72 sub#0x2@0+24,24+24 sub#0x2@72+24,96+24 sub#0x2@144+24,168+24",
		nested,
	);

	const across = shown("#amk 4\n#0 o4 (1)[c8 d8]2 e4\n#1 o4 (1)3 f4\n");
	check(
		"a cross-channel recall runs on the calling voice",
		across === "decl#0x2@0+48,48+48 recall#1x3@0+48,48+48,96+48",
		across,
	);

	{
		const { result, timeline } = build("#amk 4\n#0 o4 [c8 d8]2 e4\n");
		const run = timeline.loops[0];
		const body = (result.noteMap ?? []).filter((entry) => entry.channel === 8);
		const rest = (result.noteMap ?? []).filter((entry) => entry.channel !== 8);
		check(
			"the body range holds exactly the loop block's notes",
			body.length === 2 &&
				body.every((entry) => entry.address >= run.body.start && entry.address < run.body.end) &&
				rest.every((entry) => entry.address < run.body.start || entry.address >= run.body.end),
			`body ${run.body.start}..${run.body.end}, notes at ${(result.noteMap ?? []).map((e) => `#${e.channel}:${e.address}`).join(" ")}`,
		);
	}

	// The full walk keeps a run whose every pass is past the pass cut, exactly
	// as `channelTicks` is a full-walk figure — the roll's tail items need it.
	const past = shown("#amk 4\n#0 o4 c4\n#1 o4 c4 [d4 e4]2\n");
	check("a run past the end of the pass is still recorded", past === "decl#1x2@48+96,144+96", past);

	// An unterminated `$E6 $00` opens a subloop nothing closes: it plays exactly
	// what it says, once, and there is no run to report. The note in front is
	// what lets it compile — ticks inside an open subloop are only counted at
	// its close, and a song of zero counted ticks is AMK0303.
	const unterminated = shown("#amk 4\n#0 o4 e4 $E6 $00 c8 d8\n");
	check("an unterminated $E6 $00 is no run", unterminated === "", unterminated);

	// A remote body is jumped into by the driver, not looped over — no `$E9` is
	// emitted for it and the walk does not follow `$FC`.
	const remote = shown("#amk 4\n(!1)[$E7 $30]\n#0 o4 (!1,-1) c4 d4\n");
	check("a remote definition and its call are no run", remote === "", remote);

	// A crossed pair, as `Music.cpp:1208-1290` lets through: the subloop's close
	// jumps back into the loop's body, the channel ends on that body's `$00`
	// with the call counter spent, and what really played is one call run and a
	// one-pass sub whose body range partially overlaps it — the shape the roll
	// refuses, pinned here so the refusal has a stable input.
	const crossed = shown("#amk 4\n#0 o4 [c4 $E6 $00 d4]2 e4 $E6 $01\n");
	check(
		"a crossed loop and subloop file what really played",
		crossed === "decl#0x2@0+96,96+96 sub#0x1@144+96",
		crossed,
	);

	// A count of zero is skipped, not entered (`Commands.asm:161` via the walk's
	// own break) — and it opens no run. Only bytes can spell it: `]0` is
	// AMK0116 at parse, so the blob is built by hand here.
	{
		const at = (offset: number) => [(ARAM + offset) & 0xff, (ARAM + offset) >> 8];
		const blob = Uint8Array.from([
			...at(4), // the one phrase: channel starts at offset 4
			0x00,
			0x00, // end of the phrase table
			...at(20), // channel 0
			...new Array<number>(14).fill(0), // channels 1-7 unused
			0xe9,
			...at(24),
			0x00, // a call of count 0, targeting the note below
			0x30,
			0x80, // one note, so the channel is not empty
			0x00,
		]);
		const skipped = walkSong(blob, ARAM);
		check(
			"a $E9 of count zero is no run",
			skipped.loops.length === 0 && skipped.notes.length === 1 && skipped.problems.length === 0,
			`${skipped.loops.length} runs, ${skipped.notes.length} notes, ${skipped.problems.join(" | ")}`,
		);
	}
}

// ---------------------------------------------------------------------------
console.log("\nthe song's command list");
// ---------------------------------------------------------------------------
//
// The roll's command lane is drawn entirely from this, and it exists because the
// two readings that look sufficient are not. `origins` names the command in
// force *at a note*, so it dates a command to the next note that sounds — which
// a rest between the two moves — and it can never name a command that takes a
// slot away, there being no slot left for it to sit in.
{
	/**
	 * The list, spelled as it was written — and only the part that was.
	 *
	 * AddmusicK prepends `$FA $04 <echo size>` and `$FA $06 $01` to the lowest
	 * channel itself (`link.ts:prependBlobPrefix`, Music.cpp:2989-3050), so every
	 * song opens with two entries no author typed. The walk is right to record
	 * them — the driver runs them — and the lane drops them at the join, having
	 * no span to draw a glyph from. The check below is what holds them to two.
	 */
	const map = (source: string) => {
		const { result, timeline } = build(source);
		const spans = new Map((result.commandMap ?? []).map((entry) => [entry.address, entry.span]));
		return timeline.commands
			.filter((command) => spans.has(command.address))
			.map((command) => {
				const span = spans.get(command.address)!;
				return `${command.tick}:#${command.channel}:${source.slice(span.start, span.end)}`;
			})
			.join(" ");
	};

	{
		const { result, timeline } = build("#amk 4\n#1 o4 c4\n");
		const spans = new Set((result.commandMap ?? []).map((entry) => entry.address));
		const unwritten = timeline.commands.filter((command) => !spans.has(command.address));
		check(
			"the blob's own prefix is two commands nobody wrote, on the lowest channel",
			unwritten.length === 2 && unwritten.every((c) => c.vcmd === 0xfa && c.tick === 0 && c.channel === 1),
			unwritten.map((c) => `${c.tick}:#${c.channel}:$${c.vcmd.toString(16)}`).join(" "),
		);
	}

	const top = map("#amk 4\n#0 o4 v200 c4\n");
	check("a command at the top is one entry on tick 0", top === "0:#0:v200", top);

	const later = map("#amk 4\n#0 o4 c4 v200 c4\n");
	check("and one after a note is where that note ends", later === "48:#0:v200", later);

	// The reading `origins` cannot give. The next note that *sounds* is at 96, so
	// a lane built from a note's own state would draw this a whole rest late.
	const before = map("#amk 4\n#0 o4 c4 v200 r4 d4\n");
	check("a command before a rest is on the rest's own tick", before === "48:#0:v200", before);

	// `$DF` fills no slot at all, so no note can ever report it. It is here
	// because the list records a slot changing hands rather than a slot's
	// contents, and "there is no vibrato now" is a change.
	const off = map("#amk 4\n#0 o4 @1 $DE $00 $0C $08 c8 $DF d8\n");
	check("a command that clears a slot is recorded", off === "0:#0:@1 0:#0:$DE $00 $0C $08 24:#0:$DF", off);

	// And one that clears nothing is not: it is a transition, not an execution.
	const idle = map("#amk 4\n#0 o4 @1 c8 $DF d8\n");
	check("but one with nothing to clear is not", idle === "0:#0:@1", idle);

	// `$DD` is the one entry that is an execution, and the one raised outside
	// `recordOrigin`. It is not dispatched: the note in front of it swallows it
	// with a peek at the track pointer (`main.asm:3256-3287`), so it runs inside
	// that note and not at the tick the read pointer reached the byte, which is
	// where the note *ends* and is where every other command here would sit.
	const slide = map("#amk 4\n#0 o4 c4 $DD $00 $18 $A6 d4\n");
	check("a pitch slide is on the tick of the note that reads it", slide === "0:#0:$DD $00 $18 $A6", slide);

	// The same reading `afterTicks` carries, arrived at from the lane's end. The
	// peek happens again on a tie's own ticks, which is why `Music.cpp:2224`
	// rewinds a tie out of a `$DD`'s way — so the slide starts where the last
	// frame does and the operands alone cannot say where that is.
	const slideTied = map("#amk 4\n#0 o4 c4^4 $DD $00 $18 $A6 d4\n");
	check("and a tie in front of it takes the tick with the slide", slideTied === "48:#0:$DD $00 $18 $A6", slideTied);

	// Being an execution is what makes this two rather than one: the slide really
	// does run on each note that reads it, where the `[ v200 c8 ]2` above is one
	// entry because the second pass writes the address the slot already holds.
	const twice = map("#amk 4\n#0 o4 [ c4 $DD $00 $18 $A6 ]2\n");
	check("one inside a [ ] is an entry every pass", twice === "0:#0:$DD $00 $18 $A6 48:#0:$DD $00 $18 $A6", twice);

	// And nothing is left off the lane. With a rest in front of it no read-ahead
	// ever sees it, the command loop reaches it first and the SPC jumps to the
	// `$0000` its dispatch slot holds — so the tick is where the loop got to.
	const orphan = map("#amk 4\n#0 o4 c4 r4 $DD $00 $18 $A6 d4\n");
	check(
		"and one with no note to ride is recorded where the loop reaches it",
		orphan === "96:#0:$DD $00 $18 $A6",
		orphan,
	);

	// Whether a note *begins* where the command ran, which is the whole of what
	// decides the lane: a bar names the commands in force at its note, on that
	// note's own tick, so it speaks for where one ran only when the two agree.
	// No scope can make this test and neither can `origins`, which is anchored
	// on a note where the question is about the tick.
	const onNotes = (source: string) => {
		const { result, timeline } = build(source);
		const spans = new Map((result.commandMap ?? []).map((entry) => [entry.address, entry.span]));
		return timeline.commands
			.filter((command) => spans.has(command.address))
			.map(
				(command) =>
					`${source.slice(spans.get(command.address)!.start, spans.get(command.address)!.end)}:${command.onANote}`,
			)
			.join(" ");
	};

	const abutting = onNotes("#amk 4\n#0 o4 c4 v200 d4\n");
	check("a command the next note keys on with is on a note", abutting === "v200:true", abutting);

	// The case the lane exists for. The `v200` runs at 48 and the only thing
	// drawing it is `d4`'s chip at 96, a whole rest away.
	const resting = onNotes("#amk 4\n#0 o4 c4 v200 r4 d4\n");
	check("but one read while the channel rests is not", resting === "v200:false", resting);

	// A `$C6` sounds no note of its own — `emitNote` folds it into the one
	// already playing — so nothing keys on at the tick between the two.
	const tied = onNotes("#amk 4\n#0 o4 c4 v200 ^4 d4\n");
	check("nor one read inside a tie", tied === "v200:false", tied);

	// Replaced before anything sounds under it. The note at tick 0 reports the
	// `v100`, so the `v200` is on no bar at any tick and needs the lane.
	const replaced = onNotes("#amk 4\n#0 o4 v200 v100 c4\n");
	check("a command replaced before the next note is not on it", replaced === "v200:false v100:true", replaced);

	// The entry and not the address: both `v200`s are written once, run at tick
	// 0 on one channel and share a span, and only the second is in force.
	const turns = onNotes("#amk 4\n#0 o4 [[ v100 v200 ]]2 c4\n");
	check(
		"and only the turn still in force at the note is",
		turns === "v100:false v200:false v100:false v200:true",
		turns,
	);

	// Nothing left on its channel to key on with. `origins` cannot see this one
	// at all. `#1` is what carries the pass past it: a command on the last tick
	// of the *shortest* channel is cut from the list with the notes past it.
	const trailing = onNotes("#amk 4\n#0 o4 c2 v200 r2\n#1 o4 c2 c2\n");
	check("a command with no note after it is not on one", trailing === "v200:false", trailing);

	// The note that would report it is past the shortest channel, so the walk
	// sets it aside and no bar is drawn for it — while the command itself, at
	// tick 96, is still inside the pass and still runs.
	const beyond = onNotes("#amk 4\n#0 o4 c2 v200 r2 c2\n#1 o4 c2 r2\n");
	check("nor one whose only note the pass never reaches", beyond === "v200:false", beyond);

	// `$DF` fills no slot, so it is in no `origins` at any tick and this is
	// false for it however it is written — the reading the lane had before.
	const cleared = onNotes("#amk 4\n#0 o4 @1 $DE $00 $0C $08 c8 $DF d8\n");
	check(
		"a command that empties a slot is never on a note",
		cleared === "@1:true $DE $00 $0C $08:true $DF:false",
		cleared,
	);

	// `$DA` writes the instrument and clears the noise in the one execution
	// (`slotsOf`), and it is one command, so it is one entry.
	const two = map("#amk 4\n#0 o4 $F8 $10 c8 @1 d8\n");
	check("a command that moves two slots is still one entry", two === "0:#0:$F8 $10 24:#0:@1", two);

	// The same answer `definedAt` gives from the note end: `recordOrigin` skips a
	// write to the address already in the slot, so a body re-running a command
	// that changes nothing changes nothing here.
	const body = map("#amk 4\n#0 o4 [ v200 c8 ]2\n");
	check("a [ ] re-running an unchanged command is one entry", body === "0:#0:v200", body);

	const alternating = map("#amk 4\n#0 o4 [ v100 c8 v200 d8 ]2\n");
	check(
		"and one that alternates is an entry every time round",
		alternating === "0:#0:v100 24:#0:v200 48:#0:v100 72:#0:v200",
		alternating,
	);

	// `invalidateAll` hands all eight channels a fresh `origins` array, so a
	// reading taken per channel would report one written `t` eight times.
	const song = map("#amk 4\n#0 o4 c4 t144 c4\n#1 o4 d4 d4\n");
	check("a song-wide command is recorded once, not once per channel", song === "48:#0:t144", song);

	// The driver's own order. Nothing sorts it; the walk emits it that way.
	const both = map("#amk 4\n#0 o4 c4 v200 c4\n#1 o4 v100 d4 d4\n");
	check("two channels interleave by tick, unsorted", both === "0:#1:v100 48:#0:v200", both);

	// The same cut `notes` and `tempoChanges` take.
	const past = map("#amk 4\n#0 o4 c4\n#1 o4 c4 c4 v200 c4\n");
	check("a command past the shortest channel never runs", past === "", past);

	// The join the lane is built on: every entry has to be a key into the map
	// that turns it back into text, or it is a glyph with nothing to click.
	const { result, timeline } = build("#amk 4\n#0 o4 @1 v200 y10 $DE $00 $0C $08 $ED $3F $4D c8 $DF d8\n");
	const addressed = new Set((result.commandMap ?? []).map((entry) => entry.address));
	const unmapped = timeline.commands.filter((command) => !addressed.has(command.address));
	check(
		"every entry addresses a command the compiler mapped, bar the blob's own prefix",
		timeline.commands.length === 8 && unmapped.length === 2,
		timeline.commands.map((c) => `${c.address}:$${c.vcmd.toString(16)}`).join(" "),
	);
}

// ---------------------------------------------------------------------------
console.log("\nwhat the roll's command lane holds");
// ---------------------------------------------------------------------------
//
// The rule itself, end to end: the walk's list, the compiler's command map, the
// scanner's spelling and `commandScope`, which between them decide everything
// drawn under the roll. The lane holds every command that takes effect, on the
// tick the driver reads it, so what these pin is the tick each one lands on and
// which commands are not commands the lane can speak for at all.
{
	const lane = (source: string) => {
		const { result, timeline } = build(source);
		return commandTimeline({
			timeline,
			index: tokenize(source),
			commands: new Map((result.commandMap ?? []).map((entry) => [entry.address, entry])),
		})
			.map(
				(event) => `${event.tick}:#${event.channel}:${source.slice(event.command.span.start, event.command.span.end)}`,
			)
			.join(" ");
	};

	// Written straight before the note that reads it, so the bar stands on the
	// same tick and draws it too. Both are asserted, because a command drawn in
	// two places is the ordinary case rather than a fault: the lane says the
	// tick, the chip says which note plays under it. The blob's own `$FA` prefix
	// is in no command map and falls out at the join, which is why the lane's
	// side is the one entry and not three.
	{
		const source = "#amk 4\n#0 o4 c4 v200 d4\n";
		const { result, timeline } = build(source);
		const at = (result.commandMap ?? []).find((entry) => source.slice(entry.span.start, entry.span.end) === "v200");
		const d4 = timeline.notes.find((note) => note.tick === 48);
		check("a command the next note keys on with is on the lane", lane(source) === "48:#0:v200", lane(source));
		check(
			"and on that note's own bar, which is the same tick",
			at !== undefined && d4?.origins.includes(at.address) === true,
			d4?.origins.join(","),
		);
	}

	// The case where the two disagree, which is what makes the lane's tick worth
	// drawing: the `v200` runs at 48, in the rest, and the note that plays under
	// it does not begin until 96.
	{
		const source = "#amk 4\n#0 o4 c4 v200 r4 d4\n";
		const { result, timeline } = build(source);
		const at = (result.commandMap ?? []).find((entry) => source.slice(entry.span.start, entry.span.end) === "v200");
		const d4 = timeline.notes.find((note) => note.tick === 96);
		check("one read while the channel rests is on the lane at 48", lane(source) === "48:#0:v200", lane(source));
		check(
			"and on the note that plays under it, a rest later",
			at !== undefined && d4?.origins.includes(at.address) === true,
			d4?.origins.join(","),
		);
	}

	// Both halves of a replacement, on the one tick and in the order the driver
	// ran them. The `v200` reaches no bar at all — nothing sounds under it — so
	// the lane is the only place in the app it appears.
	const replaced = lane("#amk 4\n#0 o4 v200 v100 c4\n");
	check(
		"a command replaced before the next note is on the lane, and so is the one that replaced it",
		replaced === "0:#0:v200 0:#0:v100",
		replaced,
	);

	// The four that clear a slot rather than take one are in no `WalkNote.origins`
	// at any tick, so a bar can never draw them: `origins` names what *occupies* a
	// slot. The lane is where the song says vibrato was switched off.
	const off = lane("#amk 4\n#0 o4 @1 $DE $00 $0C $08 c8 $DF d8\n");
	check(
		"a command that switches something off is on the lane wherever it runs",
		off === "0:#0:@1 0:#0:$DE $00 $0C $08 24:#0:$DF",
		off,
	);

	// `'song'` needs no rest to qualify: one DSP holds one echo unit and a
	// tempo reaches every channel, so no bar has ever drawn either.
	const wide = lane("#amk 4\n#0 o4 c4 t144 $F1 $0A $28 $28 c4\n");
	check("the song's own settings are always on it", wide === "48:#0:t144 48:#0:$F1 $0A $28 $28", wide);

	// `'position'` and `'structure'` are neither: an `o` and an `l` are what the
	// roll's rows and widths already are, and `[ ]` is the shape of the music.
	const shape = lane("#amk 4\n#0 o4 l8 [ c > d ]2\n");
	check("but where a note sits and how the music is shaped are not", shape === "", shape);

	// The note a glyph is **heard on**, which is what a value committed for it
	// replays: the bar that would draw the command as a chip, off the same
	// `inForce` the bars read, else the next note to begin. Spelled as the note's
	// tick and length, which name one note in songs this small.
	const heardOn = (source: string, text: string) => {
		const { result, timeline } = build(source);
		const index = tokenize(source);
		const commands = new Map((result.commandMap ?? []).map((entry) => [entry.address, entry]));
		const inForce = commandsInForceOf({
			index,
			text: source,
			commands,
			notes: new Map((result.noteMap ?? []).map((entry) => [entry.address, entry])),
		});
		const event = commandTimeline({ timeline, index, commands }).find(
			(each) => source.slice(each.command.span.start, each.command.span.end) === text,
		);
		if (event === undefined) {
			return "no entry";
		}

		const note = noteHeardOn(timeline.notes, inForce, event);
		return note === null ? "none" : `${note.tick}+${note.ticks}`;
	};

	const keyed = heardOn("#amk 4\n#0 o4 c4 v200 d4\n", "v200");
	check("a command is heard on the note that keys on with it", keyed === "48+48", keyed);
	const rested = heardOn("#amk 4\n#0 o4 c4 v200 r4 d4\n", "v200");
	check("across a rest, on the note a rest later", rested === "96+48", rested);
	// The sounding note's `origins` froze at key-on, so the bar that draws the
	// `v200` is the next one — a tick-alone reading would name the tied note.
	const inTie = heardOn("#amk 4\n#0 o4 c4 v200 ^4 d4\n", "v200");
	check("past a note it was read inside a tie of, on the next to begin", inTie === "96+48", inTie);
	// The one command whose tick is inside the note that plays it, and the other
	// direction a tick-alone reading gets wrong: it would name the note after.
	const slid = heardOn("#amk 4\n#0 o4 c4^4 $DD $00 $18 $A6 d4\n", "$DD $00 $18 $A6");
	check("a $DD on the note that reads it, whose tick is inside it", slid === "0+96", slid);
	const wideOn = heardOn("#amk 4\n#0 o4 c4 t144 d4\n", "t144");
	check("a t, which no bar draws, on the next note to begin", wideOn === "48+48", wideOn);
	const replacedOn = heardOn("#amk 4\n#0 o4 v200 v100 c4\n", "v200");
	check("one replaced before the next note keyed on, on that note all the same", replacedOn === "0+48", replacedOn);
	// The rest keeps the channel in the pass, so the command runs; with the `$00`
	// straight after it the pass would end at the command and it would be no
	// entry at all.
	const last = heardOn("#amk 4\n#0 o4 c2 v200 r2\n#1 o4 c2 c2\n", "v200");
	check("and one past the channel's last note on none", last === "none", last);
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
console.log("\nthe pitch slide a note reads ahead into");
// ---------------------------------------------------------------------------
{
	// `$DD` is not dispatched — the note before it picks it up by peeking at the
	// track pointer (`main.asm:3256-3287`) — so it is reported on that note and
	// not as a state a later note inherits.
	const slid = build("#amk 4\n#0 o4 c4 $DD $00 $18 $A6 d4 e4\n").timeline;
	check(
		"the note in front of it carries it",
		JSON.stringify(slid.notes[0].bend) ===
			JSON.stringify({ delay: 0, duration: 0x18, target: 0xa6, afterTicks: 0, frameTicks: 48 }),
		JSON.stringify(slid.notes[0].bend),
	);
	check("and the notes after it do not", slid.notes[1].bend === null && slid.notes[2].bend === null, "carried on");

	// A `&` compiles to exactly that, which is what lets `writePitchSlides`
	// rewrite one into the other without moving a byte.
	const amp = build("#amk 4\n#0 o4 c4 & d4\n").timeline;
	check(
		"a legacy & reads the same",
		JSON.stringify(amp.notes[0].bend) ===
			JSON.stringify({ delay: 0, duration: 0x30, target: 0xa6, afterTicks: 0, frameTicks: 48 }),
		JSON.stringify(amp.notes[0].bend),
	);

	// The reading the three bytes alone cannot give. `Music.cpp:2224` rewinds a
	// tie out of the way of a `$DD` precisely because the peek happens again on
	// the tie's own ticks, so the same operands behind a `$C6` are a slide that
	// starts a tie later — and a walk that reported only the operands would call
	// the two songs identical.
	const late = build("#amk 4\n#0 o4 c4^4 $DD $00 $18 $A6 d4\n").timeline;
	check(
		"a tie before it moves when the slide starts",
		late.notes[0].bend?.afterTicks === 48 && late.notes[0].bend.frameTicks === 48 && late.notes[0].ticks === 96,
		`${JSON.stringify(late.notes[0].bend)} on a note of ${late.notes[0].ticks}`,
	);

	// And a tie written *after* it leaves the note running behind the four bytes,
	// so the `$DD` sits between two of its frames rather than after them all. The
	// operands and the note's length together cannot say that: `c1 $DD` is 192
	// ticks arming at 96, and this is 192 ticks arming at 0.
	const behind = build("#amk 4\n#0 o4 f+2 $DD $00 $D6 a+^2 g4\n").timeline;
	check(
		"a tie after it leaves the arm where it is, with note still to come",
		behind.notes[0].bend?.afterTicks === 0 && behind.notes[0].bend.frameTicks === 96 && behind.notes[0].ticks === 192,
		`${JSON.stringify(behind.notes[0].bend)} on a note of ${behind.notes[0].ticks}`,
	);
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
	check("it is SST0502 and severe", warning?.code === "SST0502" && warning?.severity === "severe", warning?.code);
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

	// A note one tick long moves the driver's duration counter by nothing at all:
	// `$70+2n` is decremented to zero and reloaded from the duration byte in the
	// same pass (`main.asm:2337, 2440-2441`), so a 1 arrives where a 1 already
	// was. The count comes off the tempo accumulator instead, which is the
	// driver's own gate and knows nothing about note lengths. `h0` between the
	// note and the `^` is what keeps the tie from folding in (`parser.ts`,
	// `accumulateTiedLength`), and a run of equal one-tick notes drops the
	// duration byte altogether, so `$0200+2n` stops moving too.
	const tied = run("#amk 4\n#0 t23 q7F @10 o4 f+=11 h0 ^=1 f+=11 h0 ^=1 f+=11 h0 ^=1 f+=11 h0 ^=1\n");
	check(
		"a song of one-tick ties measures at tempo",
		Math.abs((tempoShortfall(tied.measured) ?? 0) - 1) < 0.02,
		`${(tempoShortfall(tied.measured) ?? 0).toFixed(4)}x`,
	);

	const drummed = run(`#amk 4\n#0 t23 q7F @10 o4 ${"c=1".repeat(48)}\n`);
	check(
		"and so does one of nothing but one-tick notes",
		Math.abs((tempoShortfall(drummed.measured) ?? 0) - 1) < 0.02,
		`${(tempoShortfall(drummed.measured) ?? 0).toFixed(4)}x`,
	);
	check(
		"both reaching the tick count the compiler wrote them for",
		!tied.measured.truncated && !drummed.measured.truncated && tied.passTicks === 48 && drummed.passTicks === 48,
		`${tied.passTicks} and ${drummed.passTicks} ticks`,
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
	// figure and the SST0503 that rides on it drift with them.
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
			/** Of those, the ones that note puts in force rather than inherits. */
			defined: (n: number) => {
				const note = timeline.notes[n];
				const before = notePreceding(timeline.notes, note);
				const fresh = definedAt(inForce(note), before === null ? [] : inForce(before));
				return inForce(note)
					.filter((command) => fresh.has(command))
					.map(spell)
					.join(" ");
			},
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

	// Which of the commands acting on a note the note *puts* in force, which is
	// the other half of the same question and the one the roll's plated glyphs
	// draw. A run of notes under one `v200` all name it; only the first of them
	// is where it landed, and nothing but the note before it on its channel can
	// say which that is.
	const run = acting("#amk 4\n#0 v200 c8 d8 e8\n");
	check("a note names the command it puts in force", run.defined(0) === "v200", run.defined(0));
	check(
		"and the notes carrying it name none of it, while still playing under it",
		run.defined(1) === "" && run.defined(2) === "" && run.glyphs(1) === "v200",
		`${run.defined(1)} | ${run.glyphs(1)}`,
	);

	const changed = acting("#amk 4\n#0 v200 c8 v100 d8\n");
	check("a second command is put in force by the note after it", changed.defined(1) === "v100", changed.defined(1));

	// Per channel, and not per place in the list: the walk sorts by tick and then
	// by channel, so the note before `#0`'s second `c8` in `notes` is `#1`'s first
	// `d8`, whose commands have nothing to do with it.
	const both = acting("#amk 4\n#0 v200 c8 c8\n#1 v100 d8 d8\n");
	check(
		"the note before is the one before on that channel",
		both.defined(0) === "v200" && both.defined(1) === "v100" && both.defined(2) === "" && both.defined(3) === "",
		[0, 1, 2, 3].map((n) => `${n}:${both.defined(n)}`).join(" "),
	);

	// `recordOrigin` calls `invalidateAll` on a song-wide write, so every channel
	// gets a fresh `origins` array holding the same addresses. Comparing the
	// arrays rather than the commands in them lights up every channel's next note.
	const tempo = acting("#amk 4\n#0 v200 c8 t144 c8\n#1 v100 d8 d8\n");
	check(
		"a song-wide command puts nothing else back in force",
		tempo.timeline.notes.filter((_, n) => tempo.defined(n) !== "").length === 2,
		tempo.timeline.notes.map((_, n) => `${n}:${tempo.defined(n)}`).join(" "),
	);

	// `origins` names a command by the address the driver read it from, and
	// `recordOrigin` skips a write to the address already in the slot, so a body
	// re-running a command that changes nothing changes nothing here either.
	const body = acting("#amk 4\n#0 [ v200 c8 ]2 d8\n");
	check(
		"a [ ] re-running an unchanged command is not a second definition",
		body.defined(0) === "v200" && body.defined(1) === "" && body.defined(2) === "",
		[0, 1, 2].map((n) => `${n}:${body.defined(n)}`).join(" "),
	);

	// Where it alternates, every note is a definition, the slot having been taken
	// by the other command in between.
	const alternating = acting("#amk 4\n#0 [ v200 c8 v100 d8 ]2\n");
	check(
		"but one that alternates is a definition every time round",
		[0, 1, 2, 3].every((n) => alternating.defined(n) !== ""),
		[0, 1, 2, 3].map((n) => `${n}:${alternating.defined(n)}`).join(" "),
	);

	// `$DA` clears the noise slot (`song-walk.ts`, `slotsOf`), so the second pass
	// writes an address the slot no longer holds and the `$F8` is in force again.
	const cleared = acting("#amk 4\n#0 [ $F8 $10 c8 $DA $01 d8 ]2\n");
	check(
		"a slot cleared in between is put back in force by the byte that re-enables it",
		cleared.defined(2).includes("$F8"),
		cleared.defined(2),
	);

	check(
		"the note whose byte loaded a drum is where its @ took effect",
		plain.defined(0) === "@21" && plain.defined(1) === "",
		`${plain.defined(0)} | ${plain.defined(1)}`,
	);
	// The `*` replays the drum byte itself, so the definition is that replay and
	// not the note after it: `$DA` took the drum away in between, and the byte
	// putting it back is the note the `[ ]` body plays again.
	check(
		"and a * that reloads one is a definition on the replayed note, not the next",
		replayed.defined(2) === "@21" && replayed.defined(3) === "",
		`2:${replayed.defined(2)} 3:${replayed.defined(3)}`,
	);

	// One written `v200`, two channels, and it is put in force on both — which is
	// why the glyph that says so cannot be a channel's own colour.
	const shared = acting("#amk 4\n#0 (1)[ v200 c8 ]1 d8\n#1 v100 e8 (1)1 f8\n");
	const mine = shared.timeline.notes.findIndex((note) => note.channel === 0);
	const theirs = shared.timeline.notes.findIndex((note, n) => note.channel === 1 && shared.glyphs(n) === "v200");
	check(
		"one written command is put in force on every channel that calls it",
		mine >= 0 && theirs >= 0 && shared.defined(mine) === "v200" && shared.defined(theirs) === "v200",
		`${shared.defined(mine)} | ${theirs >= 0 ? shared.defined(theirs) : "?"}`,
	);

	// Nothing came before, so everything the note plays under started at it.
	const opening = acting("#amk 4\n#0 q7f v200 c8\n");
	check(
		"a channel's first note puts everything in force, folded before walked",
		opening.defined(0) === "q7f v200",
		opening.defined(0),
	);

	// The pass the walk produces runs straight through the marker, and everything
	// read off a `WalkNote` is a statement about that one pass.
	const intro = acting("#amk 4\n#0 v200 c8 / d8\n");
	check(
		"an intro marker is not a boundary",
		intro.timeline.loopTick !== null && intro.defined(1) === "",
		`${intro.timeline.loopTick} | ${intro.defined(1)}`,
	);

	// The one command that acts on the note *before* it. It is not dispatched —
	// the note sounding swallows it with a peek at the track pointer
	// (`main.asm:3256-3287`) — and it fills no slot, so nothing after it inherits
	// a slide and `WalkNote.bendFrom` is the only thing that names it.
	const slid = acting("#amk 4\n#0 o4 c4 $DD $00 $18 $A6 d4 e4\n");
	check("a pitch slide acts on the note in front of it", slid.glyphs(0) === "$DD $00 $18 $A6", slid.glyphs(0));
	check(
		"and on no note after it, a slide leaving nothing standing",
		slid.glyphs(1) === "" && slid.glyphs(2) === "",
		`1:${slid.glyphs(1)} 2:${slid.glyphs(2)}`,
	);
	check("the note that reads it is what puts it in force", slid.defined(0) === "$DD $00 $18 $A6", slid.defined(0));

	// The written-note form is one command whose span reaches over its target
	// (`tokens.ts:gather`), and the target emits nothing, so there is no note of
	// its own for it to be drawn on.
	const target = acting("#amk 4\n#0 o4 c4 $DD $00 $18 d e4\n");
	check("a slide naming its target as a note is one glyph", target.glyphs(0) === "$DD $00 $18 d", target.glyphs(0));
	check("and the target sounds no note to draw", target.timeline.notes.length === 2, `${target.timeline.notes.length}`);

	// Both passes ran their own slide, so neither inherited the other's. Identity
	// cannot tell those apart — it is one written command — which is why
	// `definedAt` never counts a `$DD` as held.
	const twice = acting("#amk 4\n#0 o4 [ c4 $DD $00 $18 $A6 ]2\n");
	check(
		"a slide inside a [ ] is put in force on every pass",
		twice.defined(0) === "$DD $00 $18 $A6" && twice.defined(1) === "$DD $00 $18 $A6",
		`0:${twice.defined(0)} 1:${twice.defined(1)}`,
	);

	// With a rest in front of it no read-ahead sees it at all, so it reaches no
	// bar — the lane is the only place it appears, which is where it is pinned.
	const rested = acting("#amk 4\n#0 o4 c4 r4 $DD $00 $18 $A6 d4\n");
	check(
		"one with no note to ride is on no bar",
		rested.timeline.notes.every((_, n) => rested.glyphs(n) === ""),
		rested.timeline.notes.map((_, n) => `${n}:${rested.glyphs(n)}`).join(" "),
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
