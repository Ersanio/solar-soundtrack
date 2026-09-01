/**
 * The command palette's catalogue, and the loop reading the two bracket buttons
 * and the loop inspector share.
 *
 * Five assertions carry the weight here, and none is visible from the table
 * itself:
 *
 * 1. **The palette is not a third statement of arity.** An entry lists argument
 *    *values*; `expectedArgs` is what says how many there are, and this asserts
 *    the two meet exactly under every dialect. A snippet one byte short does not
 *    merely look wrong — it swallows whatever follows it as its own argument,
 *    and the song still compiles.
 *
 * 2. **Availability is a prediction, and the compiler is the oracle.** Every
 *    entry claims what AddmusicK will make of it under each dialect;
 *    `formAvailability` is a port of conditions `parser.ts` tests on text that
 *    exists, asked about text that does not. This compiles each snippet in a
 *    minimal song and checks all three states against what actually comes back.
 *    A `blocked` entry that compiles cleanly is a button greyed out for nothing;
 *    an `ok` entry that errors is the one promise the palette makes, broken; and
 *    a `caution` is a warning the author is told to read, so there has to be one.
 *    What the compiler cannot answer — the driver's own lethal bytes, a dialect
 *    that rewrites in silence — is a `caveat` and is checked only for compiling.
 *
 * 3. **Every command stays reachable in every dialect.** Coverage counted at
 *    `#amk 4` alone misses the case that matters: a byte whose only spelling is
 *    a form the dialect refuses is a byte no button can write there, and the
 *    three fades are exactly that below `#amk 3`.
 *
 * 4. **A spelling swapped for its bytes is the same command, and says nothing
 *    about it.** Where a dialect refuses the written form, the button writes
 *    what it would have compiled to — so both are compiled where each is legal
 *    and compared byte for byte, which is `SUPERSEDED`'s standard applied to the
 *    other direction. Proving them equal is what lets the swap stay quiet.
 *
 * 5. **A loop's count is priced in notes played, never in text.** Each of the
 *    five spellings keeps its number somewhere else — on the second of two `]`
 *    commands, on no command at all, or one less than itself — so a reading that
 *    is wrong about which produces a perfectly plausible field over the wrong
 *    number. Every count `loop-focus.ts` reads is written back and the result
 *    walked, and a retarget is compared by *pitch*, since two bodies of one note
 *    each play the same number of notes either way.
 *
 *   npm run palettetest
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { compiler } from "@amk/compiler";
import type { Span } from "@amk/core/types";
import { walkSong } from "@amk/spc/song-walk";
import { type CommandTarget, commandAt, commandStartingAt, expectedArgs, tokenize, VCMD_NAMES } from "@amk/tokens";
import type { Edit } from "@amk/tokens/edits";
import { formAvailability } from "@amk/tokens/commands/availability";
import { readLoops } from "@amk/tokens/commands/loops";
import { channelsBeginAt, songTarget } from "@amk/tokens/dialect";
import { ENTRIES, type ResolvedEntry, resolveEntry } from "../web/src/app/editor/command-palette/catalog";
import { GLYPH_NAMES } from "../web/src/app/editor/command-palette/command-icon";
import { glyphOf } from "../web/src/app/editor/command-palette/glyph-of";
import {
	BRACKETS_UNPAIRED,
	CALL_NESTED,
	CALL_NONE,
	callVerdict,
	isCall,
	isWrap,
	type WrapKind,
	type WrapOffer,
	WRAP_CHANNELS,
	WRAP_DEEP,
	WRAP_INTRO,
	WRAP_NO_NOTES,
	WRAP_NOTHING,
	WRAP_REPLACEMENT,
	WRAP_SPLIT,
	wrapVerdict,
} from "../web/src/app/editor/command-palette/loop-wrap";
import { commandScope } from "@amk/tokens/commands/in-force";
import {
	loopCountEdit,
	loopFocus,
	loopNameEdit,
	loopTargetEdit,
} from "../web/src/app/output/loop-inspector/loop-focus";

import { check, summarise } from "./harness";

/** The dialects a song can actually declare. `#amk 3` is AMK0402 and is not one. */
const DIALECTS: { marker: string; target: CommandTarget }[] = [
	{ marker: "#amk 1", target: { program: 0, amkVersion: 1 } },
	{ marker: "#amk 2", target: { program: 0, amkVersion: 2 } },
	{ marker: "#amk 4", target: { program: 0, amkVersion: 4 } },
	{ marker: "#am4", target: { program: 1, amkVersion: 0 } },
	{ marker: "#amm", target: { program: 2, amkVersion: 0 } },
];

/** The load address the app compiles at; nothing here depends on the value. */
const ARAM = 0x0800;

/**
 * A song with `snippet` in it, and where it starts.
 *
 * Two shapes, because two entries are only legal on one side of the first
 * channel (`parseOpenParen`, and `channelsBeginAt`'s comment). Everything else
 * goes inside `#0`, which is where a caret usually is.
 *
 * `PARTNERS` is the third shape, for an entry that needs something else in the
 * song before it means anything. The palette writes one command per click, so
 * the probe supplies the partner rather than the entry pretending to be a pair.
 */
const PARTNERS: Readonly<Record<string, { above?: string; before?: string }>> = {
	// A remote call is inert without a body to call, and AddmusicK says so
	// (AMK0115). Its definition has to sit above the first channel, which is the
	// other half of the rule the palette's own `context` encodes.
	"text:(!n,": { above: "(!1)[$F4 $09]" },
	// The same rule for the same reason: a `(n)m` names a body, and
	// `parseLabelLoop` refuses a label that is not in `loopPointers` yet. The
	// palette's own `callVerdict` never offers one there — this is the snippet
	// compiled standalone, which is a claim about the spelling and not about
	// where a click would put it.
	"text:(n)": { before: "(0)[c4]2 " },
};

function probe(marker: string, entry: ResolvedEntry, beforeChannels: boolean): { song: string; at: number } {
	const partner = PARTNERS[entry.key] ?? {};
	const prelude = `${marker}\n${partner.above ? `${partner.above}\n` : ""}`;
	const head = beforeChannels ? prelude : `${prelude}#0 ${partner.before ?? ""}`;
	const tail = beforeChannels ? "\n#0 c4\n" : " c4\n";
	return { song: `${head}${entry.text}${tail}`, at: head.length };
}

/** Every entry as the palette itself would resolve it, at one dialect and place. */
/** Anything in here drawn without `svg:` in front of it would ship blank. */
const SVG_TAGS = new Set([
	"path",
	"circle",
	"ellipse",
	"rect",
	"line",
	"polyline",
	"polygon",
	"g",
	"text",
	"tspan",
	"defs",
	"use",
	"marker",
]);

const hex = (vcmd: number): string => `$${vcmd.toString(16).toUpperCase()}`;

function resolveAll(target: CommandTarget, beforeChannels: boolean): ResolvedEntry[] {
	return ENTRIES.map((entry) => resolveEntry(entry, target, { beforeChannels }));
}

const capitalised = (label: string) => label.charAt(0).toUpperCase() + label.slice(1);

/**
 * The hex commands with no button of their own, because a letter or bracket form
 * writes them.
 *
 * `letter` and `hex` are the same command said twice, and the pair is compiled
 * and compared byte for byte below — nothing here is taken on trust. The note
 * goes *first* in the probe rather than last: several of these commands leave
 * the compiler's note-compression state where a following note can see it, and
 * what happens after the construct is not what the claim is about.
 *
 * Three rows carry `hex: null`, and for a reason worth knowing rather than a
 * limitation of the harness. `$E9` and `$FC` embed an address the compiler works
 * out for itself, so no hand-written hex can equal them. `$E6` is subtler: the
 * bracket form emits the standing duration and quantization again inside the
 * loop, because a loop body has to stand on its own, where a hand-written
 * `$E6 $00` does not know a loop began. All three are checked differentially
 * instead — the construct emits the byte, and a song without it does not.
 */
interface Supersession {
	vcmd: number;
	/** Channel body that produces the command, note first. */
	letter: string;
	/** The same thing in raw hex, or `null` when the compiler adds more than bytes. */
	hex: string | null;
	/** Written above the first channel, as a remote definition must be. */
	above?: string;
	cite: string;
}

const SUPERSEDED: Supersession[] = [
	{ vcmd: 0xda, letter: "c4 @0", hex: "c4 $DA $00", cite: "parser.ts:1846" },
	{ vcmd: 0xdb, letter: "c4 y10", hex: "c4 $DB $0A", cite: "parser.ts:1614" },
	{ vcmd: 0xde, letter: "c4 p12,8", hex: "c4 $DE $00 $0C $08", cite: "parser.ts:1945" },
	{ vcmd: 0xe0, letter: "c4 w200", hex: "c4 $E0 $C8", cite: "parser.ts:1489" },
	{ vcmd: 0xe1, letter: "c4 w18,200", hex: "c4 $E1 $12 $C8", cite: "parser.ts:1492" },
	{ vcmd: 0xe2, letter: "c4 t144", hex: "c4 $E2 $90", cite: "parser.ts:1698" },
	{ vcmd: 0xe3, letter: "c4 t18,144", hex: "c4 $E3 $12 $90", cite: "parseTempo's fade fork" },
	{ vcmd: 0xe7, letter: "c4 v200", hex: "c4 $E7 $C8", cite: "parser.ts:1506" },
	{ vcmd: 0xe8, letter: "c4 v18,200", hex: "c4 $E8 $12 $C8", cite: "parser.ts:1509" },
	// `n` reads its argument as hex (`HEX_ARG_LETTERS`), so `n10` is sixteen.
	{ vcmd: 0xf8, letter: "c4 n10", hex: "c4 $F8 $10", cite: "parser.ts:1900" },
	{ vcmd: 0xe6, letter: "c4 [[ c4 ]]2", hex: null, cite: "parser.ts:2381" },
	{ vcmd: 0xe9, letter: "c4 [ c4 ]4", hex: null, cite: "parser.ts:2512" },
	{
		vcmd: 0xfc,
		// The definition alone emits only its body; `$FC` is written where the
		// remote code is *called* (`parser.ts:2334`), which is why the palette
		// carries both spellings and why the probe needs both here.
		above: "(!1)[$F4 $09]",
		letter: "c4 (!1,1,24)",
		hex: null,
		cite: "parser.ts:2334",
	},
];

console.log("\ncatalogue");

// The catalogue is complete by construction rather than by a number written
// here: adding a VCMD to `tokens.ts` fails this until it either has a button or
// is claimed by a letter form below.
{
	const entries = resolveAll(DIALECTS[2].target, false);
	const keys = new Set(entries.map((entry) => entry.key));
	// Off `vcmd` rather than the key, because two buttons may write one byte:
	// `$ED`'s ADSR and GAIN are one opcode and two envelopes.
	const offered = new Set(entries.map((entry) => entry.vcmd).filter((vcmd) => vcmd !== undefined));
	const superseded = new Set(SUPERSEDED.map((row) => row.vcmd));
	const missing: string[] = [];
	for (let vcmd = 0xda; vcmd <= 0xfe; vcmd++) {
		if (!offered.has(vcmd) && !superseded.has(vcmd)) {
			missing.push(`$${vcmd.toString(16).toUpperCase()}`);
		}
	}

	check("every VCMD $DA-$FE has an entry or a letter form that writes it", missing.length === 0, missing.join(" "));

	// And in every dialect, not only the one above. A byte whose every spelling is
	// a form the dialect refuses is a byte the palette cannot write there at all,
	// which coverage counted at `#amk 4` cannot see — `$E1`, `$E3` and `$E8` are
	// the three fades, and the forms that write them are gated at `#amk 3`.
	//
	// Only of the bytes the dialect itself will take: `#amm` refuses `$FA`
	// outright (AMK0156), and a button for it would be the palette offering what
	// AddmusicK does not.
	//
	// One allowance, and not a gap: at `#amk 1` a hand-written `$FC` is remote
	// gain and takes two arguments (`parser.ts:parseHexCommand`), so the byte is
	// reachable in the language but is not the command any entry names. A button
	// for it would be a fourth remote entry existing in one dialect, and the
	// catalogue offers a command rather than a byte.
	const EXEMPT: Readonly<Record<string, number>> = { "#amk 1": 0xfc };
	for (const { marker, target } of DIALECTS) {
		const live = new Set(
			resolveAll(target, false)
				.filter((entry) => entry.availability.state !== "blocked")
				.flatMap((entry) => [entry.vcmd, entry.writes])
				.filter((vcmd) => vcmd !== undefined),
		);
		const unreachable: string[] = [];
		for (let vcmd = 0xda; vcmd <= 0xfe; vcmd++) {
			const takes = formAvailability({ kind: "hex", vcmd }, target).state !== "blocked";
			if (takes && !live.has(vcmd) && EXEMPT[marker] !== vcmd) {
				unreachable.push(hex(vcmd));
			}
		}

		check(`${marker}: every VCMD $DA-$FE it takes is still reachable`, unreachable.length === 0, unreachable.join(" "));
	}

	const claimed = SUPERSEDED.filter((row) => offered.has(row.vcmd)).map((row) => hex(row.vcmd));
	check("nothing is both offered and superseded", claimed.length === 0, claimed.join(", "));

	// Which spelling supersedes a byte is `LetterEntry.writes`, and the app reads
	// it too — the roll meets a `$E7` in a compiled song and has to draw `v`'s
	// speaker. Resolved rather than restated here, so there is one statement of it.
	const writers = new Map(entries.filter((entry) => entry.writes !== undefined).map((entry) => [entry.writes, entry]));
	const orphaned = SUPERSEDED.filter((row) => !writers.has(row.vcmd)).map((row) => hex(row.vcmd));
	check("every superseded byte has an entry claiming to write it", orphaned.length === 0, orphaned.join(", "));

	check("entry keys are unique", keys.size === entries.length);
}

// Every entry can be drawn and can be explained. An icon nobody drew renders as
// the dashed `@default` square and a missing blurb is a silent tooltip; both are
// invisible to the eye at a glance across forty buttons.
{
	// Read rather than imported: the paths live in a template, which nothing in
	// TypeScript can see into. A glyph the union knows and the `@switch` does not
	// type-checks, builds, and ships as a dashed square.
	const template = readFileSync(
		join(import.meta.dirname, "..", "web", "src", "app", "editor", "command-palette", "command-icon.html"),
		"utf8",
	);
	const undrawn = GLYPH_NAMES.filter((glyph) => !template.includes(`@case ('${glyph}')`));
	check("every glyph the union names has a @case", undrawn.length === 0, undrawn.join(", "));

	// The template has no <svg> of its own — the host is one — so Angular has no
	// parent to take a namespace from and every element needs the `svg:` prefix.
	// Without it the element is built in the HTML namespace: it type-checks, it
	// builds, and it draws nothing at all, in the palette and on a roll bar alike.
	const bare = [...template.matchAll(/<([a-z]+)(?![a-z])/g)]
		.map((found) => found[1])
		.filter((tag) => SVG_TAGS.has(tag));
	check("and every element carries the svg: prefix", bare.length === 0, [...new Set(bare)].join(", "));

	const entries = resolveAll(DIALECTS[2].target, false);
	const unused = GLYPH_NAMES.filter((glyph) => !entries.some((entry) => entry.icon === glyph));
	check("every glyph is used by an entry", unused.length === 0, unused.join(", "));

	// Two buttons that say the same thing. The face is an icon and the name is all
	// a search result has, so no two entries may share a label — `VCMD_NAMES`
	// calls both `$EF` and `$F1` "echo parameters".
	const seen = new Map<string, string>();
	const collisions: string[] = [];
	for (const entry of entries) {
		const first = seen.get(entry.label);
		if (first === undefined) {
			seen.set(entry.label, entry.key);
			continue;
		}

		collisions.push(`${first} and ${entry.key} are both "${entry.label}"`);
	}

	check("no two entries share a label", collisions.length === 0, collisions.join("; "));

	const silent = entries.filter((entry) => entry.blurb.trim().length === 0).map((entry) => entry.key);
	check("every entry has a blurb", silent.length === 0, silent.join(", "));

	// The blurb is the hover text and the readout line; a `$` in it would be the
	// raw byte creeping back into the one place that exists to be free of it.
	const bytes = entries.filter((entry) => entry.blurb.includes("$")).map((entry) => entry.key);
	check("no blurb recites hex", bytes.length === 0, bytes.join(", "));

	// The name is on the button face and again in the readout, so it is a heading
	// in both places; `VCMD_NAMES` and `LETTER_NAMES` are lower case for prose.
	const lower = entries.filter((entry) => entry.label !== capitalised(entry.label)).map((entry) => entry.key);
	check("every label is capitalised", lower.length === 0, lower.join(", "));
}

// The supersession claims, proven against the compiler rather than asserted.
console.log("\nsuperseded");

for (const row of SUPERSEDED) {
	const byte = hex(row.vcmd);
	const label = `${byte} superseded`;
	const data = (body: string) =>
		compiler.compile({ source: `#amk 4\n${row.above ? `${row.above}\n` : ""}#0 ${body}\n`, aramAddress: ARAM }).data;

	if (row.hex === null) {
		// Equality is not writable, so the check is differential: the construct
		// emits the byte and a song that is otherwise the same does not.
		const withIt = data(row.letter);
		const without = data("c4");
		check(
			`${label}: emits ${byte} where a plain note does not (${row.cite})`,
			withIt !== null && without !== null && withIt.includes(row.vcmd) && !without.includes(row.vcmd),
			withIt === null ? "did not compile" : "",
		);
		continue;
	}

	const fromLetter = data(row.letter);
	const fromHex = data(row.hex);
	check(
		`${label}: "${row.letter}" compiles to exactly "${row.hex}" (${row.cite})`,
		fromLetter !== null &&
			fromHex !== null &&
			fromLetter.length === fromHex.length &&
			fromLetter.every((value, index) => value === fromHex[index]),
		`${fromLetter?.length ?? "no"} bytes against ${fromHex?.length ?? "no"}`,
	);
}

// The substitutions, held to the same standard.
//
// A dialect that refuses a spelling gets the bytes it would have compiled to
// instead — so the button keeps its name, and "does the same thing" in its
// readout has to be true. Both spellings are compiled at `#amk 4`, where the
// dialect takes each, and compared. The pair is read off the entries themselves:
// an entry whose text moves between dialects is one that substitutes.
console.log("\nsubstituted");

for (const entry of ENTRIES) {
	const spelled = resolveEntry(entry, DIALECTS[2].target, { beforeChannels: false });
	const swapped = DIALECTS.map((dialect) => resolveEntry(entry, dialect.target, { beforeChannels: false })).find(
		(resolved) => resolved.text !== spelled.text,
	);

	if (swapped === undefined) {
		continue;
	}

	const data = (body: string) => compiler.compile({ source: `#amk 4\n#0 c4 ${body}\n`, aramAddress: ARAM }).data;
	const fromSpelling = data(spelled.text);
	const fromHex = data(swapped.text);
	check(
		`${spelled.key}: "${spelled.text}" compiles to exactly "${swapped.text}"`,
		fromSpelling !== null &&
			fromHex !== null &&
			fromSpelling.length === fromHex.length &&
			fromSpelling.every((value, index) => value === fromHex[index]),
		`${fromSpelling?.length ?? "no"} bytes against ${fromHex?.length ?? "no"}`,
	);

	// And that it says nothing about having done so. The button is named for the
	// command, both spellings are that command, and which one a dialect takes is
	// not the porter's business — a `caveat` here would cost the button its
	// ordinary colour for no warning worth reading.
	check(`${spelled.key}: swaps silently`, swapped.caveat === undefined, swapped.caveat);
}

// A snippet is one run of MML on one line. A newline would break the line-oriented
// scanner's account of it, a `"` would open a replacement definition, and a `;`
// survives preprocessing under `#amm` (`preprocess.ts`) and would comment out the
// rest of the line.
{
	const bad = DIALECTS.flatMap(({ target }) =>
		resolveAll(target, false)
			.concat(resolveAll(target, true))
			.filter((entry) => /[\n";]/.test(entry.text))
			.map((entry) => entry.key),
	);

	check("no snippet carries a newline, a quote or a semicolon", bad.length === 0, bad.join(", "));
}

for (const { marker, target } of DIALECTS) {
	console.log(`\n${marker}`);

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
		}
	}
}

console.log("\nplacement");

// The rule `channelsBeginAt` exists for: a remote definition above the first
// channel is a definition, and below it is read as a call.
{
	const song = "#amk 4\n(!1)[$F4 $09]\n#0 c4\n";
	const first = channelsBeginAt(tokenize(song));
	check("channelsBeginAt finds the first #N", first === song.indexOf("#0"), `found ${first}`);
	check("and nothing when the song has no channel", channelsBeginAt(tokenize("#amk 4\n")) === null);
}

// `songTarget` resolves the file the way `preprocess.ts` does, and the precedence
// is the part worth pinning below the music rather than above it: `tokentest`
// already covers these orderings for `Command.target`, where every marker
// precedes the command it governs, and the whole point here is that it need not.
{
	const said = (song: string) => {
		const read = songTarget(tokenize(song));
		return read.program === 0 ? `#amk ${read.amkVersion}` : read.program === 1 ? "#am4" : "#amm";
	};

	// preprocess.ts's `amk` case is guarded by `version >= 0`, so a legacy marker
	// anywhere stops every later #amk — even one written after it.
	check("#amk below #am4 does not win", said("#am4\n#0 c4\n#amk 2\n") === "#am4", said("#am4\n#0 c4\n#amk 2\n"));
	// Its `amm` and `am4` cases are unguarded, so a legacy marker always does.
	check("#amm below #amk wins", said("#amk 2\n#0 c4\n#amm\n") === "#amm", said("#amk 2\n#0 c4\n#amm\n"));
	// And between two #amk lines, the last one.
	check("the last #amk wins", said("#amk 4\n#0 c4\n#amk 1\n") === "#amk 1", said("#amk 4\n#0 c4\n#amk 1\n"));
	check("no marker is the #amk 4 default", said("#0 c4\n") === "#amk 4", said("#0 c4\n"));
}

// ---------------------------------------------------------------------------
console.log("\na command read back out of a song finds its glyph");
// ---------------------------------------------------------------------------
//
// The catalogue answers "what can I add"; the piano roll asks it backwards, for
// a command already written. A byte with no answer is a bar with a gap on it,
// which looks exactly like a bar with nothing acting on it.
{
	const drawnAt = (marker: string, body: string) => {
		const source = `${marker}\n#0 ${body}\n`;
		const command = tokenize(source).commands.find((entry) => entry.span.start >= source.indexOf(body));
		return command === undefined ? null : { command, entry: glyphOf(command) };
	};

	const drawn = (body: string) => drawnAt("#amk 4", body);

	const undrawable: string[] = [];
	for (const vcmd of Object.keys(VCMD_NAMES).map(Number)) {
		const found = drawn(hex(vcmd));
		if (found === null || commandScope(found.command) !== "note-state") {
			continue;
		}

		if (found.entry === null) {
			undrawable.push(hex(vcmd));
		}
	}

	check("every VCMD that acts on a note has a glyph", undrawable.length === 0, undrawable.join(" "));

	const letters = ["@", "v", "y", "q", "h", "n", "p"];
	const missing = letters.filter((letter) => drawn(`${letter}1`)?.entry == null);
	check("and so does every letter that acts on one", missing.length === 0, missing.join(" "));

	// One opcode, two envelopes, told apart by the first argument's top bit —
	// the same test the inspector makes to choose between the two views.
	check("$ED below $80 is the four-stage envelope", drawn("$ED $3F $4D")?.entry?.icon === "adsr");
	check("and at or above it drives the level directly", drawn("$ED $8E $7F")?.entry?.icon === "gain");

	// A second argument turns three letters into their fades, which is the same
	// count `gather` splits their names on.
	check("t144 is the tempo glyph", drawn("t144")?.entry?.icon === "metronome");
	check("and t18,144 the fade", drawn("t18,144")?.entry?.icon === "metronomeFade");
	check("v200 is the volume glyph", drawn("v200")?.entry?.icon === "speaker");
	check("and v18,200 the fade", drawn("v18,200")?.entry?.icon === "hairpin");

	// …but only where the dialect reads the comma. Below `#amk 3` the second
	// number is not an argument, so the command is a plain `t` and saying "fade"
	// would put the word on a bar for a song that has none.
	const flat = drawnAt("#amk 2", "t18,144");
	check("under #amk 2, t18,144 is not a fade", flat?.entry?.icon === "metronome", flat?.entry?.icon);
	check("and is named for what it is", flat?.command.name === "tempo", flat?.command.name);

	// `#am4` reuses two bytes for other commands entirely, and the name has to
	// follow the arguments *written* rather than the ones a button would insert
	// — `resolveEntry` names an entry from its own defaults, which are chosen to
	// stay clear of these very forks.
	const named = (marker: string, body: string) => drawnAt(marker, body)?.entry?.label;
	check("#am4's $ED $81 is a tune", named("#am4", "$ED $81 $10") === "Tune", named("#am4", "$ED $81 $10"));
	check(
		"its $ED $80 is a DSP write",
		named("#am4", "$ED $80 $6C $20") === "DSP write",
		named("#am4", "$ED $80 $6C $20"),
	);
	check(
		"and its plain $ED is still an envelope",
		named("#am4", "$ED $3F $4D") === "ADSR",
		named("#am4", "$ED $3F $4D"),
	);

	const load = drawnAt("#am4", "$E5 $80 $04");
	check("#am4's $E5 with a high first byte is a sample load", load?.entry?.label === "Sample load", load?.entry?.label);
	check("and draws the sample glyph, not tremolo's", load?.entry?.icon === "sample", load?.entry?.icon);
	check("while a low one is still tremolo", drawnAt("#am4", "$E5 $00 $12 $08")?.entry?.icon === "tremolo");

	// The guard on all of that: `vcmdName` calls both `$EF` and `$F1` "echo
	// parameters" whatever their arguments, so only the entries' own labels tell
	// them apart and a rule that preferred the written name would lose them.
	check("$EF keeps the label that tells it from $F1", named("#amk 4", "$EF $FF $28 $28") === "Echo channels & volume");
	check("and $F1 keeps its own", named("#amk 4", "$F1 $02 $00 $00") === "Echo delay & feedback");
}

// ---------------------------------------------------------------------------
console.log("\nputting brackets round a selection");
// ---------------------------------------------------------------------------
//
// The same standard as `formAvailability` above, applied to a rule about
// structure rather than about dialect: `loop-wrap.ts` says which of the two
// constructs may be written round a run *before* the brackets exist, and the
// compiler is asked afterwards whether it was right. An offer that does not
// compile is the promise broken; a refusal that would have compiled is a button
// dead for nothing, so both directions are checked — the construct the verdict
// declined is written out by hand and has to fail.
{
	const wrapped = (song: string, pick: string, want: WrapKind) => {
		const index = tokenize(song);
		const at = song.indexOf(pick);
		return wrapVerdict({
			source: song,
			index,
			reading: readLoops(song, index),
			run: at < 0 || pick === "" ? null : { start: at, end: at + pick.length },
			want,
		});
	};

	const applied = (song: string, offer: WrapOffer) =>
		song.slice(0, offer.at.start) +
		offer.open +
		song.slice(offer.at.start, offer.at.end) +
		offer.close +
		song.slice(offer.at.end);

	const errorsIn = (song: string) =>
		compiler
			.compile({ source: song, aramAddress: ARAM })
			.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
			.map((diagnostic) => diagnostic.code);

	/** Notes the pass plays on channel 0 — how a wrap is proved to have repeated them. */
	const played = (song: string) => {
		const data = compiler.compile({ source: song, aramAddress: ARAM }).data;
		return data === null || data === undefined
			? -1
			: walkSong(data, ARAM).notes.filter((note) => note.channel === 0).length;
	};

	/** An offer, compiled; the label says what was asked for and where. */
	const offers = (label: string, song: string, pick: string, want: WrapKind, kind: WrapKind) => {
		const verdict = wrapped(song, pick, want);
		if (!isWrap(verdict)) {
			check(label, false, `refused: ${verdict.refused}`);
			return null;
		}

		check(label, verdict.kind === kind, `offered the ${verdict.kind}`);
		const out = applied(song, verdict);
		check(`${label}, and AddmusicK takes it silently`, errorsIn(out).length === 0, errorsIn(out).join(" "));
		return out;
	};

	const refuses = (label: string, song: string, pick: string, want: WrapKind, because: string) => {
		const verdict = wrapped(song, pick, want);
		check(label, !isWrap(verdict) && verdict.refused === because, isWrap(verdict) ? "offered" : verdict.refused);
	};

	// The plain case, and the claim that gives a wrap its point.
	{
		const song = "#amk 4\n#0 o4 c4 d4 e4 f4\n";
		const out = offers("a run outside every bracket takes a loop", song, "c4 d4", "loop", "loop");
		check("and the loop is labelled from 0", out?.includes("(0)[") === true, out ?? "");
		check(
			"and the two notes inside it now play twice",
			out !== null && played(out) === played(song) + 2,
			`${out === null ? "?" : played(out)} against ${played(song)}`,
		);
	}

	// The switch the feature is named for, in both directions.
	offers(
		"a run inside a loop takes the subloop instead",
		"#amk 4\n#0 o4 (0)[ c4 d4 e4 ]2\n",
		"c4 d4",
		"loop",
		"subloop",
	);
	offers("a run inside a subloop takes the loop", "#amk 4\n#0 o4 [[ c4 d4 ]]2 e4\n", "c4 d4", "loop", "loop");
	offers(
		"a run holding a loop takes the subloop round it",
		"#amk 4\n#0 o4 (0)[ c4 d4 ]2 e4\n",
		"(0)[ c4 d4 ]2",
		"loop",
		"subloop",
	);
	offers(
		"and a hand-written $E6 pair counts as the subloop it is",
		"#amk 4\n#0 o4 $E6 $00 c4 d4 $E6 $01\n",
		"c4 d4",
		"loop",
		"loop",
	);

	// Both levels spent. The proof it is a real limit and not a guess: writing
	// either construct there by hand is one of the two errors named below.
	{
		const song = "#amk 4\n#0 o4 [ c4 [[ d4 e4 ]]2 f4 ]3\n";
		refuses("a run inside both is refused", song, "d4 e4", "loop", WRAP_DEEP);
		check(
			"and a loop written there really is AMK0123",
			errorsIn(song.replace("d4 e4", "[ d4 e4 ]2")).includes("AMK0123"),
			errorsIn(song.replace("d4 e4", "[ d4 e4 ]2")).join(" "),
		);
		check(
			"and a subloop really is AMK0121",
			errorsIn(song.replace("d4 e4", "[[ d4 e4 ]]2")).includes("AMK0121"),
			errorsIn(song.replace("d4 e4", "[[ d4 e4 ]]2")).join(" "),
		);
	}

	// The swap in the other direction: the depth is what runs out, not the button.
	offers(
		"a subloop asked for inside a subloop takes the loop instead",
		"#amk 4\n#0 o4 [[ c4 d4 ]]2\n",
		"c4 d4",
		"subloop",
		"loop",
	);
	refuses(
		"and asked for inside both it is refused in the same words",
		"#amk 4\n#0 o4 [ c4 [[ d4 e4 ]]2 f4 ]3\n",
		"d4 e4",
		"subloop",
		WRAP_DEEP,
	);

	// With the brackets unpaired there is nothing to reason from, and the compiler
	// would refuse the song anyway.
	refuses("brackets that do not pair up refuse a wrap", "#amk 4\n#0 o4 [ c4 d4\n", "c4 d4", "loop", BRACKETS_UNPAIRED);

	// The refusals that are about the run rather than about the depth.
	refuses("nothing selected", "#amk 4\n#0 o4 c4 d4\n", "", "loop", WRAP_NOTHING);
	refuses("a selection with no note in it", "#amk 4\n#0 o4 c4 d4\n", "o4", "loop", WRAP_NO_NOTES);
	refuses("a run across a bracket", "#amk 4\n#0 o4 (0)[ c4 d4 ]2 e4\n", "d4 ]2 e4", "loop", WRAP_SPLIT);
	refuses("a run across a channel marker", "#amk 4\n#0 o4 c4\n#1 o4 d4\n", "c4\n#1 o4 d4", "loop", WRAP_CHANNELS);
	refuses("a run holding the intro marker", "#amk 4\n#0 o4 c4 / d4\n", "c4 / d4", "loop", WRAP_INTRO);
	refuses(
		"a run written through a replacement",
		'#amk 4\n"two=c4 d4"\n#0 o4 two e4\n',
		"two e4",
		"loop",
		WRAP_REPLACEMENT,
	);

	// The label, which is the one piece of state a wrap has to read off the whole
	// song. `parseLabelLoop` stores `n + 1` and `parseRemoteDefinition` stores `n`
	// (`parser.ts:2460`, `:2517-2518`), so `(0)` and `(!1)` are one slot and
	// writing both is AMK0124 — which is exactly what an allocator that counted
	// only its own kind would walk into.
	{
		const next = (song: string, pick: string) => {
			const verdict = wrapped(song, pick, "loop");
			return isWrap(verdict) ? verdict.label : null;
		};

		check("a song with no loops offers 0", next("#amk 4\n#0 o4 c4\n", "c4") === 0);
		check("a song already using (0) offers 1", next("#amk 4\n#0 o4 (0)[ c4 ]2 d4\n", "d4") === 1);
		check(
			"and a remote (!1) takes 0's slot, so the wrap offers 1",
			next("#amk 4\n(!1)[$F4 $09]\n#0 o4 c4\n", "c4") === 1,
			String(next("#amk 4\n(!1)[$F4 $09]\n#0 o4 c4\n", "c4")),
		);
		check(
			"and writing (0) beside that (!1) really is AMK0124",
			errorsIn("#amk 4\n(!1)[$F4 $09]\n#0 o4 (0)[ c4 ]2\n").includes("AMK0124"),
			errorsIn("#amk 4\n(!1)[$F4 $09]\n#0 o4 (0)[ c4 ]2\n").join(" "),
		);
	}

	// A `$DD` is read by the note in front of it rather than dispatched
	// (`main.asm:L_10E4`), so a closing bracket written between the two puts the
	// body's own `$00` where the slide was.
	{
		const out = offers(
			"a slide riding on the last note goes inside the brackets",
			"#amk 4\n#0 o4 c4 $DD $00 $18 $A4 d4\n",
			"c4",
			"loop",
			"loop",
		);
		check("and the bracket really is past it", out?.includes("$A4 ]2") === true, out ?? "");
	}

	// A drum's `@21`-`@29` comes inside with its note: `[` copies the remap into
	// slot 8 and the note there clears slot 8 alone (`parser.ts:2725`, `:3013`),
	// so one left outside would still be standing when the loop ends.
	{
		const out = offers("a drum takes its own @ in with it", "#amk 4\n#0 @21 c4 d4\n", "c4", "loop", "loop");
		check("and the @ is inside the brackets", out?.includes("[ @21 c4 ]") === true, out ?? "");
	}
}

// ---------------------------------------------------------------------------
//
// Reading a loop's count, and writing it back.
//
// The same standard once more, on the other half of the brackets: `loop-focus.ts`
// says what a construct repeats and where that number is written, and the
// compiler is asked whether it was right. The claim is priced in **notes played**
// rather than in text, because every one of the five spellings keeps its count
// somewhere else — on the second of two `]` commands, on no command at all, or
// one less than itself — and a reading that is wrong about which produces a
// perfectly plausible field over the wrong number.
{
	const errorsIn = (song: string) =>
		compiler
			.compile({ source: song, aramAddress: ARAM })
			.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
			.map((diagnostic) => diagnostic.code);

	/** What channel 0 plays, by written pitch and in order — the oracle for a retarget. */
	const notesIn = (song: string) => {
		const data = compiler.compile({ source: song, aramAddress: ARAM }).data;
		return data === null || data === undefined
			? null
			: walkSong(data, ARAM)
					.notes.filter((note) => note.channel === 0)
					.map((note) => note.note);
	};

	const played = (song: string) => notesIn(song)?.length ?? -1;

	const focusOn = (song: string, pick: string) => {
		const index = tokenize(song);
		const at = song.indexOf(pick);
		return loopFocus({ source: song, index, reading: readLoops(song, index), caret: at, hint: null })[0];
	};

	const applied = (song: string, edit: Edit | null) =>
		edit === null ? song : song.slice(0, edit.span.start) + edit.text + song.slice(edit.span.end);

	// Every spelling, its count read and then written, priced against the walk.
	// A body of one note means "notes played" *is* the count, so a reading one
	// out — the `$E6`'s byte, the `]]`'s second bracket — cannot hide.
	{
		const cases: { name: string; song: string; pick: string; plays: number }[] = [
			{ name: "a [ ]n loop", song: "#amk 4\n#0 o4 [c4]4 e4\n", pick: "]4", plays: 4 },
			{ name: "a [ ] with no count", song: "#amk 4\n#0 o4 [c4] e4\n", pick: "]", plays: 1 },
			{ name: "a [[ ]]n subloop", song: "#amk 4\n#0 o4 [[c4]]4 e4\n", pick: "]]4", plays: 4 },
			{
				name: "a hand-written $E6 pair",
				song: "#amk 4\n#0 o4 $E6 $00 c4 $E6 $03 e4\n",
				pick: "$E6 $03",
				plays: 4,
			},
			{ name: "a (n)m call", song: "#amk 4\n#0 o4 (0)[c4]2 (0)3 e4\n", pick: "(0)3", plays: 3 },
			{ name: "a *n call", song: "#amk 4\n#0 o4 [c4]2 *3 e4\n", pick: "*3", plays: 3 },
		];

		for (const { name, song, pick, plays } of cases) {
			const focus = focusOn(song, pick);
			check(`${name} reads its count`, focus?.count?.plays === plays, String(focus?.count?.plays));

			const out = applied(song, focus ? loopCountEdit(song, focus, plays + 2) : null);
			check(`${name}, written up by two, compiles`, errorsIn(out).length === 0, errorsIn(out).join(" "));
			check(
				`${name}, written up by two, plays two more notes`,
				played(out) === played(song) + 2,
				`${played(out)} against ${played(song)}`,
			);
		}
	}

	// The wart the loop reading exists to retire. `gather` gives `]]4` two `]`
	// commands and the count lands on the second, so the first is a command whose
	// Repeats row can never be filled — and a caret there does not even reach it,
	// `commandAt` being end-inclusive and handing back the note in front instead.
	// Three claims, so a change to any of them is caught.
	{
		const song = "#amk 4\n#0 o4 [[c4]]4 e4\n";
		const commands = tokenize(song).commands;
		const at = song.indexOf("]]");
		const first = commandStartingAt(commands, at);
		check("the first ] of a ]]4 gathers no count of its own", first?.args.length === 0, String(first?.args.length));
		check("and a caret on it does not even reach that bracket", commandAt(commands, at)?.name === "note");
		check("where the loop reading finds the 4", focusOn(song, "]]")?.count?.plays === 4);
	}

	// A count written through a replacement is in the expansion `gather` sees and
	// not in the digits, so a reading off the source would say "nothing written,
	// so 1". Writing it is refused for the same reason `edits.ts` refuses every
	// macro'd part: the splice would overwrite the use site.
	{
		const song = '#amk 4\n"REP=4"\n#0 o4 [c4]REP e4\n';
		const focus = focusOn(song, "]REP");
		check("a count through a replacement is read as 4", focus?.count?.plays === 4, String(focus?.count?.plays));
		check("and is not editable", focus?.count?.editable === false);
		check("and the splice refuses", focus !== undefined && loopCountEdit(song, focus, 5) === null);
	}

	// Retargeting a call. Counted in *pitches* rather than in note totals: two
	// bodies of one note each play the same number of notes either way, so only
	// what is heard can tell a retarget from a no-op.
	{
		const song = "#amk 4\n#0 o4 (0)[c4]2 (1)[d4]2 (0)3 e4\n";
		const focus = focusOn(song, "(0)3");
		check(
			"a call offers every label declared above it",
			focus?.recalls?.options.map((option) => option.value).join(",") === "0,1",
			focus?.recalls?.options.map((option) => option.label).join(" ") ?? "",
		);

		const out = applied(song, focus ? loopTargetEdit(song, focus, 1) : null);
		check("and pointing it at (1) compiles", errorsIn(out).length === 0, errorsIn(out).join(" "));
		const before = notesIn(song) ?? [];
		const after = notesIn(out) ?? [];
		check(
			"and the three notes it played are now the other body's",
			before.length === after.length && before.join() !== after.join(),
			`${before.join()} -> ${after.join()}`,
		);
	}

	// A label declared *below* a call is one AddmusicK refuses outright, which is
	// why the control is a select over what is above rather than a number field.
	{
		const song = "#amk 4\n#0 o4 (0)3 (0)[c4]2 e4\n";
		check(
			"a call offers nothing where its body is declared below it",
			focusOn(song, "(0)3")?.recalls?.options.length === 0,
		);
		check("and writing that call really is AMK0115", errorsIn(song).includes("AMK0115"), errorsIn(song).join(" "));
	}

	// A `*` names no body, so the select's own entry is the honest description of
	// what it plays; choosing a label writes the call that says it out loud.
	{
		const song = "#amk 4\n#0 o4 (0)[c4]2 *3 e4\n";
		const focus = focusOn(song, "*3");
		check("a * reports no label", focus?.recalls?.label === -1, String(focus?.recalls?.label));
		const out = applied(song, focus ? loopTargetEdit(song, focus, 0) : null);
		check("and naming its body writes a (0) call", out.includes("(0)3"), out);
		check("which compiles", errorsIn(out).length === 0, errorsIn(out).join(" "));
		check("and plays exactly what the * did", notesIn(out)?.join() === notesIn(song)?.join());
	}

	// A remote body is jumped into by a `$FC` rather than looped over, so a count
	// on it means nothing and AddmusicK says so.
	{
		const song = "#amk 4\n(!1)[$F4 $09]\n#0 o4 c4\n";
		const focus = focusOn(song, "$F4");
		check("a remote definition offers no count", focus?.kind === "remote" && focus.count === null);
		check(
			"and writing one really is AMK0164",
			errorsIn("#amk 4\n(!1)[$F4 $09]2\n#0 o4 c4\n").includes("AMK0164"),
			errorsIn("#amk 4\n(!1)[$F4 $09]2\n#0 o4 c4\n").join(" "),
		);
	}

	// Naming a body, which is what makes an unnamed hand-written loop reachable
	// by a call at all. The allocator counts a `(!n)` too, or it walks into
	// AMK0124 — the same rule the wrap's own label test above pins.
	{
		const song = "#amk 4\n#0 o4 [c4]2 e4\n";
		const focus = focusOn(song, "]2");
		check("an unnamed loop offers the lowest free label", focus?.name?.label === 0, String(focus?.name?.label));
		const out = applied(song, focus ? loopNameEdit(focus, 0) : null);
		check("and naming it writes the (0) hard against the [", out.includes("(0)[c4]2"), out);
		check("which compiles", errorsIn(out).length === 0, errorsIn(out).join(" "));
		check("and plays what it played", notesIn(out)?.join() === notesIn(song)?.join());
		check(
			"a loop that already has a name is not offered another",
			focusOn("#amk 4\n#0 o4 (0)[c4]2 e4\n", "]2")?.name === null,
		);
	}

	// A subloop's floor is 2 and a `[ ]`'s is 1, and both are the compiler's.
	{
		check("a subloop's count starts at 2", focusOn("#amk 4\n#0 o4 [[c4]]4\n", "]]4")?.count?.min === 2);
		check("a loop's starts at 1", focusOn("#amk 4\n#0 o4 [c4]4\n", "]4")?.count?.min === 1);
		check(
			"and ]]1 really is AMK0126",
			errorsIn("#amk 4\n#0 o4 [[c4]]1\n").includes("AMK0126"),
			errorsIn("#amk 4\n#0 o4 [[c4]]1\n").join(" "),
		);
	}

	// The list, and its order. A note inside a nested body is inside both, and
	// the innermost is the one an edit there is about.
	{
		const song = "#amk 4\n#0 o4 (1)[c4 [[d4]]3 ]2 (1)5\n";
		const index = tokenize(song);
		const at = (pick: string) =>
			loopFocus({
				source: song,
				index,
				reading: readLoops(song, index),
				caret: song.indexOf(pick, 10),
				hint: null,
			});

		check("a note in one body names one loop", at("c4").length === 1 && at("c4")[0].kind === "loop");
		check(
			"a note in a nested body names both, innermost first",
			at("d4")
				.map((focus) => focus.kind)
				.join() === "subloop,loop",
			at("d4")
				.map((focus) => focus.kind)
				.join(),
		);
		check("and a caret on a call's own text says so", at("(1)5")[0]?.onText === true);
		check("where a caret inside a body does not", at("d4")[0]?.onText === false);
	}

	// What the roll's press adds, and the only thing it adds: which of a body's
	// constructs the porter took hold of. The caret is on the body's first note
	// either way, so without the hint every press answers with the declaration.
	{
		const song = "#amk 4\n#0 o4 (1)[c4 d4]2 e4 (1)3\n";
		const index = tokenize(song);
		const reading = readLoops(song, index);
		const body = reading.spans[0];
		const recall = reading.recalls[0];
		const ask = (hint: { text: Span; body: Span } | null) =>
			loopFocus({ source: song, index, reading, caret: body.bodyFrom, hint })[0];

		check("with no hint the body's own declaration leads", ask(null)?.kind === "loop");
		check(
			"a press on the recall's box puts that call first",
			ask({
				text: { start: recall.from, end: recall.to, line: 1 },
				body: { start: body.bodyFrom, end: body.bodyTo, line: 1 },
			})?.kind === "call",
		);
		check(
			"and a hint for another body is ignored",
			ask({
				text: { start: recall.from, end: recall.to, line: 1 },
				body: { start: 0, end: 1, line: 1 },
			})?.kind === "loop",
		);
	}

	// The palette's own half: what **Loop call** writes, and when it will not.
	{
		const asked = (song: string, pick: string) => {
			const index = tokenize(song);
			return callVerdict({ source: song, index, reading: readLoops(song, index), caret: song.indexOf(pick) });
		};

		const song = "#amk 4\n#0 o4 (0)[c4]2 (1)[d4]2 e4\n";
		const offer = asked(song, "e4");
		check("a call is offered where a named loop stands above the caret", isCall(offer));
		if (isCall(offer)) {
			check("and it names the nearest one", offer.label === 1, String(offer.label));
			const out = song.slice(0, song.indexOf("e4")) + offer.text + song.slice(song.indexOf("e4"));
			check("and AddmusicK takes it silently", errorsIn(out).length === 0, errorsIn(out).join(" "));
			check(
				"and it plays the body it named",
				played(out) === played(song) + 2,
				`${played(out)} against ${played(song)}`,
			);
		}

		const none = asked("#amk 4\n#0 o4 [c4]2 e4\n", "e4");
		check("an unnamed loop is nothing a call can reach", !isCall(none) && none.refused === CALL_NONE);

		const above = asked("#amk 4\n#0 o4 c4 (0)[d4]2\n", "c4");
		check("nor is one written below the caret", !isCall(above) && above.refused === CALL_NONE);

		const inside = asked("#amk 4\n#0 o4 (0)[c4]2 [d4 e4]2\n", "e4");
		check("a call inside a [ ] body is refused", !isCall(inside) && inside.refused === CALL_NESTED);
		check(
			"and writing one really is AMK0112",
			errorsIn("#amk 4\n#0 o4 (0)[c4]2 [d4 (0)2]2\n").includes("AMK0112"),
			errorsIn("#amk 4\n#0 o4 (0)[c4]2 [d4 (0)2]2\n").join(" "),
		);

		const sub = asked("#amk 4\n#0 o4 (0)[c4]2 [[d4 e4]]2\n", "e4");
		check("but one inside a [[ ]] is not — a subloop leaves the channel alone", isCall(sub));

		const unpaired = asked("#amk 4\n#0 o4 (0)[c4]2 [d4 e4\n", "e4");
		check(
			"and brackets that do not pair up refuse a call",
			!isCall(unpaired) && unpaired.refused === BRACKETS_UNPAIRED,
			isCall(unpaired) ? "offered" : unpaired.refused,
		);
	}
}

summarise();
