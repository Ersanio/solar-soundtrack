/**
 * The piano roll's edits: `roll-strip.ts` and `roll-edit.ts`, driven the way the
 * roll drives them and checked against the walk of what they wrote.
 *
 * A gesture is not verified by looking at the text it produced. It is verified
 * by **compiling that text and walking it**: every note the plan said the
 * channel would hold has to be there, on its tick, for its length and at the
 * pitch it was written at — and no other channel may have moved. That is the
 * only check that can tell a splice which looks right from one which is right,
 * because everything the roll writes is read back through `o`, `l` and `q` it
 * did not write.
 *
 * It also holds the two spelling rules the roll and the compiler have to agree
 * on — that `spellNote` names the same key `@amk/tokens`' `NOTE_NAMES` does, and
 * that a note's octave falls out of its written byte — and the refusals, each
 * with a song that earns it.
 *
 *   npm run rolltest
 */

// First, so every module after it finds $localize and the English.

import "../localize";
import { runSections } from "../harness";

// In this order: each section runs as its module is evaluated.
await runSections([
	["spelling", () => import("./spelling")],
	["gate", () => import("./gate")],
	["loops", () => import("./loops")],
	["loop-carries-loops", () => import("./loop-carries-loops")],
	["loop-edge-gap", () => import("./loop-edge-gap")],
	["loop-edge-join", () => import("./loop-edge-join")],
	["loop-resize", () => import("./loop-resize")],
	["note-drags", () => import("./note-drags")],
	["note-deletes", () => import("./note-deletes")],
	["note-draws", () => import("./note-draws")],
	["bulk", () => import("./bulk")],
	["insert-mode", () => import("./insert-mode")],
	["overwrite-mode", () => import("./overwrite-mode")],
	["carried-past", () => import("./carried-past")],
	["removed-commands", () => import("./removed-commands")],
	["drum-apart", () => import("./drum-apart")],
	["refusals", () => import("./refusals")],
	["drag-carries", () => import("./drag-carries")],
	["past-the-end", () => import("./past-the-end")],
	["opening-a-channel", () => import("./opening-a-channel")],
	["carrying-a-command", () => import("./carrying-a-command")],
	["pitch-slide", () => import("./pitch-slide")],
	["selection", () => import("./selection")],
	["seed", () => import("./seed")],
]);
