/**
 * What the `audiotest` sections share: the driver, the one emulator instance,
 * `compileToSpc`, `renderMuted`, and the level and pitch measures.
 */

import "../localize";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compiler } from "@amk/compiler";
import { EMPTY_SAMPLE_NAME } from "@amk/core/hardcoded-tables";
import { type BrrSample, emptySample } from "@amk/spc/brr";
import { loadDriver } from "@amk/spc/driver";
import { buildSpc } from "@amk/spc/export";
import { SPC_CHANNELS, SPC_SAMPLE_RATE, instantiate } from "@amk/spc/wasm-host";
import { TICK_POLL_HZ } from "@amk/spc/driver-state";
import { SPC_ASSETS, stubFetch } from "../harness";

stubFetch();

/** Peak absolute amplitude, as a fraction of full scale. */
export function peak(samples: Int16Array): number {
	let max = 0;
	for (const sample of samples) {
		max = Math.max(max, Math.abs(sample));
	}

	return max / 32768;
}

export function rms(samples: Int16Array): number {
	let sum = 0;
	for (const sample of samples) {
		sum += sample * sample;
	}

	return Math.sqrt(sum / samples.length) / 32768;
}

/**
 * Zero crossings a second over one window of the left channel — pitch, as far as
 * a headless render can measure it.
 *
 * Gated on a fraction of the window's own peak rather than on zero, so a decaying
 * sample is counted at the pitch it is ringing at instead of at the rate its noise
 * floor happens to cross. Only ever compared against another window of the same
 * sample; the absolute number means nothing.
 */
export function crossingRate(pcm: Int16Array, fromSeconds: number, toSeconds: number): number {
	const from = Math.max(0, Math.floor(fromSeconds * SPC_SAMPLE_RATE));
	const to = Math.min(Math.floor(pcm.length / SPC_CHANNELS), Math.floor(toSeconds * SPC_SAMPLE_RATE));
	if (to - from < 2) {
		return 0;
	}

	let loudest = 0;
	for (let frame = from; frame < to; frame++) {
		loudest = Math.max(loudest, Math.abs(pcm[frame * SPC_CHANNELS]));
	}

	const gate = loudest / 8;
	let crossings = 0;
	let above = false;
	let seen = false;
	for (let frame = from; frame < to; frame++) {
		const sample = pcm[frame * SPC_CHANNELS];
		if (Math.abs(sample) < gate) {
			continue;
		}

		const now = sample > 0;
		if (seen && now !== above) {
			crossings++;
		}

		above = now;
		seen = true;
	}

	return (crossings * SPC_SAMPLE_RATE) / (to - from);
}

/** The first frame at which two renders differ, or -1 where they never do. */
export function firstDifference(a: Int16Array, b: Int16Array): number {
	const shared = Math.min(a.length, b.length);
	for (let index = 0; index < shared; index++) {
		if (a[index] !== b[index]) {
			return Math.floor(index / SPC_CHANNELS);
		}
	}

	return a.length === b.length ? -1 : Math.floor(shared / SPC_CHANNELS);
}

// ---------------------------------------------------------------------------

export const driver = await loadDriver();

/** What the host would pass: every name the driver bundle can resolve. */
export const OPTIONS = {
	sampleNames: driver.samples.map((sample) => sample.sampleName),
	sampleGroups: driver.manifest.sampleGroups,
};
export const BY_NAME = new Map(driver.samples.map((sample) => [sample.sampleName, sample]));
BY_NAME.set(EMPTY_SAMPLE_NAME, emptySample(EMPTY_SAMPLE_NAME));

/**
 * Resolves names to samples the way the app does, preserving positions.
 *
 * Dropping an unresolvable name would shift every later SRCN down and rewire the
 * directory: a `$DA`-selected instrument plays silence while an `@`-selected one
 * survives by sitting at index 0.
 */
export function resolveSamples(names: readonly string[]): BrrSample[] {
	return names.map((name) => BY_NAME.get(name) ?? emptySample(name));
}

export function compileToSpc(source: string): Uint8Array {
	const result = compiler.compile({ source, aramAddress: driver.manifest.localPos, options: OPTIONS });
	if (!result.ok || !result.data) {
		throw new Error(result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
	}

	// Resolve the compiler's own list, exactly as the app does. Passing
	// `driver.samples` regardless would defeat the point of every `#samples` test.
	const samples = resolveSamples(result.sampleList ?? driver.samples.map((s) => s.sampleName));

	return buildSpc({
		songData: result.data,
		driver,
		samples,
		tags: result.stats?.tags,
		seconds: result.stats?.tagSeconds,
		echoBufferSize: result.stats?.echoBufferSize,
		date: new Date(2026, 6, 28),
	}).spc;
}

/** Frames per emulated block, matching the rate the worklet polls the driver at. */
export const BLOCK = SPC_SAMPLE_RATE / TICK_POLL_HZ;

/**
 * Renders with channels muted the way the app mutes them: in the DSP, between
 * emulated blocks, as `worklet.ts` does when a mask arrives. Nothing about the
 * SPC image or the driver changes.
 *
 * `warmup` frames are rendered and thrown away first, so the song is past its
 * boot handshake by the time the level is measured; keep it and `frames` whole
 * multiples of {@link BLOCK}. `maskAt` is given the frame the block starts on,
 * counted from the very beginning, so a test can mute partway through.
 */
export function renderMuted(
	spc: Uint8Array,
	warmup: number,
	frames: number,
	maskAt: (frame: number) => number,
): Int16Array {
	emu.loadSpc(spc);
	const out = new Int16Array(frames * SPC_CHANNELS);

	let written = 0;
	for (let done = 0; done < warmup + frames; done += BLOCK) {
		const chunk = emu.renderView(Math.min(BLOCK, warmup + frames - done));
		if (done >= warmup) {
			out.set(chunk, written);
			written += chunk.length;
		}

		// After the block, like the worklet: a mask posted now takes effect on
		// the next one.
		emu.muteVoices(maskAt(done));
	}

	return out.subarray(0, written);
}

export const emu = instantiate(new WebAssembly.Module(readFileSync(join(SPC_ASSETS, "player", "spc.wasm"))));
