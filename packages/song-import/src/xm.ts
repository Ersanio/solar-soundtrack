/**
 * Importing an XM: read, played as FastTracker II plays it, and handed to the tracker importer, which
 * writes it as a song with its samples planned for BRR.
 *
 * The steps and why they are shaped as they are is in this package's `CLAUDE.md`.
 */

import { type TrackerImport, summarise } from "./tracker";
import type { TrackerSong } from "./tracker/model";
import { type XmFile, readXmFile } from "./xm/file";
import { playXm, xmBaseHz } from "./xm/play";

export { XmError, type XmErrorCode, type XmFile } from "./xm/file";

export interface XmImport extends TrackerImport {
	file: XmFile;
}

/** The file in the tracker model's terms: every instrument's samples in one list, each at its C-4 rate. */
export function xmSong(file: XmFile): TrackerSong {
	return {
		format: "XM",
		title: file.title,
		tag: "XM",
		channels: file.channels,
		orders: file.orders.length,
		truncated: file.truncated,
		samples: file.instruments.flatMap((instrument) =>
			instrument.samples.map((s) => ({
				index: s.index,
				name: instrument.samples.length > 1 ? `${instrument.name} ${s.name}`.trim() : instrument.name || s.name,
				pcm: s.pcm,
				baseHz: xmBaseHz(s),
				loopStart: s.loopStart,
				loopLength: s.loopLength,
			})),
		),
	};
}

/** Reads and plays an XM. Throws {@link XmError} for a file it cannot read at all. */
export function readXm(bytes: Uint8Array): XmImport {
	const file = readXmFile(bytes);
	return { ...summarise(xmSong(file), playXm(file)), file };
}
