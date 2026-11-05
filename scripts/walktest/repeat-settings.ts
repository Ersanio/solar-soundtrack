/** `walktest`: a setting that carries over into the repeat is reported. */

import "../localize";
import type { Diagnostic } from "@amk/core/types";
import { repeatSettings } from "../../web/src/app/state/repeat-carry";
import { check } from "../harness";
import { build } from "./support";
import { aramInRepeat } from "./longer-channel";

// ---------------------------------------------------------------------------
console.log("\na setting that carries over into the repeat is reported");
// ---------------------------------------------------------------------------
{
	// `PlaySong` sets every one of these only when a song starts
	// (`main.asm:2082-2206`), so what a pass ends on is what its repeat starts
	// under. Each is judged at the loop's first note or rest, and a channel's own
	// setting on that channel alone.
	const warn = (source: string) => {
		const { result, timeline } = build(source);
		return repeatSettings(timeline, { result, text: source });
	};

	const textOf = (source: string, warning: Diagnostic | undefined) =>
		warning ? source.slice(warning.span.start, warning.span.end) : "(none)";

	const song = (body: string) => `#amk 4\n${body}\n`;

	const changed = song("#0 v200 / o4 c4 v150 c4");
	const [warning] = warn(changed);
	check(
		"a channel setting changed inside the loop is SST0511 and severe",
		warning?.code === "SST0511" && warning.severity === "severe",
		warning?.code,
	);
	check("it points at the command that carries over", textOf(changed, warning) === "v150", textOf(changed, warning));
	check(
		"and names it, the channel and what the first pass had",
		["v150", "#0", "v200"].every((text) => warning?.message.includes(text) === true),
		warning?.message,
	);

	const [unset] = warn(song("#0 / o4 c4 v150 c4"));
	check(
		"one the first pass never set is measured against how a song starts",
		unset?.message.includes("as the song starts") === true,
		unset?.message,
	);

	const [flipped] = warn(song("#0 / o4 c4 $F4 $01 c4"));
	check(
		"a toggle switched an odd number of times says so",
		flipped?.message.includes("switched the other way") === true,
		flipped?.message,
	);

	const master = song("#0 w200 / o4 c4 w150 c4");
	const [wide] = warn(master);
	check(
		"a song setting is SST0512, and names no channel",
		wide?.code === "SST0512" && textOf(master, wide) === "w150" && !wide.message.includes("#"),
		wide?.message,
	);

	const quantized = song("#0 q7F o4 c4 / c4 q3F c4");
	const [q] = warn(quantized);
	check(
		"a q, which no command byte holds, is pointed at where it was written",
		textOf(quantized, q) === "q3F" && q?.message.includes("q7F") === true,
		`${textOf(quantized, q)} ${q?.message}`,
	);

	for (const [name, body, reported] of [
		["an @ inside the loop", "#0 @1 / o4 c4 @2 c4", true],
		["an @ at the loop start", "#0 @1 / @1 o4 c4 @2 c4", false],
		["an $ED inside the loop", "#0 @1 / o4 c4 $ED $8F $E0 c4", true],
		["an $F4 $09 that undoes it", "#0 @1 / o4 c4 $ED $8F $E0 c4 $F4 $09 c4", false],
		["an $ED on a channel that never writes an @", "#0 o4 c4 $ED $8F $E0 c4", true],
		["a drum at the loop start, which loads its own", "#0 @1 / @21 c4 @2 o4 c4", false],
		["a v the pass ends back on", "#0 v200 / o4 c4 v150 c4 v200 c4", false],
		["a volume fade, by its target", "#0 v200 / o4 c4 $E8 $10 $96 c4", true],
		["a y inside the loop", "#0 y10 / o4 c4 y5 c4", true],
		["a vibrato inside the loop", "#0 / o4 c4 p10,20,30 c4", true],
		["a vibrato the pass ends without", "#0 p10,20,30 / o4 c4 $DF c4", true],
		["a vibrato of no extent, which is none", "#0 / o4 c4 $DE $00 $10 $00 c4", false],
		["an $EE inside the loop", "#0 $EE $10 / o4 c4 $EE $20 c4", true],
		["an $EE after other commands, before the first note", "#0 / @0 v200 $EE $10 o4 c4 $EE $20 c4", false],
		["an $EE after a rest", "#0 / r4 $EE $10 o4 c4 $EE $20 c4", true],
		["with no /, an $EE the restart runs again", "#0 $EE $10 o4 c4 $EE $20 c4", false],
		["with no /, an $EE only partway", "#0 o4 c4 $EE $20 c4", true],
		["an $E5 inside the loop", "#0 / o4 c4 $E5 $00 $10 $40 c4", true],
		["a $FD where there was no tremolo", "#0 / o4 c4 $FD c4", false],
		["an $E5 of no depth, which is none", "#0 / o4 c4 $E5 $00 $10 $00 c4", false],
		["a pitch envelope inside the loop", "#0 / o4 c4 $EB $00 $10 $02 c4", true],
		["a $FE that ends it again", "#0 / o4 c4 $EB $00 $10 $02 c4 $FE c4", false],
		["a semitone tune inside the loop", "#0 / o4 c4 $FA $02 $01 c4", true],
		["an arpeggio inside the loop", "#0 / o4 c4 $FB $02 $04 $04 $07 c4", true],
		["an arpeggio switched off again", "#0 / o4 c4 $FB $02 $04 $04 $07 c4 $FB $00 $00 c4", false],
		["a glissando, which ends itself after two notes", "#0 / o4 c4 $FB $81 $04 $02 c4 c4 c4", false],
		["a volume multiplier inside the loop", "#0 / o4 c4 $FA $03 $40 c4", true],
		["a q inside the loop, with no intro to set it", "#0 q7F / o4 c4 q3F c4", false],
		["an n inside the loop", "#0 / o4 c4 n1F c4", true],
		["an n an @ silences again", "#0 / o4 c4 n1F c4 @0 c4", false],
		["legato switched twice", "#0 / o4 c4 $F4 $01 c4 $F4 $01 c4", false],
		["legato switched at the loop start, which flips both passes", "#0 / $F4 $01 o4 c4 c4", true],
		["remote code set inside the loop", "(!1)[$E7 $FF]\n#0 / o4 c4 (!1, -1) c4", true],
		["remote code cleared again", "(!1)[$E7 $FF]\n#0 / o4 c4 (!1, -1) c4 (!0, 0) c4", false],
		// Remote code a rest cannot read is judged at the loop's first note.
		["a key-on code set after the loop's first rest", "(!1)[$E7 $FF]\n#0 r4 (!1, -1) o4 c4", false],
		["a key-on code set after the loop's first note", "(!1)[$E7 $FF]\n#0 o4 c4 (!1, -1) c4", true],
		["a key-off code set after the loop's first rest", "(!1)[$E7 $FF]\n#0 r4 (!1, 3) o4 c4", false],
		["a key-off code with legato on into that rest", "(!1)[$E7 $FF]\n#0 $F4 $01 o4 c4 / r4 (!1, 3) c4", true],
		["a key-off code on a channel the pass cuts short", "(!1)[$E7 $FF]\n#0 o4 r4 c4\n#1 o4 r4 (!1, 3) c2", true],
		["a timer, which counts through that rest", "(!1)[$E7 $FF]\n#0 r4 (!1, 1, 8) o4 c4", true],
		["a timer cancelled at the loop start", "(!1)[$E7 $FF]\n#0 (!!1) r4 (!1, 1, 8) o4 c4", false],
		["a key-on code cancelled at the loop start", "(!1)[$E7 $FF]\n#0 (!!-1) o4 c4 (!1, -1) c4", false],
		["a type the driver never runs", "(!1)[$E7 $FF]\n#0 o4 c4 (!1, 9) c4", false],
		["a w the pass ends back on", "#0 w200 / o4 c4 w150 c4 w200 c4", false],
		["an $E4 inside the loop", "#0 / o4 c4 $E4 $01 c4", true],
		["echo turned on inside the loop", "#0 / o4 c4 $EF $FF $30 $30 c4", true],
		["echo set before the loop", "#0 $EF $FF $30 $30 / o4 c4 c4", false],
		["one channel's echo switched inside the loop", "#0 $EF $00 $30 $30 / o4 c4 $F4 $03 c4", true],
		["an echo filter inside the loop", "#0 / o4 c4 $F5 $7F $00 $00 $00 $00 $00 $00 $00 c4", true],
		["pitch modulation inside the loop", "#0 / o4 c4 $FA $00 $02 c4", true],
		["the velocity table changed inside the loop", "#0 / o4 c4 $FA $06 $00 c4", true],
		["light staccato switched once", "#0 / o4 c4 $F4 $02 c4", true],
		["Yoshi drums switched once", "#0 / o4 c4 $F4 $06 c4", true],
		["a hot patch inside the loop", "#0 / o4 c4 $FA $FE $01 c4", true],
		["a song that does not loop", "#option noloop\n#0 v200 o4 c4 v150 c4", false],
	] as const) {
		const found = warn(song(body));
		check(
			`${name}: ${reported ? "reported" : "quiet"}`,
			found.length === (reported ? 1 : 0),
			found.map((each) => each.message).join(" | "),
		);
	}

	const bounded = song("#0 / o4 c4 v150 c4\n#1 / v150 o4 c4 c4");
	const others = warn(bounded);
	check(
		"another channel's v at its loop start does not cover this one",
		others.length === 1 && others[0].message.includes("#0") && others[0].span.start < bounded.indexOf("#1"),
		others.map((each) => each.message).join(" | "),
	);
	check(
		"a song setting at the loop start on another channel covers the song",
		warn(song("#0 / o4 c4 c4\n#1 / w150 o4 c4 c4")).length === 0,
	);
	check(
		"and one partway through another channel is reported",
		warn(song("#0 / o4 c4 c4\n#1 / o4 c4 w150 c4")).length === 1,
	);
	check(
		"an @ that both changes the instrument and silences an n is reported once",
		warn(song("#0 n1F / o4 c4 @2 c4")).length === 1,
	);

	// Remote code is told by its type, and named with the reset that cancels it.
	for (const [name, source, words] of [
		["a key-on code", song("(!1)[$E7 $FF]\n#0 o4 c4 (!1, -1) c4"), ["(!!-1)", "key-on code"]],
		["a timer", song("(!1)[$E7 $FF]\n#0 r4 (!1, 1, 8) o4 c4"), ["(!!1)", "counts through rests"]],
		["a key-off code at a note", song("(!1)[$E7 $FF]\n#0 o4 c4 (!1, 3) c4"), ["(!!3)", "keeps sounding"]],
		[
			"a key-off code at a rest",
			song("(!1)[$E7 $FF]\n#0 $F4 $01 o4 c4 / r4 (!1, 3) c4"),
			["(!!3)", "rings on through it"],
		],
		["a timer under #amk 2", "#amk 2\n(!1)[$E7 $FF]\n#0 o4 c4 (!1, 1, 8) c4\n", ["(!0, 7)"]],
		["a key-on code under #amk 2", "#amk 2\n(!1)[$E7 $FF]\n#0 o4 c4 (!1, -1) c4\n", ["(!0, 8)"]],
		[
			"a call where the first pass had another",
			song("(!1)[$E7 $FF]\n(!2)[$E7 $80]\n#0 (!1, 3) / o4 c4 (!2, 3) c4"),
			["instead of (!1, 3)"],
		],
	] as const) {
		const [found] = warn(source);
		check(
			`${name} is worded for it`,
			words.every((each) => found?.message.includes(each) === true),
			found?.message,
		);
	}

	// The running driver is the oracle, a few ticks into the repeat and before
	// the loop's own commands on its 48th tick. On the tick the pass ends the
	// voices run in order and the first `$00` ends the phrase
	// (`main.asm:2337-2346`), so a command at the very end of `#0` runs and the
	// same one at the end of `#1` does not.
	for (const [name, body, read, expected, reported] of [
		[
			"a v at the end of #0",
			"#0 v200 / o4 c4 v150 c4 v200\n#1 / o4 c4 c4",
			(aram: Uint8Array) => aram[0x0241],
			200,
			false,
		],
		[
			"a v at the end of #1",
			"#0 / o4 c4 c4\n#1 v200 / o4 c4 v150 c4 v200",
			(aram: Uint8Array) => aram[0x0243],
			150,
			true,
		],
		// `$C1+x` holds the instrument plus one (`Commands.asm:107-109`).
		["an @ inside the loop", "#0 @1 / o4 c4 @2 c4", (aram: Uint8Array) => aram[0xc1], 3, true],
		["legato switched once", "#0 / o4 c4 $F4 $01 c4", (aram: Uint8Array) => aram[0x0161] & 1, 1, true],
		["echo channels set inside the loop", "#0 / o4 c4 $EF $03 $30 $30 c4", (aram: Uint8Array) => aram[0x4c], 3, true],
		["a w inside the loop", "#0 w200 / o4 c4 w150 c4", (aram: Uint8Array) => aram[0x57], 150, true],
		["an $E4 inside the loop", "#0 / o4 c4 $E4 $01 c4", (aram: Uint8Array) => aram[0x43], 1, true],
		[
			"an $EE at the end of #0",
			"#0 $EE $10 / o4 c4 $EE $20 c4 $EE $10\n#1 / o4 c4 c4",
			(aram: Uint8Array) => aram[0x02d1],
			0x10,
			false,
		],
		[
			"an $EE at the end of #1",
			"#0 / o4 c4 c4\n#1 $EE $10 / o4 c4 $EE $20 c4 $EE $10",
			(aram: Uint8Array) => aram[0x02d3],
			0x20,
			true,
		],
		[
			"an $E5 at the end of #0",
			"#0 $E5 $00 $10 $40 / o4 c4 $FD c4 $E5 $00 $10 $40\n#1 / o4 c4 c4",
			(aram: Uint8Array) => aram[0xb1],
			0x40,
			false,
		],
		[
			"an $E5 at the end of #1",
			"#0 / o4 c4 c4\n#1 $E5 $00 $10 $40 / o4 c4 $FD c4 $E5 $00 $10 $40",
			(aram: Uint8Array) => aram[0xb3],
			0,
			true,
		],
		// A rest runs no key-on code, so the loop's `v255` stands through it.
		[
			"a key-on code set after the loop's first rest",
			"(!1)[$E7 $30]\n#0 v255 r4 (!1, -1) o4 c4",
			(aram: Uint8Array) => aram[0x0241],
			255,
			false,
		],
		// `!PlayingVoices` ($0382): a key-off code keeps the voice on through the
		// loop's first rest only where a note is still sounding into it.
		[
			"a key-off code on a channel the pass cuts short",
			"(!1)[$E7 $FF]\n#0 o4 r4 c4\n#1 o4 r4 (!1, 3) c2",
			(aram: Uint8Array) => aram[0x0382] & 0x02,
			0x02,
			true,
		],
		[
			"that channel with no remote code",
			"#0 o4 r4 c4\n#1 o4 r4 c2",
			(aram: Uint8Array) => aram[0x0382] & 0x02,
			0,
			false,
		],
		[
			"a key-off code with legato on into the loop",
			"(!1)[$E7 $FF]\n#0 $F4 $01 o4 c4 / r4 (!1, 3) c4",
			(aram: Uint8Array) => aram[0x0382] & 0x01,
			0x01,
			true,
		],
		[
			"that legato with no remote code",
			"#0 $F4 $01 o4 c4 / r4 c4",
			(aram: Uint8Array) => aram[0x0382] & 0x01,
			0,
			false,
		],
		[
			"a key-off code with neither",
			"(!1)[$E7 $FF]\n#0 r4 (!1, 3) o4 c4",
			(aram: Uint8Array) => aram[0x0382] & 0x01,
			0,
			false,
		],
	] as const) {
		const source = song(body);
		const { aram } = aramInRepeat(source);
		const heard = aram === null ? null : read(aram);
		const found = warn(source).length;
		check(
			`with ${name}, the driver carries what the walk says`,
			heard === expected && found === (reported ? 1 : 0),
			`driver ${heard}, ${found} reported`,
		);
	}
}
