/** `walktest`: the commands that must not be walked as notes. */

import "../localize";
import { check, section } from "../harness";
import { build } from "./support";

// ---------------------------------------------------------------------------
section("the commands that must not be walked as notes");
// ---------------------------------------------------------------------------
{
	// Assertion 2. The arpeggio's three note bytes are arguments, not notes.
	const { timeline } = build("#amk 4\n#0 o4 $FB $03 $10 $80 $84 $87 c4 d4\n");
	check("an arpeggio's note bytes are not notes", timeline.notes.length === 2, `${timeline.notes.length} notes`);

	const plain = build("#amk 4\n#0 o4 c4 d4\n").timeline;
	check(
		"and the arpeggio costs no ticks of its own",
		timeline.channelTicks[0] === plain.channelTicks[0],
		`${timeline.channelTicks[0]} against ${plain.channelTicks[0]}`,
	);

	// `$FC` points at a body in the loop block that runs off an event. Following
	// it would invent ticks; it must be skipped as a plain five-byte command.
	const remote = build("#amk 4\n(!1)[$E7 $30]\n#0 o4 (!1,-1) c4 d4\n").timeline;
	check(
		"a remote call costs no ticks and adds no notes",
		remote.channelTicks[0] === plain.channelTicks[0] && remote.notes.length === 2,
		`${remote.channelTicks[0]} ticks, ${remote.notes.length} notes`,
	);

	// A hot-patch chain is five bytes, not three. Getting it wrong desynchronises
	// everything after it, which shows up as the wrong number of notes.
	const hot = build("#amk 4\n#0 $FA $FE $80 $80 $05 o4 c4 d4\n").timeline;
	check(
		"a hot-patch chain does not desynchronise the channel",
		hot.notes.length === 2 && hot.channelTicks[0] === plain.channelTicks[0],
		`${hot.notes.length} notes, ${hot.channelTicks[0]} ticks`,
	);
}
