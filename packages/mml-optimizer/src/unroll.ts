/** A song's loops written out pass by pass, so the passes can loop it again their own way: each copy in the octave and default length its body was written under. */

import { type Token, tokenize } from "@amk/tokens";

interface State {
	octave: number | null;
	length: string | null;
}

interface Body {
	text: string;
	start: State;
}

/**
 * `text` with every `[ ]n`, `(n)[ ]m`, `(n)m`, `[[ ]]n` and `*` replaced by its passes, or null where
 * one cannot be: a body under an octave a replacement hides, a `*` that replays a remote body, a
 * recall of a label never defined.
 */
export function unrollLoops(text: string): string | null {
	const { tokens, commands } = tokenize(text);
	const commandAt = new Map(commands.map((c) => [c.span.start, c]));

	// The octave and default length in force before each token, in text order, as the compiler reads them.
	const before: State[] = [];
	let octave: number | null = 4;
	let length: string | null = null;
	for (const t of tokens) {
		before.push({ octave, length });
		if (t.kind === "octave") {
			const c = commandAt.get(t.start);
			octave = c && !c.replacement ? (c.args[0]?.value ?? null) : null;
		} else if (t.kind === "octaveShift") {
			octave = octave === null ? null : octave + (text[t.start] === ">" ? 1 : -1);
		} else if (t.kind === "defaultLength") {
			const c = commandAt.get(t.start);
			length = c && !c.replacement ? text.slice(c.span.start, c.span.end) : null;
		} else if (t.kind === "replacement") {
			octave = null;
			length = null;
		}
	}
	before.push({ octave, length });

	const labels = new Map<number, Body>();
	let previous: Body | null = null;
	let failed = false;

	const state = (s: State): string => {
		if (s.octave === null) {
			failed = true;
			return "";
		}
		return ` o${s.octave}${s.length !== null ? ` ${s.length}` : ""} `;
	};

	const passes = (body: Body, count: number, after: State): string =>
		Array.from({ length: count }, () => state(body.start) + body.text).join("\n") + "\n" + state(after);

	/** The count written straight after token `i`, and the token after it. */
	const countAfter = (i: number, end: number): { count: number; next: number } => {
		const t = tokens[i + 1] as Token | undefined;
		if (t?.kind === "number" && t.start === tokens[i].end && i + 1 < end) {
			return { count: Number(text.slice(t.start, t.end)), next: i + 2 };
		}
		return { count: 1, next: i + 1 };
	};

	/** The token closing the bracket opened at `i`. */
	const closing = (i: number, end: number): number => {
		let depth = 0;
		for (let j = i; j < end; j++) {
			if (tokens[j].kind === "loopStart") {
				depth++;
			} else if (tokens[j].kind === "loopEnd" && --depth === 0) {
				return j;
			}
		}
		failed = true;
		return end - 1;
	};

	const expand = (from: number, to: number, endOffset: number): string => {
		let out = "";
		let copied = from < tokens.length ? tokens[from].start : endOffset;
		let i = from;
		const copyTo = (offset: number) => {
			out += text.slice(copied, offset);
		};

		while (i < to && !failed) {
			const t = tokens[i];
			if (t.kind === "label" && text[t.start] === "(" && text[t.start + 1] !== "!") {
				const close = text.indexOf(")", t.start);
				const label = Number(text.slice(t.start + 1, close));
				let j = i;
				while (j < to && tokens[j].end <= close + 1) {
					j++;
				}

				copyTo(t.start);
				if (j < to && tokens[j].kind === "loopStart" && tokens[j].start === close + 1) {
					const end = closing(j, to);
					const body: Body = { text: expand(j + 1, end, tokens[end].start), start: before[j + 1] };
					labels.set(label, body);
					previous = body;
					const { count, next } = countAfter(end, to);
					out += passes(body, count, before[next]);
					i = next;
				} else {
					const body = labels.get(label);
					if (!body) {
						failed = true;
						break;
					}
					const { count, next } = countAfter(j - 1, to);
					out += passes(body, count, before[i]);
					i = next;
				}

				copied = i < tokens.length ? tokens[i].start : endOffset;
				continue;
			}

			if (t.kind === "label" && text[t.start] === "(") {
				// A remote definition or call, kept as written; a remote body is something `*` may name.
				const close = text.indexOf(")", t.start);
				let j = i;
				while (j < to && tokens[j].end <= close + 1) {
					j++;
				}
				if (j < to && tokens[j].kind === "loopStart" && tokens[j].start === close + 1) {
					j = closing(j, to) + 1;
					previous = null;
				}
				i = j;
				continue;
			}

			if (t.kind === "loopStart") {
				copyTo(t.start);
				const superloop = tokens[i + 1]?.kind === "loopStart" && tokens[i + 1].start === t.end;
				const end = closing(i, to);
				const bodyEnd = superloop ? end - 1 : end;
				const open = superloop ? i + 2 : i + 1;
				const body: Body = { text: expand(open, bodyEnd, tokens[bodyEnd].start), start: before[open] };
				if (!superloop) {
					previous = body;
				}
				const { count, next } = countAfter(end, to);
				out += passes(body, count, before[next]);
				i = next;
				copied = i < tokens.length ? tokens[i].start : endOffset;
				continue;
			}

			if (t.kind === "loopCall") {
				copyTo(t.start);
				if (!previous) {
					failed = true;
					break;
				}
				const { count, next } = countAfter(i, to);
				out += passes(previous, count, before[i]);
				i = next;
				copied = i < tokens.length ? tokens[i].start : endOffset;
				continue;
			}

			i++;
		}

		copyTo(i < tokens.length && i < to ? tokens[i].start : endOffset);
		return out;
	};

	const flat = expand(0, tokens.length, text.length);
	return failed ? null : flat;
}
