/** `walktest`: a tempo that carries over into the repeat is reported. */

import "../localize";
import type { Diagnostic } from "@amk/core/types";
import { readDriverState } from "@amk/spc/driver-state";
import { repeatTempo } from "../../web/src/app/state/repeat-carry";
import { driverTempo } from "@amk/tokens/commands/units";
import { check } from "../harness";
import { build } from "./support";
import { aramInRepeat } from "./longer-channel";

// ---------------------------------------------------------------------------
console.log("\na tempo that carries over into the repeat is reported");
// ---------------------------------------------------------------------------
{
	// The driver sets `$51` only when a song starts (`main.asm:2187`), so the
	// tempo a pass ends on is the tempo the repeat starts at.
	const warn = (source: string) => {
		const { result, timeline } = build(source);
		return repeatTempo(timeline, result.commandMap ?? []);
	};

	const textOf = (source: string, warning: Diagnostic | undefined) =>
		warning ? source.slice(warning.span.start, warning.span.end) : "(none)";

	const midSong = "#amk 4\n#0 t60 / o4 c4 t80 c4\n";
	const [warning] = warn(midSong);
	check("a mid-song t with none where the song loops back is reported", warning !== undefined);
	check("it is SST0510 and severe", warning?.code === "SST0510" && warning?.severity === "severe", warning?.code);
	check("it points at the tempo that carries over", textOf(midSong, warning) === "t80", textOf(midSong, warning));
	check(
		"and names both tempos",
		warning?.message.includes("t80") === true && warning?.message.includes("t60") === true,
		warning?.message,
	);

	const [unset] = warn("#amk 4\n#0 / o4 c4 t80 c4\n");
	check(
		"a song that sets no tempo first is measured against the default",
		unset?.message.includes("t53") === true,
		unset?.message,
	);

	const fade = "#amk 4\n#0 t60 / o4 c4 t20,80 c4\n";
	check("a fade counts as its target", textOf(fade, warn(fade)[0]) === "t20,80", textOf(fade, warn(fade)[0]));

	const other = "#amk 4\n#0 t60 / o4 c4 c4\n#1 / o4 c4 t80 c4\n";
	const [elsewhere] = warn(other);
	check(
		"a tempo on another channel is pointed at there",
		textOf(other, elsewhere) === "t80" && (elsewhere?.span.start ?? 0) > other.indexOf("#1"),
		textOf(other, elsewhere),
	);

	for (const [name, source, reported] of [
		["with no /, the start of the song", "#amk 4\n#0 o4 c4 t80 c4\n", true],
		["with no /, a t the restart runs again", "#amk 4\n#0 t60 o4 c4 t80 c4\n", false],
		["a pass that ends on the tempo it began the loop at", "#amk 4\n#0 t60 / o4 c4 t80 c4 t60 c4\n", false],
		["a t just before the /", "#amk 4\n#0 t60 o4 c4 t80 / c4\n", false],
		["a t right after the /", "#amk 4\n#0 t60 o4 c4 / t80 c4 t70 c4\n", false],
		["a t at the head of a loop body after the /", "#amk 4\n#0 / o4 [t60 c4 t80 c4]2\n", false],
		["a t after other commands but before the first note", "#amk 4\n#0 / @0 v200 t60 o4 c4 t80 c4\n", false],
		["a t after a rest", "#amk 4\n#0 / r4 t60 o4 c4 t80 c4\n", true],
		["a song that does not loop", "#amk 4\n#option noloop\n#0 t60 o4 c4 t80 c4\n", false],
	] as const) {
		const found = warn(source);
		check(`${name}: ${reported ? "reported" : "quiet"}`, found.length === (reported ? 1 : 0), `${found.length}`);
	}

	// On the tick the pass ends the voices run in order and the first `$00` ends
	// the phrase (`main.asm:2337-2346`). A `t` at the end of `#0` runs before it;
	// the same `t` at the end of `#1` never runs, since `#0` has already ended it.
	const first = "#amk 4\n#0 t60 / o4 c4 t80 c4 t60\n#1 / o4 c4 c4\n";
	const second = "#amk 4\n#0 t60 / o4 c4 t80 c4\n#1 / o4 c4 c4 t60\n";
	check("a t that runs before the phrase ends restores the tempo", warn(first).length === 0);
	check("one that runs after it does not", warn(second).length === 1);

	const restored = build(first).timeline;
	check(
		"tempoAtEnd keeps the t that tempoChanges cuts",
		restored.tempoAtEnd?.tempo === 60 && restored.tempoChanges.at(-1)?.tempo === 80,
		JSON.stringify(restored.tempoAtEnd),
	);

	// The running driver is the oracle: `$51` a few ticks into the repeat, before
	// the loop's own `t80` on its 48th tick, is what the walk says it carried.
	for (const [name, source] of [
		["the end of #0", first],
		["the end of #1", second],
	] as const) {
		const { aram, timeline } = aramInRepeat(source);
		const heard = aram === null ? null : readDriverState(aram).tempo;
		const walked = timeline.tempoAtEnd === null ? null : driverTempo(timeline.tempoAtEnd.tempo);
		check(
			`with a t at ${name}, the repeat starts at the tempo the walk carried`,
			heard === walked,
			`$51 ${heard}, walk ${walked}`,
		);
	}
}
