/**
 * The command palette's catalogue.
 *
 * Two assertions carry the weight here, and neither is visible from the table
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
 *    minimal song and checks the claim against what actually comes back. A
 *    `blocked` entry that compiles cleanly is a button greyed out for nothing;
 *    an `ok` entry that errors is the one promise the palette makes, broken.
 *
 *   npm run palettetest
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { compiler } from "@amk/compiler";
import { type CommandTarget, commandAt, expectedArgs, tokenize, VCMD_NAMES } from "@amk/tokens";
import { channelsBeginAt, targetAt } from "@amk/tokens/dialect";
import { ENTRIES, type ResolvedEntry, resolveEntry } from "../web/src/app/editor/command-palette/catalog";
import { GLYPH_NAMES } from "../web/src/app/editor/command-palette/command-icon";
import { glyphOf } from "../web/src/app/editor/command-palette/glyph-of";
import { commandScope } from "@amk/tokens/commands/in-force";

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
 * `PARTNERS` is the third shape, for the two entries that open something. `]4`
 * outside a loop is AMK0129 and a `$E6 $00` that never closes leaves the
 * channel with no data at all (AMK0303) — both true of the text a *person*
 * types too, and both fixed by the next thing they type. The palette writes one
 * command per click, so the probe supplies the partner rather than the entry
 * pretending to be a pair.
 */
const PARTNERS: Readonly<Record<string, { above?: string; before?: string }>> = {
	"text:]": { before: "[c4 " },
	// A remote call is inert without a body to call, and AddmusicK says so
	// (AMK0115). Its definition has to sit above the first channel, which is the
	// other half of the rule the palette's own `context` encodes.
	"text:(!n,": { above: "(!1)[$F4 $09]" },
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

	// What the palette reads is what the scanner reads. If these disagreed, every
	// gating decision below would be answering for the wrong dialect.
	{
		const read = targetAt(tokenize(`${marker}\n#0 $E7 $B0 c4\n`), `${marker}\n#0 `.length);
		check(
			`${marker}: targetAt agrees with the marker`,
			read.program === target.program && read.amkVersion === target.amkVersion,
			`read program ${read.program}, #amk ${read.amkVersion}`,
		);
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
			} else {
				check(`${label}: offered, and AddmusicK does accept it`, errors.length === 0, say(errors));
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

// ---------------------------------------------------------------------------
console.log("\na command read back out of a song finds its glyph");
// ---------------------------------------------------------------------------
//
// The catalogue answers "what can I add"; the piano roll asks it backwards, for
// a command already written. A byte with no answer is a bar with a gap on it,
// which looks exactly like a bar with nothing acting on it.
{
	const drawn = (body: string) => {
		const source = `#amk 4\n#0 ${body}\n`;
		const command = tokenize(source).commands.find((entry) => entry.span.start >= source.indexOf(body));
		return command === undefined ? null : { command, entry: glyphOf(command) };
	};

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
}

summarise();
