/** `charttest`: how the command lane stacks what lands together. */

import "../localize";
import { type Command, tokenize } from "@amk/tokens";
import type { TimelineCommand } from "../../web/src/app/state/command-timeline";
import {
	type CommandLane,
	laneGlyphX,
	laneWindow,
	packCommandLane,
} from "../../web/src/app/editor/views/piano-roll/roll-command-layout";
import { eraseCommand, inspectable } from "../../web/src/app/editor/views/piano-roll/roll-command-move";
import {
	LANE_GLYPH,
	LANE_MUTED_OPACITY,
	LANE_ROW,
	MUTED_OPACITY,
} from "../../web/src/app/editor/views/piano-roll/roll-metrics";
import { check, section } from "../harness";

// ---------------------------------------------------------------------------
section("how the command lane stacks what lands together");
// ---------------------------------------------------------------------------
//
// The lane draws one glyph per command going in effect, at `tick * zoom`, and
// never moves one sideways to make room — where a glyph is *is* the claim it
// makes. So room is found by going deeper, and the rule has to hold at every
// zoom: two commands a beat apart do not collide at 4 px per tick and do at 0.5.
//
// Rows are dealt over the whole song rather than over the window on screen. A
// window-scoped pack would re-deal them at every turnover, and a glyph changing
// row as the roll scrolled past it would be saying something about the scroll.
{
	const source = "#amk 4\n#0 v200 y10 q7f @1 $ED $3F $4D t144 n10 p12,8 $DE $00 $0C $08 $F8 $10 c8\n";
	const written = tokenize(source).commands.filter((command) => command.kind !== "c");
	/** Real commands off a real scan, so `glyphOf` is exercised as the lane exercises it. */
	const at = (tick: number, channel: number, n: number): TimelineCommand => ({
		tick,
		channel,
		command: written[n % written.length],
	});
	/** Named rather than indexed where a case turns on a command's scope. */
	const kind = (letter: string): TimelineCommand["command"] => written.find((command) => command.kind === letter)!;
	const pack = (
		events: TimelineCommand[],
		zoom: number,
		audible = new Map<number, boolean>(),
		active: number | null = null,
	) => packCommandLane({ events, text: source, zoom, audible, active, songTicks: 10_000 });
	const rows = (lane: CommandLane) => lane.glyphs.map((glyph) => glyph.y / LANE_ROW).join(",");

	const together = pack([at(96, 0, 0), at(96, 1, 1), at(96, 2, 2)], 2);
	check("three commands on one tick take three rows", rows(together) === "0,1,2", rows(together));
	check(
		"and all three keep that tick's x",
		together.glyphs.every((g) => g.x === 192 - LANE_GLYPH / 2),
		together.glyphs.map((g) => g.x).join(","),
	);
	check("which is how deep the lane says it is", together.depth === 3, String(together.depth));

	// Centred on its tick rather than hung off the right of it, so a command that
	// runs on a beat straddles that beat's rule. The two ends are the exceptions,
	// and the bound is the **song's** own span: one against the pane would move a
	// glyph as the roll scrolled past it, which is the thing the whole-song pack
	// exists to avoid.
	{
		const song = 100; // Ticks; at zoom 2 the song is 200 wide.
		const boxAt = (tick: number) => laneGlyphX(tick, 2, song);
		check("a glyph is centred on its tick", boxAt(50) === 100 - LANE_GLYPH / 2, String(boxAt(50)));
		check("the first sits flush left instead of half off it", boxAt(0) === 0, String(boxAt(0)));
		check("and the last flush right", boxAt(song) === 200 - LANE_GLYPH, String(boxAt(song)));
		check(
			"so no glyph is ever drawn outside the song",
			[0, 1, 5, 49, 50, 95, 99, 100].every((t) => boxAt(t) >= 0 && boxAt(t) + LANE_GLYPH <= song * 2),
		);
		// A song narrower than one glyph has nowhere to put it but the start,
		// which is the case that would otherwise clamp to a negative upper bound.
		check("a song narrower than a glyph pins it at zero", laneGlyphX(1, 1, 4) === 0, String(laneGlyphX(1, 1, 4)));
	}

	// Far enough apart at this zoom that the first has cleared before the second
	// begins, so the second goes back to the top rather than staying where the
	// one before it happened to land.
	const apart = pack([at(0, 0, 0), at(96, 0, 1)], 2);
	check("two commands far apart share row 0", rows(apart) === "0,0", rows(apart));

	// The same two events, zoomed out until their boxes overlap. Nothing about
	// the song changed; the picture did, and the lane has to answer for the
	// picture or one glyph is drawn over another.
	const crowded = pack([at(0, 0, 0), at(4, 0, 1)], 0.5);
	check("and stack once the zoom brings them together", rows(crowded) === "0,1", rows(crowded));

	const opened = pack([at(0, 0, 0), at(4, 0, 1)], 8);
	check("then flatten again when it is wound back in", rows(opened) === "0,0", rows(opened));

	// The rule the two above are cases of, over every zoom the toolbar offers.
	let overlapping = "";
	for (const zoom of [0.5, 1, 2, 4, 8]) {
		const lane = pack(
			[0, 3, 6, 9, 24, 25, 48, 192].map((tick, n) => at(tick, 0, n)),
			zoom,
		);
		const byRow = new Map<number, number[]>();
		for (const glyph of lane.glyphs) {
			const row = byRow.get(glyph.y) ?? [];
			row.push(glyph.x);
			byRow.set(glyph.y, row);
		}

		for (const xs of byRow.values()) {
			for (let n = 1; n < xs.length; n++) {
				if (xs[n] - xs[n - 1] < LANE_GLYPH) {
					overlapping += ` ${zoom}`;
				}
			}
		}
	}

	check("no glyph is ever drawn over another, at any zoom", overlapping === "", overlapping);

	// No cap: a tick whose commands are the reason the lane was opened must not be
	// the one tick it declines to show. Every one gets a row of its own, however
	// deep the column runs, and `depth` says so — that is the scroll range, and a
	// glyph past a range that stopped short could never be reached.
	const deep = pack(
		Array.from({ length: 40 }, (_, n) => at(48, n % 8, n)),
		2,
	);
	check("a column of forty keeps all forty", deep.glyphs.length === 40, String(deep.glyphs.length));
	check("each one row lower than the last", rows(deep) === [...Array(40).keys()].join(","), rows(deep));
	check("and the lane says it is forty deep", deep.depth === 40, String(deep.depth));

	// What a mute does depends on how far the command reaches, and the two halves
	// are the point: a `v` on a silenced channel sets a volume nobody can hear, so
	// it is not drawn; a `t` written on that same channel still runs the whole
	// song, so it stays, dimmed at the lane's own value.
	{
		const silenced = new Map([[3, false]]);
		const gone = pack([{ tick: 96, channel: 3, command: kind("v") }], 2, silenced);
		check(
			"a silenced channel's own settings are not drawn at all",
			gone.glyphs.length === 0 && gone.depth === 0,
			rows(gone),
		);

		const wide = pack([{ tick: 96, channel: 3, command: kind("t") }], 2, silenced);
		check(
			"but a song-wide command written on it stays, dimmed",
			wide.glyphs.length === 1 && wide.glyphs[0].opacity === LANE_MUTED_OPACITY,
			wide.glyphs.map((g) => g.opacity).join(","),
		);
		// The lane dims further than the roll does, and that gap is deliberate
		// rather than drift: a bar is a filled rectangle tens of pixels wide where
		// a glyph is line art twelve pixels square, so the roll's value leaves the
		// strokes invisible. Soloing is where it tells — seven channels' song
		// settings dimmed at once, and they are what is still being heard.
		check(
			"and the lane dims less far than the roll does, line art needing more",
			LANE_MUTED_OPACITY > MUTED_OPACITY,
			`${LANE_MUTED_OPACITY} vs ${MUTED_OPACITY}`,
		);

		// And the row it would have taken is not held open for it: the glyph is
		// gone, so an audible channel's command moves up into its place.
		const beside = pack(
			[
				{ tick: 96, channel: 3, command: kind("v") },
				{ tick: 96, channel: 4, command: kind("y") },
			],
			2,
			silenced,
		);
		check(
			"and a live channel's command takes the row the dropped one would have",
			beside.glyphs.length === 1 && beside.glyphs[0].y === 0 && beside.depth === 1,
			`${beside.glyphs.length} at ${rows(beside)}`,
		);
	}

	// The edited channel is packed first and everything else strictly below it, so
	// its commands are in the top rows and reading them needs no scroll.
	{
		const scattered = [at(96, 0, 0), at(96, 1, 1), at(96, 2, 2)];
		const where = (lane: CommandLane) => lane.glyphs.map((g) => `#${g.channel}@${g.y / LANE_ROW}`).join(" ");
		check(
			"with no channel being edited, a tick's glyphs stack in timeline order",
			where(pack(scattered, 2)) === "#0@0 #1@1 #2@2",
			where(pack(scattered, 2)),
		);

		const lifted = pack(scattered, 2, new Map<number, boolean>(), 2);
		check(
			"the edited channel's command takes row 0 and the rest fall below it",
			where(lifted) === "#2@0 #0@1 #1@2",
			where(lifted),
		);

		// A band rather than a preference: the second group starts at the first row
		// the first did not reach, so a row the edited channel leaves free at some
		// x is still not offered to another channel there. Channel 5's two glyphs
		// are far enough apart to share row 0, which leaves x=0 free in it.
		const band = pack([at(0, 5, 0), at(960, 5, 1), at(0, 6, 2)], 2, new Map<number, boolean>(), 5);
		check(
			"a gap in the edited channel's row is not filled by another channel",
			where(band) === "#5@0 #5@0 #6@1",
			where(band),
		);
		check("and the lane is one row deeper for it", band.depth === 2, String(band.depth));
	}

	const pair = pack([at(96, 3, 0), at(96, 4, 1)], 2);

	// The colour is `color` and not `fill`: a palette glyph paints its own shapes
	// with `currentColor`, so a `fill-ch-*` would reach none of them. And the
	// hover names the channel, because the eight colours do not identify one on
	// their own — `styles.css` says so and this is where it is kept true.
	check("a glyph is tinted by color, per channel", pair.glyphs[1].tint === "text-ch-4", pair.glyphs[1].tint);
	check(
		"and its hover names the command, the text, the channel and the tick",
		pair.glyphs[1].title.includes("#4") && pair.glyphs[1].title.includes("tick 96"),
		pair.glyphs[1].title,
	);

	// The right-click erase, and the one thing on screen that says it is there.
	// A command written through a `"name=value"` has its span collapsed onto the
	// call site, so deleting that range would take the expansion with it.
	{
		const macro = '#amk 4\n"loud=v200 y10"\n#0 loud c8\n';
		const scanned = tokenize(macro).commands.filter((command) => command.kind === "v");
		const spread = packCommandLane({
			events: [{ tick: 0, channel: 0, command: scanned[0] }],
			text: macro,
			zoom: 2,
			audible: new Map(),
			active: null,
			songTicks: 10_000,
		});
		check("a command that came through a replacement cannot be erased", spread.glyphs[0].removable === false);
		check("and its hover does not offer it", !spread.glyphs[0].title.includes("right-click"), spread.glyphs[0].title);
		// The erase both routes go through — the right click and the `Delete`
		// key — so neither can come to a different answer about it. `removable`
		// is this function's own precondition read back onto the glyph.
		check("and the erase itself refuses it", eraseCommand(macro, scanned[0]) === null);
		// It cannot be carried either, and the cursor is the only thing on screen
		// that says so before the porter presses.
		check("nor dragged", spread.glyphs[0].cursor === "pointer", spread.glyphs[0].cursor);
		check("and its hover does not offer that either", !spread.glyphs[0].title.includes("drag"), spread.glyphs[0].title);
	}

	// And what the erase takes: the command plus the inline whitespace in front
	// of it, so what is left is what was there before it was written. `expect` is
	// the race guard `source-view` re-checks the batch against.
	{
		const plain = "#amk 4\n#0 v200 c8\n";
		const literal = tokenize(plain).commands.find((command) => command.kind === "v")!;
		const taken = eraseCommand(plain, literal);
		check("a literal command erases", taken !== null);
		check("taking the space in front of it with it", taken?.expect === " v200", JSON.stringify(taken?.expect));
		check("and putting nothing back", taken?.text === "", JSON.stringify(taken?.text));
	}

	// What the roll may point at, and so what `Delete` may take: the lane's and
	// the bars' scopes, and nothing else. A note is a `Command` too, and the caret
	// is on one after every click on a bar.
	{
		const song = "#amk 4\n#0 o4 t60 v200 c8 r8 [d8]2\n";
		const commands = tokenize(song).commands;
		const ofKind = (letter: string): Command => commands.find((command) => command.kind === letter)!;
		const named = (name: string): Command => commands.find((command) => command.name === name)!;
		check("a song command is inspectable", inspectable(ofKind("t")));
		check("and a note-state one", inspectable(ofKind("v")));
		check("a note is not", !inspectable(named("note")));
		check("nor a rest", !inspectable(named("rest")));
		check("nor an octave", !inspectable(ofKind("o")));
		check("nor a loop bracket", !inspectable(ofKind("]")));
	}

	check("a command written out in full can be", pair.glyphs[1].removable === true);
	check("and its hover is what says so", pair.glyphs[1].title.includes("right-click to delete"), pair.glyphs[1].title);
	check("it offers the drag as well", pair.glyphs[1].cursor === "grab", pair.glyphs[1].cursor);
	check("and says that too", pair.glyphs[1].title.includes("drag to move"), pair.glyphs[1].title);

	// The tick and the channel a drag works from, carried on the glyph rather
	// than parsed back out of the hover: the hover is prose for a person.
	check("a glyph carries the tick it was packed at", pair.glyphs[1].tick === 96, String(pair.glyphs[1].tick));
	check("and the channel it ran on", pair.glyphs[1].channel === 4, String(pair.glyphs[1].channel));

	// The window is a slice of the pack, so a glyph keeps the row the whole song
	// gave it, and `depth` stays the whole song's — it is how far the lane can be
	// scrolled, and a range that shrank as the roll moved would take the porter's
	// position with it.
	const whole = pack([at(0, 0, 0), at(0, 1, 1), at(0, 2, 2), at(960, 0, 3)], 2);
	const slice = laneWindow(whole, 900, 1000, 2);
	check("a window holds only the glyphs inside it", slice.glyphs.length === 1, String(slice.glyphs.length));
	check("keeps the row the whole song dealt it", slice.glyphs[0].y === 0, String(slice.glyphs[0].y));
	check("and reports the whole song's depth", slice.depth === 3, String(slice.depth));

	check(
		"a lane with no commands has no depth",
		packCommandLane({ events: [], text: source, zoom: 2, audible: new Map(), active: null, songTicks: 10_000 })
			.depth === 0,
	);
}
