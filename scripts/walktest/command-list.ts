/** `walktest`: the song's command list. */

import "../localize";
import { check } from "../harness";
import { build } from "./support";

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
