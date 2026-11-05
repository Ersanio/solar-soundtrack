/** `walktest`: a song that does not loop. */

import "../localize";
import { check } from "../harness";
import { build } from "./support";

// ---------------------------------------------------------------------------
console.log("\na song that does not loop");
// ---------------------------------------------------------------------------
{
	const { result, timeline } = build("#amk 4\n#option noloop\n#0 o4 c4d4e4f4\n");
	check("the compiler says it does not loop", result.stats?.loops === false);
	check("and so does the walk", timeline.loopTick === null);
	check("its notes are still there", timeline.notes.length === 4, `${timeline.notes.length} notes`);
}
