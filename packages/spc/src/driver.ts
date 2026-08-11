/**
 * Loads the prebuilt AddmusicK driver bundle: the SPC700 program, the SPC/DSP
 * base images, and the `#default` BRR sample group.
 *
 * These are build-time artifacts produced by running AddmusicK once.
 */

import { type BrrSample, parseBrr } from "./brr";

export interface DriverManifest {
	amkVersion: string;
	driver: string;
	spcBase: string;
	dspBase: string;
	/** ARAM address the driver is assembled at (`base` in asm/main.asm). */
	programPos: number;
	/**
	 * ARAM address of the driver's main loop; becomes the SPC's PC register.
	 * This is the `MainLoop:` label — the value asar reports as `MainLoopPos`.
	 */
	mainLoopPos: number;
	/**
	 * ARAM address of the `SongPointers:` label, which AddmusicK appends the song
	 * pointer table to. The table is present in this build and the global songs
	 * follow it.
	 *
	 * Song numbers are 1-based: the driver reads
	 * `mov a, SongPointers-$02+y` with `y = songNumber * 2`, so song N's entry
	 * is at `songPointers + 2 * (N - 1)` and song 1 is the first slot.
	 */
	songPointers: number;
	/**
	 * ARAM address the song is compiled and loaded at: the last entry of the song
	 * pointer table, which is the slot AddmusicK reserved for the local song.
	 *
	 * Inside the image rather than past it — AddmusicK leaves the last song it
	 * compiled sitting in that slot, and this song overwrites it.
	 */
	localPos: number;
	/** The local song's 1-based slot in that table, and so its CPUIO `$F6` value. */
	songIndex: number;
	sampleGroups: Record<string, string[]>;
	importantSamples?: string[];
}

/**
 * The fetched bytes and the manifest that describes them, and nothing else.
 *
 * Addresses are read from `manifest` at the point of use rather than copied out
 * here, so there is no second statement of them to fall out of step with the
 * first — a bundle cannot disagree with itself.
 */
export interface DriverBundle {
	manifest: DriverManifest;
	/** SPC file header + ARAM $0000-$00FF (512 bytes). */
	spcBase: Uint8Array;
	/** DSP registers + IPL area, written at SPC offset 0x10100 (256 bytes). */
	dspBase: Uint8Array;
	samples: BrrSample[];
	/** main.bin as it sits in ARAM at `manifest.programPos`, upload header stripped. */
	programData: Uint8Array;
}

export class DriverError extends Error {}

/**
 * `dw size, dw address`, prepended to a final-pass image at
 * `AddmusicK.cpp:1394-1397` and stripped again at `:1453`. `size` is measured
 * before the header existed, so it is the file's length less these four bytes.
 */
export const UPLOAD_HEADER_BYTES = 4;

const word = (bytes: Uint8Array, at: number): number => bytes[at] | (bytes[at + 1] << 8);

/**
 * Percent-encode one path segment.
 *
 * `encodeURIComponent` is wrong here: it escapes `@` to `%40`, but `@` is a
 * legal path character (RFC 3986 `pchar`) and static middleware commonly matches
 * the raw path without decoding it. AddmusicK's stock sample filenames look like
 * `00 SMW @0.brr`, so over-encoding makes every one of them 404.
 *
 * `encodeURI` leaves valid path characters alone and escapes spaces, but it also
 * leaves `#` and `?` — which would truncate the URL — so those are handled here.
 */
export function encodePathSegment(name: string): string {
	return encodeURI(name).replace(/#/g, "%23").replace(/\?/g, "%3F");
}

async function fetchBytes(url: string): Promise<Uint8Array> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new DriverError(`Could not load ${url} (HTTP ${response.status}).`);
	}

	assertNotHtmlFallback(response, url);
	return new Uint8Array(await response.arrayBuffer());
}

/**
 * A dev server's SPA fallback answers 200 with index.html for unknown paths, so
 * a missing asset arrives as a perfectly valid HTTP response full of HTML. Catch
 * it here, where we can say what actually went wrong, rather than letting it
 * reach a parser that will blame the file's contents.
 */
function assertNotHtmlFallback(response: Response, url: string): void {
	const contentType = response.headers.get("content-type") ?? "";
	if (/^\s*text\/html/i.test(contentType)) {
		throw new DriverError(
			`${url} returned an HTML page instead of a file, which means it does not exist ` +
				`(the dev server's SPA fallback answers 200 for unknown paths). ` +
				`Check that it is present in the driver bundle.`,
		);
	}
}

let cached: Promise<DriverBundle> | undefined;

/**
 * Loads and caches the driver bundle. Safe to call on every export.
 *
 * Failures are not cached — otherwise one bad load (a dev server still starting,
 * a missing file since replaced) would keep failing until a page reload.
 */
export function loadDriver(baseUrl = "driver", sampleGroup = "default"): Promise<DriverBundle> {
	cached ??= load(baseUrl, sampleGroup).catch((error: unknown) => {
		cached = undefined;
		throw error;
	});
	return cached;
}

async function load(baseUrl: string, sampleGroup: string): Promise<DriverBundle> {
	const manifestUrl = `${baseUrl}/manifest.json`;
	const manifestResponse = await fetch(manifestUrl);
	if (!manifestResponse.ok) {
		throw new DriverError(
			`Could not load ${manifestUrl} (HTTP ${manifestResponse.status}). ` +
				`The driver bundle lives in packages/spc/assets/driver/.`,
		);
	}

	assertNotHtmlFallback(manifestResponse, manifestUrl);
	const manifest = (await manifestResponse.json()) as DriverManifest;

	const names = manifest.sampleGroups[sampleGroup];
	if (!names) {
		throw new DriverError(`Sample group "${sampleGroup}" is not defined in the manifest.`);
	}

	const [spcBase, dspBase, rawProgram, ...sampleBlobs] = await Promise.all([
		fetchBytes(`${baseUrl}/${manifest.spcBase}`),
		fetchBytes(`${baseUrl}/${manifest.dspBase}`),
		fetchBytes(`${baseUrl}/${manifest.driver}`),
		...names.map((name) => fetchBytes(`${baseUrl}/samples/${encodePathSegment(name)}`)),
	]);

	if (spcBase.length < 0x100) {
		throw new DriverError(`${manifest.spcBase} is only ${spcBase.length} bytes; expected at least 256.`);
	}

	// Every address below is stated by the manifest rather than recovered from the
	// image, so this is the one thing worth confirming: that the bytes which
	// arrived are the image those addresses describe. A truncated fetch or a
	// swapped file fails here instead of relocating the song into whatever came
	// back. `spctest` checks the addresses themselves against these bytes.
	if (word(rawProgram, 0) !== rawProgram.length - UPLOAD_HEADER_BYTES) {
		throw new DriverError(
			`${manifest.driver} does not begin with AddmusicK's upload header, so it is not the final-pass ` +
				`build the manifest describes.`,
		);
	}

	return {
		manifest,
		spcBase,
		dspBase,
		samples: names.map((name, index) => parseBrr(name, sampleBlobs[index])),
		programData: rawProgram.subarray(UPLOAD_HEADER_BYTES),
	};
}
