/**
 * Importing a tracker module, whatever its format: a song and its play summed up for the dialog once,
 * then written as an `#amk 4` song as often as the porter changes what to keep.
 *
 * Each format's reader and player hand over a {@link TrackerSong} and a {@link TrackerPlay}; from
 * there every format is alike. The package hands back PCM and never BRR: encoding is `@amk/spc`'s,
 * which this package may not reach, so the caller encodes each planned sample.
 */

import type { TrackerPlay, TrackerSong } from "./tracker/model";
import {
	TRACKER_CHANNEL_LIMIT,
	type TrackerSongOptions,
	type WrittenTrackerSong,
	writeTrackerSong,
} from "./tracker/write-mml";

export type { TrackerPlay, TrackerSample, TrackerSong } from "./tracker/model";
export { LOWEST_FACTOR, type PlannedSample, fitFactor, planSample, plannedFrames } from "./tracker/samples";
export {
	DRIVER_TICKS,
	type SongSample,
	TRACKER_CHANNEL_LIMIT,
	type TrackerImportWarning,
	type TrackerSongOptions,
	type WrittenTrackerSong,
} from "./tracker/write-mml";

/** A sample slot as the dialog lists it. */
export interface TrackerSampleSummary {
	index: number;
	name: string;
	frames: number;
	/** The loop in frames, or `null` for a one-shot. */
	loop: { start: number; length: number } | null;
	/** Notes the song strikes on it, on every channel. */
	notes: number;
}

export interface TrackerImport {
	song: TrackerSong;
	play: TrackerPlay;
	/** Notes struck on each channel. */
	channelNotes: number[];
	/** The channels kept until the porter chooses: all of them, or the eight that strike the most notes. */
	suggested: number[];
	/** The slots that hold a sample. */
	samples: TrackerSampleSummary[];
}

/** What the dialog needs of a song its format's player has played. */
export function summarise(song: TrackerSong, play: TrackerPlay): TrackerImport {
	const channelNotes = play.channels.map((ch) => ch.keyOn.reduce((sum, on) => sum + on, 0));
	const ranked = channelNotes
		.map((notes, channel) => ({ notes, channel }))
		.sort((a, b) => b.notes - a.notes || a.channel - b.channel)
		.slice(0, TRACKER_CHANNEL_LIMIT)
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
		song,
		play,
		channelNotes,
		suggested: ranked,
		samples: song.samples
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
export function writeTracker(imported: TrackerImport, options: TrackerSongOptions): WrittenTrackerSong {
	return writeTrackerSong(imported.song, imported.play, options);
}
