/** `fixtest`: SST0502's Pad, which makes every channel reach the longest, and Trim, which cuts what the song never reaches. */

import { check, section } from "../harness";
import { type Song, expectFix, expectNoFix, fixesOf, song } from "./support";

/** Every channel the song plays is as long as every other, and nothing written goes unplayed. */
function even(built: Song | null): boolean {
	const timeline = built?.timeline;
	if (!timeline) {
		return false;
	}

	const lengths = timeline.channelTicks.filter((_, channel) => timeline.used[channel]);
	return lengths.every((ticks) => ticks === lengths[0]) && timeline.unreachable.length === 0;
}

const UNEVEN = "#amk 2\n#0 @0 o4 c4 d4 e4 f4\n#1 @0 o4 c4 d4";

section("Pad puts a rest on the end of each channel that ends early");
{
	const after = expectFix("pad", UNEVEN, "SST0502", `${UNEVEN}\nr2`, "pad");
	check("pad: every channel reaches the end", even(after));
	check("pad: the song is as long as its longest channel", after?.result.stats?.loopTicks === 192);
}

{
	const text = "#amk 2\n#0 @0 o4 c4 d4 e4 f4\n#1 @0 o4 c4 r4\n#2 @0 o4 c1";
	const after = expectFix(
		"pad, ending on a rest",
		text,
		"SST0502",
		"#amk 2\n#0 @0 o4 c4 d4 e4 f4\n#1 @0 o4 c4 r2.\n#2 @0 o4 c1",
		"pad",
	);
	check("pad, ending on a rest: every channel reaches the end", even(after));
}

section("Trim cuts the longer channels at the song's end, which stays where it was");
{
	const after = expectFix("trim", UNEVEN, "SST0502", "#amk 2\n#0 @0 o4 c4 d4\n#1 @0 o4 c4 d4", "trim");
	check("trim: every channel ends together", even(after));
	check("trim: the song keeps its length", after?.result.stats?.loopTicks === song(UNEVEN).result.stats?.loopTicks);
}

{
	const after = expectFix(
		"trim, a note across the end",
		"#amk 2\n#0 @0 o4 c4 d2 e4\n#1 @0 o4 c4 d4",
		"SST0502",
		"#amk 2\n#0 @0 o4 c4 d4\n#1 @0 o4 c4 d4",
		"trim",
	);
	check("trim, a note across the end: every channel ends together", even(after));
}

section("Trim is not offered where a channel's text is not one run in playing order; Pad still is");
{
	const text = "#amk 2\n#0 @0 o4 [c4 d4]4\n#1 @0 o4 c4 d4";
	expectNoFix("a loop", text, "SST0502", "trim");
	check(
		"a loop: pad is offered",
		fixesOf(song(text), "SST0502").some((fix) => fix.id === "pad"),
	);
}
