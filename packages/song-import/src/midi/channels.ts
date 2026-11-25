/**
 * Which MIDI parts can share a channel: `mml/channels.ts`'s packing, by part id and in part order.
 *
 * The writer states a channel's instrument, volume, pan, vibrato and `q` wherever the next note
 * needs them, so a channel holding two parts in turn switches between them at each hand-over.
 */

import * as shared from "../mml/channels";
import { type Part, byPriority } from "./parts";

export type { Clashes } from "../mml/channels";

/** Every pair of parts that cannot share a channel, by part index. */
export function clashes(parts: readonly Part[], slack: number): shared.Clashes {
	return shared.clashes(parts, slack);
}

/** Part order is index order. */
const inOrder = (indices: Iterable<number>): number[] => [...new Set(indices)].sort((a, b) => a - b);

/** Part ids as indices into `parts`, in the order given, leaving out any not there. */
function indicesOf(parts: readonly Part[], ids: Iterable<string>): number[] {
	const index = new Map(parts.map((part, i) => [part.id, i]));
	return [...ids].map((id) => index.get(id)).filter((at): at is number => at !== undefined);
}

const idsOf = (parts: readonly Part[], indices: readonly number[]): string[] => indices.map((at) => parts[at].id);

const priorityOf = (parts: readonly Part[]): number[] => byPriority(parts).map((p) => parts.indexOf(p));

/** The parts on each channel, packed first-fit in the order given. Part ids, not indices. */
export function packChannels(parts: readonly Part[], keep: readonly string[], clash: shared.Clashes): string[][] {
	return shared.packChannels(indicesOf(parts, keep), clash).map((channel) => idsOf(parts, channel));
}

/** Whether keeping `keep` (in part order) fits on `limit` channels when parts may share. */
export function fits(parts: readonly Part[], keep: readonly string[], clash: shared.Clashes, limit: number): boolean {
	return shared.fits(indicesOf(parts, keep), clash, limit);
}

/** `keep`, with every other part added in priority order that still lets the packing fit `limit` channels. */
export function addWhileFits(
	parts: readonly Part[],
	keep: readonly string[],
	clash: shared.Clashes,
	limit: number,
): string[] {
	return idsOf(parts, shared.addWhileFits(priorityOf(parts), indicesOf(parts, keep), clash, limit, inOrder));
}

/** `keep` cut to one part a channel: the first `limit` of it by priority. */
export function oneEach(parts: readonly Part[], keep: readonly string[], limit: number): string[] {
	return idsOf(parts, shared.oneEach(priorityOf(parts), indicesOf(parts, keep), limit, inOrder));
}
