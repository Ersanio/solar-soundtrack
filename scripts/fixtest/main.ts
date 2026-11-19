/**
 * The Problems list's fixes: each one offered where it should be and nowhere else, writing what it
 * says it writes, and leaving a song that no longer raises what it fixed and raises no new error.
 *
 * A fix is verified the way the piano roll's edits are: by compiling the text it leaves, walking
 * it and diagnosing it again, never by reading the text alone. The fixes that claim to change
 * nothing in the song are held to the same bytes. The diff the dialog draws is pinned here too.
 *
 *   npm run fixtest
 */

// First, so every module after it finds $localize and the English.

import "../localize";
import { runSections } from "../harness";

// In this order: each section runs as its module is evaluated.
await runSections([
	["directives", () => import("./directives")],
	["text", () => import("./text")],
	["names", () => import("./names")],
	["samples", () => import("./samples")],
	["hazards", () => import("./hazards")],
	["arpeggio", () => import("./arpeggio")],
	["lengths", () => import("./lengths")],
	["repeat", () => import("./repeat")],
	["diff", () => import("./diff")],
]);
