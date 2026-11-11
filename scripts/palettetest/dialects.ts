/**
 * `palettetest`: every entry under every dialect: arity against `expectedArgs`,
 * availability against the compiler, and caveats against the hazard
 * diagnostics.
 */

import "../localize";
import { compiler } from "@amk/compiler";
import { commandAt, expectedArgs, tokenize } from "@amk/tokens";
import { commandHazards } from "@amk/tokens/command-hazards";
import { songTarget } from "@amk/tokens/dialect";
import { ENTRIES, resolveEntry } from "../../web/src/app/editor/command-palette/catalog";
import { check, section } from "../harness";
import { DIALECTS, ARAM, probe, resolveAll } from "./support";

for (const { marker, target } of DIALECTS) {
	section(marker);

	// What the palette reads is what the compiler reads. If these disagreed,
	// every gating decision below would answer for the wrong dialect.
	//
	// Read off a marker at the *end* of the song as well as the top, because
	// `preprocess.ts` resolves the whole file before the parser starts and a
	// porter may write the marker anywhere. A palette that took the marker above
	// the caret would offer `#amk 4`'s forms for every line of the second song.
	{
		const agrees = (label: string, song: string) => {
			const read = songTarget(tokenize(song));
			check(
				`${marker}: ${label}`,
				read.program === target.program && read.amkVersion === target.amkVersion,
				`read program ${read.program}, #amk ${read.amkVersion}`,
			);
		};

		agrees("songTarget agrees with the marker", `${marker}\n#0 $E7 $B0 c4\n`);
		agrees("and with one written below all the music", `#0 $E7 $B0 c4\n${marker}\n`);
	}

	// Position is only a question for the two remote forms. Every other entry is
	// asserted to answer the same on both sides of the first channel rather than
	// being compiled twice, because hex written above `#0` is a different
	// question and not one the palette makes a claim about.
	{
		const inside = resolveAll(target, false);
		const above = resolveAll(target, true);
		const moved = inside
			.filter((entry, index) => entry.availability.state !== above[index].availability.state)
			.map((entry) => entry.key);

		// Read off the entries' own `where` rather than a list of keys: an entry
		// that gained a position rule without declaring one would slip past a
		// hard-coded allowance, which is the failure this is here to catch.
		const positional = new Set(inside.filter((entry) => entry.where !== "anywhere").map((entry) => entry.key));
		check(
			`${marker}: only the entries that declare a place care where the caret is`,
			moved.every((key) => positional.has(key)),
			moved.filter((key) => !positional.has(key)).join(", "),
		);
	}

	// Each entry compiled where it is meant to be written, which for all but the
	// remote definition is inside a channel.
	{
		for (const original of ENTRIES) {
			const where = resolveEntry(original, target, { beforeChannels: true }).where;
			const beforeChannels = where === "before-channels";
			const entry = beforeChannels
				? resolveEntry(original, target, { beforeChannels: true })
				: resolveEntry(original, target, { beforeChannels: false });

			const { song, at } = probe(marker, entry, beforeChannels);
			const label = `${marker} ${entry.key}`;

			// 1. Arity, for the hex entries — the assertion this file exists for.
			//    Only in a channel: hex above one is not music the parser reads.
			if (entry.vcmd !== undefined && !beforeChannels) {
				const command = commandAt(tokenize(song).commands, at);
				const wanted = command?.vcmd === undefined ? null : expectedArgs(command.vcmd, command.args, command.target);

				check(
					`${label}: writes exactly the arguments expectedArgs asks for`,
					command !== null && wanted !== null && command.args.length === wanted,
					`wrote ${command?.args.length ?? "no"} of ${wanted ?? "unknown"}`,
				);
				check(`${label}: the command is complete`, command?.complete === true);
			}

			// 2. The prediction against the compiler's own answer.
			//
			//    `blocked` asserts the song does not come back clean rather than
			//    that it errors, because the two version rules fail differently and
			//    the quieter failure is the worse one: `l=48` below `#amk 4` is
			//    AMK0070, but `t18,144` below `#amk 3` builds and simply means
			//    `t18`, warning over the rest as unexpected characters (AMK0100).
			//    A form that compiles into something else is exactly what the
			//    palette should refuse to write.
			const result = compiler.compile({ source: song, aramAddress: ARAM });
			const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
			const say = (list: typeof result.diagnostics) =>
				list.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join(" | ");

			if (entry.availability.state === "blocked") {
				check(
					`${label}: blocked, and AddmusicK does not take it cleanly`,
					result.diagnostics.length > 0,
					"compiled clean",
				);
			} else if (entry.availability.state === "caution") {
				// The state's whole claim, and both halves of it: it compiles, and
				// there is something worth reading first. An `ok` that warns and a
				// `caution` that does not are the same failure said two ways.
				check(`${label}: cautioned, and AddmusicK still accepts it`, errors.length === 0, say(errors));
				check(`${label}: cautioned, and there is a warning to read`, result.diagnostics.length > 0, "compiled clean");
			} else {
				check(
					`${label}: offered, and AddmusicK takes it silently`,
					result.diagnostics.length === 0,
					say(result.diagnostics),
				);
			}

			// A caveat says what `availability` cannot — a driver hazard, a silent
			// rewrite — so it claims nothing about the compile beyond this.
			if (entry.caveat !== undefined) {
				check(`${label}: carries a caveat, and still compiles`, errors.length === 0, say(errors));
			}

			// 6. And that the warning under the button and the finding in Problems are
			//    the same set. This is the half `availability` cannot hold: a caveat
			//    with no diagnostic behind it is a warning nothing checks, and a
			//    diagnostic no button warns of is a hazard the palette writes in
			//    silence. Matched on the span, so the finding has to be about the
			//    snippet rather than about the `c4` the probe writes after it.
			//
			//    A withheld byte is the other way of satisfying it: there is no button
			//    to warn on, so the diagnostic is the whole of the warning.
			const hazards = commandHazards(tokenize(song)).filter((d) => d.span.start === at);
			const warned = entry.caveat !== undefined || original.withheld === true;
			check(
				`${label}: a hazard is warned of, and a warning has a hazard`,
				warned === hazards.length > 0,
				entry.caveat ?? hazards.map((d) => d.code).join(),
			);
			check(
				`${label}: a withheld entry carries no caveat`,
				original.withheld !== true || entry.caveat === undefined,
				entry.caveat,
			);
		}
	}
}
