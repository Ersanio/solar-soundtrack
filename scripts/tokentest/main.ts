/**
 * The MML source scanner.
 *
 * Most of what this checks is ordinary — that `$F5` gathers eight arguments,
 * that `("kick.brr", $02)` does not mistake its tuning byte for a command. The
 * one that earns its place is restartability: scanning line by line with the
 * state carried across must give exactly what scanning the whole document
 * gives. CodeMirror restarts the scanner at arbitrary lines, so a state machine
 * that quietly depends on having seen the start of the file works perfectly
 * here and mis-colours text there, months later, for no visible reason.
 *
 *   npm run tokentest
 */

// First, so every module after it finds $localize and the English.

import "../localize";
import { runSections } from "../harness";

// In this order: each section runs as its module is evaluated.
await runSections([
	["hex-arguments", () => import("./hex-arguments")],
	["letters-and-fades", () => import("./letters-and-fades")],
	["note-lengths", () => import("./note-lengths")],
	["channels-and-tags", () => import("./channels-and-tags")],
	["replacements", () => import("./replacements")],
	["instruments-and-divergences", () => import("./instruments-and-divergences")],
	["dialect", () => import("./dialect")],
	["pitch-slide-note", () => import("./pitch-slide-note")],
	["hazards", () => import("./hazards")],
	["restartability", () => import("./restartability")],
	["driver-lengths", () => import("./driver-lengths")],
	["command-reach", () => import("./command-reach")],
]);
