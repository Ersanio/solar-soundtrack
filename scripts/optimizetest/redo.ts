/** `optimizetest`: Redo — a song's own loops in every spelling played out and looped again, playing the same and never larger than keeping them. */

import { check, section } from "../harness";
import { optimize, refusedChannels, sameNotes } from "./support";

section("redo: every loop spelling played out and looped again");
{
	const text = [
		"#amk 4",
		"#0 @0 l8 o4 [c d e]3 (7)[f g a > c <]2 r4 (7) [[g a]]4 r2 * " + "o4 c8 d8 e8 f8 g4 e4 c2 r4 ".repeat(3),
		"#1 @0 o3 (7)2 r2 [[c4 g4]]6",
		"",
	].join("\n");
	const kept = optimize(text, { mode: "finalize" });
	const redone = optimize(text, { mode: "finalize", loops: "redo" });
	check("redone, it plays the same", sameNotes(text, redone.text) === null, sameNotes(text, redone.text) ?? "");
	check("and opens in the roll", refusedChannels(redone.text).length === 0, refusedChannels(redone.text).join("; "));
	check(
		"and is no larger than keeping the loops",
		redone.after <= kept.after,
		`${kept.after} kept, ${redone.after} redone`,
	);
	check("label 7 is not written again", !redone.text.includes("(7)[f g"), redone.text);
}

section("redo: a recall from another channel under another q is played out only where it plays alike");
{
	const text = "#amk 4\n#0 @0 q7F o4 (3)[c8 d8 e8 f8]2 r2\n#1 @0 q3F o4 (3)2 r2\n";
	const redone = optimize(text, { mode: "finalize", loops: "redo" });
	check("it plays the same", sameNotes(text, redone.text) === null, sameNotes(text, redone.text) ?? "");
}
