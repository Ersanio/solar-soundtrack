/** What every `fixtest` section shares: a song compiled, walked and diagnosed as the editor does, and the checks on a fix. */

import "../localize";
import { compiler } from "@amk/compiler";
import type { CompileResult, Diagnostic } from "@amk/core/types";
import { loadDriver } from "@amk/spc/driver";
import { type SongTimeline, unreachableChannels, walkSong } from "@amk/spc/song-walk";
import { tokenize } from "@amk/tokens";
import { arpeggioCounts } from "@amk/tokens/arpeggio-count";
import { commandHazards } from "@amk/tokens/command-hazards";
import { echoHazards } from "@amk/tokens/echo-hazards";
import { applied } from "../../web/src/app/output/diagnostics-list/fixes/fix-diff";
import { type Fix, type FixContext, fixesFor } from "../../web/src/app/output/diagnostics-list/fixes/fixes";
import { repeatSettings, repeatTempo } from "../../web/src/app/state/repeat-carry";
import { check, stubFetch } from "../harness";

stubFetch();

const driver = await loadDriver();
export const ARAM = driver.manifest.localPos;

/** The stock samples, and two of a porter's own. */
export const LIBRARY = [...driver.samples.map((sample) => sample.sampleName), "kick.brr", "snare.bnk"];
export const GROUPS = driver.manifest.sampleGroups;

export interface Song {
	text: string;
	result: CompileResult;
	timeline: SongTimeline | null;
	/** What the editor's Problems list would hold, less the findings no fix answers. */
	diagnostics: Diagnostic[];
	context: FixContext;
}

/** `text` compiled, walked and diagnosed, with the compile current, as the editor holds it after the debounce. */
export function song(text: string): Song {
	const result = compiler.compile({
		source: text,
		aramAddress: ARAM,
		options: { sampleNames: LIBRARY, sampleGroups: GROUPS },
	});
	const index = tokenize(text);
	const timeline = result.data ? walkSong(result.data, ARAM) : null;
	const diagnostics = [
		...result.diagnostics,
		...echoHazards(index.commands),
		...commandHazards(index),
		...arpeggioCounts(index, text),
		...(timeline ? unreachableChannels(timeline, result.noteMap ?? []) : []),
		...(timeline ? repeatTempo(timeline, result.commandMap ?? []) : []),
		...(timeline ? repeatSettings(timeline, { result, text }) : []),
	];
	return {
		text,
		result,
		timeline,
		diagnostics,
		context: {
			live: { text, index },
			compiled: { text, index, result, timeline },
			sampleNames: LIBRARY,
			sampleGroups: GROUPS,
		},
	};
}

export function codes(built: Song): string[] {
	return built.diagnostics.map((diagnostic) => diagnostic.code);
}

/** Every fix offered for the first diagnostic with `code`. */
export function fixesOf(built: Song, code: string): readonly Fix[] {
	const diagnostic = built.diagnostics.find((each) => each.code === code);
	return diagnostic === undefined ? [] : fixesFor(diagnostic, built.context);
}

/** The edits are in order, apart, and each `expect` is what the text holds. */
function wellFormed(text: string, fix: Fix): string {
	for (const [i, edit] of fix.edits.entries()) {
		if (text.slice(edit.span.start, edit.span.end) !== edit.expect) {
			return `edit ${i} expects ${JSON.stringify(edit.expect)} at ${edit.span.start}`;
		}

		const before = fix.edits[i - 1];
		if (before !== undefined && edit.span.start < before.span.end) {
			return `edit ${i} overlaps the one before`;
		}
	}

	return fix.against === text ? "" : "built against another text";
}

/** Error codes in `after` that `before` did not have. */
function newErrors(before: Song, after: Song): string[] {
	const had = new Set(before.diagnostics.filter((d) => d.severity === "error").map((d) => d.code));
	return after.diagnostics.filter((d) => d.severity === "error" && !had.has(d.code)).map((d) => d.code);
}

/**
 * `code` is raised on `text`, its fix `id` is offered, well formed, writes `expected`, and the
 * song it leaves has no `code` and no error it did not have. Returns that song.
 */
export function expectFix(name: string, text: string, code: string, expected: string, id = "fix"): Song | null {
	const before = song(text);
	if (!codes(before).includes(code)) {
		check(`${name}: raises ${code}`, false, `raised ${codes(before).join(", ") || "nothing"}`);
		return null;
	}

	const fix = fixesOf(before, code).find((each) => each.id === id);
	check(
		`${name}: offers ${id}`,
		fix !== undefined,
		`offered ${
			fixesOf(before, code)
				.map((each) => each.id)
				.join(", ") || "nothing"
		}`,
	);
	if (fix === undefined) {
		return null;
	}

	const malformed = wellFormed(text, fix);
	check(`${name}: edits are well formed`, malformed === "", malformed);
	const result = applied(text, fix.edits);
	check(
		`${name}: writes the fix`,
		result === expected,
		`${JSON.stringify(result)}\n        wanted ${JSON.stringify(expected)}`,
	);

	const after = song(result);
	check(`${name}: ${code} is gone`, !codes(after).includes(code), codes(after).join(", "));
	const added = newErrors(before, after);
	check(`${name}: no new error`, added.length === 0, added.join(", "));
	return after;
}

/** `code` is raised on `text` and nothing is offered for it (or nothing with `id`). */
export function expectNoFix(name: string, text: string, code: string, id?: string): void {
	const built = song(text);
	check(`${name}: raises ${code}`, codes(built).includes(code), codes(built).join(", ") || "nothing");
	const offered = fixesOf(built, code).filter((fix) => id === undefined || fix.id === id);
	check(`${name}: offers no fix`, offered.length === 0, offered.map((fix) => fix.id).join(", "));
}

/** The two songs compile to the same bytes. */
export function sameBytes(a: Song | null, b: Song | null): boolean {
	const x = a?.result.data;
	const y = b?.result.data;
	return x != null && x.length === y?.length && x.every((byte, i) => byte === y[i]);
}
