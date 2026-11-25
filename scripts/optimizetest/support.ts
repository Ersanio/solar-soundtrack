/** What every `optimizetest` section shares: a song compiled as the editor compiles it, optimized, its walk read back a second way, and each channel opened as the piano roll opens it. */

import "../localize";
import { compiler } from "@amk/compiler";
import type { CompileResult } from "@amk/core/types";
import { type ExistingLoops, type OptimizeMode, type OptimizeResult, optimizeSong } from "@amk/optimize/optimize";
import { loadDriver } from "@amk/spc/driver";
import { walkSong } from "@amk/spc/song-walk";
import { tokenize } from "@amk/tokens";
import { channelStrip, isStrip } from "../../web/src/app/editor/views/piano-roll/roll-strip";
import { stubFetch } from "../harness";

stubFetch();

export const driver = await loadDriver();
export const ARAM = driver.manifest.localPos;

/** `source` compiled at `aram` against the stock samples and `extra`. */
export function compile(source: string, extra: readonly string[] = [], aram = ARAM): CompileResult {
	return compiler.compile({
		source,
		aramAddress: aram,
		options: {
			sampleNames: [...driver.samples.map((s) => s.sampleName), ...extra],
			sampleGroups: driver.manifest.sampleGroups,
			importantSamples: driver.manifest.importantSamples,
			optimizeSampleUsage: true,
		},
	});
}

export interface Options {
	mode?: OptimizeMode;
	loops?: ExistingLoops;
	extra?: readonly string[];
}

/** `text` optimized as the editor optimizes it. */
export function optimize(text: string, options: Options = {}): OptimizeResult {
	return optimizeSong(text, {
		mode: options.mode ?? "import",
		existingLoops: options.loops ?? "keep",
		aramAddress: ARAM,
		compile: (source, aram) => compile(source, options.extra ?? [], aram),
	});
}

/**
 * Each channel's notes as the walk plays them — tick, pitch with `$FA $02` folded in, length and
 * gate — read here rather than through the optimizer's own comparison, so the two are checked
 * against each other.
 */
export function played(text: string, extra: readonly string[] = []): string[] | string {
	const result = compile(text, extra);
	if (!result.data) {
		return result.diagnostics.find((d) => d.severity === "error")?.message ?? "no data";
	}

	const timeline = walkSong(result.data, ARAM);
	return timeline.notes.map(
		(n) =>
			`${n.channel}@${n.tick}:${n.key === null ? `d${n.percussion}` : n.key + n.state.tune}x${n.ticks}/${n.gateTicks} v${n.state.volume} i${n.state.instrument}`,
	);
}

/** Whether `a` and `b` play the same notes; the first difference otherwise. */
export function sameNotes(a: string, b: string, extra: readonly string[] = []): string | null {
	const pa = played(a, extra);
	const pb = played(b, extra);
	if (typeof pa === "string" || typeof pb === "string") {
		return `${String(pa)} / ${String(pb)}`.slice(0, 200);
	}

	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		if (pa[i] !== pb[i]) {
			return `note ${i}: ${pa[i]} became ${pb[i]}`;
		}
	}

	return null;
}

/** Each channel the song writes that the piano roll refuses, with why. */
export function refusedChannels(text: string, extra: readonly string[] = []): string[] {
	const result = compile(text, extra);
	if (!result.data) {
		return ["does not compile"];
	}

	const timeline = walkSong(result.data, ARAM);
	const index = tokenize(text);
	const refused: string[] = [];
	for (let channel = 0; channel < 8; channel++) {
		if (!new RegExp(`^#${channel}(\\s|$)`, "m").test(text)) {
			continue;
		}

		const strip = channelStrip({
			source: text,
			channel,
			noteMap: result.noteMap ?? [],
			commandMap: result.commandMap ?? [],
			timeline,
			index,
			tempoRatio: 1,
		});
		if (!isStrip(strip)) {
			refused.push(`#${channel}: ${strip.refused}`);
		}
	}

	return refused;
}

/** Errors and warnings the compiler raises, by code. */
export function warnings(text: string, extra: readonly string[] = []): string[] {
	return compile(text, extra)
		.diagnostics.filter((d) => d.severity !== "info")
		.map((d) => d.code);
}
