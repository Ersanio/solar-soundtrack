/** `s3mtest`: the S3M reader — the channels kept and their panning, packed cells, every sample encoding, the loop, the order markers, a file cut short, what is refused, and an S3M inside a UMX. */

import { detectFormat } from "@amk/import/format";
import { S3mError, readS3m } from "@amk/import/s3m";
import { readS3mFile } from "@amk/import/s3m/file";
import { unwrapUmx } from "@amk/import/umx";
import { check, section } from "../harness";
import { umxBytes } from "../modtest/support";
import { pattern, s3mBytes, square } from "./support";

const SIMPLE = {
	samples: [{ pcm: square(32, 8), loopStart: 0, loopLength: 256 }],
	orders: [0],
	patterns: [pattern([[0, 0, { note: "C-4", instrument: 1 }]])],
};

section("reader: header and channels");

{
	const bytes = s3mBytes({ ...SIMPLE, title: "Hello", speed: 4, tempo: 140, globalVolume: 48 });
	const file = readS3mFile(bytes);
	check("an S3M is detected as one", detectFormat(bytes) === "s3m");
	check(
		"the title, speed, tempo and global volume are read",
		file.title === "Hello" && file.speed === 4 && file.tempo === 140 && file.globalVolume === 48,
	);
	check("four PCM channels are kept", file.channels === 4, String(file.channels));
	check("left channels pan left and right ones right", file.pans.join() === "51,204,51,204", file.pans.join());
}

{
	// Settings: PCM left 0, disabled, AdLib melody 16, PCM right 8.
	const file = readS3mFile(
		s3mBytes({
			...SIMPLE,
			settings: [0, 255, 16, 8],
			patterns: [pattern([[0, 3, { note: "D-4", instrument: 1 }]])],
		}),
	);
	check("disabled and AdLib channels are left out", file.channels === 2, String(file.channels));
	check(
		"a cell on the fourth channel lands on the second kept one",
		file.patterns[0][0][1]?.note === 0x42 && file.patterns[0][0][0] === null,
	);
}

{
	const file = readS3mFile(s3mBytes({ ...SIMPLE, pans: [0x20 | 7, 0x20 | 15, 0x05, 0] }));
	check(
		"the pan table sets a channel where its 0x20 bit is set",
		file.pans.join() === "119,255,51,204",
		file.pans.join(),
	);
	const mono = readS3mFile(s3mBytes({ ...SIMPLE, stereo: false, pans: [0x20 | 15] }));
	check(
		"a mono song centres every channel",
		mono.pans.every((p) => p === 128),
		mono.pans.join(),
	);
}

section("reader: cells");

{
	const file = readS3mFile(
		s3mBytes({
			...SIMPLE,
			patterns: [
				pattern([
					[0, 0, { note: "A#5", instrument: 1, volume: 40, command: "D", info: 0x0f }],
					[1, 1, { volume: 12 }],
					[2, 2, { command: "H", info: 0x48 }],
					[3, 0, { note: "^^" }],
				]),
			],
		}),
	);
	const [a, b, c, d] = [file.patterns[0][0][0], file.patterns[0][1][1], file.patterns[0][2][2], file.patterns[0][3][0]];
	check(
		"a full cell is read",
		a?.note === 0x5a && a.instrument === 1 && a.volume === 40 && a.command === 4 && a.info === 0x0f,
		JSON.stringify(a),
	);
	check("a volume alone", b?.note === 255 && b.volume === 12 && b.command === 0, JSON.stringify(b));
	check(
		"a command alone",
		c?.note === 255 && c.volume === 255 && c.command === 8 && c.info === 0x48,
		JSON.stringify(c),
	);
	check("a cut", d?.note === 254, JSON.stringify(d));
	check("an empty cell is null", file.patterns[0][5][0] === null);
}

section("reader: samples");

{
	const ramp = Array.from({ length: 64 }, (_, i) => i * 4 - 128);
	const wide = Array.from({ length: 64 }, (_, i) => i * 1000 - 32000);
	const stereo = [...Array.from({ length: 32 }, () => 100), ...Array.from({ length: 32 }, () => -40)];
	for (const ffi of [1, 2]) {
		const file = readS3mFile(
			s3mBytes({
				ffi,
				samples: [
					{ pcm: ramp },
					{ pcm: wide, sixteen: true },
					{ pcm: stereo, stereo: true },
					{ pcm: square(32, 4), loopStart: 32, loopLength: 64, c2spd: 22050, volume: 50 },
					{ pcm: [], adlib: true },
				],
				orders: [0],
				patterns: [pattern([])],
			}),
		);
		const [eight, sixteen, mixed, looped, adlib] = file.samples;
		const kind = ffi === 1 ? "signed" : "unsigned";
		check(
			`${kind} 8-bit frames are scaled by 256`,
			eight.pcm.every((v, i) => v === ramp[i] * 256),
			String(eight.pcm.slice(0, 4)),
		);
		check(
			`${kind} 16-bit frames are read as they are`,
			sixteen.pcm.every((v, i) => v === wide[i]),
			String(sixteen.pcm.slice(0, 4)),
		);
		check(
			`${kind} stereo frames are mixed to mono`,
			mixed.pcm.length === 32 && mixed.pcm.every((v) => v === 30 * 256),
			String(mixed.pcm.slice(0, 4)),
		);
		check(
			`${kind}: a loop, a C2SPD and a volume`,
			looped.loopStart === 32 && looped.loopLength === 64 && looped.c2spd === 22050 && looped.volume === 50,
			JSON.stringify({ ...looped, pcm: undefined }),
		);
		check(`${kind}: an AdLib instrument has no frames`, adlib.adlib && adlib.pcm.length === 0);
		check(`${kind}: a volume of 64 is held to ST3's 63`, eight.volume === 63, String(eight.volume));
	}
}

{
	const file = readS3mFile(
		s3mBytes({ samples: [{ pcm: square(32, 2), c2spd: 0 }], orders: [0], patterns: [pattern([])] }),
	);
	check("a C2SPD of 0 plays at 8363", file.samples[0].c2spd === 8363, String(file.samples[0].c2spd));
}

{
	const bytes = s3mBytes({ samples: [{ pcm: square(32, 8) }], orders: [0], patterns: [pattern([])] });
	const cut = readS3mFile(bytes.subarray(0, bytes.length - 100));
	check(
		"a file cut inside its samples keeps what is there",
		cut.truncated && cut.samples[0].pcm.length === 156,
		String(cut.samples[0].pcm.length),
	);
}

section("reader: orders and refusals");

{
	const file = readS3mFile(s3mBytes({ ...SIMPLE, orders: [0, 254, 0, 255, 0] }));
	check("the order list is kept as stored, markers and all", file.orders.join() === "0,254,0,255,0");
	const s3m = readS3m(s3mBytes({ ...SIMPLE, orders: [0, 254, 0, 255, 0] }));
	check("254 is skipped and 255 ends the song: two passes", s3m.play.ticks === 2 * 64 * 6, String(s3m.play.ticks));
	check("the song lists three orders", s3m.song.orders === 3, String(s3m.song.orders));
}

{
	const notS3m = s3mBytes(SIMPLE);
	notS3m[44] = 0x41;
	let code: string | null = null;
	try {
		readS3m(notS3m);
	} catch (error) {
		code = error instanceof S3mError ? error.code : null;
	}

	check("a file without SCRM at 44 is refused", code === "not-s3m" && detectFormat(notS3m) !== "s3m");
}

{
	const bytes = s3mBytes(SIMPLE);
	const inner = unwrapUmx(umxBytes([{ payload: bytes, format: "s3m" }], 61));
	check("a UMX holding an S3M unwraps to it", inner.format === "s3m" && inner.bytes.length === bytes.length);
	check("and it reads", readS3m(inner.bytes).song.channels === 4);
}
