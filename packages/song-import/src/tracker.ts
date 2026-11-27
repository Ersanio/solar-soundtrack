/**
 * Importing a tracker module, whatever its format: its songs found, the chosen one's play summed up
 * for the dialog, then written as an `#amk 4` song as often as the porter changes what to keep.
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
export { fundamentalHz, libraryFactor } from "./tracker/fundamental";
export { LOWEST_FACTOR, type PlannedSample, fitFactor, planSample, plannedFrames } from "./tracker/samples";
export {
	DRIVER_TICKS,
	type LibrarySample,
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
	/** Notes the song strikes on it and on its copies, on every channel. */
	notes: number;
	/** The later slots holding the same frames and loop, which share its BRR. */
	copies: number[];
}

/** One of the songs a module holds: where it starts, and how it plays from there. */
export interface TrackerSongStart {
	/** The order it starts at. */
	order: number;
	/** The pattern that order plays. */
	pattern: number;
	/** How many orders it plays. */
	orders: number;
	play: TrackerPlay;
}

export interface TrackerImport {
	song: TrackerSong;
	/** The chosen song's play: `songs[chosen].play`. */
	play: TrackerPlay;
	/** Every song the module holds (`findSongs`), the one from its first order first. */
	songs: readonly TrackerSongStart[];
	chosen: number;
	/** Notes struck on each channel. */
	channelNotes: number[];
	/** The channels that strike a note in the chosen song, in channel order: the only ones listed or kept. */
	used: number[];
	/** The channels kept until the porter chooses: every used one, or the eight that strike the most notes. */
	suggested: number[];
	/** Which channels cannot share one of AddmusicK's: any of their notes overlap. */
	clash: shared.Clashes;
	/** The channels kept when they may share: by notes struck, each taken while the packing fits eight. */
	suggestedShared: number[];
	/** The slots that hold a sample, a copy of an earlier one left out. */
	samples: TrackerSampleSummary[];
	/** Each slot holding the same frames and loop as an earlier one, to that earlier one (`copiesOf`). */
	sameAs: ReadonlyMap<number, number>;
}

/**
 * Each sample slot whose frames and loop are an earlier slot's, to that earlier slot: a module that
 * lists one sample under several slots (XMSNES merges them the same way) needs it in ARAM once.
 * Their rates can differ, so each keeps an instrument of its own.
 */
export function copiesOf(song: TrackerSong): Map<number, number> {
	const sameAs = new Map<number, number>();
	const firsts = new Map<string, number[]>();
	for (const s of song.samples) {
		if (s.pcm.length === 0) {
			continue;
		}

		const key = `${s.pcm.length}:${s.loopStart}:${s.loopLength}`;
		const candidates = firsts.get(key) ?? [];
		const first = candidates.find((index) => {
			const other = song.samples[index - 1].pcm;
			return other.every((v, i) => v === s.pcm[i]);
		});
		if (first === undefined) {
			firsts.set(key, [...candidates, s.index]);
		} else {
			sameAs.set(s.index, first);
		}
	}

	return sameAs;
}

/** Channel order is the order kept channels are written in. */
const inOrder = (channels: Iterable<number>): number[] => [...new Set(channels)].sort((a, b) => a - b);

/** Every channel that strikes a note, the one that strikes the most first. */
function byNotes(channelNotes: readonly number[]): number[] {
	return channelNotes
		.map((notes, channel) => ({ notes, channel }))
		.filter((c) => c.notes > 0)
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

/**
 * Every song in a module, found as libopenmpt finds subsongs (`RowVisitor::GetFirstUnvisitedRow`):
 * played from the first order `startsAt` accepts, then from each first order no song before has
 * played, until every order has been. A game's module can hold several, each entered at its own
 * order (Deus Ex's), or a module can list them between `---` markers. The first is always kept, a
 * later one only where it strikes a note.
 */
export function findSongs(
	orders: readonly number[],
	startsAt: (order: number) => boolean,
	play: (start: number) => TrackerPlay,
): TrackerSongStart[] {
	const visited = new Set<number>();
	const songs: TrackerSongStart[] = [];
	for (let order = 0; order < orders.length; order++) {
		if (visited.has(order) || !startsAt(order)) {
			continue;
		}

		const played = play(order);
		const its = new Set(played.segments.map((s) => s.order));
		its.add(order);
		for (const o of its) {
			visited.add(o);
		}

		const strikes = played.channels.some((ch) => ch.keyOn.includes(1));
		if (songs.length === 0 || strikes) {
			songs.push({ order, pattern: orders[order], orders: its.size, play: played });
		}
	}

	if (songs.length === 0) {
		const played = play(0);
		songs.push({ order: 0, pattern: orders[0] ?? 0, orders: played.segments.length, play: played });
	}

	return songs;
}

/** `imported` summed up again for another of its songs. */
export function withSong<T extends TrackerImport>(imported: T, chosen: number): T {
	return { ...imported, ...summarise(imported.song, imported.songs, chosen) };
}

/** What the dialog needs of a module, for the song `chosen` of the ones its format's player found. */
export function summarise(song: TrackerSong, songs: readonly TrackerSongStart[], chosen = 0): TrackerImport {
	const play = songs[chosen].play;
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

	const sameAs = copiesOf(song);
	const copies = new Map<number, number[]>();
	for (const [copy, first] of sameAs) {
		copies.set(first, [...(copies.get(first) ?? []), copy]);
	}

	return {
		song,
		play,
		songs,
		chosen,
		channelNotes,
		used: inOrder(byNotes(channelNotes)),
		suggested: ranked,
		clash,
		suggestedShared: shared.addWhileFits(byNotes(channelNotes), [], clash, TRACKER_CHANNEL_LIMIT, inOrder),
		sameAs,
		samples: song.samples
			.filter((s) => s.pcm.length > 0 && !sameAs.has(s.index))
			.map((s) => ({
				index: s.index,
				name: s.name,
				frames: s.pcm.length,
				loop: s.loopLength > 0 ? { start: s.loopStart, length: s.loopLength } : null,
				notes: [s.index, ...(copies.get(s.index) ?? [])].reduce((sum, i) => sum + (struck.get(i) ?? 0), 0),
				copies: copies.get(s.index) ?? [],
			})),
	};
}

/** Writes the import as an `#amk 4` song. */
export function writeTracker(imported: TrackerImport, options: TrackerSongOptions): WrittenTrackerSong {
	return writeTrackerSong(imported.song, imported.play, options, imported.clash, imported.sameAs);
}
