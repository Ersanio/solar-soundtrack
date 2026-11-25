/**
 * Importing a tracker module, whatever its format: a song and its play summed up for the dialog once,
 * then written as an `#amk 4` song as often as the porter changes what to keep.
 *
 * Each format's reader and player hand over a {@link TrackerSong} and a {@link TrackerPlay}; from
 * there every format is alike. The package hands back PCM and never BRR: encoding is `@amk/spc`'s,
 * which this package may not reach, so the caller encodes each planned sample.
 */

import * as shared from "./mml/channels";
import type { TrackerPlay, TrackerSong } from "./tracker/model";
import {
	TRACKER_CHANNEL_LIMIT,
	type TrackerSongOptions,
	type WrittenTrackerSong,
	notesOf,
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
	/** Which channels cannot share one of AddmusicK's: any of their notes overlap. */
	clash: shared.Clashes;
	/** The channels kept when they may share: by notes struck, each taken while the packing fits eight. */
	suggestedShared: number[];
	/** The slots that hold a sample. */
	samples: TrackerSampleSummary[];
}

/** Channel order is the order kept channels are written in. */
const inOrder = (channels: Iterable<number>): number[] => [...new Set(channels)].sort((a, b) => a - b);

/** Every channel, the one that strikes the most notes first. */
function byNotes(channelNotes: readonly number[]): number[] {
	return channelNotes
		.map((notes, channel) => ({ notes, channel }))
		.sort((a, b) => b.notes - a.notes || a.channel - b.channel)
		.map((c) => c.channel);
}

/** Whether keeping `keep` fits on AddmusicK's channels when channels may share. */
export function fitsShared(imported: TrackerImport, keep: readonly number[]): boolean {
	return shared.fits(inOrder(keep), imported.clash, TRACKER_CHANNEL_LIMIT);
}

/** `keep`, with every other channel added, most notes first, that still lets the packing fit. */
export function addWhileFits(imported: TrackerImport, keep: readonly number[]): number[] {
	return shared.addWhileFits(byNotes(imported.channelNotes), keep, imported.clash, TRACKER_CHANNEL_LIMIT, inOrder);
}

/** `keep` cut to one channel each of AddmusicK's: the eight of it that strike the most notes. */
export function oneEach(imported: TrackerImport, keep: readonly number[]): number[] {
	return shared.oneEach(byNotes(imported.channelNotes), keep, TRACKER_CHANNEL_LIMIT, inOrder);
}

/** What the dialog needs of a song its format's player has played. */
export function summarise(song: TrackerSong, play: TrackerPlay): TrackerImport {
	const channelNotes = play.channels.map((ch) => ch.keyOn.reduce((sum, on) => sum + on, 0));
	const ranked = inOrder(byNotes(channelNotes).slice(0, TRACKER_CHANNEL_LIMIT));
	// With every sample played: dropping one only takes notes away, so a pair apart stays apart.
	const playable = (index: number): boolean => (song.samples[index - 1]?.pcm.length ?? 0) > 0;
	const clash = shared.clashes(
		play.channels.map((ch) => ({ notes: notesOf(ch, play.ticks, null, playable) })),
		0,
	);
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
		clash,
		suggestedShared: shared.addWhileFits(byNotes(channelNotes), [], clash, TRACKER_CHANNEL_LIMIT, inOrder),
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
	return writeTrackerSong(imported.song, imported.play, options, imported.clash);
}
