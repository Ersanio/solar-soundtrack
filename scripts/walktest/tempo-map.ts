/** `walktest`: the song's tempo map. */

import "../localize";
import type { TempoChange } from "@amk/spc/song-walk";
import { check, section } from "../harness";
import { build } from "./support";

// ---------------------------------------------------------------------------
section("the song's tempo map");
// ---------------------------------------------------------------------------
{
	const map = (source: string) => build(source).timeline.tempoChanges;
	const shown = (changes: readonly TempoChange[]) =>
		changes.map((c) => `${c.tick}:t${c.tempo}${c.fadeTicks ? `/${c.fadeTicks}` : ""}`).join(" ");

	const plain = map("#amk 4\n#0 o4 t54 c4\n");
	check("a t at the top is one change on tick 0", shown(plain) === "0:t54", shown(plain));

	// `$E3` writes its duration first and its target second (`parser.ts:1820-1822`).
	// A map that swapped them still reads as a perfectly reasonable fade.
	const fade = map("#amk 4\n#0 o4 t20,96 c1\n");
	check(
		"a fade keeps its duration and its target apart",
		shown(fade) === "0:t96/20",
		`${shown(fade)} — tempo ${fade[0]?.tempo}, over ${fade[0]?.fadeTicks}`,
	);

	const later = map("#amk 4\n#0 o4 c1 t96 c1\n");
	check("a command runs where the channel has got to", shown(later) === "192:t96", shown(later));

	// The claim that makes the map worth having: it records *executions*, not
	// bytes. The compiler cannot say this at all — `parser.ts:1806` gives up on
	// the song's whole length for a `t` in the loop block — and a walk that
	// recorded bytes would say one change and produce a timeline that looks fine.
	const looped = map("#amk 4\n#0 o4 [t96 c1]3\n");
	check("a t inside a loop is recorded once per iteration", shown(looped) === "0:t96 192:t96 384:t96", shown(looped));

	const subloop = map("#amk 4\n#0 o4 [[t96 c1]]2\n");
	check("and once per turn of a superloop", shown(subloop) === "0:t96 192:t96", shown(subloop));

	// The driver's own order, which is what makes a table built forward from the
	// list correct. Nothing sorts it; the walk emits it that way.
	const two = map("#amk 4\n#0 o4 c1 t96 c1\n#1 o4 t60 c1 c1\n");
	check("two channels interleave by tick, unsorted", shown(two) === "0:t60 192:t96", shown(two));

	// The same cut `notes` takes, and what AMK0217 warns about.
	const past = map("#amk 4\n#0 o4 c4\n#1 o4 c4 c4 t96 c4\n");
	check("a t past the shortest channel never runs", shown(past) === "", shown(past));

	// The premise of the whole clock, in one place: if this ever stops being true
	// the app can go back to `stats.playback` and none of it is needed.
	const { result, timeline } = build("#amk 4\n#0 o4 t20,96 c1\n");
	check(
		"a fade leaves the compiler with no length, and the walk with every tick",
		result.stats?.playback === null && timeline.ticks === 192 && timeline.tempoChanges.length === 1,
		`playback ${JSON.stringify(result.stats?.playback)}, ${timeline.ticks} ticks`,
	);
	check(
		"and the note it carries reports the tempo the fade is aiming at",
		timeline.notes[0]?.state.tempo === 96,
		String(timeline.notes[0]?.state.tempo),
	);
}
