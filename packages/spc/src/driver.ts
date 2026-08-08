/**
 * Loads the prebuilt AddmusicK driver bundle: the SPC700 program, the SPC/DSP
 * base images, and the `#default` BRR sample group.
 *
 * These are build-time artifacts produced by running AddmusicK once. Nothing
 * here assembles anything — asar is not involved at runtime.
 */

import { hex4 as hex } from "@amk/core/hex";
import { type BrrSample, parseBrr } from "./brr";
import { ARAM_SIZE } from "./layout";

// Re-exported because the SPC writer and the ARAM budget have always imported
// it from here; the type itself now lives with the rest of the BRR handling.
export type { BrrSample };

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
	 * ARAM address of the `SongPointers:` label, which AddmusicK appends the
	 * song pointer table to. It is the last label in `main.asm`, so in a
	 * second-pass build with no table it sits at the very end of the image; in a
	 * final-pass build the table is there and the global songs follow it.
	 *
	 * Song numbers are 1-based: the driver reads
	 * `mov a, SongPointers-$02+y` with `y = songNumber * 2`, so song N's entry
	 * is at `songPointers + 2 * (N - 1)` and song 1 is the first slot.
	 */
	songPointers: number;
	sampleGroups: Record<string, string[]>;
	/**
	 * Samples that must stay in ARAM even when a song never plays them — the
	 * names carrying a trailing `!` in AddmusicK's `Addmusic_sample groups.txt`.
	 *
	 * Optional: a hand-built bundle without it simply has no important samples,
	 * which means sample optimisation is free to reclaim any of them.
	 */
	importantSamples?: string[];
}

export interface DriverBundle {
	manifest: DriverManifest;
	/** SPC file header + ARAM $0000-$00FF (512 bytes). */
	spcBase: Uint8Array;
	/** DSP registers + IPL area, written at SPC offset 0x10100 (256 bytes). */
	dspBase: Uint8Array;
	samples: BrrSample[];

	/** main.bin as it sits in ARAM at `programPos`, upload header stripped. */
	programData: Uint8Array;
	programPos: number;
	mainLoopPos: number;
	songPointers: number;
	/**
	 * Set when main.bin is a final-pass build that already carries its own song
	 * pointer table and global song data — everything AddmusicK will occupy is
	 * then physically present, so the ARAM budget is exact.
	 */
	embedded: { localPos: number; songIndex: number } | null;
	/** Human-readable account of what was auto-detected, for the UI. */
	notes: string[];
}

export class DriverError extends Error {}

const word = (bytes: Uint8Array, at: number): number => bytes[at] | (bytes[at + 1] << 8);

/**
 * Everything the SPC writer needs about a `main.bin`, derived from the bytes.
 *
 * A driver has its own size, its own `MainLoop:` address and possibly its own
 * song table, so none of the manifest's constants can be assumed — swapping the
 * bundled image for a different AddmusicK build changes all three. They are
 * recovered here instead, falling back to the manifest only when detection fails.
 */
export function analyzeDriver(
	raw: Uint8Array,
	manifest: DriverManifest,
	custom: boolean,
): {
	programData: Uint8Array;
	programPos: number;
	mainLoopPos: number;
	songPointers: number;
	embedded: { localPos: number; songIndex: number } | null;
	notes: string[];
} {
	const notes: string[] = [];

	// A final-pass build carries a 4-byte SNES upload header — `dw size, dw
	// address`, written at AddmusicK.cpp:1394-1397 and stripped again at :1453.
	// `size` is the image length measured before the header was prepended, so
	// the header is present exactly when the first word equals length - 4.
	// A 0x2656-byte file therefore starts `52 26` (0x2652 = 0x2656 - 4) — which
	// is exactly what the bundled main.bin is.
	const declaredSize = word(raw, 0);
	const declaredAddress = word(raw, 2);
	const hasUploadHeader = raw.length > 4 && declaredSize === raw.length - 4;

	// The size match is the criterion; this only catches a header that says the
	// image loads somewhere it physically cannot fit, which would otherwise be
	// mishandled silently.
	if (hasUploadHeader && declaredAddress + declaredSize > ARAM_SIZE) {
		throw new DriverError(
			`This driver declares that it loads at $${hex(declaredAddress)} and is ` +
				`0x${hex(declaredSize)} bytes, which runs past the end of ARAM.`,
		);
	}

	const programData = hasUploadHeader ? raw.subarray(4) : raw;
	const programPos = hasUploadHeader ? declaredAddress : manifest.programPos;
	if (hasUploadHeader) {
		notes.push(`upload header: 0x${hex(declaredSize)} bytes at $${hex(programPos)}`);
	} else {
		notes.push(`no upload header`);
	}

	const mainLoopPos = findMainLoop(programData, programPos) ?? manifest.mainLoopPos;
	if (mainLoopPos !== manifest.mainLoopPos) {
		notes.push(`MainLoop found at $${hex(mainLoopPos)}`);
	} else if (findMainLoop(programData, programPos) === null) {
		notes.push(`MainLoop not found; using the manifest value $${hex(mainLoopPos)}`);
	}

	const table = hasUploadHeader ? findSongTable(programData, programPos) : null;
	if (table) {
		notes.push(
			`song table at $${hex(table.songPointers)}; ` +
				`your song takes slot ${table.songIndex} at $${hex(table.localPos)}`,
		);
		// Follow the table, not the image length: the driver jumps wherever this
		// slot points, so that is where the song has to be.
		return {
			programData,
			programPos,
			mainLoopPos,
			songPointers: table.songPointers,
			embedded: { localPos: table.localPos, songIndex: table.songIndex },
			notes,
		};
	}

	if (hasUploadHeader) {
		// Say what was looked for, so a build we cannot read is diagnosable
		// rather than just silently downgraded.
		const localPos = programPos + programData.length;
		notes.push(`no song table found (nothing points at $${hex(localPos)}); treating this as a build without one`);
	}

	// Second-pass build: `SongPointers:` is the last label in main.asm, so the
	// table begins exactly where the image ends. `planAram` appends it.
	const songPointers = programPos + programData.length;
	if (!custom && songPointers !== manifest.songPointers) {
		throw new DriverError(
			`main.bin ends at $${hex(songPointers)}, but manifest.json puts SongPointers at ` +
				`$${hex(manifest.songPointers)}. Since SongPointers is the last label in main.asm, ` +
				`those must match — set songPointers to $${hex(songPointers)} for this driver build.`,
		);
	}

	return { programData, programPos, mainLoopPos, songPointers, embedded: null, notes };
}

/**
 * `MainLoop:` is `mov y,$fd / beq MainLoop` — the timer-tick wait at the head of
 * the driver's loop. That is `EB FD F0 FC`, which occurs exactly once in the
 * stock driver, so it identifies the label without needing asar's symbol output.
 */
function findMainLoop(programData: Uint8Array, programPos: number): number | null {
	for (let i = 0; i + 3 < programData.length; i++) {
		if (
			programData[i] === 0xeb &&
			programData[i + 1] === 0xfd &&
			programData[i + 2] === 0xf0 &&
			programData[i + 3] === 0xfc
		) {
			return programPos + i;
		}
	}

	return null;
}

/**
 * Recovers the song pointer table from a final-pass build.
 *
 * Layout is `[driver][SongPointers: dw song01…dw localSong][song data…]`, with
 * `localSong` labelling the very end of the image. So the table's last entry
 * equals `programPos + length`, entries strictly increase, and — the decisive
 * check — the first entry points at the byte just past the table.
 */
function findSongTable(
	programData: Uint8Array,
	programPos: number,
): { songPointers: number; songIndex: number; localPos: number } | null {
	const imageEnd = programPos + programData.length;

	// Song numbers go into CPUIO $F6, one byte, so a table cannot usefully hold
	// more than 256 slots.
	const MAX_ENTRIES = 256;

	let best: { songPointers: number; songIndex: number; localPos: number } | null = null;
	let bestDistance = Infinity;

	// `start + 1` only: a build with no global songs has a one-entry table.
	for (let start = 0; start + 1 < programData.length; start++) {
		// The first global song's data begins immediately after the table, so the
		// first entry's value states how long the table is. That is the one
		// invariant that holds no matter how many slots there are.
		const first = word(programData, start);
		const tableBytes = first - (programPos + start);
		if (tableBytes < 2 || tableBytes % 2 !== 0) {
			continue;
		}

		const entries = tableBytes / 2;
		if (entries > MAX_ENTRIES || start + tableBytes > programData.length) {
			continue;
		}

		// Entries are laid out in song order, and so is their data.
		let ascending = true;
		let previous = -1;
		for (let k = 0; k < entries; k++) {
			const value = word(programData, start + k * 2);
			if (value <= previous || value < programPos || value > ARAM_SIZE) {
				ascending = false;
				break;
			}

			previous = value;
		}

		if (!ascending) {
			continue;
		}

		// The last entry is the local song's slot. It lands at the end of the
		// image — but not always exactly: AddmusicK.cpp:1147 sizes the table as
		// `highestGlobalSong * 2 + 2`, which over-counts by 2 for every gap in
		// the Globals list, so the address it relocates songs against can sit a
		// few bytes past where `localSong:` actually assembled. Take whichever
		// candidate lands nearest the end rather than demanding an exact hit.
		const localPos = previous;
		const distance = Math.abs(localPos - imageEnd);
		if (distance > 0x100) {
			continue;
		}

		if (distance < bestDistance) {
			bestDistance = distance;
			// The last slot is the local song's, so its index is the entry count and
			// every slot before it is a global song.
			best = { songPointers: programPos + start, songIndex: entries, localPos };
		}
	}

	return best;
}

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

	const analysis = analyzeDriver(rawProgram, manifest, false);

	return {
		manifest,
		spcBase,
		dspBase,
		samples: names.map((name, index) => parseBrr(name, sampleBlobs[index])),
		...analysis,
	};
}
