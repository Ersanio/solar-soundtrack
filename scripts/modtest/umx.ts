/** `modtest`: a UMX unwrapped to its module at every package version's layout, the module named by its signature, and each refusal. */

import { detectFormat } from "@amk/import/format";
import { UmxError, type UmxErrorCode, isUmx, unwrapUmx } from "@amk/import/umx";
import { check, section } from "../harness";
import { C2, PERIODS, imported, modBytes, pattern, problems, square, umxBytes } from "./support";

const MOD = modBytes({
	samples: [{ pcm: square(32, 8), loopStart: 0, loopLength: 256 }],
	orders: [0],
	patterns: [
		pattern([
			[0, 0, { period: C2, sample: 1 }],
			[16, 1, { period: PERIODS[19], sample: 1 }],
			[32, 0, { period: PERIODS[24], sample: 1 }],
		]),
	],
});

const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** The code `unwrapUmx` refuses `bytes` with, or `null` where it does not. */
function refusal(bytes: Uint8Array): UmxErrorCode | null {
	try {
		unwrapUmx(bytes);
		return null;
	} catch (error) {
		return error instanceof UmxError ? error.code : null;
	}
}

section("umx: package versions");

for (const version of [35, 61, 62, 64, 69, 100, 120]) {
	const umx = umxBytes([{ payload: MOD }], version);
	check(`version ${version} is detected as a UMX`, detectFormat(umx) === "umx" && isUmx(umx));
	const inner = unwrapUmx(umx);
	check(`version ${version}: the MOD inside, byte for byte`, inner.format === "mod" && equal(inner.bytes, MOD));
	const imp = imported(inner.bytes);
	check(
		`version ${version}: it imports and raises nothing`,
		problems(imp.song).length === 0,
		problems(imp.song).join("; "),
	);
	check(`version ${version}: and assembles`, imp.song.spc instanceof Uint8Array, String(imp.song.spc));
}

section("umx: the module's format");

{
	const it = new Uint8Array(256);
	it.set([..."IMPM"].map((c) => c.charCodeAt(0)));
	const xm = new Uint8Array(256);
	xm.set([..."Extended Module: "].map((c) => c.charCodeAt(0)));
	const s3m = new Uint8Array(256);
	s3m.set(
		[..."SCRM"].map((c) => c.charCodeAt(0)),
		44,
	);
	check("an IT is named it", unwrapUmx(umxBytes([{ payload: it, format: "it" }])).format === "it");
	check("an XM is named xm", unwrapUmx(umxBytes([{ payload: xm, format: "xm" }])).format === "xm");
	check("an S3M is named s3m", unwrapUmx(umxBytes([{ payload: s3m, format: "s3m" }])).format === "s3m");
	check(
		"the signature names the format, not the package",
		unwrapUmx(umxBytes([{ payload: MOD, format: "s3m" }])).format === "mod",
	);
	const mp2 = new Uint8Array(512).fill(0x55);
	mp2.set([0xff, 0xf3]);
	check(
		"the first Music object holding a module is the one taken",
		equal(unwrapUmx(umxBytes([{ payload: mp2, format: "mp2" }, { payload: MOD }])).bytes, MOD),
	);
	check("recorded audio is refused as audio", refusal(umxBytes([{ payload: mp2, format: "mp2" }])) === "audio");
}

section("umx: refusals");

{
	const umx = umxBytes([{ payload: MOD }]);
	const badMagic = new Uint8Array(umx);
	badMagic[0] = 0;
	check("a file without the magic is not a UMX", !isUmx(badMagic) && refusal(badMagic) === "not-umx");
	check("nor is it detected as one", detectFormat(badMagic) !== "umx");
	check("a package without Music is refused", refusal(umxBytes([{ payload: MOD, className: "Sound" }])) === "no-music");
	const cut = umx.subarray(0, umx.length - 4);
	check("a package cut inside its tables is damaged", refusal(cut) === "not-umx", String(refusal(cut)));
}
