/**
 * Importing a MOD: read and played once, then written as a song, with its samples planned for BRR,
 * as often as the porter changes what to keep.
 *
 * The package hands back PCM and never BRR: encoding is `@amk/spc`'s, which this package may not
 * reach, so the caller encodes each planned sample. The steps and why they are shaped as they are is
 * in this package's `CLAUDE.md`.
 */

import { type ModFile, readModFile } from "./mod/file";
import { type ModPlay, playMod } from "./mod/play";
import { MOD_CHANNEL_LIMIT, type ModSongOptions, type WrittenModSong, writeModSong } from "./mod/write-mml";

export { ModError, type ModErrorCode, type ModFile, type ModSample } from "./mod/file";
export type { ModPlay } from "./mod/play";
export { LOWEST_FACTOR, type PlannedSample, fitFactor, planSample, plannedFrames } from "./mod/samples";
export {
	DRIVER_TICKS,
	MOD_CHANNEL_LIMIT,
	type ModImportWarning,
	type ModSongOptions,
	type SongSample,
	type WrittenModSong,
} from "./mod/write-mml";

/** A sample slot as the dialog lists it. */
export interface ModSampleSummary {
	index: number;
	name: string;
	frames: number;
	/** The loop in frames, or `null` for a one-shot. */
	loop: { start: number; length: number } | null;
	/** Notes the song strikes on it, on every channel. */
	notes: number;
}

export interface ModImport {
	file: ModFile;
	play: ModPlay;
	/** Notes struck on each channel. */
	channelNotes: number[];
	/** The channels kept until the porter chooses: all of them, or the eight that strike the most notes. */
	suggested: number[];
	/** The slots that hold a sample. */
	samples: ModSampleSummary[];
}

/** Reads and plays a MOD. Throws {@link ModError} for a file it cannot read at all. */
export function readMod(bytes: Uint8Array): ModImport {
	const file = readModFile(bytes);
	const play = playMod(file);
	const channelNotes = play.channels.map((ch) => ch.keyOn.reduce((sum, on) => sum + on, 0));
	const ranked = channelNotes
		.map((notes, channel) => ({ notes, channel }))
		.sort((a, b) => b.notes - a.notes || a.channel - b.channel)
		.slice(0, MOD_CHANNEL_LIMIT)
		.map((c) => c.channel)
		.sort((a, b) => a - b);
	const struck = new Map<number, number>();
	for (const ch of play.channels) {
		ch.keyOn.forEach((on, t) => {
			if (on) {
				struck.set(ch.sample[t], (struck.get(ch.sample[t]) ?? 0) + 1);
			}
		});
	}

	return {
		file,
		play,
		channelNotes,
		suggested: ranked,
		samples: file.samples
			.filter((s) => s.pcm.length > 0)
			.map((s) => ({
				index: s.index,
				name: s.name,
				frames: s.pcm.length,
				loop: s.loopLength > 0 ? { start: s.loopStart, length: s.loopLength } : null,
				notes: struck.get(s.index) ?? 0,
			})),
	};
}

/** Writes the import as an `#amk 4` song. */
export function writeMod(mod: ModImport, options: ModSongOptions): WrittenModSong {
	return writeModSong(mod.file, mod.play, options);
}
