/** `walktest`: what the roll's command lane holds. */

import "../localize";
import { tokenize } from "@amk/tokens";
import { commandsInForceOf, noteHeardOn } from "../../web/src/app/state/commands-in-force";
import { commandTimeline } from "../../web/src/app/state/command-timeline";
import { check, section } from "../harness";
import { build } from "./support";

// ---------------------------------------------------------------------------
section("what the roll's command lane holds");
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
