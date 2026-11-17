/** `charttest`: the piano roll's lanes. */

import "../localize";
import { KEY_COUNT } from "@amk/spc/song-walk";
import { keyIsBlack, keyName, laneStack } from "../../web/src/app/editor/views/piano-roll/roll-layout";
import { check, section } from "../harness";

section("piano roll lanes");
{
	// The whole point of fitting: a song that lives in one octave should not be
	// drawn against seventy rows, most of them empty.
	const fitted = laneStack({ lowestKey: 28, highestKey: 33 });
	check("a fitted range covers whole octaves", fitted.lanes.length === 12, `${fitted.lanes.length} rows`);
	check("and it contains the notes played", fitted.rowOfKey.has(28) && fitted.rowOfKey.has(33));
	check("while a key outside it has no row", !fitted.rowOfKey.has(0) && !fitted.rowOfKey.has(69));
	check(
		"the top row is the highest pitch",
		fitted.lanes[0].index === 35 && fitted.lanes[fitted.lanes.length - 1].index === 24,
		`${fitted.lanes[0].label} down to ${fitted.lanes[fitted.lanes.length - 1].label}`,
	);

	const all = laneStack({ lowestKey: 28, highestKey: 33, all: true });
	check("all octaves is the whole keyboard", all.lanes.length === KEY_COUNT, `${all.lanes.length} rows`);
	// "All octaves" widens the pitch range and nothing else — asking for the
	// whole keyboard must not conjure nine drum lanes the song never plays.
	check(
		"and it still adds no unused drum",
		all.lanes.every((l) => l.kind === "key"),
	);
	check("o1 c is key 0 and o6 a is key 69", keyName(0) === "o1 c" && keyName(69) === "o6 a");
	check("the black keys are the five", [1, 3, 6, 8, 10].every(keyIsBlack) && ![0, 2, 4, 5, 7, 9, 11].some(keyIsBlack));

	// Rows are written pitches, and `o0` is legal MML: `h12 o0 c` is a note the
	// driver plays and the roll must have a row for, below the driver's own
	// keyboard. The names and the black keys have to wrap the right way there.
	check("o0 c is key -12", keyName(-12) === "o0 c" && keyName(-1) === "o0 b", `${keyName(-12)}, ${keyName(-1)}`);
	check("and o7 b+ is o8 c", keyName(84) === "o8 c" && keyName(72) === "o7 c", `${keyName(84)}, ${keyName(72)}`);
	check(
		"a black key below o1 is still black",
		keyIsBlack(-11) && keyIsBlack(-2) && !keyIsBlack(-12) && !keyIsBlack(-1),
	);
	const below = laneStack({ lowestKey: -12, highestKey: 3 });
	check("a range below o1 is drawn in whole octaves", below.lanes.length === 24, `${below.lanes.length} rows`);
	check(
		"from o1 b down to o0 c",
		below.lanes[0].index === 11 && below.lanes[23].index === -12 && below.rowOfKey.get(-12) === 23,
		`${below.lanes[0].label} down to ${below.lanes[23].label}`,
	);
	check("o0 c starts its octave", below.lanes[23].octaveStart && !below.lanes[22].octaveStart);
	const allBelow = laneStack({ lowestKey: -5, highestKey: 3, all: true });
	check("all octaves grows to take in a written note below o1", allBelow.lanes.length === KEY_COUNT + 12);
	// The driver's top octave stops at o6 a, since `$C6` is the tie — unless
	// something is written above it, when the octave is filled out.
	const top = laneStack({ lowestKey: 60, highestKey: 69 });
	check("a range up to o6 a stops at o6 a", top.lanes[0].index === 69, top.lanes[0].label);
	const above = laneStack({ lowestKey: 60, highestKey: 70 });
	check("a written o6 a+ fills out o6", above.lanes[0].index === 71, above.lanes[0].label);
	const beyond = laneStack({ lowestKey: 60, highestKey: 72, all: true });
	check("all octaves grows to take in a written note above o6", beyond.lanes.length === KEY_COUNT + 2 + 12);

	// Drums and noise appear only when the song plays them — nine empty drum
	// rows on a song with no percussion is nine rows of nothing. A drum is
	// named by its instrument number.
	const withDrums = laneStack({
		lowestKey: 28,
		highestKey: 33,
		usedDrums: [21, 25, 29],
		usesNoise: true,
		drumNotes: new Map([
			[21, 0xa8],
			[29, 0xa1],
		]),
	});
	check("only the drums played get a lane", withDrums.lanes.filter((l) => l.kind === "drum").length === 3);
	check("the ones that are not played have no row", withDrums.rowOfDrum.get(24) === undefined);
	check("a noise lane appears when noise is used", withDrums.noiseRow === 0, `row ${withDrums.noiseRow}`);
	check("and no noise lane when it is not", fitted.noiseRow === -1);
	check(
		"drums and noise sit above the keyboard",
		withDrums.lanes.slice(0, 4).every((l) => l.kind !== "key") && withDrums.lanes[4].kind === "key",
	);
	check(
		"drums count down to the keyboard",
		withDrums.lanes
			.slice(1, 4)
			.map((l) => l.index)
			.join(",") === "29,25,21",
		withDrums.lanes
			.slice(1, 4)
			.map((l) => l.label)
			.join(" | "),
	);
	// A drum states the note the driver's table plays it at; with no entry to
	// read, as before the driver has loaded, it is named and nothing more.
	check("a table drum's lane names its own note", withDrums.lanes[1].label === "@29 o3 a", withDrums.lanes[1].label);
	check("a drum with no table entry is named alone", withDrums.lanes[2].label === "@25", withDrums.lanes[2].label);

	// A song the compiler produced no notes for still has to lay out.
	const empty = laneStack();
	check("a song with no notes still draws a keyboard", empty.lanes.length === KEY_COUNT);
}
