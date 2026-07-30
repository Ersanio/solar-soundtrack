/**
 * The message contract between `player.ts` on the page and `worklet.ts` on the
 * audio thread. Kept in its own module so both sides compile against one
 * definition — the worklet is bundled separately by esbuild, so a mismatch here
 * would otherwise only show up at runtime as silence.
 */

import type { DriverState } from "./driver-state";

/** Registered name of the processor, shared by `registerProcessor` and the node. */
export const SPC_PROCESSOR = "spc-processor";

/**
 * Passed through `AudioWorkletNodeOptions.processorOptions`. An
 * AudioWorkletGlobalScope has no `fetch`, so the page compiles the binary and
 * hands the module across — `WebAssembly.Module` is structured-cloneable.
 */
export interface SpcProcessorOptions {
	module: WebAssembly.Module;
}

/** Page to audio thread. */
export type ToWorklet =
	| {
			type: "load";
			/** A complete `.spc` file image, as `buildSpc` produces. */
			spc: Uint8Array;
			/** Start position; the emulator fast-forwards to it. */
			atSeconds: number;
			/**
			 * The song's shape in music ticks: the intro, played once, and the loop
			 * that follows it. Both 0 when the compiler could not work them out, in
			 * which case the song plays on until it is stopped.
			 *
			 * Ticks rather than seconds because the worklet counts the driver's own
			 * ticks. A tick is the same tick on both sides of the boundary, whereas
			 * the seconds it takes cannot be predicted exactly.
			 */
			introTicks: number;
			loopTicks: number;
			/** Fade tail in seconds, played after the end unless looping. */
			fadeSeconds: number;
			/**
			 * The song data loops on its own, so the emulator repeats it unaided and
			 * the "loop" mode has nothing to do. A song without a loop point has to
			 * be restarted by hand instead, or it runs on into silence.
			 */
			songLoops: boolean;
	  }
	| { type: "seek"; seconds: number }
	| { type: "paused"; paused: boolean }
	| { type: "loop"; loop: boolean }
	| { type: "stop" };

/** Audio thread to page. */
export type FromWorklet =
	| {
			type: "position";
			/** Emulated time since the song was loaded, which a loop runs past. */
			seconds: number;
			/** Music ticks counted off the driver since the song was loaded. */
			ticks: number;
			/** The same playhead folded into one pass, for a transport to show. */
			songTicks: number;
			/** What the driver is doing, for anything that wants to follow along. */
			driver: DriverState;
	  }
	| { type: "ended" }
	| { type: "error"; message: string };
