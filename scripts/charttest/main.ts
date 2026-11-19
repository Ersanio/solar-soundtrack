/**
 * Everything the app draws that is arithmetic rather than markup: the stacked
 * bar, the plot space, `clamp`, the piano roll's lanes, mark window, grid and
 * playhead clock, its drum lanes, the slider's track, and the transport's
 * tick-to-seconds clock.
 *
 * The ARAM bar spans all 64 KiB, so real regions are routinely a fraction of a
 * percent of it and land on sub-pixel widths — subtracting the inter-segment gap
 * from each segment would zero anything narrower than the gap — and that is
 * awkward to eyeball in a browser. So it lives in a pure function and is checked
 * here.
 *
 *   npm run charttest
 */

// First, so every module after it finds $localize and the English.

import "../localize";
import { runSections } from "../harness";

// In this order: each section runs as its module is evaluated.
await runSections([
	["stack-plot-clamp", () => import("./stack-plot-clamp")],
	["lanes", () => import("./lanes")],
	["window-and-grid", () => import("./window-and-grid")],
	["pages", () => import("./pages")],
	["playhead-and-overview", () => import("./playhead-and-overview")],
	["loop-regions", () => import("./loop-regions")],
	["loop-labels", () => import("./loop-labels")],
	["loop-follow", () => import("./loop-follow")],
	["playhead-clock", () => import("./playhead-clock")],
	["percussion", () => import("./percussion")],
	["transport-clock", () => import("./transport-clock")],
	["bar-text", () => import("./bar-text")],
	["command-lane", () => import("./command-lane")],
	["slider-track", () => import("./slider-track")],
	["transport-view", () => import("./transport-view")],
	["record-pointer", () => import("./record-pointer")],
	["song-inspector", () => import("./song-inspector")],
]);
