/**
 * A MIDI channel's notes split into parts that each play one note at a time, which is all an
 * AddmusicK channel can do.
 *
 * Notes struck together are matched to the free voices without crossing them, top note to top voice,
 * moving each voice as little as it can and opening a voice only where none is free, so a melody and
 * a bass line played on one channel each keep a voice of their own and a chord's lines do not cross.
 * A voice is free once its last note has ended, give or take a short overlap — a legato line overlaps its notes by a few ticks — which the writer trims.
 * Drums are split by kit family first (kick and snare, hi-hats and cymbals, the rest), so a family
 * is kept or dropped whole, and a hit occupies its voice for that short overlap alone.
 */

import { type DrumFamily, type DrumMatch, GM_DRUMS, GM_PROGRAMS } from "./gm";
import { type ChannelPerformance, type MidiNote, type Performance, quarterTicks } from "./performance";

/** One note of a part, and the drum it was matched to on a kit channel. */
export interface PartNote extends MidiNote {
	drum: DrumMatch | null;
}

export interface Part {
	/** Stable for the life of an import: `<channel>:<family or m>:<voice>`. */
	id: string;
	/** 0-15. */
	channel: number;
	drums: boolean;
	family: DrumFamily | null;
	/** 0-based within the channel, or within the family on a kit. */
	voice: number;
	/** How many voices the channel, or the family, was split into. */
	voices: number;
	notes: PartNote[];
	/** The program most of the part's notes are played with. */
	program: number;
	/** The stock instrument that program matches; a kit's parts carry their first drum. */
	instrument: number;
	name: string | null;
	noteCount: number;
	/** How much the part sounds, in file ticks: the sum of its notes' lengths, a kit's hits weighted as a quarter note each. */
	weight: number;
	/** The lowest and highest keys it plays. */
	low: number;
	high: number;
}

export interface Split {
	parts: Part[];
	/** Kit hits on a key no stock drum stands in for. */
	unmappedDrums: number;
	/** The hits on each kit key a stock drum stands in for, by GM key. */
	drumKeys: Map<number, number>;
}

const FAMILY_ORDER: readonly DrumFamily[] = ["kick-snare", "cymbals", "percussion"];

interface Voice {
	notes: PartNote[];
	/** When the last note ends, for overlap. */
	end: number;
	key: number;
}

/** What opening a new voice costs, past any move a voice can make, so a free voice is always reused first. */
const NEW_VOICE = 128;

/** Whether `voice` has finished its last note in time for one starting at `start` and lasting `length`. */
function free(voice: Voice, start: number, length: number, slack: number, drums: boolean): boolean {
	const last = voice.notes[voice.notes.length - 1];
	const allowance = drums ? 0 : Math.min(slack, (last.end - last.start) / 2, length / 2);
	return voice.end - allowance <= start;
}

/**
 * Notes struck together (highest first) matched to the free voices (highest first) without
 * crossing: the i-th note may take a voice only below the one the note above it took. Of those
 * matchings, the one that moves the voices least, where a note with no voice left opens one.
 */
function match(chord: readonly PartNote[], voices: readonly Voice[]): (Voice | null)[] {
	const n = chord.length;
	const m = voices.length;
	// cost[i][j]: the best for the first i notes using the first j voices.
	const cost = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(Infinity));
	const from = Array.from({ length: n + 1 }, () => new Array<"take" | "skip" | "open">(m + 1).fill("skip"));
	cost[0][0] = 0;
	for (let i = 0; i <= n; i++) {
		for (let j = 0; j <= m; j++) {
			if (i === 0 && j === 0) {
				continue;
			}

			let best = Infinity;
			let how: "take" | "skip" | "open" = "skip";
			if (j > 0 && cost[i][j - 1] < best) {
				best = cost[i][j - 1];
				how = "skip";
			}

			if (i > 0 && cost[i - 1][j] + NEW_VOICE < best) {
				best = cost[i - 1][j] + NEW_VOICE;
				how = "open";
			}

			if (i > 0 && j > 0) {
				const take = cost[i - 1][j - 1] + Math.abs(voices[j - 1].key - chord[i - 1].key);
				if (take < best) {
					best = take;
					how = "take";
				}
			}

			cost[i][j] = best;
			from[i][j] = how;
		}
	}

	const out: (Voice | null)[] = new Array<Voice | null>(n).fill(null);
	let i = n;
	let j = m;
	while (i > 0 || j > 0) {
		const how = from[i][j];
		if (how === "take") {
			out[i - 1] = voices[j - 1];
			i--;
			j--;
		} else if (how === "open") {
			i--;
		} else {
			j--;
		}
	}

	return out;
}

/** Splits `notes` (sorted by start, higher key first) into voices that never overlap by more than `slack`. */
function allocate(notes: readonly PartNote[], slack: number, drums: boolean): PartNote[][] {
	const voices: Voice[] = [];
	const place = (note: PartNote, voice: Voice | null): void => {
		const target = voice ?? { notes: [], end: 0, key: note.key };
		if (!voice) {
			voices.push(target);
		}

		target.notes.push(note);
		target.end = drums ? note.start + slack : note.end;
		target.key = note.key;
	};

	for (let at = 0; at < notes.length;) {
		// A chord: the notes struck within `slack` of the first.
		let end = at + 1;
		while (end < notes.length && notes[end].start - notes[at].start <= slack) {
			end++;
		}

		const chord = notes.slice(at, end);
		at = end;
		const start = chord[0].start;
		const shortest = Math.min(...chord.map((n) => n.end - n.start));
		const open = voices.filter((voice) => free(voice, start, drums ? 0 : shortest, slack, drums));
		if (drums) {
			// A kit's voices are not lines: each hit takes the first free one.
			for (const note of chord) {
				place(note, open.shift() ?? null);
			}

			continue;
		}

		chord.sort((a, b) => b.key - a.key);
		const sorted = [...open].sort((a, b) => b.key - a.key);
		const matched = match(chord, sorted);
		chord.forEach((note, i) => place(note, matched[i]));
	}

	// The top line first, as a score reads.
	const mean = (voice: Voice): number => voice.notes.reduce((sum, n) => sum + n.key, 0) / voice.notes.length;
	return (drums ? voices : [...voices].sort((a, b) => mean(b) - mean(a))).map((voice) => voice.notes);
}

function mostCommon(values: readonly number[]): number {
	const counts = new Map<number, number>();
	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}

	return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
}

function part(
	channel: ChannelPerformance,
	family: DrumFamily | null,
	voice: number,
	voices: number,
	notes: PartNote[],
	quarter: number,
): Part {
	const program = mostCommon(notes.map((note) => note.program));
	return {
		id: `${channel.channel}:${family ?? "m"}:${voice}`,
		channel: channel.channel,
		drums: channel.drums,
		family,
		voice,
		voices,
		notes,
		program,
		instrument: channel.drums ? (notes[0].drum?.instrument ?? 21) : GM_PROGRAMS[program],
		name: channel.name,
		noteCount: notes.length,
		weight: channel.drums ? notes.length * quarter : notes.reduce((sum, n) => sum + n.end - n.start, 0),
		low: notes.reduce((low, n) => Math.min(low, n.key), 127),
		high: notes.reduce((high, n) => Math.max(high, n.key), 0),
	};
}

/** Splits every channel of the performance into parts, melodic channels in order and the kits after them. */
export function splitParts(performance: Performance): Split {
	const quarter = quarterTicks(performance);
	// A sixty-fourth note: enough to forgive a legato overlap or a flam, too little to merge two notes.
	const slack = quarter / 16;
	const melodic: Part[] = [];
	const kits: Part[] = [];
	let unmappedDrums = 0;
	const drumKeys = new Map<number, number>();

	for (const channel of performance.channels) {
		if (!channel.drums) {
			const notes = channel.notes.map((note) => ({ ...note, drum: null }));
			const voices = allocate(notes, slack, false);
			voices.forEach((voice, index) => melodic.push(part(channel, null, index, voices.length, voice, quarter)));
			continue;
		}

		const byFamily = new Map<DrumFamily, PartNote[]>();
		for (const note of channel.notes) {
			const drum = GM_DRUMS.get(note.key);
			if (!drum) {
				unmappedDrums++;
				continue;
			}

			drumKeys.set(note.key, (drumKeys.get(note.key) ?? 0) + 1);
			const list = byFamily.get(drum.family) ?? [];
			list.push({ ...note, drum });
			byFamily.set(drum.family, list);
		}

		for (const family of FAMILY_ORDER) {
			const notes = byFamily.get(family);
			if (!notes) {
				continue;
			}

			const voices = allocate(notes, slack, true);
			voices.forEach((voice, index) => kits.push(part(channel, family, index, voices.length, voice, quarter)));
		}
	}

	return { parts: [...melodic, ...kits], unmappedDrums, drumKeys };
}

/**
 * The parts in the order they are offered a channel: every channel's and every kit family's first
 * voice before any second one, so each instrument is heard, and within that the parts that sound
 * the most.
 */
export function byPriority(parts: readonly Part[]): Part[] {
	return [...parts].sort((a, b) => Number(a.voice > 0) - Number(b.voice > 0) || b.weight - a.weight);
}

/** `ids` in part order, which is the order kept parts are written in. */
export function inPartOrder(parts: readonly Part[], ids: Iterable<string>): string[] {
	const chosen = new Set(ids);
	return parts.filter((p) => chosen.has(p.id)).map((p) => p.id);
}

/** The parts an import keeps unless the porter says otherwise, one a channel: the first `limit` by priority. */
export function suggestedParts(parts: readonly Part[], limit = 8): string[] {
	return inPartOrder(
		parts,
		byPriority(parts)
			.slice(0, limit)
			.map((p) => p.id),
	);
}
