/** `palettetest`: placement either side of the first channel, and `songTarget`'s marker precedence. */

import "../localize";
import { tokenize } from "@amk/tokens";
import { channelsBeginAt, songTarget } from "@amk/tokens/dialect";
import { check, section } from "../harness";

section("placement");

// The rule `channelsBeginAt` exists for: a remote definition above the first
// channel is a definition, and below it is read as a call.
{
	const song = "#amk 4\n(!1)[$F4 $09]\n#0 c4\n";
	const first = channelsBeginAt(tokenize(song));
	check("channelsBeginAt finds the first #N", first === song.indexOf("#0"), `found ${first}`);
	check("and nothing when the song has no channel", channelsBeginAt(tokenize("#amk 4\n")) === null);
}

// `songTarget` resolves the file the way `preprocess.ts` does, and the precedence
// is the part worth pinning below the music rather than above it: `tokentest`
// already covers these orderings for `Command.target`, where every marker
// precedes the command it governs, and the whole point here is that it need not.
{
	const said = (song: string) => {
		const read = songTarget(tokenize(song));
		return read.program === 0 ? `#amk ${read.amkVersion}` : read.program === 1 ? "#am4" : "#amm";
	};

	// preprocess.ts's `amk` case is guarded by `version >= 0`, so a legacy marker
	// anywhere stops every later #amk — even one written after it.
	check("#amk below #am4 does not win", said("#am4\n#0 c4\n#amk 2\n") === "#am4", said("#am4\n#0 c4\n#amk 2\n"));
	// Its `amm` and `am4` cases are unguarded, so a legacy marker always does.
	check("#amm below #amk wins", said("#amk 2\n#0 c4\n#amm\n") === "#amm", said("#amk 2\n#0 c4\n#amm\n"));
	// And between two #amk lines, the last one.
	check("the last #amk wins", said("#amk 4\n#0 c4\n#amk 1\n") === "#amk 1", said("#amk 4\n#0 c4\n#amk 1\n"));
	check("no marker is the #amk 4 default", said("#0 c4\n") === "#amk 4", said("#0 c4\n"));
}
