/**
 * MIDI import: `@amk/import/midi` reading a Standard MIDI File and writing it as a song.
 *
 * The oracle is the compiler and the walk rather than the text written: a file is built in memory,
 * imported, compiled and walked, and the notes the walk plays are held to the notes the file plays.
 * The song is also diagnosed as the editor diagnoses it, so an import that raises a problem — a
 * stranded `$DD`, a channel that ends early, a note past its instrument — fails here first.
 *
 *   npm run miditest
 */

// First, so every module after it finds $localize and the English.

import "../localize";
import { runSections } from "../harness";

// In this order: each section runs as its module is evaluated.
await runSections([
	["parser", () => import("./parser")],
	["timing", () => import("./timing")],
	["voices", () => import("./voices")],
	["drums", () => import("./drums")],
	["instruments", () => import("./instruments")],
	["effects", () => import("./effects")],
	["end-to-end", () => import("./end-to-end")],
	["sharing", () => import("./sharing")],
	["stress", () => import("./stress")],
]);
