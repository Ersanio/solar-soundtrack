/**
 * The message contract between `player.ts` on the page and `worklet.ts` on the
 * audio thread. Kept in its own module so both sides compile against one
 * definition — the worklet is bundled separately by esbuild, so a mismatch here
 * would otherwise only show up at runtime as silence.
 */

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
			/** ID666 play length. 0 means unknown, so never end on its own. */
			lengthSeconds: number;
			/** ID666 fade, applied after `lengthSeconds` unless looping. */
			fadeSeconds: number;
	  }
	| { type: "seek"; seconds: number }
	| { type: "paused"; paused: boolean }
	| { type: "loop"; loop: boolean }
	| { type: "stop" };

/** Audio thread to page. */
export type FromWorklet =
	| { type: "position"; seconds: number }
	| { type: "ended" }
	| { type: "error"; message: string };
