/**
 * Importing an IT: read, played as Impulse Tracker 2 plays it, and handed to the tracker importer,
 * which writes it as a song with its samples planned for BRR.
 *
 * The steps and why they are shaped as they are is in this package's `CLAUDE.md`.
 */

import { type ItFile, readItFile } from "./it/file";
import { playIt } from "./it/play";
import { type TrackerImport, summarise } from "./tracker";
import type { TrackerSong } from "./tracker/model";

export { ItError, type ItErrorCode, type ItFile } from "./it/file";

export interface ItImport extends TrackerImport {
	file: ItFile;
}

/** The file in the tracker model's terms: each sample's C-5 rate is its C5Speed. */
export function itSong(file: ItFile): TrackerSong {
	return {
		format: "IT",
		title: file.title,
		tag: "IT",
		channels: file.channels,
		orders: file.orders.filter((o) => o < 254).length,
		truncated: file.truncated,
		samples: file.samples.map((s) => ({
			index: s.index,
			name: s.name,
			pcm: s.pcm,
			baseHz: s.c5Speed,
			loopStart: s.loopStart,
			loopLength: s.loopLength,
		})),
	};
}

/** Reads and plays an IT. Throws {@link ItError} for a file it cannot read at all. */
export function readIt(bytes: Uint8Array): ItImport {
	const file = readItFile(bytes);
	return { ...summarise(itSong(file), playIt(file)), file };
}
