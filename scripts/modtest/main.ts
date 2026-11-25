/**
 * MOD import: `@amk/import/mod` reading a MOD, playing it tick by tick and writing it as a song on
 * custom instruments made from its samples.
 *
 * The oracle is the compiler and the walk rather than the text written: a file is built in memory,
 * imported, its samples planned and encoded as the dialog does, the song compiled and walked, and the
 * notes the walk plays held to the ticks and pitches the MOD plays them at. The song is diagnosed as
 * the editor diagnoses it and assembled into an `.spc`, so an import that raises a problem or does not
 * fit fails here first.
 *
 *   npm run modtest
 */

// First, so every module after it finds $localize and the English.

import "../localize";
import { runSections } from "../harness";

// In this order: each section runs as its module is evaluated.
await runSections([
	["reader", () => import("./reader")],
	["timing", () => import("./timing")],
	["pitch", () => import("./pitch")],
	["effects", () => import("./effects")],
	["loops", () => import("./loops")],
	["samples", () => import("./samples")],
	["umx", () => import("./umx")],
	["sharing", () => import("./sharing")],
	["stress", () => import("./stress")],
]);
