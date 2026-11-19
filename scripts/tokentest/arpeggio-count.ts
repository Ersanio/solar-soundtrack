/** `tokentest`: an `$FB` sequence whose count disagrees with the notes written after it (`SST0518`), and the count that fits. */

import "../localize";
import { tokenize } from "@amk/tokens";
import { arpeggioCountMismatches, arpeggioCounts } from "@amk/tokens/arpeggio-count";
import { check, section } from "../harness";

section("arpeggio counts — an $FB sequence whose count disagrees with its notes");
{
	const song = (body: string, marker = "#amk 4"): string => `${marker}\n#0 @0 o4 ${body}\n`;

	/** `kind:written:fitting` for each mismatch, `-` for no fitting count. */
	const read = (body: string, marker?: string): string => {
		const text = song(body, marker);
		return arpeggioCountMismatches(tokenize(text), text)
			.map((m) => `${m.kind}:${m.written}:${m.fitting ?? "-"}`)
			.join();
	};

	for (const [name, body, want] of [
		// The run is still open at the next character that is not a `$` byte: AMK0155 (`parser.ts:scan`).
		["one note short, then a note", "$FB $03 $06 $00 $04 c4", "short:2:2"],
		// The AMK0155 test comes before the `|` resets the run, so this is refused as well.
		["one note short, then a bar line", "$FB $03 $06 $00 $04 | c4", "short:2:2"],
		["one note short, then a channel", "$FB $03 $06 $00 $04\n#1 c4", "short:2:2"],
		// A count of 0 is Off, not a sequence, so there is no count to fit.
		["no notes at all", "$FB $02 $06 c4", "short:0:-"],
		// Each byte past the count is dispatched as a command: AMK0151 below `$DA`, AMK0152 for `$FF`.
		["one note over", "$FB $02 $06 $00 $04 $07 c4", "long:3:3"],
		["two notes over", "$FB $02 $06 $00 $04 $07 $0C c4", "long:4:4"],
		["an $FF over", "$FB $02 $06 $00 $04 $FF c4", "long:3:3"],
		["a loop point among the notes over", "$FB $02 $06 $00 $04 $80 $07 c4", "long:4:4"],
		// `preprocess.ts` takes the comment out before the parser reads on.
		["a note over past a comment", "$FB $02 $06 $00 $04 ; x\n$07 c4", "long:3:3"],
		// A command byte past the count is a command, so it ends the notes over.
		["a note over, then a command", "$FB $02 $06 $00 $04 $07 $F4 $01 c4", "long:3:3"],
		// `$F4 $00` would leave the `$07` stranded, so the count can only be too small.
		["a counted note that is a command byte", "$FB $02 $06 $F4 $00 $07 c4", "long:3:3"],
	] as const) {
		check(`${name}: ${want}`, read(body) === want, read(body) || "nothing");
	}

	for (const [name, body, want] of [
		// The count may be too large instead, taking in a tempo written after the sequence.
		["a counted $E7 the byte over completes", "$FB $02 $06 $00 $E7 $80 c4", "long:3:-"],
		["a counted $F4 the byte over completes", "$FB $02 $06 $00 $F4 $01 c4", "long:3:-"],
		// A loop point in the last slot sends the driver past the end (`Commands.asm:1177-1224`).
		["counting the notes over ends on a loop point", "$FB $02 $06 $00 $04 $80 c4", "long:3:-"],
		["counting the notes written ends on a loop point", "$FB $03 $06 $00 $80 c4", "short:2:-"],
		// `$80` and up are the trill and the glissando.
		["counting the notes over passes $7F", `$FB $7F $06 ${"$00 ".repeat(127)}$07 c4`, "long:128:-"],
	] as const) {
		check(`${name}: raised with no count to fit`, read(body) === want, read(body) || "nothing");
	}

	for (const [name, body, marker] of [
		// The parser reads on past a comment that `gather` stops at.
		["a comment inside the run", "$FB $02 $06 $00 ; x\n$04 c4", undefined],
		["a run still being typed at the end of the song", "$FB $03 $06 $00", undefined],
		["a duration not yet written", "$FB $03 c4", undefined],
		["the count that fits", "$FB $02 $06 $00 $04 c4", undefined],
		["the count that fits, then a command", "$FB $02 $06 $00 $04 $E7 $80 c4", undefined],
		["Off", "$FB $00 $06 $00 $04 c4", undefined],
		["a trill", "$FB $80 $06 $04 $07 c4", undefined],
		["a glissando", "$FB $81 $06 $04 $07 c4", undefined],
		// Legacy songs write bytes below `$DA` on purpose (`parser.ts:parseHexCommand`).
		["a byte over under #amm", "$FB $02 $06 $00 $04 $07 c4", "#amm"],
	] as const) {
		check(`${name}: raises nothing`, read(body, marker) === "", read(body, marker));
	}

	check("an $FF over under #amm is still refused", read("$FB $02 $06 $00 $04 $FF c4", "#amm") === "long:3:3");

	const diagnosed = (body: string) => {
		const text = song(body);
		const found = arpeggioCounts(tokenize(text), text);
		return { found, spanned: found.map((d) => text.slice(d.span.start, d.span.end)) };
	};

	const short = diagnosed("$FB $03 $06 $00 $04 c4");
	check(
		"SST0518 is a warning on the whole run, and on its line",
		short.found.length === 1 &&
			short.found[0].code === "SST0518" &&
			short.found[0].severity === "warning" &&
			short.found[0].span.line === 2 &&
			short.spanned[0] === "$FB $03 $06 $00 $04",
		short.spanned.join(),
	);
	check(
		"and says which note the sequence stops after",
		short.found[0]?.message.startsWith("This $FB's count is $03, but its sequence stops after note 2."),
		short.found[0]?.message,
	);

	const long = diagnosed("$FB $02 $06 $00 $04 $07 $0C c4");
	check("the notes over are in the span", long.spanned[0] === "$FB $02 $06 $00 $04 $07 $0C", long.spanned.join());
	check(
		"and in the count of notes",
		long.found[0]?.message.startsWith("This $FB's count is $02, but 4 notes follow its duration."),
		long.found[0]?.message,
	);

	check(
		"no notes at all is said in words of its own",
		diagnosed("$FB $02 $06 c4").found[0]?.message.startsWith("This $FB's count is $02, but no notes follow"),
	);

	const ambiguous = diagnosed("$FB $02 $06 $00 $E7 $80 c4").found[0]?.message ?? "";
	check("the command a count may have taken in is named", ambiguous.includes("takes in the $E7"), ambiguous);
}
