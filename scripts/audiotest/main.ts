/**
 * End-to-end audio check: MML -> SPC -> actual PCM samples.
 *
 * Runs the emulator through `@amk/spc/wasm-host`, the same host the browser
 * uses — it is deliberately DOM-free so the audio path can be tested headless.
 * That means this script covers the real glue rather than a stand-in.
 *
 * This is what proves the whole pipeline: if the compiler, the driver layout,
 * the sample directory or the CPUIO handshake were wrong, the emulator would
 * run and produce silence.
 *
 *   npm run audiotest
 */

// First, so every module after it finds $localize and the English.

import "../localize";
import { runSections } from "../harness";

// In this order: each section runs as its module is evaluated.
await runSections([
	["sound", () => import("./sound")],
	["muting", () => import("./muting")],
	["pitch", () => import("./pitch")],
	["samples", () => import("./samples")],
	["loop-and-ticks", () => import("./loop-and-ticks")],
	["note-map", () => import("./note-map")],
	["audition", () => import("./audition")],
	["audition-in-song", () => import("./audition-in-song")],
	["audition-slide", () => import("./audition-slide")],
	["audition-checkpoint", () => import("./audition-checkpoint")],
	["voices", () => import("./voices")],
	["analysis", () => import("./analysis")],
]);
