/** `walktest`: what a note's pitch depends on, and the notes, vibratos and arpeggios past what their instrument can play (`SST0513`-`SST0515`). */

import "../localize";
import { readInstrumentTables } from "@amk/spc/instruments";
import { pitchRange } from "../../web/src/app/state/pitch-range";
import { check, section } from "../harness";
import { build, driver } from "./support";

const tables = readInstrumentTables(driver.programData, driver.manifest.programPos);

/** Every finding on a song, as its code, the text under its span and its message. */
const findings = (body: string): { code: string; text: string; message: string }[] => {
	const source = `#amk 2\n${body}\n`;
	const { result, timeline } = build(source);
	return pitchRange(timeline, result, tables).map((d) => ({
		code: d.code,
		text: source.slice(d.span.start, d.span.end),
		message: d.message,
	}));
};

const spell = (found: { code: string; text: string }[]): string => found.map((f) => `${f.code}@${f.text}`).join(" ");

// ---------------------------------------------------------------------------
section("the walk reports what a note's pitch depends on");
// ---------------------------------------------------------------------------
{
	const { timeline } = build(
		"#amk 2\n#0 @0 o4 c4 $EE $40 c4 $F3 $00 $03 c4 @1 c4 $FB $02 $06 $00 $04 c4 $FB $00 $00 c4 p6,12,34 c4 $EA $10 c4\n",
	);
	const states = timeline.notes.map((note) => note.state);
	check("$EE's byte is the fine tune", states.map((s) => s.fineTune).join(",") === "0,64,64,64,64,64,64,64");
	check(
		"a $F3 is loaded until a $DA",
		states.map((s) => (s.sampleLoaded ? 1 : 0)).join("") === "00100000",
		states.map((s) => (s.sampleLoaded ? 1 : 0)).join(""),
	);
	check(
		"an $FB with a count is an arpeggio, and one without ends it",
		states.map((s) => (s.arpeggio ? 1 : 0)).join("") === "00001000",
		states.map((s) => (s.arpeggio ? 1 : 0)).join(""),
	);
	check(
		"$EA's ticks are the vibrato's fade, and $DE's is none",
		states[6].vibrato?.fade === 0 && states[7].vibrato?.fade === 16 && states[7].vibrato?.depth === 34,
	);

	// A remote body is read as the driver reads it, to its `$00`: one that only sets GAIN leaves the
	// pitch to the walk, and one with a `$FA $02` does not.
	const gain = build("#amk 2\n(!1)[$FA $01 $9F]\n#0 (!1, -1) @0 o4 c4 c4\n").timeline.notes;
	const tune = build("#amk 2\n(!1)[$FA $02 $05]\n#0 @0 o4 c4 (!1, -1) c4\n").timeline.notes;
	check(
		"a GAIN-only remote body moves no pitch",
		gain.every((note) => !note.state.remotePitch),
	);
	check("one with a $FA $02 does, from its call on", !tune[0].state.remotePitch && tune[1].state.remotePitch);
}

// ---------------------------------------------------------------------------
section("a note past its instrument's range is SST0513");
// ---------------------------------------------------------------------------
{
	// `@0` multiplies by 6, so o6 f passes the DSP's fourteen bits and wraps round to o1 b.
	const wraps = findings("#0 @0 o6 e4 f4");
	check("o6 e plays true and o6 f does not, on its own span", spell(wraps) === "SST0513@f4", spell(wraps));
	check(
		"named by the highest true note and what is heard",
		wraps[0]?.message ===
			"This note is above o6 e, the highest pitch @0 can play: past that the SNES runs out of pitch and the note comes out as about o1 b instead. Write it lower, or play it on an instrument tuned lower.",
		wraps[0]?.message,
	);

	const yours = findings("#0 @0 o6 p44,255 a4 a4 a4 $DF");
	check(
		"each note of a run is its own, and a vibrato on a note already out of range adds nothing",
		spell(yours) === "SST0513@a4 SST0513@a4 SST0513@a4" && yours.every((f) => f.message.includes("about o4 g+")),
		spell(yours),
	);

	const shifted = findings("#0 $FA $02 $05 @0 o6 c4");
	check(
		"named in the frame the note is written in",
		shifted[0]?.message.startsWith("This note is above o5 b,") && shifted[0]?.message.includes("about o1 f+"),
		shifted[0]?.message,
	);

	check(
		"transposed past o7 b, it plays nothing",
		findings("#0 $FA $02 $0F @0 o6 a4")[0]?.message ===
			"This note is transposed above o6 g+, the highest pitch the driver can play, so it plays nothing. Write it lower, or transpose it less.",
	);
	check(
		"and below o1 c likewise",
		findings("#0 $FA $02 $F4 @0 o1 c4")[0]?.message ===
			"This note is transposed below o2 c, the lowest pitch the driver can play, so it plays nothing. Write it higher, or transpose it less.",
	);

	check(
		"every stock drum plays true",
		findings("#0 @21 c4 @22 c4 @23 c4 @24 c4 @25 c4 @26 c4 @27 c4 @28 c4 @29 c4").length === 0,
	);
	check(
		"and is judged at its own entry's pitch: @22's o4 c, four octaves up, plays nothing",
		findings("#0 $FA $02 $30 @22 c4")[0]?.message.startsWith("This note is transposed above") === true,
		spell(findings("#0 $FA $02 $30 @22 c4")),
	);
	check("a note played three times is one finding", findings("#0 [@0 o6 f4]3").length === 1);

	// `@30` and up take their tuning from the song's own `#instruments`, in the order written.
	const custom = findings("#instruments { @1 $FF $E0 $B8 $02 $00 @0 $FF $E0 $B8 $06 $00 }\n#0 @30 o6 f4 @31 o6 f4");
	check(
		"a custom instrument is judged by its own multiplier, @31 by the second entry",
		spell(custom) === "SST0513@f4" &&
			custom[0]?.message.startsWith("This note is above o6 e, the highest pitch @31 can play"),
		custom[0]?.message,
	);
	check(
		"and a custom noise instrument is left alone",
		findings("#instruments { n1F $FF $E0 $B8 $06 $00 }\n#0 @30 o6 a4").length === 0,
	);
}

// ---------------------------------------------------------------------------
section("a vibrato that swings a note past its range is SST0514");
// ---------------------------------------------------------------------------
{
	const wraps = findings("#0 @1 p44,255 o6 a1");
	check("on the note it swings", spell(wraps) === "SST0514@a1", spell(wraps));
	check(
		"named by the highest true note",
		wraps[0]?.message ===
			"The vibrato on this note swings it up past o7 e, the highest pitch @1 can play: at the top of each swing the SNES runs out of pitch and the note drops far lower. Make the vibrato's depth smaller, or play the note lower.",
		wraps[0]?.message,
	);
	check(
		"each note under the one vibrato is its own, and a note played twice is one",
		spell(findings("#0 @1 p44,255 o6 a1 a1 o4 c1")) === "SST0514@a1 SST0514@a1" &&
			findings("#0 @1 p44,255 [o6 a1]2").length === 1,
		spell(findings("#0 @1 p44,255 o6 a1 a1 o4 c1")),
	);
	// `$FF` crests at 3825/256 semitones, so the o6 a above stops 15/256 short of o8 c, and `$EE $10`
	// carries it over, where the octave counter shifts the pitch to nothing.
	check(
		"a crest past o7 b is silent",
		findings("#0 @1 $EE $10 p44,255 o6 a1")[0]?.message ===
			"The vibrato on this note swings it up past o7 b, the highest pitch the driver can play: the top of each swing is silent. Make the vibrato's depth smaller, or play the note lower.",
		findings("#0 @1 $EE $10 p44,255 o6 a1")[0]?.message,
	);
	check(
		"and a dip below o1 c",
		findings("#0 @0 p44,255 o1 e1")[0]?.message ===
			"The vibrato on this note swings it down below o1 c, the lowest pitch the driver can play: the bottom of each swing is silent. Make the vibrato's depth smaller, or play the note higher.",
		findings("#0 @0 p44,255 o1 e1")[0]?.message,
	);

	// Only what the phase reaches before the key-off counts.
	check("a slow rate on a short note never gets there", findings("#0 @1 p1,255 o6 a8").length === 0);
	check("nor does a delay longer than the note", findings("#0 @1 $DE $30 $2C $FF o6 a8").length === 0);
	check(
		"and a fade, which the walk does not follow, is left alone",
		findings("#0 @1 p44,255 $EA $10 o6 a1").length === 0,
	);
}

// ---------------------------------------------------------------------------
section("an arpeggio that takes a note past its range is SST0515");
// ---------------------------------------------------------------------------
{
	const high =
		"The arpeggio on this note plays it at o6 g, above o6 e, the highest pitch @0 can play: past that the SNES runs out of pitch and that step comes out as about o3 a+ instead. Make the arpeggio's steps smaller, or play the note lower.";
	const sequence = findings("#0 @0 $FB $02 $06 $00 $0C o5 g4");
	check(
		"a sequence's step, on the note, named by the step and what is heard",
		spell(sequence) === "SST0515@g4" && sequence[0]?.message === high,
		sequence[0]?.message,
	);
	check(
		"a trill's the same",
		spell(findings("#0 @0 $FB $80 $06 $0C o5 g4")) === "SST0515@g4",
		spell(findings("#0 @0 $FB $80 $06 $0C o5 g4")),
	);

	// Sixteen steps of a semitone in a half note: o6 c climbs to o7 e.
	const glissando = findings("#0 @0 $FB $81 $06 $01 o6 c2 d4");
	check(
		"a glissando's highest step, and nothing on the note after it ends",
		spell(glissando) === "SST0515@c2" &&
			glissando[0]?.message.startsWith("The arpeggio on this note plays it at o7 e,"),
		glissando[0]?.message,
	);
	check(
		"a step below o1 c is silent",
		findings("#0 @0 $FB $81 $06 $FF o1 e2")[0]?.message ===
			"The arpeggio on this note takes it below o1 c, the lowest pitch the driver can play, so those steps play nothing. Make the arpeggio's steps smaller, or play the note higher.",
		findings("#0 @0 $FB $81 $06 $FF o1 e2")[0]?.message,
	);
	check(
		"and one far enough below sounds somewhere else",
		findings("#0 @0 $FB $01 $06 $9C o2 c4")[0]?.message ===
			"The arpeggio on this note takes it below o1 c, the lowest pitch the driver can play, and that step comes out as about o4 e instead. Make the arpeggio's steps smaller, or play the note higher.",
		findings("#0 @0 $FB $01 $06 $9C o2 c4")[0]?.message,
	);
	check(
		"a step past o7 b is silent",
		findings("#0 @1 $FB $01 $06 $18 o6 a4")[0]?.message ===
			"The arpeggio on this note takes it above o7 b, the highest pitch the driver can play, so those steps play nothing. Make the arpeggio's steps smaller, or play the note lower.",
		findings("#0 @1 $FB $01 $06 $18 o6 a4")[0]?.message,
	);
	check(
		"an instrument with no true pitch is named as one",
		findings("#instruments { @0 $FF $E0 $B8 $FF $00 }\n#0 @30 $FB $01 $06 $0C o4 c4")[0]?.message ===
			"@30 is tuned too high for the SNES to play any note true, so every step of the arpeggio on this note comes out wrong. Play it on an instrument tuned lower.",
	);
	check(
		"named in the frame the note is written in",
		findings("#0 $FA $02 $05 @0 $FB $01 $06 $0C o5 c4")[0]?.message.startsWith(
			"The arpeggio on this note plays it at o6 c, above o5 b,",
		) === true,
	);

	// The written pitch is heard only where a step plays it.
	check(
		"o6 f is not judged where no step plays it, and the step that is, is",
		spell(findings("#0 @0 $FB $01 $06 $0C o6 f4")) === "SST0515@f4",
		spell(findings("#0 @0 $FB $01 $06 $0C o6 f4")),
	);
	check(
		"where a step does, SST0513 says it, and a step that also wraps adds nothing",
		spell(findings("#0 @0 $FB $02 $06 $00 $04 o6 f4")) === "SST0513@f4",
		spell(findings("#0 @0 $FB $02 $06 $00 $04 o6 f4")),
	);
	check(
		"a step the note is too short to reach is not judged",
		findings("#0 @0 $FB $02 $30 $00 $0C o5 g8").length === 0,
	);
	check("nor a note too short for any step", findings("#0 @0 $FB $02 $06 $00 $0C o6 f=2").length === 0);
	check("a note played three times is one finding", findings("#0 @0 $FB $02 $06 $00 $0C [o5 g4]3").length === 1);
	check(
		"and a vibrato under one is not judged, each step restarting it",
		spell(findings("#0 @0 p44,255 $FB $01 $06 $00 o6 a1")) === "SST0513@a1",
		spell(findings("#0 @0 p44,255 $FB $01 $06 $00 o6 a1")),
	);
}

// ---------------------------------------------------------------------------
section("a note whose tuning the walk cannot vouch for is left alone");
// ---------------------------------------------------------------------------
{
	check("under a $F3, until a $DA", spell(findings("#0 @0 $F3 $00 $03 o6 f4 @0 o6 f4")) === "SST0513@f4");
	check("a drum under an arpeggio", findings("#0 @0 $FB $02 $06 $00 $0C @21 c4").length === 0);
	check(
		"a glissando under a hot-patch preset past the table",
		findings("#0 $FA $7F $08 @0 $FB $81 $06 $18 o6 c4").length === 0,
	);
	check(
		"under a remote body that moves the pitch, and not under one that only sets GAIN",
		findings("(!1)[$FA $02 $05]\n#0 (!1, -1) @0 o6 f4").length === 0 &&
			findings("(!1)[$FA $01 $9F]\n#0 (!1, -1) @0 o6 f4").length === 1,
	);
}
