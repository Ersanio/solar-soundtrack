/**
 * Importing an S3M: read, played as Scream Tracker 3 plays it, and handed to the tracker importer,
 * which writes it as a song with its samples planned for BRR.
 *
 * The steps and why they are shaped as they are is in this package's `CLAUDE.md`.
 */

import { type S3mFile, readS3mFile } from "./s3m/file";
import { playS3m } from "./s3m/play";
import { type TrackerImport, findSongs, summarise } from "./tracker";
import type { TrackerSong } from "./tracker/model";

export { S3mError, type S3mErrorCode, type S3mFile, type S3mSample } from "./s3m/file";

export interface S3mImport extends TrackerImport {
	file: S3mFile;
}

/** The file in the tracker model's terms: each sample's C-4 rate is its C2SPD. */
export function s3mSong(file: S3mFile): TrackerSong {
	return {
		format: "S3M",
		title: file.title,
		tag: "S3M",
		channels: file.channels,
		orders: file.orders.filter((o) => o < 254).length,
		truncated: file.truncated,
		samples: file.samples.map((s) => ({
			index: s.index,
			name: s.name,
			pcm: s.pcm,
			baseHz: s.c2spd,
			loopStart: s.loopStart,
			loopLength: s.loopLength,
		})),
	};
}

/** Reads an S3M and plays each song it holds. Throws {@link S3mError} for a file it cannot read at all. */
export function readS3m(bytes: Uint8Array): S3mImport {
	const file = readS3mFile(bytes);
	const songs = findSongs(
		file.orders,
		(o) => file.orders[o] < 254,
		(start) => playS3m(file, start),
	);
	return { ...summarise(s3mSong(file), songs), file };
}
