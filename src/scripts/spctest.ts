/**
 * End-to-end check: compile MML -> assemble an SPC -> verify its structure.
 *
 * Runs in node, so it stubs `fetch` over the local public/driver directory.
 *
 *   npm run spctest
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { compilers } from "../src/compilers";
import { EMPTY_SAMPLE_NAME } from "../src/compilers/addmusick/tables";
import { emptySample } from "../src/spc/brr";
import { analyzeDriver, encodePathSegment, loadDriver, withCustomProgram } from "../src/spc/driver";
import { buildSpc } from "../src/spc/export";
import { computeBudget, planAram } from "../src/spc/layout";

const DRIVER_DIR = join(import.meta.dirname, "..", "public", "driver");

const FALLBACK_HTML = "<!doctype html><html><body>SPA fallback</body></html>";

function response(body: Buffer | string, contentType: string) {
	const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
	return {
		ok: true,
		status: 200,
		headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
		async arrayBuffer() {
			return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		},
		async json() {
			return JSON.parse(bytes.toString("utf8"));
		},
	};
}

/**
 * Fetch shim that mirrors Vite's dev server, including the two behaviours that
 * produced the "invalid BRR length 2205" bug:
 *
 *   1. paths are decoded with `decodeURI`, which leaves `%40` untouched, so an
 *      over-encoded `@` never resolves to a real file;
 *   2. an unresolved path is answered 200 with index.html, not 404.
 */
globalThis.fetch = (async (input: string) => {
	const path = join(DRIVER_DIR, decodeURI(String(input).replace(/^driver\//, "")));
	try {
		const bytes = readFileSync(path);
		const contentType = path.endsWith(".json") ? "application/json" : "application/octet-stream";
		return response(bytes, contentType);
	} catch {
		return response(FALLBACK_HTML, "text/html");
	}
}) as unknown as typeof fetch;

let failures = 0;
function check(name: string, condition: boolean, detail = ""): void {
	if (condition) console.log(`  ok    ${name}`);
	else {
		failures++;
		console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
	}
}
const hex = (n: number) => `$${n.toString(16).toUpperCase().padStart(4, "0")}`;

const SONG = `#amk 4
#spc
{
    #title  "Export Test"
    #author "web mml"
}
#0 t40 o4 v200 q7F @0 l8 c d e f g4 e4 c4 r4
#1 o2 v160 q7D @1 l8 [c c > c < c]4
`;

console.log("\nURL encoding");
{
	// Regression: encodeURIComponent escapes `@` to %40, which decodeURI does not
	// undo, so the file never resolves and the SPA fallback returns index.html.
	check(
		"@ is left unescaped in path segments",
		encodePathSegment("00 SMW @0.brr") === "00%20SMW%20@0.brr",
		encodePathSegment("00 SMW @0.brr"),
	);
	check(
		"round-trips through decodeURI",
		decodeURI(encodePathSegment("00 SMW @0.brr")) === "00 SMW @0.brr",
	);
	check("# is escaped", encodePathSegment("a#b.brr") === "a%23b.brr", encodePathSegment("a#b.brr"));
	check("? is escaped", encodePathSegment("a?b.brr") === "a%3Fb.brr", encodePathSegment("a?b.brr"));
	check(
		"encodeURIComponent would have broken this",
		encodeURIComponent("00 SMW @0.brr") !== encodePathSegment("00 SMW @0.brr"),
	);
}

console.log("\nmissing files are diagnosed, not misread");
{
	let message = "";
	try {
		await loadDriver("does-not-exist");
	} catch (error) {
		message = error instanceof Error ? error.message : String(error);
	}
	check("HTML fallback is rejected", /HTML page/.test(message), message || "(no error thrown)");
}

const driver = await loadDriver();

console.log("\ndriver bundle");
{
	check("programPos is $0400", driver.manifest.programPos === 0x0400, hex(driver.manifest.programPos));
	check("mainLoopPos is $042E", driver.manifest.mainLoopPos === 0x042e, hex(driver.manifest.mainLoopPos));
	check("20 default samples", driver.samples.length === 20, `${driver.samples.length}`);
	{
		// The app resolves its sample set by looking the `#default` group's names
		// up in the library, so those names must match what `loadDriver` parsed —
		// name for name, in order. If they ever drift, every export silently loses
		// the samples that failed to resolve, and only the browser would show it.
		const group = driver.manifest.sampleGroups["default"] ?? [];
		const parsed = driver.samples.map((sample) => sample.sampleName);
		check(
			"the #default group names match the parsed samples, in order",
			group.length === parsed.length && group.every((name, index) => name === parsed[index]),
			`group [${group.slice(0, 3).join(", ")}…] vs parsed [${parsed.slice(0, 3).join(", ")}…]`,
		);
	}
	{
		// The `!`-marked names from AddmusicK's `Addmusic_sample groups.txt`. A name
		// here that is not in the group would silently protect nothing, and the
		// count is worth pinning so an edit to one list is noticed in the other.
		const important = driver.manifest.importantSamples ?? [];
		const group = driver.manifest.sampleGroups["default"] ?? [];
		check("17 samples are marked important", important.length === 17, `${important.length}`);
		check(
			"every important name is in the #default group",
			important.every((name) => group.includes(name)),
			important.filter((name) => !group.includes(name)).join(", "),
		);
		check(
			"0D, 0F and 11 are the unimportant ones",
			group.filter((name) => !important.includes(name)).join(", ") ===
				"0D SMW @14.brr, 0F SMW @21.brr, 11 SMW @17.brr",
			group.filter((name) => !important.includes(name)).join(", "),
		);
	}
	check("no embedded song table", driver.embedded === null);
	check("SongPointers is $236D", driver.manifest.songPointers === 0x236d, hex(driver.manifest.songPointers));
	check(
		"SongPointers sits at the end of main.bin",
		driver.manifest.songPointers === driver.manifest.programPos + 8045,
		hex(driver.manifest.songPointers),
	);
	check("MainLoop auto-detected", driver.mainLoopPos === 0x042e, hex(driver.mainLoopPos));
}

console.log("\ndefault driver: one-slot table appended");
const plan = planAram(driver);
{
	check("localPos is $236F", plan.localPos === 0x236f, hex(plan.localPos));
	check("songIndex is 1", plan.songIndex === 1, `${plan.songIndex}`);
	check("2-byte table appended", plan.appendedTableBytes === 2, `${plan.appendedTableBytes}`);

	// Song numbers are 1-based: song N's entry is at songPointers + 2*(N-1).
	const at = driver.songPointers - driver.programPos;
	const entry = plan.programImage[at] | (plan.programImage[at + 1] << 8);
	check("song table slot 1 points at localPos", entry === plan.localPos, hex(entry));
}

console.log("\nsong table survives pointer-like bytes before it");
{
	// Regression: the table start used to be found by walking back while the
	// words looked like ascending pointers. The bytes immediately before the
	// table are driver code / SFX data, and if they happen to read as a valid
	// pointer that walk overshoots and the table is lost. Whether detection
	// worked then depended on the driver's sound effect set.
	const build = (tailWord: number | null) => {
		const G = 9;
		const GB = 1747;
		const tableBytes = (G + 1) * 2;
		const base = Uint8Array.from(driver.programData);
		if (tailWord !== null) {
			base[base.length - 2] = tailWord & 0xff;
			base[base.length - 1] = tailWord >> 8;
		}
		const body = new Uint8Array(base.length + tableBytes + GB);
		body.set(base, 0);
		const firstGlobal = driver.programPos + base.length + tableBytes;
		for (let i = 0; i < G; i++) {
			const address = firstGlobal + Math.floor((GB / G) * i);
			body[base.length + i * 2] = address & 0xff;
			body[base.length + i * 2 + 1] = address >> 8;
		}
		const localPos = driver.programPos + body.length;
		body[base.length + G * 2] = localPos & 0xff;
		body[base.length + G * 2 + 1] = localPos >> 8;

		const raw = new Uint8Array(body.length + 4);
		raw[0] = body.length & 0xff;
		raw[1] = body.length >> 8;
		raw[2] = driver.programPos & 0xff;
		raw[3] = driver.programPos >> 8;
		raw.set(body, 4);
		return raw;
	};

	for (const tail of [null, 0x0401, 0x1000, 0x2000, 0x236c] as const) {
		const found = withCustomProgram(driver, build(tail), "main.bin").embedded;
		check(
			`table found with tail ${tail === null ? "unchanged" : `$${tail.toString(16).toUpperCase().padStart(4, "0")}`}`,
			found?.globalSongCount === 9,
			`${found?.globalSongCount}`,
		);
	}

	// AddmusicK.cpp:1147 sizes the table as `highestGlobalSong * 2 + 2`, which
	// over-counts when the Globals list has a gap, so the local song slot can
	// point a little past where the image actually ends. Follow the slot.
	{
		const G = 9;
		const GB = 1747;
		const SLACK = 2;
		const tableBytes = (G + 1) * 2;
		const base = driver.programData;
		const body = new Uint8Array(base.length + tableBytes + GB);
		body.set(base, 0);
		const firstGlobal = driver.programPos + base.length + tableBytes;
		for (let i = 0; i < G; i++) {
			const address = firstGlobal + Math.floor((GB / G) * i);
			body[base.length + i * 2] = address & 0xff;
			body[base.length + i * 2 + 1] = address >> 8;
		}
		const slot = driver.programPos + body.length + SLACK;
		body[base.length + G * 2] = slot & 0xff;
		body[base.length + G * 2 + 1] = slot >> 8;

		const raw = new Uint8Array(body.length + 4);
		raw[0] = body.length & 0xff;
		raw[1] = body.length >> 8;
		raw[2] = driver.programPos & 0xff;
		raw[3] = driver.programPos >> 8;
		raw.set(body, 4);

		const found = withCustomProgram(driver, raw, "main.bin");
		check("table found when the slot overshoots the image end", found.embedded !== null);
		check("localPos follows the slot, not the image length", found.embedded?.localPos === slot, hex(found.embedded?.localPos ?? 0));
		check("9 globals still detected", found.embedded?.globalSongCount === 9, `${found.embedded?.globalSongCount}`);
	}

	// A build with no global songs at all is a one-entry table.
	const single = (() => {
		const base = driver.programData;
		const body = new Uint8Array(base.length + 2);
		body.set(base, 0);
		const localPos = driver.programPos + body.length;
		body[base.length] = localPos & 0xff;
		body[base.length + 1] = localPos >> 8;
		const raw = new Uint8Array(body.length + 4);
		raw[0] = body.length & 0xff;
		raw[1] = body.length >> 8;
		raw[2] = driver.programPos & 0xff;
		raw[3] = driver.programPos >> 8;
		raw.set(body, 4);
		return withCustomProgram(driver, raw, "main.bin").embedded;
	})();
	check("zero-global table is one entry", single?.globalSongCount === 0 && single?.songIndex === 1, `${single?.globalSongCount}`);
}

console.log("\ncustom driver: a final-pass build is read as-is");
{
	// Synthesize what AddmusicK's asm/SNES/bin/main.bin looks like: the stock
	// second-pass image, then a 10-slot table, then 9 global songs' data, then a
	// 4-byte upload header on the front.
	const GLOBALS = 9;
	const GLOBAL_BYTES = 1747;
	const base = driver.programData;
	const tableBytes = (GLOBALS + 1) * 2;
	const body = new Uint8Array(base.length + tableBytes + GLOBAL_BYTES);
	body.set(base, 0);

	const songPointers = driver.programPos + base.length;
	const firstGlobal = songPointers + tableBytes;
	for (let i = 0; i < GLOBALS; i++) {
		// Global songs laid out consecutively, ~194 bytes apart.
		const address = firstGlobal + Math.floor((GLOBAL_BYTES / GLOBALS) * i);
		body[base.length + i * 2] = address & 0xff;
		body[base.length + i * 2 + 1] = address >> 8;
	}
	const localPos = driver.programPos + body.length;
	body[base.length + GLOBALS * 2] = localPos & 0xff;
	body[base.length + GLOBALS * 2 + 1] = localPos >> 8;

	const withHeader = new Uint8Array(body.length + 4);
	withHeader[0] = body.length & 0xff;
	withHeader[1] = body.length >> 8;
	withHeader[2] = driver.programPos & 0xff;
	withHeader[3] = driver.programPos >> 8;
	withHeader.set(body, 4);

	const custom = withCustomProgram(driver, withHeader, "main.bin");
	check("upload header stripped", custom.programData.length === body.length, `${custom.programData.length}`);
	check("programPos read from header", custom.programPos === 0x0400, hex(custom.programPos));
	check("MainLoop still found", custom.mainLoopPos === 0x042e, hex(custom.mainLoopPos));
	check("song table located", custom.embedded !== null);
	check("9 global songs detected", custom.embedded?.globalSongCount === 9, `${custom.embedded?.globalSongCount}`);
	check("song index is 10", custom.embedded?.songIndex === 10, `${custom.embedded?.songIndex}`);
	check("songPointers located", custom.songPointers === songPointers, hex(custom.songPointers ?? 0));

	const customPlan = planAram(custom);
	check("localPos is $2A54", customPlan.localPos === 0x2a54, hex(customPlan.localPos));
	check("nothing appended", customPlan.appendedTableBytes === 0);
	check("plan uses the embedded table", customPlan.fromEmbeddedTable);

	// The whole point: a real driver makes the budget exact without modelling.
	const customBudget = computeBudget(custom, custom.samples, customPlan, 100, 0);
	const rows = customBudget.rows.reduce((sum, row) => sum + row.bytes, 0);
	check("custom budget accounts for all 64 KiB", rows === 0x10000, `${rows}`);
	check(
		"driver row covers code + SFX + table + globals",
		customBudget.rows.find((r) => r.key === "driver")?.bytes === body.length,
	);
}

console.log("\nupload header detection is the size rule alone");
{
	// AddmusicK.cpp:1394 stores the image length measured BEFORE the header was
	// prepended, so a final-pass file's first word is always length - 4.
	const withHeader = (bodyLength: number, address: number) => {
		const raw = new Uint8Array(bodyLength + 4);
		raw[0] = bodyLength & 0xff;
		raw[1] = (bodyLength >> 8) & 0xff;
		raw[2] = address & 0xff;
		raw[3] = (address >> 8) & 0xff;
		return raw;
	};

	// The worked example: a 0x2656-byte file starts `52 26`.
	const example = withHeader(0x2656 - 4, 0x0400);
	check("0x2656-byte file starts 52 26", example[0] === 0x52 && example[1] === 0x26, `${example[0]},${example[1]}`);
	check("and is detected as final-pass", analyzeDriver(example, driver.manifest, true).programPos === 0x0400);

	// Load addresses outside any range we might have guessed are still accepted.
	for (const address of [0x0200, 0x0400, 0x1000, 0x8000, 0xc000]) {
		const raw = withHeader(0x100, address);
		const analysis = analyzeDriver(raw, driver.manifest, true);
		check(
			`header honoured at $${address.toString(16).toUpperCase().padStart(4, "0")}`,
			analysis.programPos === address && analysis.programData.length === 0x100,
			`${hex(analysis.programPos)}`,
		);
	}

	// One byte off in either direction means no header.
	for (const wrong of [-1, 1]) {
		const raw = withHeader(0x100, 0x0400);
		const bad = raw.slice();
		bad[0] = (0x100 + wrong) & 0xff;
		const analysis = analyzeDriver(bad, driver.manifest, true);
		check(`size off by ${wrong} -> no header`, analysis.programData.length === raw.length, `${analysis.programData.length}`);
	}

	// The stock second-pass driver starts with SPC700 code, not a header.
	check(
		"stock main.bin has no upload header",
		driver.programData.length === 8045 && driver.programPos === 0x0400,
		`${driver.programData.length}`,
	);

	// A header claiming an address the image cannot fit at is an error, not a
	// silent fallback to "second-pass".
	let threw = false;
	try {
		analyzeDriver(withHeader(0x8000, 0xc000), driver.manifest, true);
	} catch {
		threw = true;
	}
	check("header that overruns ARAM is rejected", threw);
}

console.log("\ncustom driver: bad input is rejected");
{
	for (const [bytes, label] of [
		[new Uint8Array(8), "too small"],
		[new Uint8Array(0x10000), "too large for ARAM"],
	] as const) {
		let threw = false;
		try {
			withCustomProgram(driver, bytes, "bad.bin");
		} catch {
			threw = true;
		}
		check(`${label} rejected`, threw);
	}
}

console.log("\ncompile + export");
const compiler = compilers.get("addmusick")!;
const compiled = compiler.compile({ source: SONG, aramAddress: plan.localPos });
check("song compiles", compiled.ok, compiled.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));

const { spc, layout } = buildSpc({
	songData: compiled.data!,
	driver,
	samples: driver.samples,
	plan,
	tags: compiled.stats!.tags,
	seconds: compiled.stats!.seconds,
	echoBufferSize: compiled.stats!.echoBufferSize,
	date: new Date(2026, 6, 28),
});

console.log("\nfile structure");
{
	const text = (at: number, len: number) =>
		Buffer.from(spc.subarray(at, at + len)).toString("latin1").replace(/\0+$/, "");

	check("size is 0x10200", spc.length === 0x10200, `0x${spc.length.toString(16)}`);
	check("signature", text(0, 33) === "SNES-SPC700 Sound File Data v0.30");
	check("has ID666 tags", spc[0x23] === 0x1a, `0x${spc[0x23].toString(16)}`);
	check("PC = mainLoopPos", (spc[0x25] | (spc[0x26] << 8)) === 0x042e, hex(spc[0x25] | (spc[0x26] << 8)));
	check("SP = $CF (post-init)", spc[0x2b] === 0xcf, `0x${spc[0x2b].toString(16)}`);
	check("title tag", text(0x2e, 32) === "Export Test", text(0x2e, 32));
	check("artist tag", text(0xb1, 32) === "web mml", text(0xb1, 32));
	check("game defaults", text(0x4e, 32) === "Super Mario World (custom)", text(0x4e, 32));
	check("date", text(0x9e, 10) === "07/28/2026", text(0x9e, 10));
	check("length is ASCII digits", /^\d{3}$/.test(text(0xa9, 3)), text(0xa9, 3));
	check("fade is 10000", text(0xac, 5) === "10000", text(0xac, 5));
}

console.log("\nARAM contents");
{
	const aram = spc.subarray(0x100, 0x10100);

	check("driver at programPos", aram[0x400] === 0x20 && aram[0x401] === 0xcd, "expected CLRP / MOV X,#$CF");
	check(
		"main loop instruction at $042E",
		aram[0x42e] === 0xeb && aram[0x42f] === 0xfd && aram[0x430] === 0xf0,
		"expected MOV Y,$FD / BEQ",
	);
	check("tempo mirror $51 = $36", aram[0x51] === 0x36, `0x${aram[0x51].toString(16)}`);
	check("FLG mirror $5F = $20", aram[0x5f] === 0x20, `0x${aram[0x5f].toString(16)}`);
	check("$F6 = songIndex", aram[0xf6] === plan.songIndex, `${aram[0xf6]}`);

	// Song data must land exactly where the pointer table says it does.
	const songBytes = compiled.data!;
	let matches = true;
	for (let i = 0; i < songBytes.length; i++) {
		if (aram[plan.localPos + i] !== songBytes[i]) { matches = false; break; }
	}
	check("song data at localPos", matches);

	// The song header's first word points at its own phrase pointer block.
	const firstWord = aram[plan.localPos] | (aram[plan.localPos + 1] << 8);
	check(
		"song header pointer is inside the song",
		firstWord >= plan.localPos && firstWord < layout.songEnd,
		hex(firstWord),
	);
}

console.log("\nsample directory");
{
	const aram = spc.subarray(0x100, 0x10100);
	const dir = spc[0x10100 + 0x5d];

	check("DIR register set", dir === (layout.sampleTablePos >> 8), `0x${dir.toString(16)}`);
	check("table is page-aligned", (layout.sampleTablePos & 0xff) === 0, hex(layout.sampleTablePos));
	check("table starts after the song", layout.sampleTablePos >= layout.songEnd);

	let ok = true;
	let expected = layout.sampleDataPos;
	for (let index = 0; index < driver.samples.length; index++) {
		const entry = layout.sampleTablePos + index * 4;
		const start = aram[entry] | (aram[entry + 1] << 8);
		const loop = aram[entry + 2] | (aram[entry + 3] << 8);
		const sample = driver.samples[index];
		if (start !== expected || loop !== expected + sample.loopOffset) { ok = false; break; }
		// Spot-check that the BRR actually got copied.
		if (aram[start] !== sample.data[0] || aram[start + sample.data.length - 1] !== sample.data[sample.data.length - 1]) {
			ok = false;
			break;
		}
		expected += sample.data.length;
	}
	check("all 20 directory entries and BRR blobs correct", ok);
	check("sample data ends where layout says", expected === layout.sampleDataEnd, hex(expected));
}

console.log("\nARAM budget");
{
	const budget = computeBudget(driver, driver.samples, plan, compiled.data!.length, compiled.stats!.echoBufferSize);

	// Every byte of ARAM must be accounted for exactly once.
	const total = budget.rows.reduce((sum, row) => sum + row.bytes, 0);
	check("rows account for all 64 KiB", total === 0x10000, `${total}`);
	check("no overflow with the stock set", budget.overflowBytes === 0, `${budget.overflowBytes}`);
	check("free matches the layout", budget.freeBytes === budget.layout.freeBytes);
	check(
		"budget layout agrees with the exported SPC",
		budget.layout.songPos === layout.songPos && budget.layout.sampleDataEnd === layout.sampleDataEnd,
	);

	console.log(`  ..    free ${budget.freeBytes} B`);
}

console.log("\nlayout");
console.log(`  driver   ${hex(layout.programPos)} - ${hex(layout.programEnd)}`);
console.log(`  song     ${hex(layout.songPos)} - ${hex(layout.songEnd)}`);
console.log(`  smp tbl  ${hex(layout.sampleTablePos)} - ${hex(layout.sampleTableEnd)}`);
console.log(`  samples  ${hex(layout.sampleDataPos)} - ${hex(layout.sampleDataEnd)}`);
console.log(`  echo     ${hex(layout.echoStart)} - ${hex(layout.echoEnd)}`);
console.log(`  free     ${layout.freeBytes} bytes`);

console.log("\n#samples reaches the sample directory");
{
	// The decisive end-to-end check: a song that names its own sample set must
	// produce an SPC built from *that* set. Every intermediate stage can look
	// right while the writer quietly falls back to the driver's twenty, and the
	// only symptom would be an SPC that plays the wrong sounds.
	const byName = new Map(driver.samples.map((sample) => [sample.sampleName, sample]));
	const options = {
		sampleNames: driver.samples.map((sample) => sample.sampleName),
		sampleGroups: driver.manifest.sampleGroups,
	};
	const only = driver.samples[0];

	const source = `#amk 4\n#samples { "${only.sampleName}" }\n#0 o4 $F3 $00 $02 c4\n`;
	const one = compiler.compile({ source, aramAddress: plan.localPos, options });
	check("a one-sample song compiles", one.ok, one.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
	check("it resolves exactly one name", one.sampleList?.length === 1, `${one.sampleList?.length}`);

	const samples = (one.sampleList ?? []).map((name) => byName.get(name) ?? emptySample(name));
	check("that name resolves to a real sample", samples.length === 1);

	const built = buildSpc({
		songData: one.data!,
		driver,
		samples,
		plan,
		echoBufferSize: one.stats?.echoBufferSize,
		date: new Date(2026, 6, 28),
	});

	const entries = (built.layout.sampleTableEnd - built.layout.sampleTablePos) / 4;
	check("the directory holds one entry, not twenty", entries === 1, `${entries}`);
	check(
		"only that sample's bytes are stored",
		built.layout.sampleDataEnd - built.layout.sampleDataPos === only.data.length,
		`${built.layout.sampleDataEnd - built.layout.sampleDataPos} vs ${only.data.length}`,
	);
	check(
		"it frees the ARAM the other nineteen were using",
		built.layout.freeBytes > layout.freeBytes,
		`${built.layout.freeBytes} vs ${layout.freeBytes} for the full set`,
	);

	// The directory entry must point at the sample, and DSP DIR at the table.
	const aram = built.spc.subarray(0x100, 0x100 + 0x10000);
	const start = aram[built.layout.sampleTablePos] | (aram[built.layout.sampleTablePos + 1] << 8);
	check("the entry points at the sample data", start === built.layout.sampleDataPos, hex(start));
	check("the stored bytes are that sample's", aram[start] === only.data[0], hex(aram[start]));

	// And the budget must agree with what was written, since they are computed
	// from the same layout but by different call sites.
	const budget = computeBudget(driver, samples, plan, one.data!.length, one.stats?.echoBufferSize ?? 0);
	check("the budget agrees with the built file", budget.layout.sampleDataEnd === built.layout.sampleDataEnd,
		`${budget.layout.sampleDataEnd} vs ${built.layout.sampleDataEnd}`);
	check("the samples row counts one", budget.rows.find((row) => row.key === "samples")?.label === "samples (1)",
		budget.rows.find((row) => row.key === "samples")?.label);
}

console.log("\nthe budget says how many samples are really loaded");
{
	// "samples (20)" for every possible song reads as "the default set is loaded"
	// no matter what optimisation actually did, which is how a real bug in the
	// importance fallback went unnoticed. The row has to distinguish the two.
	const byName = new Map(driver.samples.map((sample) => [sample.sampleName, sample]));
	byName.set(EMPTY_SAMPLE_NAME, emptySample(EMPTY_SAMPLE_NAME));

	const options = {
		sampleNames: driver.samples.map((sample) => sample.sampleName),
		sampleGroups: driver.manifest.sampleGroups,
		importantSamples: driver.manifest.importantSamples ?? [],
	};
	const source = "#amk 4\n#0 t40 o4 v220 q7F @0 l8 c d e f\n";

	const label = (optimize: boolean): string => {
		const result = compiler.compile({ source, aramAddress: plan.localPos, options: { ...options, optimizeSampleUsage: optimize } });
		const samples = (result.sampleList ?? []).map((name) => byName.get(name) ?? emptySample(name));
		const budget = computeBudget(driver, samples, plan, result.data!.length, result.stats?.echoBufferSize ?? 0);
		return budget.rows.find((row) => row.key === "samples")?.label ?? "";
	};

	check("unoptimised reports the plain count", label(false) === "samples (20)", label(false));
	// 17 important plus @0's own sample, which is one of them.
	check("optimised reports loaded of total", label(true) === "samples (17 of 20)", label(true));
}

console.log("\noptimizeSampleUsage frees real ARAM");
{
	// The point of the pass: a song using two instruments should not upload all
	// twenty samples. Measured on the real bundle, through the real writer.
	const byName = new Map(driver.samples.map((sample) => [sample.sampleName, sample]));
	byName.set(EMPTY_SAMPLE_NAME, emptySample(EMPTY_SAMPLE_NAME));

	const options = {
		sampleNames: driver.samples.map((sample) => sample.sampleName),
		sampleGroups: driver.manifest.sampleGroups,
	};
	const source = "#amk 4\n#0 t40 o4 v220 q7F @0 l8 c d e f\n#1 o3 v200 @1 l4 c e g\n";

	const build = (optimize: boolean) => {
		const result = compiler.compile({ source, aramAddress: plan.localPos, options: { ...options, optimizeSampleUsage: optimize } });
		if (!result.ok || !result.data) throw new Error(result.diagnostics.map((d) => d.message).join("; "));
		const samples = (result.sampleList ?? []).map((name) => byName.get(name) ?? emptySample(name));
		return { result, built: buildSpc({ songData: result.data, driver, samples, plan, echoBufferSize: result.stats?.echoBufferSize, date: new Date(2026, 6, 28) }) };
	};

	const lean = build(true);
	const full = build(false);

	const leanBytes = lean.built.layout.sampleDataEnd - lean.built.layout.sampleDataPos;
	const fullBytes = full.built.layout.sampleDataEnd - full.built.layout.sampleDataPos;

	check("the directory is the same length either way",
		lean.built.layout.sampleTableEnd - lean.built.layout.sampleTablePos ===
			full.built.layout.sampleTableEnd - full.built.layout.sampleTablePos);
	check("optimising uploads far fewer sample bytes", leanBytes < fullBytes / 4, `${leanBytes} vs ${fullBytes}`);
	check("it frees that ARAM", lean.built.layout.freeBytes > full.built.layout.freeBytes,
		`${lean.built.layout.freeBytes} vs ${full.built.layout.freeBytes}`);

	// Emptied slots all name one sample, so its zero bytes are stored once and
	// every other entry is a copy of that entry's four bytes.
	const aram = lean.built.spc.subarray(0x100, 0x100 + 0x10000);
	const table = lean.built.layout.sampleTablePos;
	const entryOf = (srcn: number) => aram[table + srcn * 4] | (aram[table + srcn * 4 + 1] << 8);
	const emptied = (lean.result.sampleList ?? []).map((name, srcn) => ({ name, srcn })).filter((s) => s.name === EMPTY_SAMPLE_NAME);
	check("some slots really were emptied", emptied.length > 15, `${emptied.length}`);
	check("every emptied slot shares one pointer",
		emptied.every((slot) => entryOf(slot.srcn) === entryOf(emptied[0].srcn)),
		`first ${hex(entryOf(emptied[0].srcn))}`);
	check("a kept sample points somewhere else", entryOf(0) !== entryOf(emptied[0].srcn),
		`kept ${hex(entryOf(0))} vs empty ${hex(entryOf(emptied[0].srcn))}`);
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
