/** `selftest`: where commands written above the first `#N` go. */

import "../localize";
import { check, section } from "../harness";
import { compile, expectBytes } from "./support";

section("commands above the first channel");
{
	// Music.cpp:385-400 — the parser starts on the lowest `#N` found anywhere in
	// the text, probing `#0` up through `#7`, and stays on 0 without one. So what
	// is written above the first marker is that channel's own head, and the
	// echo-buffer prefix (`$FA $04`, `resizedChannel`) lands there with it.
	const one = compile("#amk 4\n$ED $7F $E0\n#1 d8\n");
	check("a #1-only song compiles", one.ok, one.diagnostics.map((d) => d.message).join("; "));
	if (one.data) {
		const view = new DataView(one.data.buffer, one.data.byteOffset);
		check("channel 0 has no phrase pointer", view.getUint16(6, true) === 0);
		check("channel 1 starts right after the header", view.getUint16(8, true) === 0x3e16);
		expectBytes(
			"the $ED above the first marker heads channel 1's body",
			one.data.slice(22),
			[0xfa, 0x04, 0x00, 0xfa, 0x06, 0x01, 0xed, 0x7f, 0xe0, 0x18, 0x7f, 0xa6, 0x00],
		);
		check("and the command map says channel 1", one.commandMap?.[0]?.channel === 1);
	}

	// `#0` declared later still wins the probe: lowest declared, not first.
	const later = compile("#amk 4\n$ED $7F $E0\n#1 d8\n#0 c8\n");
	expectBytes(
		"with a #0 further down, the $ED heads channel 0 instead",
		later.data!.slice(22),
		[0xfa, 0x04, 0x00, 0xfa, 0x06, 0x01, 0xed, 0x7f, 0xe0, 0x18, 0x7f, 0xa4, 0x00, 0x18, 0x7f, 0xa6, 0x00],
	);
	check("and the command map says channel 0", later.commandMap?.[0]?.channel === 0);

	// `q[channel]` and `instrument[channel]` survive the marker (parseHash resets
	// neither), so a `q` or a drum `@` written above it is what the channel's
	// first note goes out under.
	expectBytes(
		"a q above #0 is the q byte of #0's first note",
		compile("#amk 4\nq40\n#0 c8\n").data!.slice(22),
		[0xfa, 0x04, 0x00, 0xfa, 0x06, 0x01, 0x18, 0x40, 0xa4, 0x00],
	);
	// Music.cpp:684-687 — inside a `[ ]` body `q` writes `q[prevChannel]`, and
	// above the first marker `prevChannel` is the starting channel, so a remote
	// definition's `q` reaches it too.
	expectBytes(
		"and so is one inside a remote definition above #0",
		compile("#amk 4\n(!1)[q40 $F4 $09]\n#0 c8\n").data!.slice(22),
		[0xfa, 0x04, 0x00, 0xfa, 0x06, 0x01, 0x18, 0x40, 0xa4, 0x00, 0xf4, 0x09, 0x00],
	);
	expectBytes(
		"a percussion @ above #0 makes its first note the drum",
		compile("#amk 4\n@21\n#0 c8 d8\n").data!.slice(22),
		[0xfa, 0x04, 0x00, 0xfa, 0x06, 0x01, 0x18, 0x7f, 0xd0, 0xa6, 0x00],
	);

	// Music.cpp:569-570 — every `#N` resets `hTranspose`, so an `h` above the
	// first marker reaches nothing, and a channel written in two blocks does not
	// carry the first block's `h` into the second.
	expectBytes(
		"an h above #0 transposes nothing",
		compile("#amk 4\nh5\n#0 c8\n").data!.slice(22),
		[0xfa, 0x04, 0x00, 0xfa, 0x06, 0x01, 0x18, 0x7f, 0xa4, 0x00],
	);
	expectBytes(
		"a channel's second block starts with h reset",
		compile("#amk 4\n#0 h5 c8\n#1 d8\n#0 e8\n").data!.slice(22),
		[0xfa, 0x04, 0x00, 0xfa, 0x06, 0x01, 0x18, 0x7f, 0xa9, 0x18, 0xa8, 0x00, 0x18, 0x7f, 0xa6, 0x00],
	);
}
