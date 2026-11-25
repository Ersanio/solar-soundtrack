/** `xmtest`: the XM reader — the header, packed and unpacked cells, delta-coded 8- and 16-bit samples, a ping-pong loop laid out forward, instruments and their keymaps, a cut file, what is refused, and an XM inside a UMX. */

import { detectFormat } from "@amk/import/format";
import { XmError, readXm } from "@amk/import/xm";
import { readXmFile } from "@amk/import/xm/file";
import { unwrapUmx } from "@amk/import/umx";
import { check, section } from "../harness";
import { umxBytes } from "../modtest/support";
import { pattern, square, xmBytes } from "./support";

const SIMPLE = {
	instruments: [{ samples: [{ pcm: square(32, 8), loopStart: 0, loopLength: 256 }] }],
	orders: [0],
	patterns: [pattern([[0, 0, { note: "C-4", instrument: 1 }]])],
};

section("reader: header and cells");

{
	const bytes = xmBytes({ ...SIMPLE, title: "Hello", channels: 6, speed: 4, bpm: 140, restart: 0, linear: false });
	const file = readXmFile(bytes);
	check("an XM is detected as one", detectFormat(bytes) === "xm");
	check(
		"the title, channels, speed, BPM and frequency table are read",
		file.title === "Hello" && file.channels === 6 && file.speed === 4 && file.bpm === 140 && !file.linear,
		JSON.stringify({ ...file, patterns: undefined, instruments: undefined }),
	);
}

{
	const file = readXmFile(
		xmBytes({
			...SIMPLE,
			patterns: [
				pattern([
					[0, 0, { note: "A#5", instrument: 1, volume: 0x30, effect: "A", param: 0x0f }],
					[1, 1, { volume: 0xc8 }],
					[2, 2, { note: 97 }],
				]),
			],
		}),
	);
	const [a, b, c] = [file.patterns[0][0][0], file.patterns[0][1][1], file.patterns[0][2][2]];
	check(
		"a full cell is read",
		a.note === 71 && a.instrument === 1 && a.volume === 0x30 && a.effect === 10 && a.param === 0x0f,
		JSON.stringify(a),
	);
	check("a volume alone", b.note === 0 && b.volume === 0xc8, JSON.stringify(b));
	check("a key off", c.note === 97, JSON.stringify(c));
	check("an empty cell is empty", file.patterns[0][5][0].note === 0 && file.patterns[0][5][0].effect === 0);
}

section("reader: samples and instruments");

{
	const ramp = Array.from({ length: 64 }, (_, i) => i * 4 - 128);
	const wide = Array.from({ length: 64 }, (_, i) => i * 1000 - 32000);
	const file = readXmFile(
		xmBytes({
			instruments: [
				{
					name: "two",
					samples: [
						{ pcm: ramp, relativeNote: -12, finetune: -64 },
						{ pcm: wide, sixteen: true, volume: 40 },
					],
					keymap: Array.from({ length: 96 }, (_, i) => (i < 48 ? 0 : 1)),
					fadeout: 500,
				},
				{ samples: [] },
				{ samples: [{ pcm: [0, 10, 20, 30, 40, 50, 60, 70], loopStart: 2, loopLength: 4, pingPong: true }] },
			],
			orders: [0],
			patterns: [pattern([])],
		}),
	);
	const [one, none, pong] = file.instruments;
	check(
		"8-bit delta frames are decoded and scaled by 256",
		one.samples[0].pcm.every((v, i) => v === ramp[i] * 256),
	);
	check(
		"16-bit delta frames are decoded",
		one.samples[1].pcm.every((v, i) => v === wide[i]),
	);
	check(
		"a relative note, a finetune, a volume and a fadeout",
		one.samples[0].relativeNote === -12 &&
			one.samples[0].finetune === -64 &&
			one.samples[1].volume === 40 &&
			one.fadeout === 500,
	);
	check("the keymap", one.keymap[47] === 0 && one.keymap[48] === 1);
	check("an instrument with no samples is kept empty", none.samples.length === 0);
	check(
		"a ping-pong loop is laid out forward, its turns not doubled",
		[...pong.samples[0].pcm].map((v) => v / 256).join() === "0,10,20,30,40,50,40,30" &&
			pong.samples[0].loopStart === 2 &&
			pong.samples[0].loopLength === 6,
		[...pong.samples[0].pcm].map((v) => v / 256).join(),
	);
	check("each sample has its number in the song", one.samples[1].index === 2 && pong.samples[0].index === 3);
}

{
	const bytes = xmBytes(SIMPLE);
	const cut = readXmFile(bytes.subarray(0, bytes.length - 56));
	check(
		"a file cut inside its samples keeps what is there",
		cut.truncated && cut.instruments[0].samples[0].pcm.length === 200,
		String(cut.instruments[0].samples[0].pcm.length),
	);
}

section("reader: refusals and UMX");

{
	const bad = xmBytes(SIMPLE);
	bad[58] = 0x05;
	let code: string | null = null;
	try {
		readXm(bad);
	} catch (error) {
		code = error instanceof XmError ? error.code : null;
	}

	check("a version FT2 does not read is refused", code === "not-xm");
	const inner = unwrapUmx(umxBytes([{ payload: xmBytes(SIMPLE), format: "xm" }], 68));
	check("a UMX holding an XM unwraps to it", inner.format === "xm" && readXm(inner.bytes).song.channels === 4);
}

section("reader: songs");

{
	// Order 0 loops on itself; order 1 runs off the end, past the restart order.
	const xm = readXm(
		xmBytes({
			...SIMPLE,
			orders: [0, 1],
			restart: 0,
			patterns: [
				pattern([
					[0, 0, { note: "C-4", instrument: 1 }],
					[63, 0, { effect: "B", param: 0 }],
				]),
				pattern([[0, 1, { note: "E-4", instrument: 1 }]]),
			],
		}),
	);
	const second = xm.songs[1];
	check("an order the first song never plays starts a second", xm.songs.map((s) => s.order).join() === "0,1");
	check(
		"which wraps to its own start rather than the restart order",
		second.play.segments.map((s) => s.order).join() === "1" && second.play.loopTick === 0 && !second.play.tooLong,
		JSON.stringify(second.play.segments),
	);
}
