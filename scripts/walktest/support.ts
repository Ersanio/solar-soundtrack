/** What every `walktest` section shares: the driver, `build` (compile a song and walk it), and the samples by name. */

import "../localize";
import { compiler } from "@amk/compiler";
import type { CompileResult } from "@amk/core/types";
import { loadDriver } from "@amk/spc/driver";
import { type SongTimeline, walkSong } from "@amk/spc/song-walk";
import { stubFetch } from "../harness";

stubFetch();

export const driver = await loadDriver();
export const ARAM = driver.manifest.localPos;
const OPTIONS = {
	sampleNames: driver.samples.map((sample) => sample.sampleName),
	sampleGroups: driver.manifest.sampleGroups,
};

export const BY_NAME = new Map(driver.samples.map((sample) => [sample.sampleName, sample]));

export function build(source: string): { result: CompileResult; timeline: SongTimeline } {
	const result = compiler.compile({ source, aramAddress: ARAM, options: OPTIONS });
	if (!result.ok || !result.data) {
		throw new Error(result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
	}

	return { result, timeline: walkSong(result.data, ARAM) };
}

/** The default target, which is the only one emitted bytes can be in. */
export const DEFAULT_TARGET = { program: 0, amkVersion: 4 } as const;
