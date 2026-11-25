/** A plan written back out as MML: each note in an octave it states, each label defined where it is first used, and a transposed call wrapped in `$FA $02`. */

import type { Label, Node, Plan } from "./plan";
import type { Item, SongItems } from "./read";
import { spellTicks } from "./read";

const LINE = 100;

/** Where a move was written, so a compile or walk that fails can name it. */
export interface Mark {
	start: number;
	end: number;
	signature: string;
}

export interface Written {
	text: string;
	marks: Mark[];
	/** Where each channel's text starts. */
	channelStarts: number[];
	/** Each note written, by where it starts, and the byte its letter and octave must name. */
	notes: { offset: number; written: number }[];
}

function hexByte(value: number): string {
	return "$" + (value & 0xff).toString(16).toUpperCase().padStart(2, "0");
}

/** The signature a node's move is barred by, or null for an item. */
export function signatureOf(n: Node): string | null {
	switch (n.kind) {
		case "item":
			return null;
		case "use":
			return n.label.signature;
		case "super":
		case "rest":
			return n.signature;
	}
}

/** Writes `plan` for `song`. */
export function writePlan(song: SongItems, plan: Plan): Written {
	// The compiler's octave and default length run on in text order from channel to channel.
	let octave: number | null = null;
	let length: string | null = null;
	const defined = new Set<Label>();
	const marks: Mark[] = [];
	const channelStarts: number[] = [];
	const notes: { offset: number; written: number }[] = [];
	let text = song.head.replace(/\s*$/, "\n\n");
	let lineStart = text.length;

	const put = (word: string) => {
		if (text.length > lineStart) {
			if (text.length - lineStart + word.length + 1 > LINE) {
				text += "\n";
				lineStart = text.length;
			} else {
				text += " ";
			}
		}
		text += word;
	};

	const flush = () => {
		if (text.length > lineStart) {
			text += "\n";
			lineStart = text.length;
		}
	};

	for (let c = 0; c < song.channels.length; c++) {
		channelStarts.push(text.length);
		text += song.channels[c].header + "\n";
		lineStart = text.length;
		let tune = 0;

		const toOctave = (target: number) => {
			if (octave === target) {
				return;
			}
			put(octave === target - 1 ? ">" : octave === target + 1 ? "<" : `o${target}`);
			octave = target;
		};

		const setTune = (value: number) => {
			if (tune !== value) {
				put(`$FA $02 ${hexByte(value)}`);
				tune = value;
			}
		};

		const item = (it: Item) => {
			if (it.restore) {
				if (it.restore.octave !== null && it.restore.octave !== octave) {
					put(`o${it.restore.octave}`);
				}
				octave = it.restore.octave;
				if (it.restore.length !== null && it.restore.length !== length) {
					put(it.restore.length);
				}
				length = it.restore.length;
			}

			if (it.kind === "note" && it.octave !== undefined) {
				toOctave(it.octave);
			}

			if (it.targetOctave !== undefined && it.targetOctave !== null) {
				toOctave(it.targetOctave);
			}

			const words = it.text.trim();
			if (words.includes("\n")) {
				flush();
				text += words + "\n";
				lineStart = text.length;
			} else {
				put(words);
				if (it.kind === "note" && it.written !== undefined) {
					notes.push({ offset: text.length - words.length, written: it.written });
				}
			}

			if (it.restore && it.leaves) {
				octave = it.leaves.octave;
				length = it.leaves.length;
			}

			// A comment runs to the end of its line.
			if (it.kind === "fixed" && /;[^\n]*$/.test(words)) {
				flush();
			}
		};

		const node = (n: Node) => {
			if (n.kind !== "use" || n.shift === 0) {
				setTune(0);
			}

			const signature = signatureOf(n);
			const start = text.length;
			switch (n.kind) {
				case "item":
					item(n.item);
					return;
				case "use": {
					setTune(n.shift);
					const count = n.count > 1 ? String(n.count) : "";
					if (defined.has(n.label)) {
						put(`(${n.label.id})${count}`);
						break;
					}

					defined.add(n.label);
					flush();
					put(`(${n.label.id})[`);
					for (const inner of n.label.body) {
						node(inner);
					}
					setTune(0);
					put(`]${count}`);
					flush();
					break;
				}
				case "super":
					put("[[");
					for (const inner of n.body) {
						node(inner);
					}
					setTune(0);
					put(`]]${n.count}`);
					break;
				case "rest":
					if (n.remainder > 0) {
						put(`r${spellTicks(n.remainder)}`);
					}
					put(`[[r${spellTicks(n.unit)}]]${n.count}`);
					break;
			}

			if (signature !== null) {
				marks.push({ start, end: text.length, signature });
			}
		};

		for (const n of plan.channels[c]) {
			node(n);
		}
		setTune(0);
		flush();
		text += "\n";
		lineStart = text.length;
	}

	return { text: text.replace(/\n+$/, "\n"), marks, channelStarts, notes };
}
