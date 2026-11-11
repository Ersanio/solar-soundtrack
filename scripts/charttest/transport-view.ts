/**
 * `charttest`: the transport's mixer and playhead, the playhead dropping what a
 * mid-update read of ARAM invents, and the seconds estimate for a song the walk
 * could not read.
 */

import "../localize";
import {
	channelStates,
	estimatedSecondsAt,
	silencedMask,
	silencedReason,
	soleAudible,
	soundingSpans,
} from "../../web/src/app/state/transport-view";
import { check, section } from "../harness";

section("the transport's mixer and playhead, which a browser cannot be made to show");
{
	// Solo clears the mutes outright rather than holding them: what the buttons
	// show is always what is heard.
	check("no mutes and no solo silences nothing", silencedMask(0, null) === 0);
	check("a mute mask passes through", silencedMask(0b0000_0101, null) === 0b0000_0101);
	check(
		"solo silences everything else, mutes included",
		silencedMask(0b1111_1111, 3) === 0b1111_0111,
		silencedMask(0b1111_1111, 3).toString(2),
	);

	const sizes = [40, 0, 12, 0, 0, 0, 0, 9];
	const rows = channelStates(sizes, 0, null);
	check("only channels the song writes to get a row", rows.length === 3, rows.map((r) => r.index).join(","));
	check("and they keep their own indices", rows.map((r) => r.index).join(",") === "0,2,7");
	check(
		"all audible with nothing muted",
		rows.every((r) => r.audible),
	);

	const muted = channelStates(sizes, 0b0000_0001, null);
	check("a muted channel reads muted and inaudible", muted[0].muted && !muted[0].audible);
	check("  and leaves the others alone", muted[1].audible && muted[2].audible);

	const soloed = channelStates(sizes, 0b0000_0001, 2);
	check("under solo only that channel is audible", soloed.filter((r) => r.audible).length === 1);
	check("  and it is the soloed one", soloed.find((r) => r.audible)?.index === 2);
	// The mute survives in the button's state even while solo overrides it.
	check("  while a mute is still shown as set", soloed[0].muted && !soloed[0].audible);

	// An empty channel keeps no row, whatever its mute state.
	check("an empty channel gets no row even when muted", channelStates([0, 0], 0b11, null).length === 0);

	// What the roll adopts as the channel to edit. Soloing and muting every other
	// channel by hand are one answer, which is the point of asking it over the rows.
	check("nothing muted leaves no sole channel", soleAudible(rows) === null);
	check("a solo leaves the soloed channel", soleAudible(soloed) === 2);
	check(
		"muting every other row by hand leaves the same one",
		soleAudible(channelStates(sizes, 0b1000_0001, null)) === 2,
	);
	check("one mute short of that leaves none", soleAudible(muted) === null);
	check("muting every row leaves none", soleAudible(channelStates(sizes, 0b1000_0101, null)) === null);
	check("a song with one channel leaves that one", soleAudible(channelStates([40], 0, null)) === 0);
	check("and a song with no channels at all leaves none", soleAudible(channelStates([], 0, null)) === null);

	check("a mute is reported as a mute", silencedReason(3, null) === "channel 3 is muted");
	check("  and a solo names the channel that has it", silencedReason(3, 5) === "only channel 5 is soloed");
}

section("the playhead drops what a mid-update read of ARAM invents");
{
	// `noteAddressAt` finds the last note *before* the pointer, because the
	// driver's read pointer has already stepped past the note it is sounding —
	// so every pointer below sits just after the entry it should resolve to.
	const span = (start: number) => ({ start, end: start + 1, line: 1 });
	const map = [
		{ address: 0x100, channel: 0, span: span(10), written: 0, note: 0 },
		{ address: 0x200, channel: 1, span: span(20), written: 0, note: 0 },
		{ address: 0x300, channel: 8, span: span(30), written: 0, note: 0 },
	] as unknown as Parameters<typeof soundingSpans>[0];
	const starts = (pointers: number[], silenced = 0) =>
		soundingSpans(map, pointers, silenced)
			.map((s) => s.start)
			.join(",");

	check("each voice decorates its own note", starts([0x150, 0x250, 0, 0, 0, 0, 0, 0]) === "10,20");

	// Voice 1's pointer landing in voice 0's region is the artefact: reading ARAM
	// between the driver's writes, never a real thing to draw.
	check("a pointer in another voice's region is dropped", starts([0, 0x150, 0, 0, 0, 0, 0, 0]) === "");

	// The loop block is the exception, and has to be: a subroutine's notes belong
	// to whichever voice called it.
	check("but the loop block is kept for any voice", starts([0x350, 0, 0, 0, 0, 0, 0, 0]) === "30");

	check(
		"two voices in one subroutine decorate it once",
		soundingSpans(map, [0x350, 0x350, 0, 0, 0, 0, 0, 0], 0).length === 1,
	);

	check("a silenced voice is not drawn", starts([0x150, 0x250, 0, 0, 0, 0, 0, 0], 0b0000_0001) === "20");
	check("a voice that has not started is not drawn", starts([0, 0, 0, 0, 0, 0, 0, 0]) === "");
	check("a pointer before every note resolves to nothing", starts([0x010, 0, 0, 0, 0, 0, 0, 0]) === "");

	// Addresses ascend where the spans do not, so the sort is doing the work.
	const jumbled = [
		{ address: 0x100, channel: 0, span: span(40), written: 0, note: 0 },
		{ address: 0x200, channel: 1, span: span(15), written: 0, note: 0 },
	] as unknown as Parameters<typeof soundingSpans>[0];
	const sorted = soundingSpans(jumbled, [0x150, 0x250, 0, 0, 0, 0, 0, 0], 0).map((s) => s.start);
	check("spans come back in document order", sorted.join(",") === "15,40", sorted.join(","));
}

section("the seconds estimate for a song the walk could not read");
{
	const pass = { introTicks: 96, loopTicks: 192, introSeconds: 2, mainSeconds: 6 };

	check("tick 0 is second 0", estimatedSecondsAt(pass, 0) === 0);
	check("the intro is exact at its end", estimatedSecondsAt(pass, 96) === 2);
	check("and the pass is exact at its end", estimatedSecondsAt(pass, 288) === 8);
	check("halfway through the intro is half its seconds", estimatedSecondsAt(pass, 48) === 1);
	check("halfway round the loop is half of the main", estimatedSecondsAt(pass, 192) === 5);

	// Two straight lines, so it never runs backwards even though it bends.
	let backwards = "";
	for (let tick = 1; tick <= 288; tick++) {
		if (estimatedSecondsAt(pass, tick) < estimatedSecondsAt(pass, tick - 1)) {
			backwards += ` ${tick}`;
		}
	}

	check("it never runs backwards", backwards === "", backwards);

	// A song with no loop stops at the intro rather than extrapolating past it.
	const once = { introTicks: 96, loopTicks: 0, introSeconds: 2, mainSeconds: 0 };
	check("a song that does not loop holds at its end", estimatedSecondsAt(once, 500) === 2);
	check(
		"an intro-less song is all loop",
		estimatedSecondsAt({ introTicks: 0, loopTicks: 100, introSeconds: 0, mainSeconds: 4 }, 50) === 2,
	);
}
