/** `walktest`: the walk and the compiler agree on how long the song is. */

import "../localize";
import { check } from "../harness";
import { build } from "./support";

// ---------------------------------------------------------------------------
console.log("\nthe walk and the compiler agree on how long the song is");
// ---------------------------------------------------------------------------

/** Each song isolates one hazard; the name is what it is there to catch. */
export const CORPUS: { name: string; source: string }[] = [
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
