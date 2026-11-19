/**
 * The command palette's catalogue, and the loop reading the two bracket buttons
 * and the loop inspector share.
 *
 * Seven assertions carry the weight here, and none is visible from the table
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
 *    What the compiler cannot answer — the driver’s own lethal bytes, a dialect
 *    that rewrites in silence — is a `caveat`, which is checked for compiling
 *    here and for saying the same thing as its diagnostic in 6.
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
 * 6. **A hazard the compiler is silent about is said somewhere, or the byte is
 *    not offered.** `SST0506`-`SST0508`, `SST0517` and the catalogue are held to the same
 *    set at every dialect: a `caveat` with no diagnostic behind it is a warning
 *    nothing checks, and a diagnostic no button warns of is a hazard the palette
 *    writes in silence. Neither half can be read off the other, so the iff is
 *    the only thing holding them together — which is what lets the buttons wear
 *    no colour of their own. A `withheld` entry satisfies it the other way:
 *    `$F7` cannot be written from the palette at all, so it needs no caveat and
 *    must not carry one, nothing being able to hover a button that is not drawn.
 *
 * 7. **A remote call is read as the compiler reads it.** Neither `(!n, type[,
 *    wait])` nor `(!!n)` raises a command, so `commands/remote.ts` reads them off
 *    the text. Each reading is compared with the `$FC` bytes the compiler emits
 *    and the body its address points at, and each splice the inspector writes is
 *    compiled again.
 *
 *   npm run palettetest
 */

// First, so every module after it finds $localize and the English.

import "../localize";
import { runSections } from "../harness";

// In this order: each section runs as its module is evaluated.
await runSections([
	["catalogue", () => import("./catalogue")],
	["supersession", () => import("./supersession")],
	["dialects", () => import("./dialects")],
	["placement", () => import("./placement")],
	["glyph-lookup", () => import("./glyph-lookup")],
	["loop-wrap", () => import("./loop-wrap")],
	["loop-count", () => import("./loop-count")],
	["remote-call", () => import("./remote-call")],
]);
