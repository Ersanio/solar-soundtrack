/**
 * The MML optimizer: `@amk/optimize` rewriting a song with loops to compile smaller and play the same.
 *
 * The oracle is a second reading of the walk, not the optimizer's own proof: every rewrite is held to
 * play the notes the original plays, at the same ticks, pitches, lengths, volumes and instruments,
 * to open in the piano roll on every channel, and, for a tracker import, to raise no problem.
 *
 *   npm run optimizetest
 */

// First, so every module after it finds $localize and the English.

import "../localize";
import { runSections } from "../harness";

// In this order: each section runs as its module is evaluated.
await runSections([
	["constructs", () => import("./constructs")],
	["constraints", () => import("./constraints")],
	["tracker", () => import("./tracker")],
	["redo", () => import("./redo")],
]);
