/**
 * What the byte-level harnesses share: the assertion, the tally, the section
 * runner and the asset stub. Nothing here knows what is being tested, so it
 * stays out of the way of the assertions. See CLAUDE.md.
 */

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * `packages/spc/assets` — the driver bundle and the emulator — whatever directory
 * the harness was bundled into. Import this rather than restating it, so the path
 * is stated once.
 */
export const SPC_ASSETS = join(import.meta.dirname, "..", "packages", "spc", "assets");

/** The harness's own name, off the bundle it runs from: `.selftest/rolltest.mjs` is `rolltest`. */
const HARNESS = basename(process.argv[1] ?? "harness").replace(/\.[cm]?js$/, "");

/** `HARNESS_VERBOSE` prints every `ok` line and every section header; without it only failures and the tally. */
const VERBOSE = Boolean(process.env["HARNESS_VERBOSE"]);

/** `HARNESS_ONLY=a,b` runs only those sections of a harness that is split into sections. */
const ONLY = (process.env["HARNESS_ONLY"] ?? "")
	.split(",")
	.map((name) => name.trim())
	.filter((name) => name !== "");

let passes = 0;
const failed: string[] = [];

/** The current section's header, held back until that section has a failure to print under it. */
let heldSection: string | null = null;

/** Names the checks that follow. Printed with the section's first failure, or at once when verbose. */
export function section(title: string): void {
	if (VERBOSE) {
		console.log(`\n${title}`);
		heldSection = null;
	} else {
		heldSection = title;
	}
}

/** A line about a passing run, such as a measured figure. Printed only when verbose. */
export function info(line: string): void {
	if (VERBOSE) {
		console.log(line);
	}
}

/**
 * Where a failing check was written, innermost frame first: the helper's line, then its caller's.
 * Run under `node --enable-source-maps` the frames are source lines; without it, the bundle's.
 */
function callSite(stack: string): string {
	const frames: string[] = [];
	for (const line of stack.split("\n").slice(1)) {
		const frame = /\(?((?:file:\/\/\/)?[^()\s][^()]*?):(\d+):\d+\)?\s*$/.exec(line);
		if (!frame) {
			continue;
		}

		const path = (frame[1] ?? "").replaceAll("\\", "/");
		if (path.includes("node:") || path.endsWith("/harness.ts")) {
			continue;
		}

		const scripts = path.lastIndexOf("/scripts/");
		const shown = `${scripts >= 0 ? path.slice(scripts + "/scripts/".length) : basename(path)}:${frame[2]}`;
		if (frames.at(-1) !== shown) {
			frames.push(shown);
		}
	}

	return frames.slice(0, 3).join(" < ");
}

function fail(name: string, detail: string, at: string): void {
	if (heldSection !== null) {
		console.log(`\n${heldSection}`);
		heldSection = null;
	}

	const where = at === "" ? "" : `  (${at})`;
	failed.push(`${name}${where}`);
	console.log(`  FAIL  ${name}${where}${detail ? `\n        ${detail}` : ""}`);
}

/** One assertion. A failure prints with where it was written; a pass prints only when verbose. */
export function check(name: string, condition: boolean, detail = ""): void {
	if (condition) {
		passes++;
		if (VERBOSE) {
			console.log(`  ok    ${name}`);
		}
	} else {
		const limit = Error.stackTraceLimit;
		Error.stackTraceLimit = 40;
		const stack = new Error().stack ?? "";
		Error.stackTraceLimit = limit;
		fail(name, detail, callSite(stack));
	}
}

/** A throw as a failure: its message on the FAIL line, its stack as the detail. */
function failThrown(name: string, thrown: unknown): void {
	const error = thrown instanceof Error ? thrown : new Error(String(thrown));
	const stack = (error.stack ?? "").split("\n").slice(1).join("\n    ");
	fail(`${name}: threw ${error.message}`, stack.trim(), callSite(error.stack ?? ""));
}

/**
 * Print the tally and exit. Call it last.
 *
 * The failed checks are listed again and the last line is always
 * `<harness>: N passed, M failed`, which `scripts/steps.mjs` reads.
 */
export function summarise(): never {
	if (failed.length > 0) {
		console.log(`\nfailed:\n${failed.map((name) => `  FAIL  ${name}`).join("\n")}`);
	}

	console.log(`\n${HARNESS}: ${passes} passed, ${failed.length} failed\n`);
	process.exit(failed.length === 0 ? 0 : 1);
}

// A throw outside any section is a failure with a tally, not a bare stack.
process.on("uncaughtException", (thrown) => {
	failThrown(HARNESS, thrown);
	summarise();
});

/**
 * Run a harness's sections in order, then the tally. Each is imported inside a
 * try, so one that throws is a FAIL line and the sections after it still run.
 */
export async function runSections(sections: readonly (readonly [string, () => Promise<unknown>])[]): Promise<never> {
	const unknown = ONLY.filter((name) => !sections.some(([known]) => known === name));
	if (unknown.length > 0) {
		console.log(`HARNESS_ONLY names no section of ${HARNESS}: ${unknown.join(", ")}`);
		console.log(`sections: ${sections.map(([name]) => name).join(", ")}`);
		process.exit(2);
	}

	for (const [name, load] of sections) {
		if (ONLY.length > 0 && !ONLY.includes(name)) {
			continue;
		}

		heldSection = name;
		try {
			await load();
		} catch (thrown) {
			failThrown(name, thrown);
		}
	}

	if (ONLY.length > 0) {
		console.log(`\nHARNESS_ONLY: ran ${ONLY.join(", ")} of ${sections.length} sections`);
	}

	return summarise();
}

const FALLBACK_HTML = "<!doctype html><html><body>SPA fallback</body></html>";

function response(body: Buffer | string, contentType: string) {
	const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
	return {
		ok: true,
		status: 200,
		headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
		arrayBuffer() {
			return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		},
		json() {
			return JSON.parse(bytes.toString("utf8")) as unknown;
		},
	};
}

/**
 * Serve the SPC package's assets over `fetch`, the way Vite's dev server does.
 *
 * Two behaviours here are deliberate and between them produced a real bug: paths
 * are decoded with `decodeURI`, and an unresolved path is answered 200 with
 * index.html rather than 404. CLAUDE.md has why both matter.
 */
export function stubFetch(): void {
	globalThis.fetch = ((input: string) => {
		// `loadDriver`'s default base is "driver" and `SpcPlayer`'s is "player",
		// so every URL is already relative to the asset root — the same shape
		// the browser requests.
		const path = join(SPC_ASSETS, decodeURI(String(input)));
		try {
			const bytes = readFileSync(path);
			const contentType = path.endsWith(".json") ? "application/json" : "application/octet-stream";
			return response(bytes, contentType);
		} catch {
			return response(FALLBACK_HTML, "text/html");
		}
	}) as unknown as typeof fetch;
}
