/**
 * Which voices can share an AddmusicK channel, whatever the format: two whose notes never sound at the
 * same time, give or take a short hand-over the writer trims, take turns on one channel.
 *
 * Voices are packed first-fit in the order given, each on the lowest channel holding nothing it
 * clashes with, so keeping or dropping one moves as few of the others as it can. Everything here
 * works on indices into the caller's list of voices.
 */

/** A note's time on a voice. */
export interface Span {
	start: number;
	end: number;
}

/** What sharing needs of a voice: its notes sorted by start, and whether it is a drum part. */
export interface Voice {
	notes: readonly Span[];
	drums?: boolean;
}

/** Whether two voices clash, by index; voices with no note in common time are `false`. */
export type Clashes = readonly (readonly boolean[])[];

/**
 * Whether two notes on one channel would cut each other short. Only a hand-over may overlap: the
 * later note starting within `slack` of the earlier one's end and outlasting it, which the writer
 * trims as it trims a legato line. A note inside another, two struck together, or any overlap with
 * a drum hit, clashes. With no slack, any overlap clashes.
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

/** Whether two voices' notes cut each other short anywhere. */
function overlap(a: Voice, b: Voice, slack: number): boolean {
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

/** Every pair of voices that cannot share a channel. */
export function clashes(voices: readonly Voice[], slack: number): Clashes {
	const out = voices.map(() => voices.map(() => false));
	for (let i = 0; i < voices.length; i++) {
		for (let j = i + 1; j < voices.length; j++) {
			const clash = overlap(voices[i], voices[j], slack);
			out[i][j] = clash;
			out[j][i] = clash;
		}
	}

	return out;
}

/** The voices on each channel, packed first-fit in the order given. */
export function packChannels(keep: readonly number[], clash: Clashes): number[][] {
	const channels: number[][] = [];
	for (const at of keep) {
		const home = channels.find((channel) => channel.every((other) => !clash[at][other]));
		if (home) {
			home.push(at);
		} else {
			channels.push([at]);
		}
	}

	return channels;
}

/** Whether keeping `keep` fits on `limit` channels when voices may share. */
export function fits(keep: readonly number[], clash: Clashes, limit: number): boolean {
	return packChannels(keep, clash).length <= limit;
}

/**
 * `keep`, with every other voice of `priority` added that still lets the packing fit `limit` channels.
 * `order` puts a set of voices in the order they are packed and written.
 */
export function addWhileFits(
	priority: readonly number[],
	keep: readonly number[],
	clash: Clashes,
	limit: number,
	order: (voices: Iterable<number>) => number[],
): number[] {
	let kept = order(keep);
	for (const at of priority) {
		if (kept.includes(at)) {
			continue;
		}

		const next = order([...kept, at]);
		if (fits(next, clash, limit)) {
			kept = next;
		}
	}

	return kept;
}

/** `keep` cut to one voice a channel: the first `limit` of it in `priority`, put in `order`. */
export function oneEach(
	priority: readonly number[],
	keep: readonly number[],
	limit: number,
	order: (voices: Iterable<number>) => number[],
): number[] {
	const chosen = new Set(keep);
	return order(priority.filter((at) => chosen.has(at)).slice(0, limit));
}
