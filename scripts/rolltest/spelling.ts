/** `rolltest`: the spellings the roll and the compiler have to agree on. */

import "../localize";
import { NOTE_MAX, NOTE_MIN } from "@amk/core/hardcoded-tables";
import { octaveFor, octaveOfNote, spellDuration, spellNote } from "@amk/core/mml-text";
import { NOTE_NAMES } from "@amk/tokens/commands/units";
import { check, section } from "../harness";

// --- the spellings the roll and the compiler have to agree on ---------------

section("spelling");
{
	let agree = true;
	let roundTrips = true;
	for (let written = NOTE_MIN; written < NOTE_MAX; written++) {
		const octave = octaveFor(written);
		const text = octave === null ? null : spellNote(written, octave);
		if (octave === null || text === null) {
			agree = false;
			break;
		}

		agree &&= text === NOTE_NAMES[(written - NOTE_MIN) % 12];
		roundTrips &&= octaveOfNote(written, text) === octave;
	}

	check("spellNote names the key NOTE_NAMES does, for every note the driver plays", agree);
	check("a note's octave falls back out of its written byte", roundTrips);
	check("a length over a whole note is tied", spellDuration(421, 4) === "1^1^=37", spellDuration(421, 4) ?? "null");
	check("a whole note is one token", spellDuration(192, 4) === "1", spellDuration(192, 4) ?? "null");
}
