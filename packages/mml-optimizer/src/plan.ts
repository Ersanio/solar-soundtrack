/** The passes: repeated runs made label loops, transposed or not, then superloops, then long rests looped, each checked against what the compiler would make of it. */

import type { Item, SongItems } from "./read";
import { repeats } from "./repeats";

export interface Label {
	id: number;
	body: Node[];
	/** The body's keys, which a move that failed its proof is barred by. */
	signature: string;
	/** The body sets the instrument, or plays a drum, which leaves the compiler holding another. */
	setsInstrument: boolean;
}

export type Node =
	| { kind: "item"; item: Item; index: number }
	| { kind: "use"; label: Label; count: number; shift: number; from: number; to: number }
	| { kind: "super"; body: Node[]; count: number; from: number; to: number; signature: string }
	| { kind: "rest"; unit: number; count: number; remainder: number; from: number; to: number; signature: string };

export interface PlanOptions {
	/** Loop long rests: the finalize mode's, since a looped silence cannot be drawn into. */
	restLoops: boolean;
	transpose: boolean;
	/** Signatures of moves that failed the proof. */
	barred: ReadonlySet<string>;
	/** The first label number free to use. */
	firstLabel: number;
}

export interface Plan {
	channels: Node[][];
	labels: Label[];
}

/** Bytes a loop edge costs on top of its command: the next note writes its length and q again. */
const EDGE = 2;
const CALL = 4;
const TRANSPOSE = 3;
const MAX_COUNT = 255;
const MAX_ROUNDS = 40;
const CANDIDATES_PER_ROUND = 600;
const MAX_SHIFT = 48;
/** The longest body the superloop pass looks for. */
const MAX_PERIOD = 64;

const MUSIC = new Set(["note", "rest", "tie", "command", "state", "drum"]);

/** Two instruments a note compiles alike under: the same, or two pitched ones that tune it alike. */
export function alike(song: SongItems, a: string, b: string): boolean {
	if (a === b) {
		return true;
	}

	const drum = (x: string) => /^2[1-9]$/.test(x);
	if (drum(a) || drum(b)) {
		return false;
	}

	const sa = song.shifts.get(a);
	const sb = song.shifts.get(b);
	return sa !== undefined && sb !== undefined && Number.isFinite(sa) && sa === sb;
}

function nodeBytes(node: Node): number {
	switch (node.kind) {
		case "item":
			return node.item.bytes;
		case "use":
			return CALL + EDGE;
		case "super":
			return node.body.reduce((sum, n) => sum + nodeBytes(n), 0) + 4 + EDGE;
		case "rest":
			return 7 + (node.remainder > 0 ? 2 : 0) + EDGE;
	}
}

function nodeKey(node: Node): string {
	switch (node.kind) {
		case "item":
			return node.item.key + (node.item.glued ? "#g" : "");
		case "use":
			return `use|${node.label.id}|${node.count}|${node.shift}`;
		case "super":
		case "rest":
			return node.signature;
	}
}

function glued(node: Node | undefined): boolean {
	return node?.kind === "item" && node.item.glued;
}

function nodeSetsInstrument(node: Node): boolean {
	switch (node.kind) {
		case "item":
			return node.item.setsInstrument || (node.item.kind === "note" && (node.item.emitted ?? 0) >= 0xd0);
		case "use":
			return node.label.setsInstrument;
		case "super":
			return node.body.some(nodeSetsInstrument);
		case "rest":
			return false;
	}
}

class Interner {
	private readonly ids = new Map<string, number>();
	private unique = 1 << 24;
	id(key: string): number {
		let id = this.ids.get(key);
		if (id === undefined) {
			id = this.ids.size + 1;
			this.ids.set(key, id);
		}
		return id;
	}
	fresh(): number {
		return this.unique++;
	}
}

interface Occurrence {
	at: number;
	shift: number;
}

interface Candidate {
	start: number[];
	length: number;
	occurrences: Occurrence[];
	saving: number;
	signature: string;
}

/** Finds the plan for `song`. */
export function plan(song: SongItems, options: PlanOptions): Plan {
	const channels: Node[][] = song.channels.map((c) => c.items.map((item, index) => ({ kind: "item", item, index })));
	const labels: Label[] = [];
	let nextLabel = options.firstLabel;
	const takeLabel = () => {
		while (song.labels.has(nextLabel) || song.labels.has(nextLabel + 1)) {
			nextLabel++;
		}
		return nextLabel++;
	};

	const interner = new Interner();
	const ids = itemIds(song, options.transpose, interner);
	for (let round = 0; round < MAX_ROUNDS; round++) {
		if (!labelRound(buildRound(song, channels, options, ids, interner), labels, takeLabel)) {
			break;
		}
	}

	for (let c = 0; c < channels.length; c++) {
		channels[c] = superloops(song, c, channels[c], song.channels[c].items);
		if (options.restLoops) {
			channels[c] = restLoops(channels[c], options.barred, c);
		}
	}

	// A body called inside a superloop stays flat: a `[[ ]]` in it would nest in that one (AMK0121).
	const nested = new Set<Label>();
	const visit = (nodes: readonly Node[], inside: boolean) => {
		for (const n of nodes) {
			if (n.kind === "use" && inside) {
				nested.add(n.label);
			} else if (n.kind === "super") {
				visit(n.body, true);
			}
		}
	};
	channels.forEach((nodes) => visit(nodes, false));

	for (const label of labels) {
		if (nested.has(label)) {
			continue;
		}

		label.body = superloops(song, -1, label.body, null);
		if (options.restLoops) {
			label.body = restLoops(label.body, options.barred, -1);
		}
	}

	return { channels, labels };
}

/** What one item is called in the label pass's sequences. */
interface ItemIds {
	/** The key the repeats are found on: relative pitches when transposing. */
	search: number;
	/** The same with a first note's pitch let go. */
	relaxed: number;
	exact: number;
}

/** Interns every item's keys once for the whole plan. */
function itemIds(song: SongItems, transpose: boolean, interner: Interner): Map<Item, ItemIds> {
	const ids = new Map<Item, ItemIds>();
	for (const channel of song.channels) {
		for (const item of channel.items) {
			if (!MUSIC.has(item.kind)) {
				continue;
			}

			const g = item.glued ? "#g" : "";
			const key = transpose ? item.relKey : item.key;
			ids.set(item, {
				search: interner.id(key + g),
				relaxed: interner.id(key.startsWith("p|") ? key.replace(/^p\|[^|]*/, "P") + g : key + g),
				exact: interner.id(item.key + g),
			});
		}
	}

	return ids;
}

/** The song as the label pass reads it in one round: a position per node, and a separator after each channel. */
interface Round {
	song: SongItems;
	channels: Node[][];
	options: PlanOptions;
	where: { channel: number; node: number }[];
	items: (Item | null)[];
	seq: Int32Array;
	relaxed: Int32Array;
	exact: Int32Array;
	/** Bytes of the items before each position. */
	bytes: Float64Array;
}

function buildRound(
	song: SongItems,
	channels: Node[][],
	options: PlanOptions,
	ids: Map<Item, ItemIds>,
	interner: Interner,
): Round {
	const where: { channel: number; node: number }[] = [];
	const items: (Item | null)[] = [];
	const seq: number[] = [];
	const relaxed: number[] = [];
	const exact: number[] = [];
	const push = (channel: number, node: number, item: Item | null) => {
		where.push({ channel, node });
		const known = item ? ids.get(item) : undefined;
		items.push(known ? item : null);
		if (known) {
			seq.push(known.search);
			relaxed.push(known.relaxed);
			exact.push(known.exact);
		} else {
			const fresh = interner.fresh();
			seq.push(fresh);
			relaxed.push(fresh);
			exact.push(fresh);
		}
	};

	for (let c = 0; c < channels.length; c++) {
		const nodes = channels[c];
		for (let j = 0; j < nodes.length; j++) {
			const node = nodes[j];
			push(c, j, node.kind === "item" ? node.item : null);
		}
		push(c, nodes.length, null);
	}

	const bytes = new Float64Array(items.length + 1);
	for (let p = 0; p < items.length; p++) {
		bytes[p + 1] = bytes[p] + (items[p]?.bytes ?? 0);
	}

	return {
		song,
		channels,
		options,
		where,
		items,
		seq: Int32Array.from(seq),
		relaxed: Int32Array.from(relaxed),
		exact: Int32Array.from(exact),
		bytes,
	};
}

/** One round of the label pass: every run worth looping that no better run already took. */
function labelRound(round: Round, labels: Label[], takeLabel: () => number): boolean {
	const { channels, where, items, seq, relaxed } = round;
	const pitched = (item: Item | null) => item?.kind === "note" && item.pitched === true;

	const candidates: Candidate[] = [];
	for (const rep of repeats(seq, 1)) {
		// Reach back over what every occurrence has in common before it: one first note at a
		// different pitch, and anything else alike.
		let back = 0;
		let relaxedNote = false;
		for (; back < 64; back++) {
			const first = rep.positions[0] - back - 1;
			if (rep.positions.some((p) => p - back - 1 < 0 || items[p - back - 1] === null)) {
				break;
			}

			const same = rep.positions.every((p) => seq[p - back - 1] === seq[first]);
			const near = rep.positions.every((p) => relaxed[p - back - 1] === relaxed[first]);
			if (same && !(relaxedNote && pitched(items[first]))) {
				continue;
			}

			if (near && !relaxedNote && pitched(items[first])) {
				relaxedNote = true;
				continue;
			}

			break;
		}

		let starts = rep.positions.map((p) => p - back);
		let length = rep.length + back;
		while (length > 0 && (items[starts[0]]?.glued || tieOpens(items, starts[0], starts[0] + length))) {
			starts = starts.map((p) => p + 1);
			length--;
		}

		if (length <= 0) {
			continue;
		}

		// No run of these can save anything, however its occurrences fall.
		const body = round.bytes[starts[0] + length] - round.bytes[starts[0]];
		if (
			(Math.min(starts.length, Math.floor((starts[starts.length - 1] - starts[0]) / length) + 1) - 1) * body -
				(1 + 2 * EDGE + CALL) <=
			0
		) {
			continue;
		}

		const tries = [length];
		for (let l = length - 1; l > 0; l--) {
			if (!items[starts[0] + l]?.glued && !tieOpens(items, starts[0] + l, items.length)) {
				tries.push(l);
				break;
			}
		}

		for (const l of tries) {
			const candidate = evaluate(round, starts, l, null);
			if (candidate) {
				candidates.push(candidate);
			}
		}
	}

	candidates.sort((a, b) => b.saving - a.saving);
	const claimed = new Uint8Array(seq.length);
	const accepted: Candidate[] = [];
	const signatures = new Set<string>();
	for (const candidate of candidates.slice(0, CANDIDATES_PER_ROUND)) {
		const again = evaluate(round, candidate.start, candidate.length, claimed);
		if (!again || again.saving <= 0) {
			continue;
		}

		const signature = signatureAt(round, again.occurrences[0].at, again.length);
		if (signatures.has(signature) || round.options.barred.has(signature)) {
			continue;
		}

		for (const o of again.occurrences) {
			claimed.fill(1, o.at, o.at + again.length);
		}

		again.signature = signature;
		signatures.add(signature);
		accepted.push(again);
	}

	if (accepted.length === 0) {
		return false;
	}

	// Each run of occurrences becomes one use; channels are rebuilt from the back so indices hold.
	const replacements = new Map<number, { node: number; length: number; replacement: Node }[]>();
	for (const candidate of accepted) {
		const first = candidate.occurrences[0];
		const firstWhere = where[first.at];
		const body = channels[firstWhere.channel].slice(firstWhere.node, firstWhere.node + candidate.length);
		const label: Label = {
			id: takeLabel(),
			body,
			signature: candidate.signature,
			setsInstrument: body.some(nodeSetsInstrument),
		};
		labels.push(label);
		const occurrences = candidate.occurrences;
		for (let i = 0; i < occurrences.length;) {
			let j = i + 1;
			while (
				j < occurrences.length &&
				j - i < MAX_COUNT &&
				occurrences[j].at === occurrences[j - 1].at + candidate.length &&
				occurrences[j].shift === occurrences[i].shift &&
				where[occurrences[j].at].channel === where[occurrences[i].at].channel
			) {
				j++;
			}

			const w = where[occurrences[i].at];
			const nodes = channels[w.channel];
			const span = (j - i) * candidate.length;
			const covered = nodes.slice(w.node, w.node + span);
			const list = replacements.get(w.channel) ?? [];
			list.push({
				node: w.node,
				length: span,
				replacement: {
					kind: "use",
					label,
					count: j - i,
					shift: occurrences[i].shift,
					from: firstIndex(covered[0]),
					to: lastIndex(covered[covered.length - 1]),
				},
			});
			replacements.set(w.channel, list);
			i = j;
		}
	}

	for (const [channel, list] of replacements) {
		list.sort((a, b) => b.node - a.node);
		for (const r of list) {
			channels[channel].splice(r.node, r.length, r.replacement);
		}
	}

	return true;
}

/**
 * Whether the first note, rest or tie in `items[from, to)` is a tie. The read-ahead that keeps a
 * note keyed on into its tie steps over `$E9` and stops at a body's `$00` (`main.asm:2964-3039`),
 * so a tie on the far side of either edge keys the note off instead.
 */
function tieOpens(items: readonly (Item | null)[], from: number, to: number): boolean {
	for (let p = from; p < to; p++) {
		const item = items[p];
		if (item === null) {
			return false;
		}
		if (item.kind === "tie") {
			return true;
		}
		if (item.kind === "note" || item.kind === "rest") {
			return false;
		}
	}
	return false;
}

/** The exact keys of the run at `at`, which a move that failed its proof is barred by across attempts. */
function signatureAt(round: Round, at: number, length: number): string {
	const keys: string[] = [];
	for (let i = 0; i < length; i++) {
		const item = round.items[at + i]!;
		keys.push(item.key + (item.glued ? "#g" : ""));
	}
	return "L|" + keys.join(" ");
}

function firstIndex(node: Node): number {
	return node.kind === "item" ? node.index : node.from;
}

function lastIndex(node: Node): number {
	return node.kind === "item" ? node.index : node.to;
}

/** The occurrences of the run of `length` at `starts` worth taking, and what they save, or null. */
function evaluate(round: Round, starts: number[], length: number, claimed: Uint8Array | null): Candidate | null {
	const { song, channels, where, items, exact } = round;
	const body: Item[] = [];
	for (let i = 0; i < length; i++) {
		const item = items[starts[0] + i];
		if (!item) {
			return null;
		}
		body.push(item);
	}

	if (!body.some((item) => item.kind === "note")) {
		return null;
	}

	// A tie before the body's first note would carry on a note outside it.
	const firstEvent = body.find((item) => item.kind === "note" || item.kind === "rest" || item.kind === "tie");
	if (firstEvent?.kind === "tie") {
		return null;
	}

	const firstPitched = body.findIndex((item) => item.kind === "note" && item.pitched === true);
	const transposable = firstPitched >= 0 && body.every((item) => !item.untransposable);
	const bytes = round.bytes[starts[0] + length] - round.bytes[starts[0]];
	const setsInstrument = body.some(
		(item) => item.setsInstrument || (item.kind === "note" && (item.emitted ?? 0) >= 0xd0),
	);

	const occurrences: Occurrence[] = [];
	let reference: number | null = null;
	let referenceAt = -1;
	let end = -1;
	outer: for (const at of starts) {
		if (at < end) {
			continue;
		}

		if (claimed) {
			for (let i = 0; i < length; i++) {
				if (claimed[at + i] !== 0) {
					continue outer;
				}
			}
		}

		const w = where[at];
		const nodes = channels[w.channel];
		if (glued(nodes[w.node + length]) || tieNext(nodes, w.node + length)) {
			continue;
		}

		// Pitches equal to the first occurrence's, or all moved alike.
		let shift = 0;
		if (firstPitched >= 0 && reference !== null) {
			shift = items[at + firstPitched]!.emitted! - reference;
		}

		if (shift !== 0) {
			if (!transposable || song.tunedChannels.has(song.channels[w.channel].channel) || Math.abs(shift) > MAX_SHIFT) {
				continue;
			}
		} else if (referenceAt >= 0) {
			for (let i = 0; i < length; i++) {
				if (exact[at + i] !== exact[referenceAt + i]) {
					continue outer;
				}
			}
		}

		if (setsInstrument && !followsAlike(song, nodes, w.node, w.node + length)) {
			continue;
		}

		if (referenceAt < 0) {
			referenceAt = at;
			reference = firstPitched >= 0 ? items[at + firstPitched]!.emitted! : null;
		}

		occurrences.push({ at, shift });
		end = at + length;
	}

	if (occurrences.length < 2) {
		return null;
	}

	let runs = 0;
	let transposedRuns = 0;
	for (let i = 0; i < occurrences.length; i++) {
		const prev = occurrences[i - 1] as Occurrence | undefined;
		const joined =
			prev !== undefined &&
			occurrences[i].at === prev.at + length &&
			occurrences[i].shift === prev.shift &&
			where[occurrences[i].at].channel === where[prev.at].channel;
		if (!joined) {
			runs++;
			if (occurrences[i].shift !== 0) {
				transposedRuns++;
			}
		}
	}

	// One run back to back and nothing else is a superloop's to take: `[[c16]]32`, as porters write it.
	if (runs === 1 && length <= MAX_PERIOD) {
		return null;
	}

	const saving =
		occurrences.length * bytes - (bytes + 1 + EDGE) - runs * (CALL + EDGE) - transposedRuns * TRANSPOSE * 2;
	if (saving <= 0) {
		return null;
	}

	return { start: starts, length, occurrences, saving, signature: "" };
}

/**
 * Whether the notes after nodes `[from, to)`, written as a call, compile through the instrument
 * they did: a body compiles on channel 8, so an `@` inside it no longer reaches the text after.
 */
function followsAlike(song: SongItems, nodes: Node[], from: number, to: number): boolean {
	const first = nodes[from];
	const last = nodes[to - 1];
	if (first.kind !== "item" || last.kind !== "item") {
		return false;
	}

	const before = first.item.instrumentBefore;
	if (alike(song, before, last.item.instrumentAfter)) {
		return true;
	}

	for (let j = to; j < nodes.length; j++) {
		const node = nodes[j];
		if (node.kind !== "item") {
			return false;
		}

		if (node.item.tuned) {
			return false;
		}

		if (node.item.setsInstrument) {
			return true;
		}
	}

	return true;
}

/** Runs of a body repeated back to back made `[[ ]]n`. */
function superloops(song: SongItems, channel: number, nodes: Node[], items: readonly Item[] | null): Node[] {
	const calls = items !== null;
	const allowed = (node: Node) =>
		(node.kind === "item" && (MUSIC.has(node.item.kind) || (calls && node.item.kind === "call"))) ||
		(calls && node.kind === "use" && node.label.body.every((n) => n.kind === "item"));
	const keys = nodes.map((n) => (allowed(n) ? nodeKey(n) : null));
	const out: Node[] = [];
	let i = 0;
	while (i < nodes.length) {
		let best: { period: number; count: number; saving: number } | null = null;
		if (keys[i] !== null && !glued(nodes[i])) {
			for (let period = 1; period <= MAX_PERIOD && i + 2 * period <= nodes.length; period++) {
				let ok = true;
				for (let k = 0; k < period; k++) {
					if (keys[i + k] === null) {
						ok = false;
						break;
					}
				}
				if (!ok) {
					break;
				}

				const body = nodes.slice(i, i + period);
				if (!body.some((n) => n.kind !== "item" || n.item.kind === "note" || n.item.kind === "call")) {
					continue;
				}

				if (tieNext(body, 0)) {
					continue;
				}

				let count = 1;
				while (count < MAX_COUNT && i + (count + 1) * period <= nodes.length) {
					let same = true;
					for (let k = 0; k < period; k++) {
						if (keys[i + count * period + k] !== keys[i + k]) {
							same = false;
							break;
						}
					}
					if (!same) {
						break;
					}
					count++;
				}

				while (count >= 2 && (glued(nodes[i + count * period]) || tieNext(nodes, i + count * period))) {
					count--;
				}

				if (count < 2) {
					continue;
				}

				if (body.some(nodeSetsInstrument) && !superloopFollowsAlike(song, nodes, items, i, period, count)) {
					continue;
				}

				const bytes = body.reduce((sum, n) => sum + nodeBytes(n), 0);
				const saving = (count - 1) * bytes - 4 - 2 * EDGE;
				if (saving > 0 && (!best || saving > best.saving)) {
					best = { period, count, saving };
				}
			}
		}

		if (best) {
			const body = nodes.slice(i, i + best.period);
			const covered = nodes.slice(i, i + best.period * best.count);
			out.push({
				kind: "super",
				body,
				count: best.count,
				from: firstIndex(covered[0]),
				to: lastIndex(covered[covered.length - 1]),
				signature: `S|${channel}|${body.map(nodeKey).join(" ")}`,
			});
			i += best.period * best.count;
		} else {
			out.push(nodes[i]);
			i++;
		}
	}

	return out;
}

/** Whether the first note, rest or tie from `from` on is a tie, which would carry on a note before it. */
function tieNext(nodes: readonly Node[], from: number): boolean {
	for (let j = from; j < nodes.length; j++) {
		const n = nodes[j];
		if (n.kind !== "item") {
			return false;
		}

		if (n.item.kind === "tie") {
			return true;
		}

		if (n.item.kind !== "command" && n.item.kind !== "state" && n.item.kind !== "drum") {
			return false;
		}
	}

	return false;
}

/** The instrument the original holds after a node. */
function flatAfter(node: Node, items: readonly Item[] | null): string | null {
	if (node.kind === "item") {
		return node.item.instrumentAfter;
	}
	return items ? items[node.to].instrumentAfter : null;
}

/**
 * A superloop compiles its body once, so the instrument after it is the first pass's, and a call
 * in it changes nothing the compiler holds.
 */
function superloopFollowsAlike(
	song: SongItems,
	nodes: Node[],
	items: readonly Item[] | null,
	i: number,
	period: number,
	count: number,
): boolean {
	const first = nodes[i];
	let held = first.kind === "item" ? first.item.instrumentBefore : items ? items[first.from].instrumentBefore : null;
	if (held === null) {
		return false;
	}

	for (const n of nodes.slice(i, i + period)) {
		if (n.kind === "item" && (n.item.setsInstrument || alike(song, held, n.item.instrumentBefore))) {
			held = n.item.instrumentAfter;
		}
	}

	const after = flatAfter(nodes[i + period * count - 1], items);
	if (after !== null && alike(song, held, after)) {
		return true;
	}

	for (let j = i + period * count; j < nodes.length; j++) {
		const node = nodes[j];
		if (node.kind !== "item" || node.item.tuned) {
			return false;
		}
		if (node.item.setsInstrument) {
			return true;
		}
	}

	return true;
}

/** A long rest, and the rests and ties the compiler merges into it, as `r=R [[r=L]]k`. */
function restLoops(nodes: Node[], barred: ReadonlySet<string>, channel: number): Node[] {
	const out: Node[] = [];
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		if (node.kind !== "item" || node.item.kind !== "rest" || node.item.glued) {
			out.push(node);
			continue;
		}

		let j = i + 1;
		let ticks = node.item.ticks;
		let bytes = node.item.bytes;
		while (j < nodes.length) {
			const next = nodes[j];
			if (next.kind !== "item" || !next.item.glued || (next.item.kind !== "rest" && next.item.kind !== "tie")) {
				break;
			}
			ticks += next.item.ticks;
			bytes += next.item.bytes;
			j++;
		}

		const loop = restLoop(ticks);
		const signature = `R|${channel}|${node.index}`;
		if (loop && bytes - loop.bytes - EDGE > 0 && !barred.has(signature)) {
			out.push({
				kind: "rest",
				unit: loop.unit,
				count: loop.count,
				remainder: loop.remainder,
				from: node.index,
				to: lastIndex(nodes[j - 1]),
				signature,
			});
			i = j - 1;
		} else {
			out.push(node);
		}
	}

	return out;
}

/** The cheapest `[[r=L]]k` plus a rest of what is left for `ticks`, L a single length byte. */
export function restLoop(ticks: number): { unit: number; count: number; remainder: number; bytes: number } | null {
	let best: { unit: number; count: number; remainder: number; bytes: number } | null = null;
	for (let unit = 127; unit >= 1; unit--) {
		const count = Math.floor(ticks / unit);
		if (count < 2 || count > MAX_COUNT) {
			continue;
		}

		const remainder = ticks - count * unit;
		if (remainder > 127) {
			continue;
		}

		const bytes = 7 + (remainder > 0 ? 2 : 0);
		if (!best || bytes < best.bytes) {
			best = { unit, count, remainder, bytes };
		}
	}

	return best;
}
