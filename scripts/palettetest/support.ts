/**
 * What the `palettetest` sections share: the dialects, the probe song an entry
 * is compiled in, `resolveAll`, and the `SUPERSEDED` table.
 */

import "../localize";
import type { CommandTarget } from "@amk/tokens";
import { ENTRIES, type ResolvedEntry, resolveEntry } from "../../web/src/app/editor/command-palette/catalog";

/** The dialects a song can actually declare. `#amk 3` is AMK0402 and is not one. */
export const DIALECTS: { marker: string; target: CommandTarget }[] = [
	{ marker: "#amk 1", target: { program: 0, amkVersion: 1 } },
	{ marker: "#amk 2", target: { program: 0, amkVersion: 2 } },
	{ marker: "#amk 4", target: { program: 0, amkVersion: 4 } },
	{ marker: "#am4", target: { program: 1, amkVersion: 0 } },
	{ marker: "#amm", target: { program: 2, amkVersion: 0 } },
];

/** The load address the app compiles at; nothing here depends on the value. */
export const ARAM = 0x0800;

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
	// A remote call is inert without a body to call, which AddmusicK compiles in
	// silence and SST0509 reports. Its definition has to sit above the first
	// channel, which is the other half of the rule the palette's own `context`
	// encodes.
	"text:(!n,": { above: "(!1)[$F4 $09]" },
	// The same rule for the same reason: a `(n)m` names a body, and
	// `parseLabelLoop` refuses a label that is not in `loopPointers` yet. The
	// palette's own `callVerdict` never offers one there — this is the snippet
	// compiled standalone, which is a claim about the spelling and not about
	// where a click would put it.
	"text:(n)": { before: "(0)[c4]2 " },
};

export function probe(marker: string, entry: ResolvedEntry, beforeChannels: boolean): { song: string; at: number } {
	const partner = PARTNERS[entry.key] ?? {};
	const prelude = `${marker}\n${partner.above ? `${partner.above}\n` : ""}`;
	const head = beforeChannels ? prelude : `${prelude}#0 ${partner.before ?? ""}`;
	const tail = beforeChannels ? "\n#0 c4\n" : " c4\n";
	return { song: `${head}${entry.text}${tail}`, at: head.length };
}

/** Every entry as the palette itself would resolve it, at one dialect and place. */
/** Anything in here drawn without `svg:` in front of it would ship blank. */
export const SVG_TAGS = new Set([
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

export const hex = (vcmd: number): string => `$${vcmd.toString(16).toUpperCase()}`;

export function resolveAll(target: CommandTarget, beforeChannels: boolean): ResolvedEntry[] {
	return ENTRIES.map((entry) => resolveEntry(entry, target, { beforeChannels }));
}

export const capitalised = (label: string) => label.charAt(0).toUpperCase() + label.slice(1);

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

export const SUPERSEDED: Supersession[] = [
	{ vcmd: 0xda, letter: "c4 @0", hex: "c4 $DA $00", cite: "parser.ts:1954" },
	{ vcmd: 0xdb, letter: "c4 y10", hex: "c4 $DB $0A", cite: "parser.ts:1728" },
	{ vcmd: 0xde, letter: "c4 p12,8", hex: "c4 $DE $00 $0C $08", cite: "parser.ts:2047" },
	{ vcmd: 0xe0, letter: "c4 w200", hex: "c4 $E0 $C8", cite: "parser.ts:1596" },
	{ vcmd: 0xe1, letter: "c4 w18,200", hex: "c4 $E1 $12 $C8", cite: "parser.ts:1599" },
	{ vcmd: 0xe2, letter: "c4 t144", hex: "c4 $E2 $90", cite: "parser.ts:1812" },
	{ vcmd: 0xe3, letter: "c4 t18,144", hex: "c4 $E3 $12 $90", cite: "parseTempo's fade fork" },
	{ vcmd: 0xe7, letter: "c4 v200", hex: "c4 $E7 $C8", cite: "parser.ts:1617" },
	{ vcmd: 0xe8, letter: "c4 v18,200", hex: "c4 $E8 $12 $C8", cite: "parser.ts:1620" },
	// `n` reads its argument as hex (`HEX_ARG_LETTERS`), so `n10` is sixteen.
	{ vcmd: 0xf8, letter: "c4 n10", hex: "c4 $F8 $10", cite: "parser.ts:2002" },
	{ vcmd: 0xe6, letter: "c4 [[ c4 ]]2", hex: null, cite: "parser.ts:2460" },
	{ vcmd: 0xe9, letter: "c4 [ c4 ]4", hex: null, cite: "parser.ts:2553" },
	{
		vcmd: 0xfc,
		// The definition alone emits only its body; `$FC` is written where the
		// remote code is *called* (`parser.ts:2400`), which is why the palette
		// carries both spellings and why the probe needs both here.
		above: "(!1)[$F4 $09]",
		letter: "c4 (!1,1,24)",
		hex: null,
		cite: "parser.ts:2400",
	},
];
