/** `walktest`: malformed data is contained, not thrown. */

import "../localize";
import { walkSong } from "@amk/spc/song-walk";
import { check } from "../harness";
import { ARAM, build } from "./support";

// ---------------------------------------------------------------------------
console.log("\nmalformed data is contained, not thrown");
// ---------------------------------------------------------------------------
{
	// `*` before any `[ ]` emits `$E9 FF FF n` on purpose (`parser.ts:2564-2573`,
	// porting `Music.cpp:1321`), because AddmusicK builds it rather than
	// rejecting it. What it does *not* do is point outside the song: relocation
	// adds the loop-block base to `$FFFF` and keeps the low sixteen bits, so the
	// call wraps to one byte below the block and lands back inside the blob. The
	// driver follows it into whatever is there and so does the walk — the only
	// thing worth asserting is that a song built from nonsense still terminates.
	const { timeline } = build("#amk 4\n#0 o4 *2 c4 d4\n");
	check("a call to nowhere still terminates", !timeline.truncated, timeline.problems.join(" | "));

	// A blob whose phrase table points outside itself.
	const broken = walkSong(Uint8Array.from([0x00, 0x40, 0x00, 0x00]), ARAM);
	check("a phrase outside the song is reported", broken.problems.length > 0, broken.problems.join(" | "));
	check("and yields no notes", broken.notes.length === 0);

	const nothing = walkSong(new Uint8Array(0), ARAM);
	check("an empty blob is reported", nothing.problems.length > 0 && nothing.notes.length === 0);
}
