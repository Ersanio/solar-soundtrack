/** `charttest`: the roll's pages. */

import "../localize";
import { pageStart, tickWindow } from "../../web/src/app/editor/views/piano-roll/roll-layout";
import { check, section } from "../harness";
import { EPSILON } from "./support";

section("the roll's pages");
{
	// The paged view holds the music still and sweeps the playhead across it,
	// turning over once the playhead reaches PAGE_TURN_AT and moving PAGE_STEP of
	// a pane — so it lands at the difference, a tenth in, with the bar it has just
	// played still on screen. None of it is visible in a screenshot: a page that
	// turns a fraction early or late looks exactly like one that does not.
	const TURN_AT = 0.9; // PianoRoll.PAGE_TURN_AT
	const STEP = 0.8; // PianoRoll.PAGE_STEP
	const LEAD = 0.2; // PianoRoll.PLAYHEAD_AT, the continuous roll's fixed lead
	const SCREEN = 800; // ticks across the pane
	const STRIDE = SCREEN * STEP;
	const LEAD_IN = SCREEN * (TURN_AT - STEP);
	const page = (tick: number) => pageStart(tick, SCREEN, TURN_AT, STEP);
	const offset = (tick: number) => tick - page(tick);

	// The song opens on the lead-in every later page opens on, which means page
	// zero starts before tick 0 and the first bar is drawn with space in front of
	// it. Opening flush against the key column instead makes that margin appear
	// out of nowhere at the first turn, and makes a scroll back to the beginning
	// show the space and then lose it again on the way back to the song.
	check("a song opens on the lead-in, not against the key column", page(0) === -LEAD_IN, `${page(0)}`);
	check(
		"which is the margin every later page opens on too",
		Math.abs(offset(0) - LEAD_IN) < EPSILON && Math.abs(offset(STRIDE) - LEAD_IN) < EPSILON,
		`${offset(0)} then ${offset(STRIDE)}`,
	);
	check(
		"and it holds there until the playhead reaches the turn",
		page(STRIDE - 1) === page(0) && Math.abs(page(STRIDE) - (page(0) + STRIDE)) < EPSILON,
		`${page(STRIDE - 1)} then ${page(STRIDE)}`,
	);
	check(
		"the turn comes when the playhead is TURN_AT across the pane",
		Math.abs(offset(STRIDE - EPSILON) - SCREEN * TURN_AT) < 1e-3,
		`${offset(STRIDE - EPSILON)} ticks in, of ${SCREEN}`,
	);

	// Why the step is shorter than the turn: a page moving the whole pane would
	// drop the playhead hard against the key column with nothing behind it, and
	// the phrase that had just played would be gone at the moment you looked for it.
	check(
		"a turn leaves the music just played still on screen",
		Math.abs(offset(STRIDE) - SCREEN * (TURN_AT - STEP)) < EPSILON,
		`${offset(STRIDE)} ticks in, of ${SCREEN}`,
	);

	// The playhead is drawn at its offset into the page, so an offset outside the
	// pane is a line over the key column or off the right edge — where the clip
	// hides it rather than showing anything wrong.
	let outside = "";
	let backwards = "";
	let previous = page(0);
	for (let tick = 0; tick <= SCREEN * 12; tick += 7) {
		const into = offset(tick);
		if (into < LEAD_IN - EPSILON || into >= SCREEN * TURN_AT + EPSILON) {
			outside += ` ${tick}`;
		}

		if (page(tick) < previous - EPSILON) {
			backwards += ` ${tick}`;
		}

		previous = page(tick);
	}

	check("the playhead is never outside the lead-in and the turn", outside === "", outside);
	check("and a page never turns backwards as the song runs forwards", backwards === "", backwards);

	// One turn per stride, not one per frame. The transform itself is cheap, but a
	// page flickering between two values at the boundary takes the marks with it,
	// and that is the whole pane rebuilt.
	const starts = new Set<number>();
	let sampled = 0;
	for (let tick = 0; tick <= SCREEN * 12; tick += 7) {
		sampled++;
		starts.add(page(tick));
	}

	check(
		"a sweep turns one page per stride at most",
		starts.size <= (SCREEN * 12) / STRIDE + 1,
		`${starts.size} pages over ${(SCREEN * 12) / STRIDE} strides`,
	);
	check("which is far below one per frame", starts.size * 20 < sampled, `${starts.size} against ${sampled}`);
	check(
		"and every page starts a whole stride past the lead-in",
		[...starts].every((tick) => Math.abs((tick + LEAD_IN) % STRIDE) < EPSILON),
	);

	check("an unmeasured pane pages nowhere rather than dividing by zero", pageStart(500, 0, TURN_AT, STEP) === 0);
	check("and neither does a zero step", pageStart(500, SCREEN, TURN_AT, 0) === 0);

	// The anchor, which is what a scroll moves. Measured from the song's own start
	// always, a seek drops the playhead wherever its place in that fixed grid
	// happens to fall — so the notes jump the moment the wheel goes quiet, by up
	// to a whole stride, and the roll looks like it is fighting the scroll.
	{
		const anchored = (tick: number, origin: number) => pageStart(tick, SCREEN, TURN_AT, STEP, origin);
		check(
			"the anchor is the tick that sits on the lead-in",
			anchored(1234, 1234) === 1234 - LEAD_IN,
			`${anchored(1234, 1234)}`,
		);
		check("and an anchor of zero is the song's own start", anchored(500, 0) === page(500));

		// The property the fix exists for: a scroll leaves the view at some tick and
		// some lead, and re-anchoring on it must reproduce that exact camera. Over
		// every lead a page can show the playhead at, which is the lead-in up to but
		// not including the turn — a page ends *at* the turn, so that is the one
		// value no page has the playhead sitting at.
		let moved = "";
		for (const tick of [0, 137, 900, 5000, 12345]) {
			for (const lead of [0.1, 0.2, 0.35, 0.5, 0.75, 0.85, 0.899]) {
				const viewLeft = tick - SCREEN * lead;
				const origin = viewLeft + LEAD_IN;
				if (Math.abs(anchored(tick, origin) - viewLeft) > EPSILON) {
					moved += ` ${tick}@${lead}`;
				}
			}
		}

		check("re-anchoring on a parked view leaves the notes exactly where they are", moved === "", moved);

		// And that the excluded value is excluded because the page has turned there,
		// not because the arithmetic gives up: anchoring at the turn lands the
		// playhead on the next page's lead-in, which is what turning a page is.
		const atTurn = anchored(5000, 5000 - SCREEN * TURN_AT + LEAD_IN);
		check(
			"anchoring exactly at the turn turns the page, as it should",
			Math.abs(5000 - atTurn - LEAD_IN) < EPSILON,
			`playhead ${5000 - atTurn} into the page, lead-in ${LEAD_IN}`,
		);

		// Which is reachable only in theory: a page shows the playhead below the
		// turn by construction, so the lead a scroll parks with is never that value.
		let atOrPast = "";
		for (let tick = 0; tick <= SCREEN * 12; tick += 3) {
			if (offset(tick) >= SCREEN * TURN_AT) {
				atOrPast += ` ${tick}`;
			}
		}

		check("and a real page never has the playhead at the turn to begin with", atOrPast === "", atOrPast);

		// And the grid still behaves once anchored: same lead-in, same turn, and a
		// page behind the anchor rather than the playhead stranded off the pane —
		// which is what a loop wrap back past the anchor would otherwise do.
		const ORIGIN = 5000;
		let bad = "";
		for (let tick = 0; tick <= 12000; tick += 11) {
			const into = tick - anchored(tick, ORIGIN);
			if (into < LEAD_IN - EPSILON || into >= SCREEN * TURN_AT + EPSILON) {
				bad += ` ${tick}`;
			}
		}

		check("an anchored grid still holds the playhead on the pane, before the anchor too", bad === "", bad);
	}

	// The one with no visual tell at all. The marks are built for a window around
	// the *playhead*, snapped and carrying a screen of margin either side, while
	// the transform points at the *page*. A page reaching outside that window
	// would scroll perfectly smoothly over blank music, so the two are pinned
	// together rather than left to be rediscovered.
	let uncovered = "";
	for (const zoom of [0.5, 1, 2, 4, 8]) {
		const width = SCREEN * zoom;
		for (let tick = 0; tick <= 20000; tick += 13) {
			// Clamped at 0, because the opening page reaches before the first tick
			// and there is no music there to be missing.
			const from = Math.max(0, pageStart(tick, SCREEN, TURN_AT, STEP));
			const window = tickWindow(tick, width, zoom, LEAD);
			if (from < window.from || from + SCREEN > window.to) {
				uncovered += ` ${zoom}@${tick}`;
				break;
			}
		}
	}

	check("every page is inside the window the marks are built for", uncovered === "", uncovered);
}
