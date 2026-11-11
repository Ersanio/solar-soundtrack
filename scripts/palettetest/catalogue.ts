/** `palettetest`: the catalogue covers every VCMD in every dialect, and every entry can be drawn and explained. */

import "../localize";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tokenize } from "@amk/tokens";
import { formAvailability } from "@amk/tokens/commands/availability";
import { commandHazards } from "@amk/tokens/command-hazards";
import { ENTRIES, OFFERED, resolveEntry } from "../../web/src/app/editor/command-palette/catalog";
import { GLYPH_NAMES } from "../../web/src/app/editor/command-palette/command-icon";
import { check, section } from "../harness";
import { DIALECTS, probe, SVG_TAGS, hex, resolveAll, capitalised, SUPERSEDED } from "./support";

section("catalogue");

// The catalogue is complete by construction rather than by a number written
// here: adding a VCMD to `tokens.ts` fails this until it either has a button or
// is claimed by a letter form below.
{
	const entries = resolveAll(DIALECTS[2].target, false);
	const keys = new Set(entries.map((entry) => entry.key));
	// Off `vcmd` rather than the key, because two buttons may write one byte:
	// `$ED`'s ADSR and GAIN are one opcode and two envelopes.
	const offered = new Set(entries.map((entry) => entry.vcmd).filter((vcmd) => vcmd !== undefined));
	const superseded = new Set(SUPERSEDED.map((row) => row.vcmd));
	const missing: string[] = [];
	for (let vcmd = 0xda; vcmd <= 0xfe; vcmd++) {
		if (!offered.has(vcmd) && !superseded.has(vcmd)) {
			missing.push(`$${vcmd.toString(16).toUpperCase()}`);
		}
	}

	check("every VCMD $DA-$FE has an entry or a letter form that writes it", missing.length === 0, missing.join(" "));

	// And in every dialect, not only the one above. A byte whose every spelling is
	// a form the dialect refuses is a byte the palette cannot write there at all,
	// which coverage counted at `#amk 4` cannot see — `$E1`, `$E3` and `$E8` are
	// the three fades, and the forms that write them are gated at `#amk 3`.
	//
	// Only of the bytes the dialect itself will take: `#amm` refuses `$FA`
	// outright (AMK0156), and a button for it would be the palette offering what
	// AddmusicK does not.
	//
	// One allowance, and not a gap: at `#amk 1` a hand-written `$FC` is remote
	// gain and takes two arguments (`parser.ts:parseHexCommand`), so the byte is
	// reachable in the language but is not the command any entry names. A button
	// for it would be a fourth remote entry existing in one dialect, and the
	// catalogue offers a command rather than a byte.
	const EXEMPT: Readonly<Record<string, number>> = { "#amk 1": 0xfc };
	for (const { marker, target } of DIALECTS) {
		const live = new Set(
			resolveAll(target, false)
				.filter((entry) => entry.availability.state !== "blocked")
				.flatMap((entry) => [entry.vcmd, entry.writes])
				.filter((vcmd) => vcmd !== undefined),
		);
		const unreachable: string[] = [];
		for (let vcmd = 0xda; vcmd <= 0xfe; vcmd++) {
			const takes = formAvailability({ kind: "hex", vcmd }, target).state !== "blocked";
			if (takes && !live.has(vcmd) && EXEMPT[marker] !== vcmd) {
				unreachable.push(hex(vcmd));
			}
		}

		check(`${marker}: every VCMD $DA-$FE it takes is still reachable`, unreachable.length === 0, unreachable.join(" "));
	}

	const claimed = SUPERSEDED.filter((row) => offered.has(row.vcmd)).map((row) => hex(row.vcmd));
	check("nothing is both offered and superseded", claimed.length === 0, claimed.join(", "));

	// Which spelling supersedes a byte is `LetterEntry.writes`, and the app reads
	// it too — the roll meets a `$E7` in a compiled song and has to draw `v`'s
	// speaker. Resolved rather than restated here, so there is one statement of it.
	const writers = new Map(entries.filter((entry) => entry.writes !== undefined).map((entry) => [entry.writes, entry]));
	const orphaned = SUPERSEDED.filter((row) => !writers.has(row.vcmd)).map((row) => hex(row.vcmd));
	check("every superseded byte has an entry claiming to write it", orphaned.length === 0, orphaned.join(", "));

	check("entry keys are unique", keys.size === entries.length);

	// A withheld byte is still catalogued, and has to be: `glyphOf` reads these
	// rows backwards, so a `$F7` a porter typed by hand still earns its glyph and
	// its name on a roll bar and in the command lane. What it may not do is appear
	// on a strip. Both halves are checked, because deleting the row instead would
	// pass the second and silently fail the first.
	const READ = { beforeChannels: false };
	const withheld = ENTRIES.filter((entry) => entry.withheld === true);
	check("something is withheld, or this block proves nothing", withheld.length > 0);

	const leaked = withheld.filter((entry) => OFFERED.includes(entry)).map((entry) => entry.category);
	check("a withheld entry is never offered", leaked.length === 0, leaked.join(", "));

	// The reason it may be withheld at all: the editor says so when one is written.
	// Without this a byte could quietly leave the palette with nothing in its place.
	const unexplained = withheld.filter(
		(entry) =>
			commandHazards(tokenize(probe(DIALECTS[2].marker, resolveEntry(entry, DIALECTS[2].target, READ), false).song))
				.length === 0,
	);
	check("and every withheld byte is reported when it is written", unexplained.length === 0, String(unexplained.length));
}

// Every entry can be drawn and can be explained. An icon nobody drew renders as
// the dashed `@default` square and a missing blurb is a silent tooltip; both are
// invisible to the eye at a glance across forty buttons.
{
	// Read rather than imported: the paths live in a template, which nothing in
	// TypeScript can see into. A glyph the union knows and the `@switch` does not
	// type-checks, builds, and ships as a dashed square.
	const template = readFileSync(
		join(import.meta.dirname, "..", "web", "src", "app", "editor", "command-palette", "command-icon.html"),
		"utf8",
	);
	const undrawn = GLYPH_NAMES.filter((glyph) => !template.includes(`@case ('${glyph}')`));
	check("every glyph the union names has a @case", undrawn.length === 0, undrawn.join(", "));

	// The template has no <svg> of its own — the host is one — so Angular has no
	// parent to take a namespace from and every element needs the `svg:` prefix.
	// Without it the element is built in the HTML namespace: it type-checks, it
	// builds, and it draws nothing at all, in the palette and on a roll bar alike.
	const bare = [...template.matchAll(/<([a-z]+)(?![a-z])/g)]
		.map((found) => found[1])
		.filter((tag) => SVG_TAGS.has(tag));
	check("and every element carries the svg: prefix", bare.length === 0, [...new Set(bare)].join(", "));

	const entries = resolveAll(DIALECTS[2].target, false);
	const unused = GLYPH_NAMES.filter((glyph) => !entries.some((entry) => entry.icon === glyph));
	check("every glyph is used by an entry", unused.length === 0, unused.join(", "));

	// Two buttons that say the same thing. The face is an icon and the name is all
	// a search result has, so no two entries may share a label — `VCMD_NAMES`
	// calls both `$EF` and `$F1` "echo parameters".
	const seen = new Map<string, string>();
	const collisions: string[] = [];
	for (const entry of entries) {
		const first = seen.get(entry.label);
		if (first === undefined) {
			seen.set(entry.label, entry.key);
			continue;
		}

		collisions.push(`${first} and ${entry.key} are both "${entry.label}"`);
	}

	check("no two entries share a label", collisions.length === 0, collisions.join("; "));

	const silent = entries.filter((entry) => entry.blurb.trim().length === 0).map((entry) => entry.key);
	check("every entry has a blurb", silent.length === 0, silent.join(", "));

	// The blurb is the hover text and the readout line; a `$` in it would be the
	// raw byte creeping back into the one place that exists to be free of it.
	const bytes = entries.filter((entry) => entry.blurb.includes("$")).map((entry) => entry.key);
	check("no blurb recites hex", bytes.length === 0, bytes.join(", "));

	// The name is on the button face and again in the readout, so it is a heading
	// in both places; `VCMD_NAMES` and `LETTER_NAMES` are lower case for prose.
	const lower = entries.filter((entry) => entry.label !== capitalised(entry.label)).map((entry) => entry.key);
	check("every label is capitalised", lower.length === 0, lower.join(", "));
}
