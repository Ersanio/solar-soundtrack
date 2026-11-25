/**
 * Importing a MOD: read, played as ProTracker plays it, and handed to the tracker importer, which
 * writes it as a song with its samples planned for BRR.
 *
 * The steps and why they are shaped as they are is in this package's `CLAUDE.md`.
 */

import { type ModFile, readModFile } from "./mod/file";
import { C2_PERIOD, PAULA_HZ, playMod } from "./mod/play";
import { type TrackerImport, findSongs, summarise } from "./tracker";
import type { TrackerSong } from "./tracker/model";

export { ModError, type ModErrorCode, type ModFile, type ModSample } from "./mod/file";

export interface ModImport extends TrackerImport {
	file: ModFile;
}

/** The file in the tracker model's terms: 16-bit PCM, and each sample's C-2 rate at its finetune. */
export function modSong(file: ModFile): TrackerSong {
	return {
		format: "MOD",
		title: file.title,
		tag: file.tag,
		channels: file.channels,
		orders: file.orders.length,
		truncated: file.truncated,
		samples: file.samples.map((s) => ({
			index: s.index,
			name: s.name,
			pcm: Int16Array.from(s.pcm, (v) => v * 256),
			baseHz: (PAULA_HZ / C2_PERIOD) * 2 ** (s.finetune / 96),
			loopStart: s.loopStart,
			loopLength: s.loopLength,
		})),
	};
}

/** Reads a MOD and plays each song it holds. Throws {@link ModError} for a file it cannot read at all. */
export function readMod(bytes: Uint8Array): ModImport {
	const file = readModFile(bytes);
	const songs = findSongs(
		file.orders,
		() => true,
		(start) => playMod(file, start),
	);
	return { ...summarise(modSong(file), songs), file };
}
