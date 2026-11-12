/** `pianorolltest`: seeding a song with no playable music. */

import "../localize";
import { compiler } from "@amk/compiler";
import { tokenize } from "@amk/tokens";
import { SEED_SONG, seededChannel, seedEdits } from "../../web/src/app/editor/views/piano-roll/roll-seed";
import { SAMPLE_SONG } from "../../web/src/app/state/sample-song";
import { check, section } from "../harness";
import { apply, ARAM, build, OPTIONS, strip } from "./support";

// --- seeding a song with no playable music ----------------------------------

// `roll-seed.ts` runs when the roll is opened on a song that fails AMK0302 or
// AMK0303: one batch of splices gives the song its first rest, so a `Strip` can
// exist at all. Seeded songs are checked the way every edit here is — by
// compiling the result — and the refusals pin that a song failing for its own
// reasons is never written to.
section("the seed");
{
	const seeded = (source: string): string | null => {
		const result = compiler.compile({ source, aramAddress: ARAM, options: OPTIONS });
		const edits = seedEdits(source, result, tokenize(source));
		return edits === null ? null : apply(source, edits);
	};

	const playedTicks = (source: string | null, channel: number): number | string => {
		if (source === null) {
			return "no seed";
		}

		const built = build(source);
		return typeof built === "string" ? built : (built.result.stats?.channelTicks[channel] ?? -1);
	};

	check("a blank document becomes the seed song", seeded("") === SEED_SONG, String(seeded("")));
	check("whitespace is a blank document", seeded("  \n\n") === SEED_SONG);
	check(
		"the seed song plays a whole rest on channel 0",
		playedTicks(SEED_SONG, 0) === 192,
		String(playedTicks(SEED_SONG, 0)),
	);
	check(
		"and its channel is a strip of one rest",
		(() => {
			const built = build(SEED_SONG);
			if (typeof built === "string") {
				return false;
			}

			const made = strip(SEED_SONG, built, 0);
			return typeof made !== "string" && made.items.length === 1 && made.items[0].kind === "rest";
		})(),
	);

	// A header alone raises no command anywhere, so the seeded channel carries the defaults.
	const headed = seeded("#amk 4\n");
	check("a header alone keeps its header", headed === `#amk 4\n\n${seededChannel(0)}\n`, String(headed));
	check("and plays", playedTicks(headed, 0) === 192, String(playedTicks(headed, 0)));

	// An `#spc` block raises no command either — its braces are a block, not music.
	const tagged = seeded('#amk 4\n\n#spc\n{\n    #title "x"\n}\n');
	check("an #spc block still gets the defaults", tagged?.includes(seededChannel(0)) === true, String(tagged));
	check("and it plays", playedTicks(tagged, 0) === 192, String(playedTicks(tagged, 0)));

	// With a `#N` declared the defaults are the porter's to write: the rest goes
	// in alone, at the end of the last-declared channel's block.
	const declared = seeded("#amk 4\n#0\n");
	check("a declared channel is given only its rest", declared === "#amk 4\n#0\nr1\n", String(declared));
	check("which plays", playedTicks(declared, 0) === 192, String(playedTicks(declared, 0)));

	const voiced = seeded("#amk 4\n#0 v200\n");
	check("a channel with only commands keeps them", voiced === "#amk 4\n#0 v200\nr1\n", String(voiced));
	check("and still plays", playedTicks(voiced, 0) === 192, String(playedTicks(voiced, 0)));

	// A command above the first `#N` gathers on the starting channel
	// (Music.cpp:383-406), and everything the scaffold writes is tick-0
	// last-writer-wins state — so no defaults, or they would win over it.
	const tempoed = seeded("#amk 4\nt60\n");
	check("a command above the channels is not stomped", tempoed === "#amk 4\nt60\n\n#0 r1\n", String(tempoed));
	check("and the song plays", playedTicks(tempoed, 0) === 192, String(playedTicks(tempoed, 0)));

	const twin = seeded("#amk 4\n#0\n#1\n");
	check(
		"the rest lands on the last-declared channel",
		playedTicks(twin, 1) === 192 && playedTicks(twin, 0) === 0,
		String(twin),
	);

	// `@0` is not written on Addmusic 4.05, where an `@` switches instrument
	// tuning on rather than saying what is already true.
	const legacy = seeded("#am4\n");
	check("a legacy target is seeded without `@0`", legacy !== null && !legacy.includes("@0"), String(legacy));
	check("and its rest plays", playedTicks(legacy, 0) === 192, String(playedTicks(legacy, 0)));

	// A song failing for its own reasons is never written to.
	check("a song missing its header is left alone", seeded("#0 c8\n") === null, String(seeded("#0 c8\n")));
	check("a song for a newer AddmusicK is left alone", seeded("#amk 9\n") === null);
	check("a song that compiles is left alone", seeded(SAMPLE_SONG) === null);
}
