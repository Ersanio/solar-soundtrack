/** `charttest`: what fits inside one bar. */

import "../localize";
import { keyName, noteLabel } from "../../web/src/app/editor/views/piano-roll/roll-layout";
import { fitBarContent } from "../../web/src/app/editor/views/piano-roll/roll-bar-text";
import { check, section } from "../harness";

// ---------------------------------------------------------------------------
section("what fits inside one bar");
// ---------------------------------------------------------------------------
//
// A bar names its own note and carries a glyph per command acting on it. Both
// are drawn inside a rectangle whose width is a note length times a zoom and
// whose height is a stretched row, so "does it fit" is arithmetic and the
// failure — text running out over the next bar, or over the key column — is the
// kind that only shows up on somebody else's song.
{
	// Two spellings of one pitch. `keyName` is four characters too wide for a bar
	// and `noteLabel` is what goes in one, so the only thing that matters is that
	// they can never name different keys.
	let apart = "";
	for (let key = -24; key < 96; key++) {
		const long = keyName(key);
		const at = long.indexOf(" ");
		const rewritten = long.slice(at + 1).toUpperCase() + long.slice(1, at);
		if (noteLabel(key) !== rewritten) {
			apart += ` ${long} vs ${noteLabel(key)}`;
		}
	}

	check("a bar's name and the key column's name the same key", apart === "", apart);
	check("including below o1, where the octave floors", noteLabel(-12) === "C0" && noteLabel(-1) === "B0");
	check("and the accidental is MML's own +", noteLabel(1) === "C+1");

	// A row too short to hold text holds nothing: half a letter is worse than a
	// bar that simply says nothing and leaves it to the hover.
	check("nothing is drawn in a row too short for it", fitBarContent(400, 8, "C4", 3).name === null);
	check("and no glyphs either", fitBarContent(400, 8, "C4", 3).glyphs.length === 0);
	check("nor the mark that says there are more", fitBarContent(400, 8, "C4", 3).more === null);
	check("nor in a bar of no width", fitBarContent(0, 30, "C4", 3).name === null);

	// The name goes first and the glyphs are dropped from the end. A bar saying
	// `C6` is still saying something; glyphs with no note beside them are a row of
	// icons floating over the music.
	const wide = fitBarContent(300, 20, "C4", 4);
	check("a wide bar takes its name and every glyph", wide.name !== null && wide.glyphs.length === 4);
	check("and says nothing about more, because there are none", wide.more === null);

	// A truncated list and a complete one are the same picture without this, so
	// the mark is the only thing that says the hover is worth asking. It costs a
	// slot, and the slot comes off the glyphs rather than off the name.
	{
		// Every width from "one slot" upwards, so the claims below are about the
		// rule rather than about three widths that happen to agree with it.
		let unmarked = "";
		let overrun = "";
		let alone = -1;
		for (let width = 0; width <= 400; width += 1) {
			const fit = fitBarContent(width, 20, "C4", 4);
			if (fit.more === null && fit.glyphs.length < 4 && fit.glyphs.length > 0) {
				unmarked += ` ${width}`;
			}

			if (fit.more !== null && fit.glyphs.length >= 4) {
				overrun += ` ${width}`;
			}

			if (fit.more !== null && fit.glyphs.length === 0 && alone < 0) {
				alone = width;
			}
		}

		check("a bar showing some of four always says there are more", unmarked === "", unmarked);
		check("and one showing all four never does", overrun === "", overrun);
		check("the narrowest bar with a slot spends it on the mark", alone >= 0, `never stood alone`);

		// The second half of that, and the one the rule is chosen for: one slot
		// and one glyph is the glyph, not a mark standing in for it.
		const one = fitBarContent(alone, 20, "C4", 1);
		check("but a bar with one slot and one glyph draws the glyph", one.glyphs.length === 1 && one.more === null);

		// `MAX_GLYPHS` is a cut like any other: a bar wide enough for eight shows
		// five at most, and the three it drops are three the porter cannot see.
		const capped = fitBarContent(400, 20, "C4", 8);
		check("a bar past the glyph cap says so too", capped.more !== null, `${capped.glyphs.length} glyphs, no mark`);
		check("and spends one of the capped slots on saying it", capped.glyphs.length === 4);

		// `buildMarks` reads the boxes back onto the front of the list it asked
		// about and takes the tail as the ones the mark stands for — which is what
		// decides both the icon each box gets and whether the mark wears a
		// defining note's plate. Both are silently wrong if the order is not the
		// list's own, left to right with the mark past the end of them.
		const cut = fitBarContent(120, 20, "C4", 5);
		let ordered = cut.glyphs.length > 1;
		for (let n = 1; n < cut.glyphs.length; n++) {
			ordered &&= cut.glyphs[n - 1].x < cut.glyphs[n].x;
		}

		check("a cut bar hands its boxes back in the order it was given", ordered, `${cut.glyphs.length} boxes`);
		check(
			"with the mark for the rest past the last of them",
			cut.more !== null && cut.more.x > cut.glyphs[cut.glyphs.length - 1].x,
		);
	}

	// Monotone, and it has to be: a bar that grows an icon as it shrinks is what
	// happens when the glyphs are allowed the room the name gave up.
	let last = 99;
	let grew = "";
	let nameLost = -1;
	for (let width = 300; width >= 0; width -= 1) {
		const fit = fitBarContent(width, 20, "C4", 4);
		if (fit.glyphs.length > last) {
			grew += ` ${fit.glyphs.length} at ${width}`;
		}

		last = fit.glyphs.length;
		if (fit.name === null && nameLost < 0) {
			nameLost = width;
		}
	}

	check("glyphs only ever drop as a bar narrows", grew === "", grew);
	check("down to none", last === 0);
	check(
		"and the name is the last thing to go",
		nameLost >= 0 && fitBarContent(nameLost + 1, 20, "C4", 4).glyphs.length === 0,
		`name lost at ${nameLost}`,
	);

	// Nothing may cross the bar it is drawn in: the roll clips at the key column
	// and not per mark, so an overhang lands on the neighbouring note.
	let overflow = "";
	for (const width of [12, 20, 40, 80, 160, 320]) {
		for (const glyphs of [0, 1, 3, 5, 8]) {
			const fit = fitBarContent(width, 24, "C+4", glyphs);
			const boxes = fit.more === null ? fit.glyphs : [...fit.glyphs, fit.more];
			for (const box of boxes) {
				if (box.x < 0 || box.x + box.size > width) {
					overflow += ` ${width}/${glyphs}`;
				}
			}

			// The name is measured at the monospace advance, which is what makes
			// this an estimate worth trusting: the roll's text is `font-mono`.
			const nameEnd = fit.name === null ? 0 : fit.name.x + "C+4".length * fit.name.size * 0.6;
			if (boxes.length > 0 && boxes[0].x < nameEnd) {
				overflow += ` overlap ${width}/${glyphs}`;
			}
		}
	}

	check("nothing is laid outside its bar or over its name", overflow === "", overflow);
}
