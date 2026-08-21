import { hex } from "@amk/core/hex";
import type { CompileRequest, CompileResult, CompileStats, Diagnostic } from "@amk/core/types";
import { link } from "./link";
import { type AddmusicKOptions, AddmusicKParser } from "./parser";

export type { AddmusicKOptions };

/**
 * AddmusicK, covering every target it accepts.
 *
 * `#amk 4`:  AddmusicK 1.0.9+ (current)
 * `#amk 2`:  AddmusicK 1.0-1.0.8
 * `#amk 1`:  AddmusicK Beta
 * `#am4`  :  Addmusic 4.05
 * `#amm`  :  AddmusicM
 * `#amk 3` (Codec's beta) is rejected. AddmusicK itself does not implement it.
 */
export class AddmusicKCompiler {
	compile(request: CompileRequest): CompileResult {
		const { source, aramAddress } = request;
		const options = readOptions(request.options);

		if (!Number.isInteger(aramAddress) || aramAddress < 0 || aramAddress > 0xffff) {
			return this.failure([
				{
					severity: "error",
					code: "AMK0301",
					message: `ARAM address 0x${hex(aramAddress)} is outside the 64 KiB address space.`,
					span: { start: 0, end: 0, line: 1 },
				},
			]);
		}

		// Read apart from `readOptions`, which answers `undefined` for a bag with
		// no sample library in it; a trace is asked for on its own.
		const trace = request.options?.["trace"] === true;
		const parsed = new AddmusicKParser(source, options, trace).parse();

		const stats = this.initStats();
		stats.channelTicks = parsed.channelLengths.map((ticks) => Math.floor(ticks));
		// Music.cpp:3209 — the song is as long as its shortest channel
		const played = stats.channelTicks.filter((ticks) => ticks !== 0);
		stats.introTicks = Math.floor(parsed.introTicks);
		stats.loopTicks = played.length ? Math.min(...played) - stats.introTicks : 0;
		stats.echoBufferSize = parsed.echoBufferSize;
		stats.sampleNames = [...(parsed.requestedSamples ?? [])];
		stats.usedSampleNames = [...new Set(stats.sampleNames.filter((_, srcn) => parsed.usedSamples[srcn]))];
		stats.hasIntro = parsed.hasIntro;
		stats.loops = !parsed.doesntLoop;
		stats.tagSeconds = parsed.tagSeconds;
		stats.introSeconds = parsed.introSeconds;
		stats.mainSeconds = parsed.mainSeconds;
		stats.playback = parsed.playback;
		stats.tags = parsed.tags;

		const sampleList = parsed.sampleList;
		if (parsed.errorCount > 0) {
			return this.failure(parsed.diagnostics, stats, sampleList);
		}

		// Check if song has musical data.
		const hasData = parsed.data.slice(0, 8).some((channel) => channel.length > 0);
		if (!hasData) {
			return this.failure(
				[
					...parsed.diagnostics,
					{
						severity: "error",
						code: "AMK0302",
						message: "This song contained no musical data.",
						span: { start: 0, end: 0, line: 1 },
					},
				],
				stats,
				sampleList,
			);
		}

		// Music.cpp:3210-3214 — Check if song's data has a musical duration
		// Distinct from the check above: a song can
		// emit plenty of bytes and still run for no time at all
		if (!stats.channelTicks.some((ticks) => ticks !== 0)) {
			return this.failure(
				[
					...parsed.diagnostics,
					{
						severity: "error",
						code: "AMK0303",
						message: "This song doesn't seem to have any data.",
						span: { start: 0, end: 0, line: 1 },
					},
				],
				stats,
				sampleList,
			);
		}

		const linked = link(parsed, aramAddress);
		const diagnostics = [...parsed.diagnostics, ...linked.diagnostics];

		stats.channelSizes = linked.channelSizes;
		stats.loopDataSize = linked.loopDataSize;
		stats.headerSize = linked.headerSize;
		stats.totalSize = linked.data.length;

		// Music.cpp:3286 — Check if song data has grown larger than `#pad` reserved
		if (parsed.minSize > 0 && stats.totalSize > parsed.minSize) {
			diagnostics.push({
				severity: "warning",
				code: "AMK0213",
				message:
					`This song is 0x${hex(stats.totalSize - parsed.minSize)} bytes larger ` +
					`than the 0x${hex(parsed.minSize)} it asked #pad to reserve.`,
				span: { start: 0, end: 0, line: 1 },
			});
		}

		if (linked.diagnostics.some((d) => d.severity === "error")) {
			return this.failure(diagnostics, stats, sampleList);
		}

		return {
			ok: true,
			data: linked.data,
			noteMap: linked.noteMap,
			commandMap: linked.commandMap,
			sampleList,
			diagnostics,
			stats,
			...(parsed.trace ? { trace: parsed.trace } : {}),
		};
	}

	private initStats(): CompileStats {
		return {
			channelSizes: [0, 0, 0, 0, 0, 0, 0, 0],
			loopDataSize: 0,
			headerSize: 0,
			totalSize: 0,
			channelTicks: [0, 0, 0, 0, 0, 0, 0, 0],
			introTicks: 0,
			loopTicks: 0,
			echoBufferSize: 0,
			sampleNames: [],
			usedSampleNames: [],
			hasIntro: false,
			loops: true,
			tagSeconds: null,
			introSeconds: null,
			mainSeconds: null,
			playback: null,
			tags: {},
		};
	}

	private failure(
		diagnostics: Diagnostic[],
		stats: CompileStats | null = null,
		sampleList: readonly string[] | null = null,
	): CompileResult {
		return { ok: false, data: null, noteMap: null, commandMap: null, sampleList, diagnostics, stats };
	}
}

/**
 * Reads {@link AddmusicKOptions} out of the request's untyped `options` bag.
 *
 * `CompileRequest.options` is `Record<string, unknown>` and documented as
 * "unknown keys must be ignored", so this validates rather than casts: a host
 * that passes nothing, or passes the wrong shape, gets `undefined` and the
 * compiler behaves as if no options were given.
 */
function readOptions(options: CompileRequest["options"]): AddmusicKOptions | undefined {
	if (!options) {
		return undefined;
	}

	const names = options["sampleNames"];
	const groups = options["sampleGroups"];
	if (!Array.isArray(names) || typeof groups !== "object" || groups === null) {
		return undefined;
	}

	const optimize = options["optimizeSampleUsage"];
	const important = options["importantSamples"];

	return {
		sampleNames: names.filter((name): name is string => typeof name === "string"),
		sampleGroups: groups as Readonly<Record<string, readonly string[]>>,
		importantSamples: Array.isArray(important)
			? important.filter((name): name is string => typeof name === "string")
			: undefined,
		// Only an explicit `false` turns it off, matching AddmusicK's default.
		optimizeSampleUsage: typeof optimize === "boolean" ? optimize : undefined,
	};
}

/** The compiler. There is one, and this is it. */
export const compiler = new AddmusicKCompiler();
