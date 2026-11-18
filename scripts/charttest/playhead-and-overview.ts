/**
 * `charttest`: the roll's playhead marking the song rather than the camera, and
 * the overview bar's time axis and minimap.
 */

import "../localize";
import type { WalkNote } from "@amk/spc/song-walk";
import {
	laneStack,
	pageStart,
	overviewOffset,
	overviewTick,
	tickAtX,
	xAtTick,
} from "../../web/src/app/editor/views/piano-roll/roll-layout";
import { buildMinimap } from "../../web/src/app/editor/views/piano-roll/roll-marks";
import { KEY_WIDTH, MUTED_OPACITY } from "../../web/src/app/editor/views/piano-roll/roll-metrics";
import { check, section } from "../harness";
import { EPSILON } from "./support";

section("the roll's playhead marks the song, not the camera");
{
	// `lead` is where the camera holds the playhead, and the transform is the same
	// fraction run the other way — so while the roll is *on* the song, the line is
	// at `lead` across the pane by construction. Parked it is not: the camera
	// stands still and the music does not, so the line is drawn at the song's own
	// tick in the camera's coordinates and is allowed to leave. None of it shows
	// in a screenshot, since a line that has stopped and one that is off the pane
	// look the same as a line that is simply somewhere else.
	const WIDTH = 724; // a pane, less the key column
	const TURN_AT = 0.9; // PianoRoll.PAGE_TURN_AT
	const STEP = 0.8; // PianoRoll.PAGE_STEP
	const LEAD = 0.2; // PianoRoll.PLAYHEAD_AT

	// The two directions of the camera, and they have to agree: a gesture turns a
	// pointer into a tick and the playhead turns a tick back into an x, so a pair
	// that did not round-trip would draw a note somewhere other than under the
	// pointer that drew it.
	let drifted = "";
	for (const zoom of [0.5, 1, 2, 4, 8]) {
		for (const viewTick of [-96, 0, 1, 4919.5]) {
			for (const tick of [0, 1, 96, 12345.5]) {
				const back = tickAtX(xAtTick(tick, viewTick, zoom), viewTick, zoom);
				if (Math.abs(back - tick) > EPSILON) {
					drifted += ` ${zoom}@${viewTick}:${tick}`;
				}
			}
		}
	}

	check("a tick drawn and read back is the tick it was", drifted === "", drifted);

	// A following roll's camera is built around the playhead, in both view modes:
	// paging leaves the view on the page start, scrolling the notes leaves it a
	// fifth behind the tick. Either way the line cannot be off the pane, which is
	// what makes drawing it from the song rather than from `lead` a no-op here.
	let offPane = "";
	for (const zoom of [0.5, 1, 2, 4, 8]) {
		const screen = WIDTH / zoom;
		for (let tick = 0; tick <= screen * 12; tick += 7) {
			for (const view of [pageStart(tick, screen, TURN_AT, STEP), tick - screen * LEAD]) {
				const x = xAtTick(tick, view, zoom);
				if (x < KEY_WIDTH - EPSILON || x > KEY_WIDTH + WIDTH + EPSILON) {
					offPane += ` ${zoom}@${tick}`;
					break;
				}
			}
		}
	}

	check("a following roll never draws the line off its own pane", offPane === "", offPane);

	// Parked, the view is one fixed tick and the song goes on without it.
	const parked = pageStart(4800, WIDTH, TURN_AT, STEP); // a view left mid-song
	check(
		"a parked roll moves the line at the song's own rate while the view stands still",
		Math.abs(xAtTick(4800, parked, 2) - xAtTick(4700, parked, 2) - 200) < EPSILON,
		`${xAtTick(4800, parked, 2)} against ${xAtTick(4700, parked, 2)}`,
	);

	// And lets it go, which is why `xAtTick` does not clamp: a line held at the
	// edge would say the song was there. The clip in `piano-roll.html` is what
	// keeps an x past either end off the key column and out of the pane.
	check(
		"and lets it leave the pane rather than holding it at the edge",
		xAtTick(parked + WIDTH * 3, parked, 1) > KEY_WIDTH + WIDTH && xAtTick(parked - WIDTH, parked, 1) < KEY_WIDTH,
		`${xAtTick(parked + WIDTH * 3, parked, 1)} and ${xAtTick(parked - WIDTH, parked, 1)}`,
	);
}

section("the overview bar's time axis");
{
	// The bar holds the whole song and nothing else, so a drag on it is a mapping
	// and its inverse. The inverse has to be exact: the view goes where the box
	// under the pointer is put, and one that landed merely near it would drop the
	// roll a note away from where it was dropped, every time, with nothing on
	// screen to say so.
	const WIDTH = 724; // a pane, less the key column
	const TICKS = 12312;

	check("tick 0 is the left edge", overviewOffset(0, TICKS, WIDTH) === 0);
	check("and the last tick is the right edge", overviewOffset(TICKS, TICKS, WIDTH) === WIDTH);
	check("with the middle in the middle", Math.abs(overviewOffset(TICKS / 2, TICKS, WIDTH) - WIDTH / 2) < EPSILON);

	let apart = "";
	for (let tick = 0; tick <= TICKS; tick += 7) {
		const back = overviewTick(overviewOffset(tick, TICKS, WIDTH), TICKS, WIDTH);
		if (Math.abs(back - tick) > 1e-9) {
			apart += ` ${tick}->${back}`;
		}
	}

	check("a tick survives the round trip to the bar and back", apart === "", apart);

	// The whole song and nothing else: the same tick lands on a different pixel of
	// a wider pane, and on the same *fraction* of either. A bar that drew a fixed
	// number of pixels per tick would run off the end of a long song.
	check(
		"the song fills the bar at any width",
		[200, 724, 1600, 3000].every((w) => overviewOffset(TICKS, TICKS, w) === w && overviewOffset(0, TICKS, w) === 0),
	);
	check(
		"and a short song fills it exactly as a long one does",
		[1, 96, 12312, 999999].every((t) => Math.abs(overviewOffset(t / 2, t, WIDTH) - WIDTH / 2) < EPSILON),
	);

	// A drag that leaves the bar is still asking for an end of the song, not for a
	// tick outside it — which the transport would clamp anyway, silently.
	check("a drag off the left end asks for the first tick", overviewTick(-500, TICKS, WIDTH) === 0);
	check("and off the right end for the last", overviewTick(WIDTH + 500, TICKS, WIDTH) === TICKS);
	check("a tick past the end draws at the right edge", overviewOffset(TICKS * 2, TICKS, WIDTH) === WIDTH);
	check("and one before the start at the left", overviewOffset(-100, TICKS, WIDTH) === 0);

	// A NaN here is an x of NaN on every bar of the minimap: a strip that renders
	// blank, with nothing in the console to say why.
	check(
		"a song of no ticks answers 0 rather than NaN",
		overviewOffset(50, 0, WIDTH) === 0 && overviewTick(50, 0, WIDTH) === 0,
	);
	check("and so does an unmeasured pane", overviewOffset(50, TICKS, 0) === 0 && overviewTick(50, TICKS, 0) === 0);
}

section("the overview bar's minimap");
{
	// A bar's colour is which channel it is, so the dedupe that keeps a dense song
	// inside the DOM has to keep the channels apart. Everything here is invisible
	// in a screenshot: a note folded into another channel's bar leaves the picture
	// altogether, and the only tell is a colour that is not there.
	const WIDTH = 724;
	const TICKS = 12312;
	const stack = laneStack({ lowestKey: 24, highestKey: 35 });
	const context = {
		noisy: new Set<number>(),
		written: new Map<number, number>(),
	};

	/** A pitched note as the walk would report it; only the fields the minimap reads. */
	const note = (channel: number, key: number, tick: number, ticks: number): WalkNote => ({
		origins: [],
		drumFrom: null,
		bend: null,
		bendFrom: null,
		channel,
		tick,
		ticks,
		gateTicks: ticks,
		vibratoTicks: 0,
		note: 0x80 + key,
		key,
		percussion: null,
		address: 0,
		state: {
			instrument: 0,
			volume: null,
			pan: null,
			quantization: null,
			gate: 0xff,
			waitTime: 2,
			velocity: 0xff,
			vibrato: null,
			tremolo: false,
			noise: null,
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

	const minimap = (notes: WalkNote[], audible: ReadonlyMap<number, boolean> = new Map()) =>
		buildMinimap({ notes, stack, context, ticks: TICKS, width: WIDTH, audible });

	// One pixel of this bar is some seventeen ticks, so ticks 0 and 1 land on it
	// together — which is the collision the key has to tell apart.
	const together = minimap([note(0, 28, 0, 24), note(1, 28, 1, 24)]);
	check("two channels through one pixel of a row are two bars", together.length === 2, `${together.length}`);
	check(
		"each in its own channel's colour",
		together
			.map((bar) => bar.fill)
			.sort()
			.join(",") === "fill-ch-0,fill-ch-1",
		together.map((bar) => bar.fill).join(","),
	);

	// One channel's two are one picture, and the wider holds a long note's reach
	// against a short one starting alongside it.
	const doubled = minimap([note(0, 28, 0, 24), note(0, 28, 1, 96)]);
	check("one channel's two through that pixel are one bar", doubled.length === 1, `${doubled.length}`);
	check(
		"and it is the wider of them",
		Math.abs(doubled[0].w - overviewOffset(96, TICKS, WIDTH)) < EPSILON,
		`${doubled[0].w}`,
	);

	const reversed = minimap([note(0, 28, 0, 96), note(0, 28, 1, 24)]);
	check(
		"whichever order the two arrive in",
		reversed.length === 1 && Math.abs(reversed[0].w - doubled[0].w) < EPSILON,
		`${reversed.length} at ${reversed[0].w}`,
	);

	// A silenced channel is dimmed rather than dropped, at the roll's own value,
	// and its bars come back first so a live one is never veiled by the wash of
	// something that cannot be heard.
	const mixed = minimap(
		[note(0, 28, 0, 24), note(1, 30, 0, 24), note(2, 32, 0, 24)],
		new Map([
			[0, true],
			[1, false],
			[2, true],
		]),
	);
	check("a silenced channel is dimmed rather than dropped", mixed.length === 3, `${mixed.length}`);
	check(
		"at the value the roll's own bars use",
		mixed.filter((bar) => bar.fill === "fill-ch-1").every((bar) => bar.opacity === MUTED_OPACITY),
	);
	check("its bars come back before every audible one", mixed[0].fill === "fill-ch-1", mixed[0].fill);
	check(
		"and an audible one is not dimmed at all",
		mixed.filter((bar) => bar.fill !== "fill-ch-1").every((bar) => bar.opacity === 1),
	);
	// The mixer only has controls for the channels a song writes to, so a channel
	// missing from the map is one nothing has silenced.
	check("a channel the mixer has no entry for is heard", minimap([note(3, 28, 0, 24)])[0].opacity === 1);

	// `track bar.id` — two bars sharing an id is a duplicate-key error in dev and
	// a bar that never updates in production, which is why the channel is in the
	// key rather than beside it.
	const dense: WalkNote[] = [];
	for (let channel = 0; channel < 8; channel++) {
		for (let tick = 0; tick < TICKS; tick += 13) {
			dense.push(note(channel, 24 + (tick % 12), tick, 24));
		}
	}

	const bars = minimap(dense);
	check("every bar's id is its own", new Set(bars.map((bar) => bar.id)).size === bars.length, `${bars.length} bars`);
	check("and there are never more bars than notes", bars.length <= dense.length, `${bars.length} of ${dense.length}`);
}
