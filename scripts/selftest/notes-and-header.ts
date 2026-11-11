/** `selftest`: the minimal looping song byte for byte, how a note is encoded, and a long note split into ties. */

import "../localize";
import { check, section } from "../harness";
import { compile, expectBytes } from "./support";

// ---------------------------------------------------------------------------

section("minimal song, no intro, loops");
{
	// One channel, one quarter-note C in octave 4.
	const result = compile("#amk 4\n#0 @0 o4 c4\n");
	check("compiles", result.ok, result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));

	if (result.data) {
		// Header: add = 0 (no intro) + 2 (loops) + 4 = 6, instrLen = 0, size = 22.
		//   [0]  word -> add+instrLen = 6, relocated  = 0x3E06
		//   [2]  0xFFFE                              -> 0x00FF
		//   [4]  0xFFFC -> song base                 -> 0x3E00
		//   [6]  channel 0 phrase ptr = 0 + 22 = 22  -> 0x3E16
		//   [8..20] unused channels                  -> 0x0000
		const header = result.data.slice(0, 22);
		// The pairing is the documentation here — each line is one little-endian
		// word and the comment names it. Prettier puts one byte per line, which
		// separates every word from its own annotation.
		// prettier-ignore
		expectBytes(
			"header",
			header,
			[
				0x06, 0x3e, // pointer to the phrase pointer block
				0xff, 0x00, // loop marker
				0x00, 0x3e, // loop target = song base
				0x16, 0x3e, // channel 0
				0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
				0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			],
		);

		// Channel body: FA 04 00 (echo alloc) FA 06 01 (N-SPC vtable)
		//               DA 00 (instrument) 30 7F A4 (48 ticks, q, note) 00 (end)
		// c in octave 4 = pitches['c'] + (4-1)*12 + 0x80 = 0 + 0x24 + 0x80 = 0xA4.
		expectBytes(
			"channel 0 body",
			result.data.slice(22),
			[0xfa, 0x04, 0x00, 0xfa, 0x06, 0x01, 0xda, 0x00, 0x30, 0x7f, 0xa4, 0x00],
		);
	}
}

section("note encoding");
{
	const result = compile("#amk 4\n#0 o4 c4 c4 d8\n");
	// Second c4 reuses the previous length, so no duration byte is emitted.
	// Note bytes: c in octave 4 = 0 + 3*12 + 0x80 = 0xA4, d = 0xA6.
	// Instrument 0 has transpose 0, so no adjustment.
	expectBytes("duration is omitted when unchanged", result.data!.slice(28), [0x30, 0x7f, 0xa4, 0xa4, 0x18, 0xa6, 0x00]);
}

section("long notes split into ties");
{
	const result = compile("#amk 4\n#0 o4 c1\n");
	// 192 ticks exceeds the 0x80 note-length limit, so Music.cpp:2245 emits a
	// 0x60 head and ties the rest. The remainder is exactly 0x60, so the
	// `if (j != 0x60)` guard suppresses a redundant duration byte before the tie.
	expectBytes("whole note", result.data!.slice(28), [0x60, 0x7f, 0xa4, 0xc6, 0x00]);

	// 0x60 + 0x60 = 192 ticks total.
	const longer = compile("#amk 4\n#0 o4 c1^2\n");
	// 288 ticks: 0x60 head, then one full tie, then a 0x60 remainder tie.
	expectBytes("dotted-whole via tie", longer.data!.slice(28), [0x60, 0x7f, 0xa4, 0xc6, 0xc6, 0x00]);
}
