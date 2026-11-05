/** `walktest`: every note the walk finds is a note the compiler mapped. */

import "../localize";
import { check } from "../harness";
import { build } from "./support";
import { CORPUS } from "./song-length";

// ---------------------------------------------------------------------------
console.log("\nevery note the walk finds is a note the compiler mapped");
// ---------------------------------------------------------------------------
{
	let checked = 0;
	let unmapped = "";
	let wrongPitch = "";
	let wrongLength = "";

	for (const song of CORPUS) {
		const { result, timeline } = build(song.source);
		const byAddress = new Map((result.noteMap ?? []).map((entry) => [entry.address, entry]));

		for (const note of timeline.notes) {
			checked++;
			const entry = byAddress.get(note.address);
			if (!entry) {
				unmapped += ` ${song.name}#${note.channel}@0x${note.address.toString(16)}`;
				continue;
			}

			// `noteMap` records the emitting channel, which is the loop block for a
			// note inside `[ ]`; the walk records the voice that sounds it.
			if (entry.channel !== note.channel && entry.channel !== 8) {
				unmapped += ` ${song.name}#${note.channel}(mapped to ${entry.channel})`;
			}

			if (entry.note !== note.note) {
				wrongPitch += ` ${song.name} $${entry.note.toString(16)}!=$${note.note.toString(16)}`;
			}

			if (entry.ticks !== note.ticks) {
				wrongLength += ` ${song.name} ${entry.ticks}!=${note.ticks}`;
			}
		}
	}

	check("the corpus produced notes to check", checked > 100, `${checked} notes`);
	check("every walked note has a note-map entry", unmapped === "", unmapped);
	check("every walked note has the pitch the compiler emitted", wrongPitch === "", wrongPitch);
	check("every walked note has the length the compiler emitted", wrongLength === "", wrongLength);
}
