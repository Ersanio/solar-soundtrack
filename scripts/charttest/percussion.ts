/** `charttest`: the percussion set, which is a preference and not a rule. */

import "../localize";
import type { WalkNote } from "@amk/spc/song-walk";
import {
	DEFAULT_PERCUSSION,
	keyOf,
	parsePercussion,
	rollShape,
} from "../../web/src/app/editor/views/piano-roll/percussion";
import { LANE_HEIGHT, LANE_HEIGHT_MAX, LANE_ROW } from "../../web/src/app/editor/views/piano-roll/roll-metrics";
import { clampLaneHeight } from "../../web/src/app/editor/views/piano-roll/roll-settings";
import { check, section } from "../harness";

section("percussion is a preference, not a rule");
{
	/** The driver's own notes for `@21` and `@29`, decoded from `main.bin`. */
	const DRUM_NOTES = new Map([
		[21, 0xa8], // o4 e
		[29, 0xa1], // o3 a
	]);

	const context = (percussion: number[], noisy: number[] = [], written: [number, number][] = []) => ({
		percussion: new Set(percussion),
		noisy: new Set(noisy),
		drumNotes: DRUM_NOTES,
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
			vibrato: false,
			tremolo: false,
			noise,
			transpose: 0,
			tune: 0,
			tempo: 0,
			globalVolume: null,
		},
	});

	check(
		"the default is @10 and the driver's nine",
		DEFAULT_PERCUSSION.join(",") === "10,21,22,23,24,25,26,27,28,29",
		DEFAULT_PERCUSSION.join(","),
	);

	// A hi-hat must not stretch the keyboard. `@10` sits at o4 f+ once its
	// default transposition applies, and letting that widen the range adds
	// octaves of empty rows to every song with a drum in it.
	const drummed = rollShape([note(29, 0xd8), note(29, 0x97), note(0, 0xa4)], context([...DEFAULT_PERCUSSION]));
	check("a drum lane never widens the pitched range", drummed.usedDrums.join(",") === "29" && drummed.lowestKey === 36);
	check("and the melodic note is the only thing in it", drummed.lowestKey === drummed.highestKey);

	// The case the whole feature exists for: a song that repointed its samples,
	// where `@10` is no longer a drum and its notes belong on the keyboard.
	const melodicTen = rollShape([note(10, 0x9e)], context([12, 21, 29]));
	check("removing a drum gives its notes back to the keyboard", melodicTen.usedDrums.length === 0);
	check("and they claim their own pitch", melodicTen.lowestKey === 30, String(melodicTen.lowestKey));

	// A bare `$D0`-`$D8` carries no pitch, so a removed drum's notes would have
	// no lane *and* no key — they would silently disappear. The driver's own
	// table is what they fall back to.
	const bare = note(29, 0xd8);
	check("a bare drum falls back to the note the driver's table gives it", keyOf(bare, context([])) === 33);
	check("and @21's is its own", keyOf(note(21, 0xd0), context([])) === 40, String(keyOf(note(21, 0xd0), context([]))));
	const removed = rollShape([bare], context([]));
	check(
		"so removing it keeps the note rather than losing it",
		removed.lowestKey === 33 && removed.usedDrums.length === 0,
	);

	// The fallback is for the bare byte only. A pitched note after a drum was
	// written at a pitch and must keep it.
	check("a pitched note after a drum keeps the pitch it was written at", keyOf(note(29, 0x97), context([])) === 23);

	// The row is the pitch that was *written*, which only the note map knows:
	// `@2 o5 g` emits `$B2` because `@2` takes five semitones off, and the roll
	// draws it on o5 g all the same — the byte is neither what was written nor
	// what sounds, and only the letter is something an edit could go back to.
	const transposed = note(2, 0xb2, null, 0x1234);
	check("a pitched note draws at its written pitch", keyOf(transposed, context([], [], [[0x1234, 0xb7]])) === 55);
	check("and at the byte when the map does not know it", keyOf(transposed, context([])) === 50);
	check(
		"the fitted range is over written pitches too",
		rollShape([transposed], context([], [], [[0x1234, 0xb7]])).highestKey === 55,
	);
	// `h12 o0 c` is `$80` on the wire and o0 c in the source; the row is below o1.
	check(
		"a written pitch below o1 is a negative key",
		keyOf(note(0, 0x80, null, 7), context([], [], [[7, 0x74]])) === -12,
	);
	// A bare drum's letter had no say in its byte, so the map has no say in its row.
	check(
		"a bare drum ignores the pitch it was written under",
		keyOf(note(29, 0xd8, null, 9), context([], [], [[9, 0xa4]])) === 33,
	);

	// Nothing about the rule may be special-cased to `@21`-`@29`.
	check(
		"any instrument the porter names leaves the keyboard",
		rollShape([note(4, 0xa4)], context([4])).usedDrums.join(",") === "4",
	);

	// Two classifications over one note, invisible until a row comes out empty.
	const both = rollShape([note(30, 0xa4)], context([30], [30]));
	check("percussion takes precedence over noise", both.usedDrums.join(",") === "30" && !both.usesNoise);
	check("and noise still wins when it is not named", rollShape([note(30, 0xa4)], context([], [30])).usesNoise);

	check(
		"an empty set leaves everything on the keyboard",
		rollShape([note(29, 0xd8), note(10, 0x9e)], context([])).usedDrums.length === 0,
	);

	// Storage is a string someone can hand-edit.
	check("a stored set that is not a list is ignored", parsePercussion("yes") === null && parsePercussion(42) === null);
	check("junk inside a list is dropped", parsePercussion([10, "x", 12, 1.5, -1, 999])?.join(",") === "10,12");
	check("and it comes back sorted and deduped", parsePercussion([29, 10, 29])?.join(",") === "10,29");
	// The `sampleList: null is not []` rule, in miniature: `null` means nothing
	// was stored and the default stands, `[]` means the porter turned everything
	// off. Reading `[]` as "no opinion" would make that undo itself on reload.
	check("an empty stored set is kept, not treated as absent", parsePercussion([])?.length === 0);
	// The porter's answer for a custom instrument is worth as much as the one for
	// `@21`, and costs more to give again: nothing here treats it differently.
	check(
		"a custom instrument is stored like any other",
		parsePercussion([10, 29, 30, 200])?.join(",") === "10,29,30,200",
		parsePercussion([10, 29, 30, 200])?.join(","),
	);

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
