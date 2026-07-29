import type { CompileRequest, CompileResult, MmlCompiler } from "../../core/types";
import { emptyStats, failure } from "../../core/types";
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
 * Implemented across all targets: channels, notes/rests/ties, note lengths,
 * octaves, `h` transpose, `t`/`v`/`w`/`y`/`q`/`p`/`n`, default instruments,
 * `tuning[]`, loops, `&` pitch slide, `$` hex commands with the legacy
 * translations (HFD `$ED`, Addmusic 4.05 `$E5`/`$E4`, `#amk 1` `$FC` remote
 * gain), `/` intro, `?`, `"a=b"` replacements, `#spc`, `#halvetempo`, `#option`,
 * `#louder`, and the `#define`/`#if` preprocessor.
 *
 * Not implemented yet, and reported as errors rather than mis-compiled:
 * `#samples`, `#instruments`, `#path`, `#pad`, remote code `(!)`, and custom
 * instruments `@30+`.
 */
export class AddmusicKCompiler implements MmlCompiler {
	readonly id = "addmusick";
	readonly name = "AddmusicK";
	readonly targets = ["#amk 1", "#amk 2", "#amk 4", "#am4", "#amm"] as const;

	detect(source: string): number {
		if (/^[ \t]*#(am4|amm)\b/im.test(source)) return 1;
		const marker = /^[ \t]*#amk[ \t]*=?[ \t]*(\d+)/im.exec(source);
		if (!marker) return 0.1; // Might be ours; the compiler will say so properly.
		const version = Number(marker[1]);
		return version >= 1 && version <= 4 && version !== 3 ? 1 : 0;
	}

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
		stats.echoBufferSize = parsed.echoBufferSize;
		stats.sampleNames = [...(parsed.sampleList ?? [])];
		stats.hasIntro = parsed.hasIntro;
		stats.loops = !parsed.doesntLoop;
		stats.seconds = parsed.seconds;
		stats.tags = parsed.tags;

		// Carried on every return, including the failures: the sample panel stays
		// populated while a song is mid-edit and not compiling.
		const sampleList = parsed.sampleList;

		if (parsed.errorCount > 0) return failure(parsed.diagnostics, stats, sampleList);

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
	if (!options) return undefined;

	const names = options["sampleNames"];
	const groups = options["sampleGroups"];
	if (!Array.isArray(names) || typeof groups !== "object" || groups === null) return undefined;

	const optimize = options["optimizeSampleUsage"];

	return {
		sampleNames: names.filter((name): name is string => typeof name === "string"),
		sampleGroups: groups as Readonly<Record<string, readonly string[]>>,
		// Only an explicit `false` turns it off, matching AddmusicK's default.
		optimizeSampleUsage: typeof optimize === "boolean" ? optimize : undefined,
	};
}
