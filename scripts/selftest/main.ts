/**
 * Byte-level sanity checks for the AddmusicK compiler.
 *
 * This is NOT the differential harness — `Compare-Spc.ps1` and `Compare-SongBin.ps1`
 * diff against a native AddmusicK build and are what actually establish fidelity.
 * This just catches gross breakage while iterating.
 *
 *   npm run selftest
 */

// First, so every module after it finds $localize and the English.

import "../localize";
import { runSections } from "../harness";

// In this order: each section runs as its module is evaluated.
await runSections([
	["notes-and-header", () => import("./notes-and-header")],
	["above-first-channel", () => import("./above-first-channel")],
	["drum-remap", () => import("./drum-remap")],
	["header-and-loops", () => import("./header-and-loops")],
	["legacy-targets", () => import("./legacy-targets")],
	["preprocessor-and-replacements", () => import("./preprocessor-and-replacements")],
	["diagnostic-spans", () => import("./diagnostic-spans")],
	["parity", () => import("./parity")],
	["samples-and-path", () => import("./samples-and-path")],
	["instruments", () => import("./instruments")],
	["sample-load", () => import("./sample-load")],
	["remote-code", () => import("./remote-code")],
	["pad-and-warnings", () => import("./pad-and-warnings")],
	["sample-usage", () => import("./sample-usage")],
	["audit", () => import("./audit")],
]);
