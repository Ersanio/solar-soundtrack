/**
 * Which parts can share a channel: two parts whose notes never sound at the same time, give or take
 * a short overlap the writer trims, take turns on one channel.
 *
 * The writer states a channel's instrument, volume, pan, vibrato and `q` wherever the next note
 * needs them, so a channel holding two parts in turn switches between them at each hand-over.
 * Parts are packed first-fit in part order — each on the lowest channel holding nothing it clashes
 * with — so keeping or dropping one part moves as few of the others as it can.
 */

import { type Part, byPriority, inPartOrder } from "./parts";

/** Whether two parts clash, by part index; parts with no note in common time are `false`. */
export type Clashes = readonly (readonly boolean[])[];

interface Span {
	start: number;
	end: number;
}

/**
 * Whether two notes on one channel would cut each other short. Only a hand-over may overlap: the
 * later note starting within `slack` of the earlier one's end and outlasting it, which the writer
 * trims as it trims a legato line. A note inside another, two struck together, or any overlap with
 * a drum hit, clashes.
 */
function cuts(x: Span, y: Span, slack: number): boolean {
	if (x.start === y.start) {
		return true;
	}

	const [first, later] = x.start < y.start ? [x, y] : [y, x];
	if (later.start >= first.end) {
		return false;
	}

	return slack === 0 || later.start < first.end - slack || later.end <= first.end;
}

/** Whether two parts' notes, each sorted by start, cut each other short anywhere. */
function overlap(a: Part, b: Part, slack: number): boolean {
	const tolerance = a.drums || b.drums ? 0 : slack;
	let i = 0;
	let j = 0;
	while (i < a.notes.length && j < b.notes.length) {
		const x = a.notes[i];
		const y = b.notes[j];
		if (cuts(x, y, tolerance)) {
			return true;
		}

		if (x.end <= y.end) {
			i++;
		} else {
			j++;
		}
	}

	return false;
}

/** Every pair of parts that cannot share a channel. */
export function clashes(parts: readonly Part[], slack: number): Clashes {
	const out = parts.map(() => parts.map(() => false));
	for (let i = 0; i < parts.length; i++) {
		for (let j = i + 1; j < parts.length; j++) {
			const clash = overlap(parts[i], parts[j], slack);
			out[i][j] = clash;
			out[j][i] = clash;
		}
	}

	return out;
}

/** The parts on each channel, packed first-fit in the order given. Part ids, not indices. */
export function packChannels(parts: readonly Part[], keep: readonly string[], clash: Clashes): string[][] {
	const index = new Map(parts.map((part, i) => [part.id, i]));
	const channels: number[][] = [];
	for (const id of keep) {
		const at = index.get(id);
		if (at === undefined) {
			continue;
		}

		const home = channels.find((channel) => channel.every((other) => !clash[at][other]));
		if (home) {
			home.push(at);
		} else {
			channels.push([at]);
		}
	}

	return channels.map((channel) => channel.map((at) => parts[at].id));
}

/** Whether keeping `keep` (in part order) fits on `limit` channels when parts may share. */
export function fits(parts: readonly Part[], keep: readonly string[], clash: Clashes, limit: number): boolean {
	return packChannels(parts, keep, clash).length <= limit;
}

/** `keep`, with every other part added in priority order that still lets the packing fit `limit` channels. */
export function addWhileFits(parts: readonly Part[], keep: readonly string[], clash: Clashes, limit: number): string[] {
	let kept = inPartOrder(parts, keep);
	for (const part of byPriority(parts)) {
		if (kept.includes(part.id)) {
			continue;
		}

		const next = inPartOrder(parts, [...kept, part.id]);
		if (fits(parts, next, clash, limit)) {
			kept = next;
		}
	}

	return kept;
}

/** `keep` cut to one part a channel: the first `limit` of it by priority. */
export function oneEach(parts: readonly Part[], keep: readonly string[], limit: number): string[] {
	const chosen = new Set(keep);
	return inPartOrder(
		parts,
		byPriority(parts)
			.filter((p) => chosen.has(p.id))
			.slice(0, limit)
			.map((p) => p.id),
	);
}
