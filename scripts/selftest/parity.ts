/** `selftest`: parity against AddmusicKsrc, a case per behaviour. */

import "../localize";
import { check, section } from "../harness";
import { compile, LIBRARY } from "./support";

section("parity against AddmusicKsrc");
{
	// Music.cpp:535 — `?1` and `?2` set `noMusic[][]`, which the reference never
	// reads. Only `?` and `?0` stop the song looping. The digit is consumed, so
	// `?1` neither kills the loop nor leaves a stray `1`.
	const bare = compile("#amk 4\n#0 ? o4 c4\n");
	const zero = compile("#amk 4\n#0 ?0 o4 c4\n");
	const one = compile("#amk 4\n#0 ?1 o4 c4\n");
	const two = compile("#amk 4\n#0 ?2 o4 c4\n");
	check("? compiles", bare.ok, bare.diagnostics.map((d) => d.message).join("; "));
	check(
		"?1 compiles with no stray-character diagnostic",
		one.ok && one.diagnostics.length === 0,
		one.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);
	check("? stops the song looping", bare.stats?.loops === false);
	check("?0 stops the song looping", zero.stats?.loops === false);
	check("?1 leaves looping alone", one.stats?.loops === true, `loops=${one.stats?.loops}`);
	check("?2 leaves looping alone", two.stats?.loops === true, `loops=${two.stats?.loops}`);

	// Music.cpp:1217 guards this with a lookbehind that can never be true, so
	// the reference compiles a subloop inside a label-loop definition.
	const labelSubloop = compile("#amk 4\n#0 o4 (5)[ c4 [[d4]]4 ]\n");
	check(
		"a subloop inside a label loop compiles, as in AMK",
		labelSubloop.ok,
		labelSubloop.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);

	// Music.cpp:3493 — a declared length must switch guessing off, or the
	// estimate wins and the declared value is recorded but never used.
	const declared = compile('#amk 4\n#spc { #length "1:30" }\n#0 o4 c4\n');
	check('#length "1:30" is 90 seconds', declared.stats?.tagSeconds === 90, `${declared.stats?.tagSeconds}`);
	// AMK leaves intro/main at zero for a declared length, so its own readout
	// prints 0:00. We report what the author wrote instead; the tag is untouched.
	check(
		"a declared #length is also the play length",
		declared.stats?.introSeconds === 90 && declared.stats?.mainSeconds === 0,
		`${declared.stats?.introSeconds}+${declared.stats?.mainSeconds}`,
	);
	const auto = compile('#amk 4\n#spc { #length "auto" }\n#0 o4 c1 c1 c1\n');
	check('#length "auto" still estimates', (auto.stats?.tagSeconds ?? 0) > 0, `${auto.stats?.tagSeconds}`);
	const badLength = compile('#amk 4\n#spc { #length "90" }\n#0 o4 c4\n');
	check("a malformed #length is rejected", !badLength.ok && badLength.diagnostics.some((d) => d.code === "AMK0066"));
	const tooLong = compile('#amk 4\n#spc { #length "20:00" }\n#0 o4 c4\n');
	check("a length past 16:39 is rejected", !tooLong.ok && tooLong.diagnostics.some((d) => d.code === "AMK0067"));

	// Music.cpp:3253-3262 — two different lengths come out of one estimate. Four
	// whole notes at t96 are 4*192 ticks / (2*96) = 4 seconds of music, and the
	// ID666 tag carries 8 because it counts the loop twice before the fade.
	const plain = compile("#amk 4\n#0 o4 t96 a1 g1 e1 e1\n");
	check(
		"a 4-second loop estimates as 4 seconds",
		plain.stats?.introSeconds === 0 && plain.stats?.mainSeconds === 4,
		`intro=${plain.stats?.introSeconds} main=${plain.stats?.mainSeconds}`,
	);
	check("its ID666 tag counts the loop twice", plain.stats?.tagSeconds === 8, `${plain.stats?.tagSeconds}`);

	// An intro is counted once and the loop twice, so 2+2 seconds tags as 6.
	const intro = compile("#amk 4\n#0 o4 t96 a1 a1 / a1 a1\n");
	check(
		"an intro and its loop are reported apart",
		intro.stats?.introSeconds === 2 && intro.stats?.mainSeconds === 2,
		`intro=${intro.stats?.introSeconds} main=${intro.stats?.mainSeconds}`,
	);
	check("an intro tags as intro + two loops", intro.stats?.tagSeconds === 6, `${intro.stats?.tagSeconds}`);

	// Music.cpp:809 — a tempo fade makes the length unguessable, and all of the
	// figures have to go, not just the tag.
	const faded = compile("#amk 4\n#0 o4 t20,96 c1\n");
	check(
		"a tempo fade leaves every length unknown",
		faded.ok &&
			faded.stats?.tagSeconds === null &&
			faded.stats?.introSeconds === null &&
			faded.stats?.mainSeconds === null,
		`${faded.stats?.tagSeconds}/${faded.stats?.introSeconds}/${faded.stats?.mainSeconds}`,
	);
	check("and no playback timing either", faded.stats?.playback === null, `${JSON.stringify(faded.stats?.playback)}`);

	// The driver's real rate is (tempo + 1) * 500/256 ticks a second, not the
	// 2 * tempo AddmusicK rounds it to — 768 ticks at t96 run 4.0538s, not 4.
	// `audiotest` measures this against the emulator; here it is just arithmetic.
	const played = (ticks: number, tempo: number) => (ticks * 256) / (500 * (tempo + 1));
	check(
		"playback timing uses the driver's rate, not the estimate",
		Math.abs(plain.stats!.playback!.mainSeconds - played(768, 96)) < 1e-9,
		`${plain.stats?.playback?.mainSeconds} vs ${played(768, 96)}`,
	);
	const drift = plain.stats!.playback!.mainSeconds / plain.stats!.mainSeconds!;
	check("which runs longer than AddmusicK's figure", drift > 1.01 && drift < 1.03, `${drift}`);
	check(
		"the intro is timed the same way",
		Math.abs(intro.stats!.playback!.introSeconds - played(384, 96)) < 1e-9 &&
			Math.abs(intro.stats!.playback!.mainSeconds - played(384, 96)) < 1e-9,
		JSON.stringify(intro.stats?.playback),
	);

	// Each segment carries its own tempo, so the two rates cannot differ by one
	// constant factor across a song that changes tempo part-way.
	const shifting = compile("#amk 4\n#0 o4 t192 c1 c1 t16 c1 c1\n");
	check(
		"a tempo change is timed segment by segment",
		Math.abs(shifting.stats!.playback!.mainSeconds - (played(384, 192) + played(384, 16))) < 1e-9,
		`${shifting.stats?.playback?.mainSeconds}`,
	);

	// A declared length has no ticks to time, so it stands in for itself.
	check(
		"a declared #length is its own playback length",
		declared.stats?.playback?.introSeconds === 90 && declared.stats?.playback?.mainSeconds === 0,
		JSON.stringify(declared.stats?.playback),
	);

	// Channels may carry their `/` at different points. AddmusicK reassigns
	// introLength on every one and so ends up holding whichever channel was parsed
	// last, while the length estimate splits at the first — a different place in
	// the song. Taking the boundary from anywhere but the first contradicts the
	// seconds reported beside it, and a transport built on the pair maps the whole
	// first pass onto the wrong scale and then wraps to the wrong bar.
	//
	// Channel 0 turns over at 384 ticks here and channel 1 at 192, so the two
	// rules disagree and the wrong one shows.
	const staggered = compile("#amk 4\n#0 t192 @0 o4 q7F a1 a1 / g1 g1\n#1 @1 o3 q7F c1 / d1 d1 d1\n");
	check(
		"the intro ends at the first / in the file",
		staggered.stats?.introTicks === 384,
		`${staggered.stats?.introTicks} ticks`,
	);
	check(
		"and the loop is what is left of the shortest channel",
		staggered.stats?.loopTicks === 384,
		`${staggered.stats?.loopTicks} ticks`,
	);
	// Two views of one boundary, so they have to land in the same place.
	const split = staggered.stats!.playback!;
	check(
		"the tick split agrees with the seconds split",
		Math.abs(
			staggered.stats!.introTicks / (staggered.stats!.introTicks + staggered.stats!.loopTicks) -
				split.introSeconds / (split.introSeconds + split.mainSeconds),
		) < 1e-9,
		`${staggered.stats?.introTicks}/${staggered.stats?.loopTicks} vs ${split.introSeconds}/${split.mainSeconds}`,
	);

	// Music.cpp:3528 — ID666 gives each text field 32 bytes.
	const longTitle = compile(`#amk 4\n#spc { #title "${"x".repeat(40)}" }\n#0 o4 c4\n`);
	check(
		"an over-long title is truncated to 32",
		longTitle.stats?.tags.title?.length === 32,
		`${longTitle.stats?.tags.title?.length}`,
	);
	check(
		"truncation warns",
		longTitle.diagnostics.some((d) => d.code === "AMK0205"),
	);

	// globals.cpp:667 — the one escape the format allows.
	const escaped = compile('#amk 4\n#spc { #title "a \\"b\\" c" }\n#0 o4 c4\n');
	check(
		'\\" survives inside a quoted string',
		escaped.stats?.tags.title === 'a "b" c',
		JSON.stringify(escaped.stats?.tags.title),
	);
	const badEscape = compile('#amk 4\n#spc { #title "a \\n b" }\n#0 o4 c4\n');
	check("any other escape is rejected", !badEscape.ok && badEscape.diagnostics.some((d) => d.code === "AMK0068"));

	// Music.cpp:1826 — a sample load past the stock group needs #samples first.
	const am4Sample = compile("#am4\n#0 o4 $E5 $94 $02 c4\n");
	check(
		"am4 $E5 sample load past $13 without #samples is rejected",
		!am4Sample.ok && am4Sample.diagnostics.some((d) => d.code === "AMK0131"),
		am4Sample.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);
	const am4Stock = compile("#am4\n#0 o4 $E5 $85 $02 c4\n");
	check(
		"am4 $E5 sample load within the stock group is fine",
		am4Stock.ok,
		am4Stock.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);

	// A failing block directive must consume the rest of its block, or the scanner
	// reads the body as MML and buries the real diagnostic in nonsense.
	const unsupported = compile('#amk 4\n#samples { "x.wav" }\n#0 o4 c4\n', 0x3e00, LIBRARY);
	check(
		"a bad #samples entry reports exactly one error",
		unsupported.diagnostics.filter((d) => d.severity === "error").length === 1,
		unsupported.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
	);
}
