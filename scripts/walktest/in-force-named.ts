/** `walktest`: the command in force at a note is named exactly. */

import "../localize";
import { commandStartingAt, tokenize } from "@amk/tokens";
import { commandScope, parseTimeInForce } from "@amk/tokens/commands/in-force";
import { SLOTS, type SongTimeline, type StateSlot } from "@amk/spc/song-walk";
import { commandsInForceOf, definedAt, notePreceding } from "../../web/src/app/state/commands-in-force";
import { check } from "../harness";
import { ARAM, build } from "./support";

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
