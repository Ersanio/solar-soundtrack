/** `optimizetest`: each move on a song written for it — a label loop, a call from another channel, a transposed call, a superloop, and a long rest looped only when finalizing. */

import { check, section } from "../harness";
import { optimize, refusedChannels, sameNotes } from "./support";

const PHRASE = "o4 c8 d8 e8 f8 g4 e4 c2";

/** A bass riff starting `semitones` above C, every note `semitones` higher. */
function riff(semitones: number): string {
	const names = ["c", "c+", "d", "d+", "e", "f", "f+", "g", "g+", "a", "a+", "b"];
	return [0, 0, 7, 12, 10, 7, 5, 7, 0, 0, 3, 5]
		.map((step) => {
			const key = 36 + semitones + step;
			return `o${Math.floor(key / 12) + 1} ${names[key % 12]}16`;
		})
		.join(" ");
}

/** Holds `text` optimized to be smaller, play the same and open in the roll, and returns it. */
function holds(name: string, text: string, mode: "import" | "finalize" = "import"): string {
	const result = optimize(text, { mode });
	check(`${name}: smaller`, result.after < result.before, `${result.before} -> ${result.after}`);
	check(`${name}: plays the same`, sameNotes(text, result.text) === null, sameNotes(text, result.text) ?? "");
	check(
		`${name}: every channel opens in the roll`,
		refusedChannels(result.text).length === 0,
		refusedChannels(result.text).join("; "),
	);
	return result.text;
}

section("constructs: a phrase played three times is a label loop");
{
	const text = holds("label", `#amk 4\n#0 t40 @0 v200 ${PHRASE} r4 ${PHRASE} r8 ${PHRASE}\n`);
	check("it is defined once and called after", /\(\d+\)\[/.test(text) && /\(\d+\)(?!\[)/.test(text), text);
}

section("constructs: the same phrase on another channel calls the first channel's body");
{
	const text = holds("cross-channel", `#amk 4\n#0 @0 ${PHRASE} r2 ${PHRASE}\n#1 @0 r4 ${PHRASE} r2 ${PHRASE}\n`);
	const second = text.slice(text.indexOf("#1"));
	check("the second channel defines nothing", !/\(\d+\)\[/.test(second), second);
}

section("constructs: a riff played at another pitch is the same body under $FA $02");
{
	const text = holds("transposed", `#amk 4\n#0 @0 ${[0, 2, 5, 7].map(riff).join(" r4 ")} r4\n`);
	check("a call is moved up", /\$FA \$02 \$0[1-9A-F]/.test(text), text);
	check("and the tune is put back after", text.includes("$FA $02 $00"), text);
}

section("constructs: a note struck over and over is a superloop");
{
	const text = holds("superloop", `#amk 4\n#0 @0 o4 ${"c16 ".repeat(32)}d4\n`);
	check("written as [[ ]]", text.includes("[["), text);
}

section("constructs: a long rest is looped when finalizing, and left drawable on import");
{
	const song = `#amk 4\n#0 @0 o4 c4 ${"r1^1^1^1^1^1^1^1"} d4\n`;
	const finalized = holds("rest", song, "finalize");
	check("finalized, the rest is a superloop", /\[\[r[^\]]*\]\]\d+/.test(finalized), finalized);
	check("imported, it is not", !optimize(song).text.includes("[[r"), optimize(song).text);
}
