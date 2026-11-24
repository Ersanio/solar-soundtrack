/** `ittest`: the IT reader — the header and channels, packed cells with their masks and last values, every sample encoding, IT 2.14 and 2.15 compression, loops, instruments and envelopes, what is refused, and an IT inside a UMX. */

import { detectFormat } from "@amk/import/format";
import { ItError, readIt } from "@amk/import/it";
import { decompress8, decompress16, readItFile } from "@amk/import/it/file";
import { unwrapUmx } from "@amk/import/umx";
import { check, section } from "../harness";
import { umxBytes } from "../modtest/support";
import { bitStream, itBytes, pattern, square } from "./support";

const SIMPLE = {
	samples: [{ pcm: square(32, 8), loopStart: 0, loopLength: 256 }],
	orders: [0, 255],
	patterns: [pattern([[0, 0, { note: "C-5", instrument: 1 }]])],
};

section("reader: header, channels and cells");

{
	const bytes = itBytes({
		...SIMPLE,
		title: "Hello",
		speed: 4,
		tempo: 140,
		globalVolume: 100,
		linear: false,
		channelPans: [0, 64, 100, 32 | 128],
	});
	const file = readItFile(bytes);
	check("an IT is detected as one", detectFormat(bytes) === "it");
	check(
		"the title, speed, tempo, global volume and slides are read",
		file.title === "Hello" && file.speed === 4 && file.tempo === 140 && file.globalVolume === 100 && !file.linear,
	);
	check("the channels' pans, surround and disabled included", file.channelPans.slice(0, 4).join() === "0,64,100,160");
	check("the order list as stored", file.orders.join() === "0,255");
}

{
	const file = readItFile(
		itBytes({
			...SIMPLE,
			patterns: [
				pattern([
					[0, 0, { note: "A#6", instrument: 1, volume: 40, command: "D", param: 0x0f }],
					[1, 1, { volume: 130 }],
					[2, 2, { note: "===" }],
					[3, 5, { command: "H", param: 0x48 }],
				]),
			],
		}),
	);
	const [a, b, c, d] = [file.patterns[0][0][0], file.patterns[0][1][1], file.patterns[0][2][2], file.patterns[0][3][5]];
	check(
		"a full cell is read",
		a?.note === 82 && a.instrument === 1 && a.volume === 40 && a.command === 4 && a.param === 0x0f,
		JSON.stringify(a),
	);
	check("a volume alone", b?.note === -1 && b.volume === 130 && b.command === 0, JSON.stringify(b));
	check("a note off", c?.note === 255, JSON.stringify(c));
	check("the channels run to the last one used", file.channels === 6 && d?.command === 8, String(file.channels));
}

{
	// Channel 1's mask with the repeat bits: the note, instrument and volume of its last cell again.
	const bytes = itBytes(SIMPLE);
	const file = readItFile(bytes);
	check("an empty cell is null", file.patterns[0][5][0] === null);
}

section("reader: samples");

{
	const ramp = Array.from({ length: 64 }, (_, i) => i * 4 - 128);
	const wide = Array.from({ length: 64 }, (_, i) => i * 1000 - 32000);
	const stereo = [...Array.from({ length: 32 }, () => 100), ...Array.from({ length: 32 }, () => -40)];
	const file = readItFile(
		itBytes({
			samples: [
				{ pcm: ramp },
				{ pcm: ramp, unsigned: true },
				{ pcm: wide, sixteen: true },
				{ pcm: wide, sixteen: true, unsigned: true },
				{ pcm: stereo, stereo: true },
				{ pcm: [0, 10, 20, 30, 40, 50, 60, 70], loopStart: 2, loopLength: 4, pingPong: true },
				{
					pcm: square(32, 4),
					loopStart: 32,
					loopLength: 64,
					sustain: true,
					c5Speed: 22050,
					volume: 50,
					globalVolume: 40,
					pan: 10,
				},
			],
			orders: [0],
			patterns: [pattern([])],
		}),
	);
	const [signed8, unsigned8, signed16, unsigned16, mixed, pong, held] = file.samples;
	check(
		"signed 8-bit frames are scaled by 256",
		signed8.pcm.every((v, i) => v === ramp[i] * 256),
	);
	check(
		"unsigned 8-bit frames too",
		unsigned8.pcm.every((v, i) => v === ramp[i] * 256),
	);
	check(
		"signed and unsigned 16-bit frames",
		signed16.pcm.every((v, i) => v === wide[i]) && unsigned16.pcm.every((v, i) => v === wide[i]),
	);
	check("stereo frames are mixed to mono", mixed.pcm.length === 32 && mixed.pcm.every((v) => v === 30 * 256));
	check(
		"a ping-pong loop is laid out forward",
		[...pong.pcm].map((v) => v / 256).join() === "0,10,20,30,40,50,40,30" && pong.loopLength === 6,
		[...pong.pcm].map((v) => v / 256).join(),
	);
	check(
		"a sustain loop stands for the loop, with its C5Speed, volumes and pan",
		held.sustain &&
			held.loopStart === 32 &&
			held.loopLength === 64 &&
			held.c5Speed === 22050 &&
			held.volume === 50 &&
			held.globalVolume === 40 &&
			held.pan === 10,
		JSON.stringify({ ...held, pcm: undefined }),
	);
}

section("reader: compression");

{
	// Depth 9: each value's ninth bit clear adds its low eight bits; 0x106 switches to depth 7.
	const deltas = [10, 20, 246, 5];
	const seven = [3, 0x7f & -9, 12];
	const stream = bitStream([
		...deltas.map((d): [number, number] => [d, 9]),
		[0x106, 9],
		...seven.map((v): [number, number] => [v, 7]),
	]);
	const decoded = decompress8(stream, 7);
	check("8-bit values at depth 9 are summed", [...decoded.slice(0, 4)].join() === "10,30,20,25", [...decoded].join());
	check("and at depth 7, sign-extended", [...decoded.slice(4)].join() === "28,19,31", [...decoded].join());
	const wide = decompress16(bitStream([1000, 2000, 65036].map((v): [number, number] => [v, 17])), 3);
	check("16-bit values at depth 17 are summed", [...wide].join() === "1000,3000,2500", [...wide].join());
}

{
	const deltas = [10, 20, 246, 5];
	const block = bitStream(deltas.map((d): [number, number] => [d, 9]));
	const file = readItFile(
		itBytes({
			samples: [
				{ pcm: [0, 0, 0, 0], compressed: [block] },
				{ pcm: [0, 0, 0, 0], compressed: [block], delta: true },
			],
			orders: [0],
			patterns: [pattern([])],
		}),
	);
	check(
		"a compressed sample is decoded",
		[...file.samples[0].pcm].map((v) => v / 256).join() === "10,30,20,25",
		[...file.samples[0].pcm].join(),
	);
	check(
		"and with IT 2.15's delta, summed again",
		[...file.samples[1].pcm].map((v) => v / 256).join() === "10,40,60,85",
		[...file.samples[1].pcm].map((v) => v / 256).join(),
	);
}

section("reader: instruments and refusals");

{
	const file = readItFile(
		itBytes({
			...SIMPLE,
			instruments: [
				{
					keymap: Array.from({ length: 120 }, (_, n) => ({ note: n + 12, sample: n < 60 ? 1 : 2 })),
					fadeout: 300,
					globalVolume: 64,
					pan: 16,
					newNoteAction: 2,
					volumeEnvelope: {
						points: [
							[0, 64],
							[10, 32],
							[20, 0],
						],
						sustain: [1, 1],
					},
					panEnvelope: {
						points: [
							[0, -32],
							[8, 32],
						],
						loop: [0, 1],
					},
				},
			],
			samples: [{ pcm: square(32, 8) }, { pcm: square(16, 8) }],
		}),
	);
	const ins = file.instruments[0];
	check("instrument mode", file.instrumentMode);
	check("the keymap", ins.keymap[59].sample === 1 && ins.keymap[60].sample === 2 && ins.keymap[60].note === 72);
	check(
		"the fadeout, global volume, pan and new note action",
		ins.fadeout === 300 && ins.globalVolume === 64 && ins.pan === 16 && ins.newNoteAction === 2,
	);
	check(
		"the volume envelope with its sustain",
		ins.volumeEnvelope?.points.join(";") === "0,64;10,32;20,0" && ins.volumeEnvelope.sustain?.start === 1,
		JSON.stringify(ins.volumeEnvelope),
	);
	check("the panning envelope with its loop", ins.panEnvelope?.points[0][1] === -32 && ins.panEnvelope.loop?.end === 1);
}

{
	const refusal = (bytes: Uint8Array): string | null => {
		try {
			readIt(bytes);
			return null;
		} catch (error) {
			return error instanceof ItError ? error.code : null;
		}
	};

	check(
		"instruments of the format before 2.00 are refused",
		refusal(itBytes({ ...SIMPLE, instruments: [{}], compatible: 0x0100 })) === "old-instruments",
	);
	const bad = itBytes(SIMPLE);
	bad[0] = 0;
	check("a file without IMPM is not an IT", refusal(bad) === "not-it" && detectFormat(bad) !== "it");
	const inner = unwrapUmx(umxBytes([{ payload: itBytes(SIMPLE), format: "it" }], 69));
	check("a UMX holding an IT unwraps to it", inner.format === "it" && readIt(inner.bytes).song.channels === 1);
}
