/** `selftest`: which notes the `@21`-`@29` drum remap folds into. */

import "../localize";
import { section } from "../harness";
import { compile, expectBytes } from "./support";

section("which notes the drum remap folds into");
{
	// `instrument[channel]` is written by `@` alone (Music.cpp:908), copied into
	// the loop block by `[` and never copied back (Music.cpp:1239), and cleared
	// by the first pitched note it folds unless the channel is #6 or #7 under
	// #amk (Music.cpp:2178-2183). `tokentest` mirrors every song here on the
	// source side; these are the bytes it mirrors.
	const PREFIX = [0xfa, 0x04, 0x00, 0xfa, 0x06, 0x01];
	const body = (source: string) => compile(source).data!.slice(22);

	expectBytes("on #0 the first note is the drum and the second is not", body("#amk 4\n#0 @21 c8 d8\n"), [
		...PREFIX,
		0x18,
		0x7f,
		0xd0,
		0xa6,
		0x00,
	]);
	expectBytes("on #6 both are", body("#amk 4\n#6 @21 c8 d8\n"), [...PREFIX, 0x18, 0x7f, 0xd0, 0xd0, 0x00]);
	// #am4's own prefix is `$FA $7F $04`; the notes are what is being pinned.
	expectBytes(
		"under #am4 #6 clears like any other channel",
		body("#am4\n#6 @21 c8 d8\n").slice(6),
		[0x18, 0x7f, 0xd0, 0xa6, 0x00],
	);
	expectBytes("a rest is not folded and clears nothing", body("#amk 4\n#0 @21 r8 c8\n"), [
		...PREFIX,
		0x18,
		0x7f,
		0xc7,
		0xd0,
		0x00,
	]);

	// The `[ ]` copy: `E9 <ptr> 02` is the call, and the loop block follows the channel.
	expectBytes("a drum @ inside a [ ] does not survive the ]", body("#amk 4\n#0 [ @21 c8 ]2 d8\n"), [
		...PREFIX,
		0xe9,
		0x24,
		0x3e,
		0x02,
		0x18,
		0x7f,
		0xa6,
		0x00,
		0x18,
		0x7f,
		0xd0,
		0x00,
	]);
	expectBytes("and a body's @0 does not reach past it either", body("#amk 4\n#0 @21 [ @0 c8 ]2 d8\n"), [
		...PREFIX,
		0xe9,
		0x24,
		0x3e,
		0x02,
		0x18,
		0x7f,
		0xd0,
		0x00,
		0xda,
		0x00,
		0x18,
		0x7f,
		0xa4,
		0x00,
	]);
	expectBytes(
		"so a body's first note clears the copy and the note after is still a drum",
		body("#amk 4\n#0 @21 [ c8 ]2 d8\n"),
		[...PREFIX, 0xe9, 0x24, 0x3e, 0x02, 0x18, 0x7f, 0xd0, 0x00, 0x18, 0x7f, 0xd0, 0x00],
	);
	expectBytes("where a [[ ]] body's @0 is the channel's own", body("#amk 4\n#0 @21 [[ @0 c8 ]]2 d8\n"), [
		...PREFIX,
		0xe6,
		0x00,
		0xda,
		0x00,
		0x18,
		0x7f,
		0xa4,
		0xe6,
		0x01,
		0x18,
		0x7f,
		0xa6,
		0x00,
	]);
	expectBytes("and a [[ ]] inside a [ ] works on the copy", body("#amk 4\n#0 [ c8 [[ @21 d8 ]]2 e8 ]2 f8\n"), [
		...PREFIX,
		0xe9,
		0x24,
		0x3e,
		0x02,
		0x18,
		0x7f,
		0xa9,
		0x00,
		0x18,
		0x7f,
		0xa4,
		0xe6,
		0x00,
		0x18,
		0x7f,
		0xd0,
		0xe6,
		0x01,
		0x18,
		0x7f,
		0xa8,
		0x00,
	]);

	// A raw `$DA` emits and leaves `instrument[channel]` alone.
	expectBytes("a $DA between two notes on #6 leaves the second a drum", body("#amk 4\n#6 @21 c8 $DA $00 d8\n"), [
		...PREFIX,
		0x18,
		0x7f,
		0xd0,
		0xda,
		0x00,
		0xd0,
		0x00,
	]);
	expectBytes("and on #0 the first note has already cleared it", body("#amk 4\n#0 @21 c8 $DA $00 d8\n"), [
		...PREFIX,
		0x18,
		0x7f,
		0xd0,
		0xda,
		0x00,
		0xa6,
		0x00,
	]);
}
