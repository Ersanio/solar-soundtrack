import type { CompileRequest, CompileResult } from "../core/types";
import { emptyStats, failure } from "../core/types";
import { link } from "./link";
import { type AddmusicKOptions, AddmusicKParser } from "./parser";

export type { AddmusicKOptions };

/**
 * AddmusicK, covering every target it accepts.
 *
 * | Marker | Target |
 * |---|---|
 * | `#amk 4` | AddmusicK 1.0.9+ (current) |
 * | `#amk 2` | AddmusicK 1.0-1.0.8 |
 * | `#amk 1` | AddmusicK Beta |
 * | `#am4`   | Addmusic 4.05 |
 * | `#amm`   | AddmusicM |
 *
 * `#amk 3` (Codec's beta) is rejected — AddmusicK itself does not implement it.
 *
 *
 * One deliberate divergence: an unknown `#directive` is an error here, where
 * `parseSpecialDirective` (Music.cpp:2413) has no else branch and lets the
 * scanner read `#foo` as a note. See the comment at that branch in `parser.ts`.
 */
export class AddmusicKCompiler {
	compile(request: CompileRequest): CompileResult {
		const { source, aramAddress } = request;
		const options = readOptions(request.options);

		if (!Number.isInteger(aramAddress) || aramAddress < 0 || aramAddress > 0xffff) {
			return failure([
				{
					severity: "error",
					code: "AMK0301",
					message: `ARAM address 0x${aramAddress.toString(16)} is outside the 64 KiB address space.`,
					span: { start: 0, end: 0, line: 1 },
				},
			]);
		}

		const parsed = new AddmusicKParser(source, options).parse();

		const stats = emptyStats();
		stats.channelTicks = parsed.channelLengths.map((ticks) => Math.floor(ticks));
		// Music.cpp:3209 — the song turns over when its *shortest* channel runs out,
		// so that is the pass length however long the other channels are.
		const played = stats.channelTicks.filter((ticks) => ticks !== 0);
		stats.introTicks = Math.floor(parsed.introTicks);
		stats.loopTicks = played.length ? Math.min(...played) - stats.introTicks : 0;
		stats.echoBufferSize = parsed.echoBufferSize;
		// What the song asked for, before optimisation replaced anything unplayed —
		// which is what the field has always claimed to be, and what the UI needs
		// to explain why a sample is or is not in ARAM.
		stats.sampleNames = [...(parsed.requestedSamples ?? [])];
		// `usedSamples` is indexed by SRCN, which is a position in that same list.
		// Collapsing to names loses nothing the UI needs and spares it the mapping.
		stats.usedSampleNames = [...new Set(stats.sampleNames.filter((_, srcn) => parsed.usedSamples[srcn]))];
		stats.hasIntro = parsed.hasIntro;
		stats.loops = !parsed.doesntLoop;
		stats.tagSeconds = parsed.tagSeconds;
		stats.introSeconds = parsed.introSeconds;
		stats.mainSeconds = parsed.mainSeconds;
		stats.playback = parsed.playback;
		stats.tags = parsed.tags;

		// Carried on every return, including the failures: the sample panel stays
		// populated while a song is mid-edit and not compiling.
		const sampleList = parsed.sampleList;

		if (parsed.errorCount > 0) {
			return failure(parsed.diagnostics, stats, sampleList);
		}

		const hasData = parsed.data.slice(0, 8).some((channel) => channel.length > 0);
		if (!hasData) {
			return failure(
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

		const linked = link(parsed, aramAddress);
		const diagnostics = [...parsed.diagnostics, ...linked.diagnostics];

		stats.channelSizes = linked.channelSizes;
		stats.loopDataSize = linked.loopDataSize;
		stats.headerSize = linked.headerSize;
		stats.totalSize = linked.data.length;

		// Music.cpp:3286 — `#pad` reserves ARAM for a song that is still growing,
		// so outgrowing the reservation is worth saying out loud.
		if (parsed.minSize > 0 && stats.totalSize > parsed.minSize) {
			diagnostics.push({
				severity: "warning",
				code: "AMK0213",
				message:
					`This song is 0x${(stats.totalSize - parsed.minSize).toString(16).toUpperCase()} bytes larger ` +
					`than the 0x${parsed.minSize.toString(16).toUpperCase()} it asked #pad to reserve.`,
				span: { start: 0, end: 0, line: 1 },
			});
		}

		if (linked.diagnostics.some((d) => d.severity === "error")) {
			return failure(diagnostics, stats, sampleList);
		}

		return { ok: true, data: linked.data, sampleList, diagnostics, stats };
	}
}

/**
 * Reads {@link AddmusicKOptions} out of the request's untyped `options` bag.
 *
 * `CompileRequest.options` is `Record<string, unknown>` and documented as
 * "unknown keys must be ignored", so this validates rather than casts: a host
 * that passes nothing, or passes the wrong shape, gets `undefined` and the
 * compiler behaves as it did before options existed.
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
