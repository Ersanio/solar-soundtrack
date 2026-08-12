/**
 * What the eleven byte-level harnesses share. Nothing here knows what is being
 * tested, so it stays out of the way of the assertions. See README.md.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `packages/spc/assets` — the driver bundle and the emulator — whatever directory
 * the harness was bundled into. Import this rather than restating it: three
 * harnesses used to keep their own copy, and the path has now moved once.
 */
export const SPC_ASSETS = join(import.meta.dirname, "..", "packages", "spc", "assets");

let failures = 0;

/** One assertion. Prints either way; the count is what decides the exit code. */
export function check(name: string, condition: boolean, detail = ""): void {
	if (condition) {
		console.log(`  ok    ${name}`);
	} else {
		failures++;
		console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
	}
}

/**
 * Print the tally and exit. Call it last.
 *
 * The wording is fixed here because it used to differ: six harnesses said "all
 * checks passed" and four said "All FIR tests passed." and friends, which made
 * one suite look like two.
 */
export function summarise(): never {
	console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}\n`);
	process.exit(failures === 0 ? 0 : 1);
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
 * index.html rather than 404. README.md has why both matter.
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
