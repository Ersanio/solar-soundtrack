/** `charttest`: the drum lanes, which are the driver's own `@21`-`@29` and nothing else. */

import "../localize";
import type { WalkNote } from "@amk/spc/song-walk";
import { isDrum, keyOf, rollShape } from "../../web/src/app/editor/views/piano-roll/percussion";
import { laneStack } from "../../web/src/app/editor/views/piano-roll/roll-layout";
import { rowOf } from "../../web/src/app/editor/views/piano-roll/roll-marks";
import { LANE_HEIGHT, LANE_HEIGHT_MAX, LANE_ROW } from "../../web/src/app/editor/views/piano-roll/roll-metrics";
import { rowOfPlaced } from "../../web/src/app/editor/views/piano-roll/roll-preview";
import { clampLaneHeight } from "../../web/src/app/editor/views/piano-roll/roll-settings";
import { check, section } from "../harness";

section("the drum lanes are the driver's own drums");
{
	const context = (noisy: number[] = [], written: [number, number][] = []) => ({
		noisy: new Set(noisy),
		written: new Map(written),
	});

	/** A note as the walk would report it; only the fields placement reads. */
	const note = (instrument: number | null, byte: number, noise: number | null = null, address = 0): WalkNote => ({
		origins: [],
		drumFrom: null,
		bend: null,
		bendFrom: null,
		channel: 0,
		tick: 0,
		ticks: 24,
		gateTicks: 24,
		vibratoTicks: 0,
		note: byte,
		key: byte >= 0x80 && byte < 0xc6 ? byte - 0x80 : null,
		percussion: byte >= 0xd0 ? byte - 0xd0 : null,
		address,
		state: {
			instrument,
			volume: null,
			pan: null,
			quantization: null,
			gate: 0xff,
			waitTime: 2,
			velocity: 0xff,
			vibrato: null,
			tremolo: false,
			noise,
			transpose: 0,
			tune: 0,
			fineTune: 0,
			sampleLoaded: false,
			arpeggio: false,
			remotePitch: false,
			tempo: 0,
			globalVolume: null,
		},
	});

	check(
		"a drum is @21 to @29 and nothing either side",
		[21, 25, 29].every(isDrum) && ![null, 0, 10, 20, 30, 200].some(isDrum),
	);

	// A hi-hat must not stretch the keyboard: letting a drum widen the range adds
	// octaves of empty rows to every song with one in it.
	const drummed = rollShape([note(29, 0xd8), note(0, 0xa4)], context());
	check("a drum lane never widens the pitched range", drummed.usedDrums.join(",") === "29" && drummed.lowestKey === 36);
	check("and the melodic note is the only thing in it", drummed.lowestKey === drummed.highestKey);

	// A note after a drum is a pitched byte on `#0`-`#5` (`parser.ts:2743-2754`):
	// it plays the drum's sample at the pitch written, so it is a key and not a
	// second hit on the lane — and it claims its own key in the range.
	const followed = rollShape([note(29, 0xd8), note(29, 0x97), note(0, 0xa4)], context());
	check(
		"a pitched note after a drum is on the keyboard",
		followed.usedDrums.join(",") === "29" && followed.lowestKey === 23 && followed.highestKey === 36,
		`${String(followed.lowestKey)}-${String(followed.highestKey)}`,
	);

	// `@10` and a sampled kick are heard at the pitch they were written at, so
	// they are notes on the keyboard and get no lane, the same as any `@n`.
	const others = rollShape([note(10, 0x9e), note(30, 0x98), note(21, 0xd0)], context());
	check("@10 and a custom instrument get no lane", others.usedDrums.join(",") === "21", others.usedDrums.join(","));
	check(
		"and claim their own pitches on the keyboard",
		others.lowestKey === 24 && others.highestKey === 30,
		`${String(others.lowestKey)}-${String(others.highestKey)}`,
	);

	// What the lanes are for: the row a bar is drawn on is the row a press finds
	// it on. The marks place a note by its walk byte (`rowOf`) and the gestures
	// place a strip item by the drum `@` it carries (`rowOfPlaced`), and the two
	// agree only because both call a drum byte, and nothing else, a drum. The
	// real strips are pinned the same way in `pianorolltest`'s `drum-apart.ts`.
	const placed: [string, WalkNote, number | null][] = [
		["@21's drum byte", note(21, 0xd0, null, 1), 21],
		["@21's pitched note after it", note(21, 0xa4, null, 4), null],
		["@10", note(10, 0x9e, null, 2), null],
		["@30", note(30, 0xa4, null, 3), null],
	];
	const placedContext = context(
		[],
		[
			[1, 0xa4],
			[2, 0x9e],
			[3, 0xa4],
			[4, 0xa4],
		],
	);
	const shape = rollShape(
		placed.map(([, each]) => each),
		placedContext,
	);
	const stack = laneStack({ lowestKey: shape.lowestKey, highestKey: shape.highestKey, usedDrums: shape.usedDrums });
	for (const [name, each, drum] of placed) {
		const drawn = rowOf(each, stack, placedContext);
		const pressed = rowOfPlaced({ written: placedContext.written.get(each.address) ?? each.note, drum }, stack);
		check(
			`${name}: its bar is drawn on the row a press finds it on`,
			drawn >= 0 && drawn === pressed,
			`drawn ${drawn}, pressed ${pressed}`,
		);
	}

	// The row is the pitch that was *written*, which only the note map knows:
	// `@2 o5 g` emits `$B2` because `@2` takes five semitones off, and the roll
	// draws it on o5 g all the same — the byte is neither what was written nor
	// what sounds, and only the letter is something an edit could go back to.
	const transposed = note(2, 0xb2, null, 0x1234);
	check("a pitched note draws at its written pitch", keyOf(transposed, context([], [[0x1234, 0xb7]])) === 55);
	check("and at the byte when the map does not know it", keyOf(transposed, context()) === 50);
	check(
		"the fitted range is over written pitches too",
		rollShape([transposed], context([], [[0x1234, 0xb7]])).highestKey === 55,
	);
	// `h12 o0 c` is `$80` on the wire and o0 c in the source; the row is below o1.
	check("a written pitch below o1 is a negative key", keyOf(note(0, 0x80, null, 7), context([], [[7, 0x74]])) === -12);
	check("a pitched note after a drum keeps the pitch it was written at", keyOf(note(29, 0x97), context()) === 23);
	// A bare drum's letter had no say in its byte, so it has no key at all.
	check("a bare drum has no key", keyOf(note(29, 0xd8, null, 9), context([], [[9, 0xa4]])) === null);

	// A `$D9` reads a tenth percussion entry that is not there, and only a
	// malformed blob plays one. It is no drum and has no key, so it has no row.
	const tenth = rollShape([note(30, 0xd9)], context());
	check(
		"a percussion byte past the nine has no row and claims no range",
		tenth.usedDrums.length === 0 && tenth.lowestKey === null && !tenth.usesNoise,
	);

	// Two classifications over one note, invisible until a row comes out empty.
	const both = rollShape([note(21, 0xd0, 0x1f)], context());
	check("a drum takes precedence over noise", both.usedDrums.join(",") === "21" && !both.usesNoise);
	check("and noise still wins over the keyboard", rollShape([note(30, 0xa4)], context([30])).usesNoise);

	// The lane's height comes off a drag rather than a table, so it is held
	// between its two ends rather than checked against a list — and rounded,
	// because it becomes the `viewBox` the glyphs are laid out against and a
	// fractional user unit puts every row's rule on a half pixel.
	// The two ends are whole rows, and stated in rows: the point of either is how
	// many commands it shows, so a pixel figure that had drifted off a row
	// boundary would leave a band too short to draw a glyph in.
	check(
		"the lane cannot be dragged shorter than five rows",
		clampLaneHeight(0) === LANE_ROW * 5,
		String(clampLaneHeight(0)),
	);
	check("nor taller than ten", clampLaneHeight(9999) === LANE_ROW * 10, String(clampLaneHeight(9999)));
	check(
		"which are the height it opens at and its ceiling",
		LANE_HEIGHT === LANE_ROW * 5 && LANE_HEIGHT_MAX === LANE_ROW * 10,
	);
	check("a height between the two is kept", clampLaneHeight(LANE_HEIGHT + 20) === LANE_HEIGHT + 20);
	check("and a drag's fractional pixel is rounded off", Number.isInteger(clampLaneHeight(LANE_HEIGHT + 7.4)));
}
