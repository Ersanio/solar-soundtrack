/** `selftest`: `#instruments` and `@30` upwards. */

import "../localize";
import { check, section } from "../harness";
import { compile, LIBRARY, expectBytes } from "./support";

section("#instruments and @30+");
{
	const ENTRY = "$8F $E0 $00 $02 $B0"; // ADSR1, ADSR2, GAIN, tuning hi, tuning lo
	const withDefault = (body: string) => `#amk 4\n#samples { #default }\n${body}`;

	const one = compile(withDefault(`#instruments { @0 ${ENTRY} }\n#0 o4 @30 c4\n`), 0x3e00, LIBRARY);
	check("a custom instrument compiles", one.ok, one.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));

	// add = 0 (no intro) + 2 (loops) + 4 = 6, so the six instrument bytes sit at
	// header[6..12) and the channel pointer table starts at 12.
	check("the header grew by exactly six bytes", one.stats?.headerSize === 28, `${one.stats?.headerSize}`);
	if (one.data) {
		// @0's sample is instrToSample[0] = 0x00.
		expectBytes(
			"the instrument block is sample + five bytes",
			one.data.slice(6, 12),
			[0x00, 0x8f, 0xe0, 0x00, 0x02, 0xb0],
		);
		const word0 = one.data[0] | (one.data[1] << 8);
		check("header word 0 points past the instrument block", word0 === 0x3e00 + 12, `0x${word0.toString(16)}`);
		const channel0 = one.data[12] | (one.data[13] << 8);
		check(
			"the channel pointer relocated correctly",
			channel0 === 0x3e00 + one.stats!.headerSize,
			`0x${channel0.toString(16)}`,
		);
		check("@30 emits $DA $1E", [...one.data].includes(0x1e) && [...one.data].includes(0xda));
	}

	// The relocation walk steps over the instrument block using a byte counter,
	// and that path has never run with a non-empty block. All four header shapes
	// use a different `add`, so each moves the block somewhere else.
	for (const [body, label, headerSize] of [
		[`#instruments { @0 ${ENTRY} }\n#0 o4 @30 c4\n`, "loops, no intro", 28],
		[`#instruments { @0 ${ENTRY} }\n#0 o4 @30 c4 ?\n`, "no loop, no intro", 26],
		[`#instruments { @0 ${ENTRY} }\n#0 o4 @30 c4 / d4\n`, "loops, intro", 46],
		[`#instruments { @0 ${ENTRY} }\n#0 o4 @30 c4 / d4 ?\n`, "no loop, intro", 44],
	] as const) {
		const result = compile(withDefault(body), 0x3e00, LIBRARY);
		check(`${label}: compiles`, result.ok, result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
		check(
			`${label}: header is ${headerSize} bytes`,
			result.stats?.headerSize === headerSize,
			`${result.stats?.headerSize}`,
		);
		if (!result.data) {
			continue;
		}

		// Wherever the block landed, word 0 must point just past it, and every
		// channel pointer must land inside the song rather than in the header.
		const add = (result.stats!.hasIntro ? 2 : 0) + (result.stats!.loops ? 2 : 0) + 4;
		expectBytes(
			`${label}: block sits at header[${add}]`,
			result.data.slice(add, add + 6),
			[0x00, 0x8f, 0xe0, 0x00, 0x02, 0xb0],
		);
		const word0 = result.data[0] | (result.data[1] << 8);
		check(`${label}: word 0 = base + ${add + 6}`, word0 === 0x3e00 + add + 6, `0x${word0.toString(16)}`);
		const channel0 = result.data[add + 6] | (result.data[add + 7] << 8);
		check(
			`${label}: channel 0 points into the song`,
			channel0 >= 0x3e00 + result.stats!.headerSize,
			`0x${channel0.toString(16)} vs header end 0x${(0x3e00 + result.stats!.headerSize).toString(16)}`,
		);
	}

	// Two entries, so @31 is reachable and the stride is verifiable.
	const two = compile(withDefault(`#instruments { @0 ${ENTRY} n05 ${ENTRY} }\n#0 o4 @31 c4\n`), 0x3e00, LIBRARY);
	check(
		"two entries compile and @31 resolves",
		two.ok,
		two.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);
	check("the block is twelve bytes", two.stats?.headerSize === 34, `${two.stats?.headerSize}`);
	if (two.data) {
		// Noise sets the high bit: $05 | $80 = $85 (Music.cpp:2618).
		expectBytes("the noise entry stores $85", two.data.slice(12, 18), [0x85, 0x8f, 0xe0, 0x00, 0x02, 0xb0]);
	}

	// A quoted name resolves to an index into this song's own sample list.
	const named = compile(
		`#amk 4\n#samples { #default "kick.brr" }\n#instruments { "kick.brr" ${ENTRY} }\n#0 o4 @30 c4\n`,
		0x3e00,
		LIBRARY,
	);
	check("a quoted name compiles", named.ok, named.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
	check("it resolves to SRCN 20, its slot in this song", named.data?.[6] === 20, `${named.data?.[6]}`);

	for (const [source, code, label] of [
		[`#amk 4\n#instruments { "kick.brr" ${ENTRY} }\n#0 c4\n`, "AMK0089", "a name not in #samples"],
		[withDefault(`#instruments { @30 ${ENTRY} }\n#0 c4\n`), "AMK0103", "@30 as a base instrument"],
		[withDefault(`#instruments { n20 ${ENTRY} }\n#0 c4\n`), "AMK0105", "a noise pitch past $1F"],
		[withDefault("#instruments { @0 $8F $E0 $00 $02 }\n#0 c4\n"), "AMK0087", "only four bytes"],
		[withDefault(`#instruments ( @0 ${ENTRY} )\n#0 c4\n`), "AMK0051", "a missing brace"],
		[withDefault(`#instruments { %0 ${ENTRY} }\n#0 c4\n`), "AMK0106", "an unexpected character"],
		[withDefault(`#instruments { @0 ${ENTRY} }\n#0 o4 @31 c4\n`), "AMK0092", "@31 with one entry defined"],
	] as const) {
		const result = compile(source, 0x3e00, LIBRARY);
		check(
			`${label} is rejected with ${code}`,
			!result.ok && result.diagnostics.some((d) => d.code === code),
			result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
		);
	}

	// Music.cpp:880 — the convert remap turns @@19 into @30, so it starts
	// resolving against #instruments the moment @30+ is allowed at all.
	const doubleAt = compile(withDefault(`#instruments { @0 ${ENTRY} }\n#0 o4 @@19 c4\n`), 0x3e00, LIBRARY);
	check(
		"@@19 remaps to @30 and resolves",
		doubleAt.ok,
		doubleAt.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);
	check("@@19 emits $DA $1E", doubleAt.data ? [...doubleAt.data.slice(12)].includes(0x1e) : false);
}
