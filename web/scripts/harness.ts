/**
 * What the eleven byte-level harnesses share.
 *
 * Each of them is a standalone esbuild-bundled Node script, and each used to
 * carry its own byte-identical copy of `check`, its own exit epilogue and — for
 * the three that load the driver bundle — its own `fetch` stub. The copies had
 * already drifted: `worklettest.ts` said "same shim as spctest" above a shim
 * that had lost both of the behaviours `spctest.ts` documents as load-bearing.
 *
 * Nothing here knows what is being tested, so it stays out of the way of the
 * assertions, which are the point.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** `web/public`, whatever directory the harness was bundled into. */
export const PUBLIC = join(import.meta.dirname, "..", "public");

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

/** How many assertions have failed so far, for a harness that wants to branch. */
export function failureCount(): number {
	return failures;
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
 * Serve `web/public` over `fetch`, the way Vite's dev server does.
 *
 * Both behaviours here are deliberate, and between them they produced the
 * "invalid BRR length 2205" bug:
 *
 *   1. paths are decoded with `decodeURI`, which leaves `%40` untouched, so an
 *      over-encoded `@` never resolves to a real file;
 *   2. an unresolved path is answered 200 with index.html, not 404 — so code
 *      that trusts `response.ok` gets HTML where it expected bytes.
 *
 * A harness that threw on a missing file instead would pass while the browser
 * failed, which is exactly the drift this module exists to stop.
 */
export function stubFetch(): void {
	globalThis.fetch = ((input: string) => {
		// `loadDriver`'s default base is "driver", so every URL is already
		// relative to public/ — the same shape the browser requests.
		const path = join(PUBLIC, decodeURI(String(input)));
		try {
			const bytes = readFileSync(path);
			const contentType = path.endsWith(".json") ? "application/json" : "application/octet-stream";
			return response(bytes, contentType);
		} catch {
			return response(FALLBACK_HTML, "text/html");
		}
	}) as unknown as typeof fetch;
}
