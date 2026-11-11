/** `palettetest`: a command read back out of a song finds its glyph. */

import "../localize";
import { tokenize, VCMD_NAMES } from "@amk/tokens";
import { glyphOf } from "../../web/src/app/editor/command-palette/glyph-of";
import { commandScope } from "@amk/tokens/commands/in-force";
import { check, section } from "../harness";
import { hex } from "./support";

// ---------------------------------------------------------------------------
section("a command read back out of a song finds its glyph");
// ---------------------------------------------------------------------------
//
// The catalogue answers "what can I add"; the piano roll asks it backwards, for
// a command already written. A byte with no answer is a bar with a gap on it,
// which looks exactly like a bar with nothing acting on it.
{
	const drawnAt = (marker: string, body: string) => {
		const source = `${marker}\n#0 ${body}\n`;
		const command = tokenize(source).commands.find((entry) => entry.span.start >= source.indexOf(body));
		return command === undefined ? null : { command, entry: glyphOf(command) };
	};

	const drawn = (body: string) => drawnAt("#amk 4", body);

	const undrawable: string[] = [];
	for (const vcmd of Object.keys(VCMD_NAMES).map(Number)) {
		const found = drawn(hex(vcmd));
		if (found === null || commandScope(found.command) !== "note-state") {
			continue;
		}

		if (found.entry === null) {
			undrawable.push(hex(vcmd));
		}
	}

	check("every VCMD that acts on a note has a glyph", undrawable.length === 0, undrawable.join(" "));

	const letters = ["@", "v", "y", "q", "h", "n", "p"];
	const missing = letters.filter((letter) => drawn(`${letter}1`)?.entry == null);
	check("and so does every letter that acts on one", missing.length === 0, missing.join(" "));

	// One opcode, two envelopes, told apart by the first argument's top bit —
	// the same test the inspector makes to choose between the two views.
	check("$ED below $80 is the four-stage envelope", drawn("$ED $3F $4D")?.entry?.icon === "adsr");
	check("and at or above it drives the level directly", drawn("$ED $8E $7F")?.entry?.icon === "gain");

	// A second argument turns three letters into their fades, which is the same
	// count `gather` splits their names on.
	check("t144 is the tempo glyph", drawn("t144")?.entry?.icon === "metronome");
	check("and t18,144 the fade", drawn("t18,144")?.entry?.icon === "metronomeFade");
	check("v200 is the volume glyph", drawn("v200")?.entry?.icon === "speaker");
	check("and v18,200 the fade", drawn("v18,200")?.entry?.icon === "hairpin");

	// …but only where the dialect reads the comma. Below `#amk 3` the second
	// number is not an argument, so the command is a plain `t` and saying "fade"
	// would put the word on a bar for a song that has none.
	const flat = drawnAt("#amk 2", "t18,144");
	check("under #amk 2, t18,144 is not a fade", flat?.entry?.icon === "metronome", flat?.entry?.icon);
	check("and is named for what it is", flat?.command.name === "tempo", flat?.command.name);

	// `#am4` reuses two bytes for other commands entirely, and the name has to
	// follow the arguments *written* rather than the ones a button would insert
	// — `resolveEntry` names an entry from its own defaults, which are chosen to
	// stay clear of these very forks.
	const named = (marker: string, body: string) => drawnAt(marker, body)?.entry?.label;
	check("#am4's $ED $81 is a tune", named("#am4", "$ED $81 $10") === "Tune", named("#am4", "$ED $81 $10"));
	check(
		"its $ED $80 is a DSP write",
		named("#am4", "$ED $80 $6C $20") === "DSP write",
		named("#am4", "$ED $80 $6C $20"),
	);
	check(
		"and its plain $ED is still an envelope",
		named("#am4", "$ED $3F $4D") === "ADSR",
		named("#am4", "$ED $3F $4D"),
	);

	const load = drawnAt("#am4", "$E5 $80 $04");
	check("#am4's $E5 with a high first byte is a sample load", load?.entry?.label === "Sample load", load?.entry?.label);
	check("and draws the sample glyph, not tremolo's", load?.entry?.icon === "sample", load?.entry?.icon);
	check("while a low one is still tremolo", drawnAt("#am4", "$E5 $00 $12 $08")?.entry?.icon === "tremolo");

	// The guard on all of that: `vcmdName` calls both `$EF` and `$F1` "echo
	// parameters" whatever their arguments, so only the entries' own labels tell
	// them apart and a rule that preferred the written name would lose them.
	check("$EF keeps the label that tells it from $F1", named("#amk 4", "$EF $FF $28 $28") === "Echo channels & volume");
	check("and $F1 keeps its own", named("#amk 4", "$F1 $02 $00 $00") === "Echo delay & feedback");
}
